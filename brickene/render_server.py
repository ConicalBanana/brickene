"""Serve backend molecule renders for the standalone frontend."""

from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import typer

from brickene import get_version
from brickene.brick_store import DEFAULT_BRICK_DB_PATH, BrickStore
from brickene.core.node import Atom, BrickNode, BrickType, Port
from brickene.core.rendering import (
    DEFAULT_CATALOG_PATH,
    DEFAULT_IMAGE_SIZE,
    load_brick_catalog,
    render_brick_definition_image_bytes,
    render_state_image_bytes,
    render_state_smiles,
)

app = typer.Typer(help="Run the Brickene RDKit render server.")
PACKAGE_VERSION = get_version()


def serialize_brick_definition(node: BrickNode) -> dict[str, Any]:
    """Serialize one brick node and annotate its ports with bonded symbols."""

    payload = node.to_dict()
    connected_symbol_by_port = get_connected_symbol_by_port(node)

    for site_payload in payload["nodes"]:
        if site_payload.get("kind") != "port":
            continue

        site_payload["connected_symbol"] = connected_symbol_by_port.get(
            int(site_payload["index"])
        )

    return payload


def get_connected_symbol_by_port(node: BrickNode) -> dict[int, str | None]:
    """Find the directly bonded atom symbol for each port in one brick."""

    connected_symbol_by_port = {port.index: None for port in node.ports}

    for edge in node.edges:
        left_site = edge.left
        right_site = edge.right
        port_site: Port | None = None
        atom_site: Atom | None = None

        if isinstance(left_site, Port) and isinstance(right_site, Atom):
            port_site = left_site
            atom_site = right_site
        elif isinstance(left_site, Atom) and isinstance(right_site, Port):
            port_site = right_site
            atom_site = left_site

        if port_site is None or atom_site is None:
            continue

        existing_symbol = connected_symbol_by_port[port_site.index]
        if existing_symbol is not None and existing_symbol != atom_site.symbol:
            raise ValueError(
                "Each port must connect to exactly one atom symbol in the brick."
            )

        connected_symbol_by_port[port_site.index] = atom_site.symbol

    return connected_symbol_by_port


def parse_brick_type(value: Any) -> BrickType:
    """Normalize one request payload value to a supported BrickType."""

    normalized = str(value or BrickType.SKELETON.name).strip().upper()

    try:
        return BrickType[normalized]
    except KeyError as exc:
        raise ValueError(
            "brick_type must be one of SKELETON, SIDE_CHAIN, SUBSTITUENT, or BRIDGE."
        ) from exc


def normalize_aliases(value: Any) -> list[str]:
    """Normalize one alias request value to a clean string list."""

    if value is None:
        return []

    if not isinstance(value, list):
        raise ValueError("alias must be an array of strings.")

    aliases = []
    for alias in value:
        if not isinstance(alias, str):
            raise ValueError("alias must be an array of strings.")

        normalized = alias.strip()
        if normalized:
            aliases.append(normalized)

    return aliases


def normalize_brick_definition(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize one posted brick definition payload.

    The request may either be the definition object itself or a wrapper with a
    top-level ``definition`` key.
    """

    definition_payload = payload.get("definition", payload)
    if not isinstance(definition_payload, dict):
        raise ValueError("definition must be a JSON object.")

    normalized_definition = dict(definition_payload)
    normalized_definition["brick_type"] = parse_brick_type(
        definition_payload.get("brick_type")
    ).name

    try:
        node = BrickNode.from_dict(normalized_definition)
    except KeyError as exc:
        raise ValueError(
            f"Invalid brick definition: missing {exc.args[0]}."
        ) from exc
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid brick definition: {exc}") from exc

    if not node.nodes:
        raise ValueError("definition must include at least one node.")

    return {
        "name": str(definition_payload.get("name") or "User defined").strip()
        or "User defined",
        "alias": normalize_aliases(definition_payload.get("alias")),
        **serialize_brick_definition(node),
    }


def build_runtime_catalog(
    catalog_path: Path,
    brick_store: BrickStore,
) -> dict[str, dict[str, Any]]:
    """Load the built-in catalog and merge stored user-defined bricks."""

    catalog = load_brick_catalog(catalog_path)
    catalog.update(brick_store.catalog_entries())
    return catalog


def create_handler(
    catalog_path: Path,
    image_size: int,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
) -> type[BaseHTTPRequestHandler]:
    """Create a request handler bound to one render configuration.

    Args:
        catalog_path: Path to the brick catalog JSON.
        image_size: Width and height of returned PNG renders.
        brick_db_path: Path to the SQLite database for user-defined bricks.

    Returns:
        Request handler class for the configured render service.
    """

    brick_store = BrickStore(brick_db_path)

    class RenderRequestHandler(BaseHTTPRequestHandler):
        """Handle HTTP requests for graph image rendering."""

        server_version = f"BrickeneRenderServer/{PACKAGE_VERSION}"

        def do_OPTIONS(self) -> None:
            """Respond to CORS preflight requests."""

            self.send_response(HTTPStatus.NO_CONTENT)
            self._send_cors_headers()
            self.end_headers()

        def do_GET(self) -> None:
            """Serve a basic health endpoint."""

            request_path = urlparse(self.path).path.rstrip("/") or "/"

            if request_path == "/health":
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "status": "ok",
                        "catalog_path": str(catalog_path),
                        "image_size": image_size,
                        "brick_db_path": str(brick_db_path),
                        "stored_brick_count": brick_store.count_bricks(),
                    },
                )
                return

            if request_path == "/version":
                self._send_json(
                    HTTPStatus.OK,
                    {"version": PACKAGE_VERSION},
                )
                return

            if request_path == "/bricks":
                self._send_json(
                    HTTPStatus.OK,
                    {"bricks": brick_store.list_bricks()},
                )
                return

            if request_path.startswith("/bricks/"):
                brick_id = request_path.removeprefix("/bricks/")
                definition = brick_store.get_brick(brick_id)
                if definition is None:
                    self._send_json(
                        HTTPStatus.NOT_FOUND,
                        {"error": f"Unknown stored brick id: {brick_id}."},
                    )
                    return

                self._send_json(
                    HTTPStatus.OK,
                    {"definition": definition},
                )
                return

            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"error": "Not found."},
            )
            return

        def do_POST(self) -> None:
            """Render a posted graph payload into backend representations.

            The payload may include optional edge bond type metadata via
            ``bondType`` or ``bond_type`` on individual edges.
            """

            request_path = urlparse(self.path).path.rstrip("/") or "/"
            if request_path not in {
                "/render",
                "/smiles",
                "/brick-config",
                "/bricks",
                "/brick-render",
            }:
                self._send_json(
                    HTTPStatus.NOT_FOUND,
                    {"error": "Not found."},
                )
                return

            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                request_body = self.rfile.read(content_length)
                payload = json.loads(request_body.decode("utf-8"))
            except json.JSONDecodeError:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Request body must be valid JSON."},
                )
                return

            if not isinstance(payload, dict):
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Request body must decode to a JSON object."},
                )
                return

            if request_path == "/brick-config":
                try:
                    smiles = str(payload.get("smiles") or "").strip()
                    if not smiles:
                        raise ValueError("smiles must be a non-empty string.")

                    node = BrickNode.from_smiles(
                        smiles,
                        brick_type=parse_brick_type(payload.get("brick_type")),
                    )
                    definition = {
                        "name": str(payload.get("name") or "User defined").strip()
                        or "User defined",
                        "alias": normalize_aliases(payload.get("alias")),
                        **serialize_brick_definition(node),
                    }
                except (TypeError, ValueError) as exc:
                    self._send_json(
                        HTTPStatus.BAD_REQUEST,
                        {"error": str(exc)},
                    )
                    return

                self._send_json(
                    HTTPStatus.OK,
                    {"definition": definition},
                )
                return

            if request_path == "/bricks":
                try:
                    definition = normalize_brick_definition(payload)
                    stored_definition = brick_store.save_brick(definition)
                except (TypeError, ValueError) as exc:
                    self._send_json(
                        HTTPStatus.BAD_REQUEST,
                        {"error": str(exc)},
                    )
                    return

                self._send_json(
                    HTTPStatus.CREATED,
                    {"definition": stored_definition},
                )
                return

            if request_path == "/brick-render":
                try:
                    definition = normalize_brick_definition(payload)
                    image_bytes = render_brick_definition_image_bytes(
                        definition,
                        image_size=image_size,
                    )
                except (TypeError, ValueError) as exc:
                    self._send_json(
                        HTTPStatus.BAD_REQUEST,
                        {"error": str(exc)},
                    )
                    return
                except Exception as exc:  # pragma: no cover
                    self._send_json(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        {"error": f"Render failed: {exc}"},
                    )
                    return

                self.send_response(HTTPStatus.OK)
                self._send_cors_headers()
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(image_bytes)))
                self.end_headers()
                self.wfile.write(image_bytes)
                return

            runtime_catalog = build_runtime_catalog(catalog_path, brick_store)

            try:
                if request_path == "/render":
                    image_bytes = render_state_image_bytes(
                        payload,
                        image_size=image_size,
                        catalog_path=catalog_path,
                        catalog=runtime_catalog,
                    )
                else:
                    smiles = render_state_smiles(
                        payload,
                        catalog_path=catalog_path,
                        catalog=runtime_catalog,
                    )
            except (TypeError, ValueError) as exc:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": str(exc)},
                )
                return
            except Exception as exc:  # pragma: no cover
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": f"Render failed: {exc}"},
                )
                return

            if request_path == "/smiles":
                self._send_json(
                    HTTPStatus.OK,
                    {"smiles": smiles},
                )
                return

            self.send_response(HTTPStatus.OK)
            self._send_cors_headers()
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(image_bytes)))
            self.end_headers()
            self.wfile.write(image_bytes)

        def log_message(self, format: str, *args: Any) -> None:
            """Write concise request logs to stdout."""

            typer.echo(
                "%s - - [%s] %s"
                % (
                    self.address_string(),
                    self.log_date_time_string(),
                    format % args,
                )
            )

        def _send_cors_headers(self) -> None:
            """Write the standard CORS headers for frontend access."""

            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
            """Write a JSON response with CORS headers."""

            response = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

    return RenderRequestHandler


def serve(
    host: str = "127.0.0.1",
    port: int = 8765,
    catalog_path: Path = DEFAULT_CATALOG_PATH,
    image_size: int = DEFAULT_IMAGE_SIZE,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
) -> None:
    """Run the render server.

    Args:
        host: Host interface to bind.
        port: TCP port to bind.
        catalog_path: Path to the brick catalog JSON.
        image_size: Width and height of returned PNG renders.
        brick_db_path: Path to the SQLite database for user-defined bricks.
    """

    server = ThreadingHTTPServer(
        (host, port),
        create_handler(catalog_path, image_size, brick_db_path),
    )
    typer.echo(f"Brickene render server listening on http://{host}:{port}")
    typer.echo(f"Using catalog {catalog_path.resolve()}")
    typer.echo(f"Using brick database {brick_db_path.resolve()}")
    server.serve_forever()


@app.command()
def main(
    host: str = typer.Option("127.0.0.1", help="Host interface to bind."),
    port: int = typer.Option(8765, help="TCP port to bind."),
    catalog_path: Path = typer.Option(
        DEFAULT_CATALOG_PATH,
        help="Path to the brick catalog JSON.",
    ),
    image_size: int = typer.Option(
        DEFAULT_IMAGE_SIZE,
        help="Width and height of the rendered PNG.",
    ),
    brick_db_path: Path = typer.Option(
        DEFAULT_BRICK_DB_PATH,
        help="Path to the SQLite database for user-defined bricks.",
    ),
) -> None:
    """Start the HTTP render interface for frontend preview requests."""

    serve(
        host=host,
        port=port,
        catalog_path=catalog_path,
        image_size=image_size,
        brick_db_path=brick_db_path,
    )


if __name__ == "__main__":
    app()
