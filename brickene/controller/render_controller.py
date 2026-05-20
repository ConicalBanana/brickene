"""HTTP request handlers and CLI entry point for the render server."""

from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import typer

from brickene import get_version
from brickene.dto.frontend_payload import GraphPayload
from brickene.model.brick import BrickNode
from brickene.service.rendering import DEFAULT_IMAGE_SIZE
from brickene.repository.brick_repository import (
    DEFAULT_BRICK_DB_PATH,
    DEFAULT_USER_BRICK_DB_PATH,
    RuntimeBrickStore,
)
from brickene.service.brick_service import (
    build_runtime_catalog,
    normalize_aliases,
    normalize_brick_definition,
    parse_brick_type,
    serialize_brick_definition,
)
from brickene.service.render_service import (
    render_brick_definition_image_bytes,
    render_brick_definition_svg,
    render_state_image_bytes,
    render_state_smiles,
)

app = typer.Typer(help="Run the Brickene RDKit render server.")
PACKAGE_VERSION = get_version()


def create_handler(
    image_size: int,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> type[BaseHTTPRequestHandler]:
    """Create a request handler bound to one render configuration.

    Args:
        image_size: Width and height of returned PNG renders.
        brick_db_path: Path to the SQLite database for system bricks.
        user_brick_db_path: Path to the SQLite database for user-defined bricks.

    Returns:
        Request handler class for the configured render service.
    """

    brick_store = RuntimeBrickStore(brick_db_path, user_brick_db_path)

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
                        "image_size": image_size,
                        "brick_db_path": str(brick_db_path),
                        "user_brick_db_path": str(user_brick_db_path),
                        "stored_brick_count": brick_store.count_bricks(),
                        "system_brick_count": brick_store.count_system_bricks(),
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
                brick_path = request_path.removeprefix("/bricks/")

                if brick_path.endswith("/image.svg"):
                    brick_id = brick_path.removesuffix("/image.svg")
                    svg_text = brick_store.get_brick_svg_text(brick_id)
                    if svg_text is None:
                        self._send_json(
                            HTTPStatus.NOT_FOUND,
                            {
                                "error": (
                                    f"No stored SVG asset for brick id: {brick_id}."
                                )
                            },
                        )
                        return

                    self._send_text(
                        HTTPStatus.OK,
                        svg_text,
                        "image/svg+xml",
                    )
                    return

                if brick_path.endswith("/layout.json"):
                    brick_id = brick_path.removesuffix("/layout.json")
                    layout_payload = brick_store.get_brick_layout(brick_id)
                    if layout_payload is None:
                        self._send_json(
                            HTTPStatus.NOT_FOUND,
                            {
                                "error": (
                                    f"No stored layout asset for brick id: {brick_id}."
                                )
                            },
                        )
                        return

                    self._send_json(
                        HTTPStatus.OK,
                        layout_payload,
                    )
                    return

                brick_id = brick_path
                definition = brick_store.get_brick(brick_id)
                if definition is None:
                    self._send_json(
                        HTTPStatus.NOT_FOUND,
                        {"error": f"Unknown brick id: {brick_id}."},
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
                    svg_text = render_brick_definition_svg(
                        definition,
                        image_size=image_size,
                    )
                    stored_definition = brick_store.save_brick(
                        definition,
                        svg_text=svg_text,
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
                        {"error": f"Save failed: {exc}"},
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

            runtime_catalog = build_runtime_catalog(brick_store)

            try:
                graph_payload = GraphPayload.from_dict(payload)
            except (TypeError, ValueError) as exc:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": str(exc)},
                )
                return

            try:
                if request_path == "/render":
                    image_bytes = render_state_image_bytes(
                        graph_payload,
                        image_size=image_size,
                        catalog=runtime_catalog,
                    )
                else:
                    smiles = render_state_smiles(
                        graph_payload,
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

        def _send_text(
            self,
            status: HTTPStatus,
            payload: str,
            content_type: str,
        ) -> None:
            """Write a UTF-8 text response with CORS headers."""

            response = payload.encode("utf-8")
            self.send_response(status)
            self._send_cors_headers()
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

    return RenderRequestHandler


def serve(
    host: str = "127.0.0.1",
    port: int = 8765,
    image_size: int = DEFAULT_IMAGE_SIZE,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> None:
    """Run the render server.

    Args:
        host: Host interface to bind.
        port: TCP port to bind.
        image_size: Width and height of returned PNG renders.
        brick_db_path: Path to the SQLite database for system bricks.
        user_brick_db_path: Path to the SQLite database for user-defined bricks.
    """

    server = ThreadingHTTPServer(
        (host, port),
        create_handler(image_size, brick_db_path, user_brick_db_path),
    )
    typer.echo(f"Brickene render server listening on http://{host}:{port}")
    typer.echo(f"Using system brick database {brick_db_path.resolve()}")
    typer.echo(f"Using user brick database {user_brick_db_path.resolve()}")
    server.serve_forever()


@app.command()
def main(
    host: str = typer.Option("127.0.0.1", help="Host interface to bind."),
    port: int = typer.Option(8765, help="TCP port to bind."),
    image_size: int = typer.Option(
        DEFAULT_IMAGE_SIZE,
        help="Width and height of the rendered PNG.",
    ),
    brick_db_path: Path = typer.Option(
        DEFAULT_BRICK_DB_PATH,
        help="Path to the SQLite database for system bricks.",
    ),
    user_brick_db_path: Path = typer.Option(
        DEFAULT_USER_BRICK_DB_PATH,
        help="Path to the SQLite database for user-defined bricks.",
    ),
) -> None:
    """Start the HTTP render interface for frontend preview requests."""

    serve(
        host=host,
        port=port,
        image_size=image_size,
        brick_db_path=brick_db_path,
        user_brick_db_path=user_brick_db_path,
    )


if __name__ == "__main__":
    app()
