"""Serve backend molecule renders for the standalone frontend."""

from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import typer

from brickene.core.rendering import DEFAULT_CATALOG_PATH, DEFAULT_IMAGE_SIZE, render_state_image_bytes

app = typer.Typer(help="Run the Brickene RDKit render server.")


def create_handler(catalog_path: Path, image_size: int) -> type[BaseHTTPRequestHandler]:
    """Create a request handler bound to one render configuration.

    Args:
        catalog_path: Path to the brick catalog JSON.
        image_size: Width and height of returned PNG renders.

    Returns:
        Request handler class for the configured render service.
    """

    class RenderRequestHandler(BaseHTTPRequestHandler):
        """Handle HTTP requests for graph image rendering."""

        server_version = "BrickeneRenderServer/0.1"

        def do_OPTIONS(self) -> None:
            """Respond to CORS preflight requests."""

            self.send_response(HTTPStatus.NO_CONTENT)
            self._send_cors_headers()
            self.end_headers()

        def do_GET(self) -> None:
            """Serve a basic health endpoint."""

            if urlparse(self.path).path != "/health":
                self._send_json(
                    HTTPStatus.NOT_FOUND,
                    {"error": "Not found."},
                )
                return

            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "catalog_path": str(catalog_path),
                    "image_size": image_size,
                },
            )

        def do_POST(self) -> None:
            """Render a posted graph payload into a PNG image."""

            if urlparse(self.path).path != "/render":
                self._send_json(
                    HTTPStatus.NOT_FOUND,
                    {"error": "Not found."},
                )
                return

            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                request_body = self.rfile.read(content_length)
                payload = json.loads(request_body.decode("utf-8"))
                image_bytes = render_state_image_bytes(
                    payload,
                    image_size=image_size,
                    catalog_path=catalog_path,
                )
            except json.JSONDecodeError:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Request body must be valid JSON."},
                )
                return
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

        def log_message(self, format: str, *args: Any) -> None:
            """Write concise request logs to stdout."""

            typer.echo("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), format % args))

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
) -> None:
    """Run the render server.

    Args:
        host: Host interface to bind.
        port: TCP port to bind.
        catalog_path: Path to the brick catalog JSON.
        image_size: Width and height of returned PNG renders.
    """

    server = ThreadingHTTPServer((host, port), create_handler(catalog_path, image_size))
    typer.echo(f"Brickene render server listening on http://{host}:{port}")
    typer.echo(f"Using catalog {catalog_path.resolve()}")
    server.serve_forever()


@app.command()
def main(
    host: str = typer.Option("127.0.0.1", help="Host interface to bind."),
    port: int = typer.Option(8765, help="TCP port to bind."),
    catalog_path: Path = typer.Option(DEFAULT_CATALOG_PATH, help="Path to the brick catalog JSON."),
    image_size: int = typer.Option(DEFAULT_IMAGE_SIZE, help="Width and height of the rendered PNG."),
) -> None:
    """Start the HTTP render interface for frontend preview requests."""

    serve(host=host, port=port, catalog_path=catalog_path, image_size=image_size)


if __name__ == "__main__":
    app()