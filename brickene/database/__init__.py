"""Database access layer for the Brickene render server.

The ``reader`` submodule provides read-only access to system brick
definitions, SVG assets, layout payloads, and catalog metadata stored
in ``db.sqlite3``.
"""

from brickene.database.reader import (
    get_brick_layout,
    get_brick_svg,
    get_catalog_shared_coordinate_size,
    get_system_brick,
    list_system_bricks,
)

__all__ = [
    "get_brick_layout",
    "get_brick_svg",
    "get_catalog_shared_coordinate_size",
    "get_system_brick",
    "list_system_bricks",
]
