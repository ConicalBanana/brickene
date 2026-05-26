"""HTTP controller layer for the Brickene render server."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import typer
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from brickene import get_version
from brickene.dto.frontend_payload import GraphPayload
from brickene.model.brick import BrickNode
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
    render_brick_definition_svg,
    render_brick_definition_svg_and_layout,
    render_state_smiles,
    render_state_svg,
)
from brickene.service.rendering import DEFAULT_IMAGE_SIZE

app = typer.Typer(help="Run the Brickene RDKit render server.")
PACKAGE_VERSION = get_version()

_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def _error(message: str, status: int = 400) -> JSONResponse:
    """Return a standardized JSON error response."""

    return JSONResponse({"error": message}, status_code=status)


async def _read_json_body(request: Request) -> dict[str, Any] | JSONResponse:
    """Parse and validate that the request body is a JSON object."""

    try:
        body = await request.body()
        payload = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return _error("Request body must be valid JSON.")

    if not isinstance(payload, dict):
        return _error("Request body must decode to a JSON object.")

    return payload


def create_app(
    image_size: int = DEFAULT_IMAGE_SIZE,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> FastAPI:
    """Create a FastAPI application for the Brickene render server.

    Args:
        image_size: Width and height of rendered SVG images in pixels.
        brick_db_path: Path to the SQLite database for system bricks.
        user_brick_db_path: Path to the SQLite database for user-defined bricks.

    Returns:
        Configured FastAPI application instance.
    """

    brick_store = RuntimeBrickStore(brick_db_path, user_brick_db_path)
    server = FastAPI(title="Brickene Render Server", version=PACKAGE_VERSION)

    # -----------------------------------------------------------------------
    # CORS — always add headers; handle OPTIONS preflight directly
    # -----------------------------------------------------------------------

    @server.middleware("http")
    async def cors_middleware(request: Request, call_next: Any) -> Response:
        if request.method == "OPTIONS":
            return Response(status_code=204, headers=_CORS_HEADERS)
        response = await call_next(request)
        for key, value in _CORS_HEADERS.items():
            response.headers[key] = value
        return response

    @server.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request,
        exc: StarletteHTTPException,
    ) -> JSONResponse:
        if exc.status_code == 404:
            return _error("Not found.", 404)
        return _error(str(exc.detail), exc.status_code)

    # -----------------------------------------------------------------------
    # GET endpoints
    # -----------------------------------------------------------------------

    @server.get("/health")
    def health() -> dict[str, Any]:
        """Report server status and bound configuration."""

        return {
            "status": "ok",
            "image_size": image_size,
            "brick_db_path": str(brick_db_path),
            "user_brick_db_path": str(user_brick_db_path),
            "stored_brick_count": brick_store.count_bricks(),
            "system_brick_count": brick_store.count_system_bricks(),
        }

    @server.get("/version")
    def version() -> dict[str, str]:
        """Return the installed package version."""

        return {"version": PACKAGE_VERSION}

    @server.get("/bricks")
    def list_bricks() -> dict[str, Any]:
        """List all available brick definitions."""

        return {"bricks": brick_store.list_bricks()}

    @server.get("/bricks/{brick_id}/image")
    def get_brick_image(brick_id: str) -> Response:
        """Return the stored SVG image for one brick."""

        svg_text = brick_store.get_brick_svg_text(brick_id)
        if svg_text is None:
            return _error(f"No stored SVG asset for brick id: {brick_id}.", 404)
        return Response(
            content=svg_text,
            media_type="image/svg+xml; charset=utf-8",
        )

    @server.get("/bricks/{brick_id}/layout")
    def get_brick_layout(brick_id: str) -> Any:
        """Return the stored layout JSON for one brick."""

        layout = brick_store.get_brick_layout(brick_id)
        if layout is None:
            return _error(
                f"No stored layout asset for brick id: {brick_id}.", 404
            )
        return layout

    @server.get("/bricks/{brick_id}")
    def get_brick(brick_id: str) -> Any:
        """Return the definition for one brick by id."""

        definition = brick_store.get_brick(brick_id)
        if definition is None:
            return _error(f"Unknown brick id: {brick_id}.", 404)
        return {"definition": definition}

    # -----------------------------------------------------------------------
    # POST endpoints — specific paths before parameterised ones
    # -----------------------------------------------------------------------

    @server.post("/bricks/preview")
    async def preview_brick(request: Request) -> Any:
        """Parse a SMILES string into a brick definition preview."""

        payload = await _read_json_body(request)
        if isinstance(payload, JSONResponse):
            return payload

        try:
            smiles = str(payload.get("smiles") or "").strip()
            if not smiles:
                raise ValueError("smiles must be a non-empty string.")
            node = BrickNode.from_smiles(
                smiles,
                brick_type=parse_brick_type(payload.get("brick_type")),
            )
            definition = {
                "name": (
                    str(payload.get("name") or "User defined").strip()
                    or "User defined"
                ),
                "alias": normalize_aliases(payload.get("alias")),
                **serialize_brick_definition(node),
            }
        except (TypeError, ValueError) as exc:
            return _error(str(exc))

        return {"definition": definition}

    @server.post("/bricks/render")
    async def render_brick(request: Request) -> Any:
        """Render a brick definition payload to an SVG image."""

        payload = await _read_json_body(request)
        if isinstance(payload, JSONResponse):
            return payload

        try:
            definition = normalize_brick_definition(payload)
            svg_text = render_brick_definition_svg(
                definition, image_size=image_size
            )
        except (TypeError, ValueError) as exc:
            return _error(str(exc))

        return Response(
            content=svg_text, media_type="image/svg+xml; charset=utf-8"
        )

    @server.post("/bricks", status_code=201)
    async def save_brick(request: Request) -> Any:
        """Save a user-defined brick and return its stored definition."""

        payload = await _read_json_body(request)
        if isinstance(payload, JSONResponse):
            return payload

        try:
            definition = normalize_brick_definition(payload)
            shared_coordinate_size = brick_store.get_catalog_shared_coordinate_size()
            svg_text, layout = render_brick_definition_svg_and_layout(
                definition,
                image_size=image_size,
                shared_coordinate_size=shared_coordinate_size,
            )
            stored_definition = brick_store.save_brick(
                definition, svg_text=svg_text, layout_payload=layout
            )
        except (TypeError, ValueError) as exc:
            return _error(str(exc))
        except Exception as exc:  # pragma: no cover
            return _error(f"Save failed: {exc}", 500)

        return JSONResponse({"definition": stored_definition}, status_code=201)

    @server.post("/graph/render")
    async def render_graph(request: Request) -> Any:
        """Render a frontend graph state to an SVG image."""

        payload = await _read_json_body(request)
        if isinstance(payload, JSONResponse):
            return payload

        runtime_catalog = build_runtime_catalog(brick_store)

        try:
            graph_payload = GraphPayload.from_dict(payload)
            svg_text = render_state_svg(
                graph_payload,
                image_size=image_size,
                catalog=runtime_catalog,
            )
        except (TypeError, ValueError) as exc:
            return _error(str(exc))
        except Exception as exc:  # pragma: no cover
            return _error(f"Render failed: {exc}", 500)

        return Response(
            content=svg_text, media_type="image/svg+xml; charset=utf-8"
        )

    @server.post("/graph/smiles")
    async def graph_smiles(request: Request) -> Any:
        """Convert a frontend graph state to a SMILES string."""

        payload = await _read_json_body(request)
        if isinstance(payload, JSONResponse):
            return payload

        runtime_catalog = build_runtime_catalog(brick_store)

        try:
            graph_payload = GraphPayload.from_dict(payload)
            smiles = render_state_smiles(
                graph_payload,
                catalog=runtime_catalog,
            )
        except (TypeError, ValueError) as exc:
            return _error(str(exc))
        except Exception as exc:  # pragma: no cover
            return _error(f"Render failed: {exc}", 500)

        return {"smiles": smiles}

    return server


def serve(
    host: str = "127.0.0.1",
    port: int = 8765,
    image_size: int = DEFAULT_IMAGE_SIZE,
    brick_db_path: Path = DEFAULT_BRICK_DB_PATH,
    user_brick_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
) -> None:
    """Run the render server with uvicorn.

    Args:
        host: Host interface to bind.
        port: TCP port to bind.
        image_size: Width and height of rendered SVG images in pixels.
        brick_db_path: Path to the SQLite database for system bricks.
        user_brick_db_path: Path to the SQLite database for user-defined bricks.
    """

    fastapi_app = create_app(image_size, brick_db_path, user_brick_db_path)
    typer.echo(f"Brickene render server listening on http://{host}:{port}")
    typer.echo(f"Using system brick database {brick_db_path.resolve()}")
    typer.echo(f"Using user brick database {user_brick_db_path.resolve()}")
    uvicorn.run(fastapi_app, host=host, port=port, log_level="warning")


@app.command()
def main(
    host: str = typer.Option("127.0.0.1", help="Host interface to bind."),
    port: int = typer.Option(8765, help="TCP port to bind."),
    image_size: int = typer.Option(
        DEFAULT_IMAGE_SIZE,
        help="Width and height of the rendered SVG.",
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
