"""Read-only access to the system brick database.

All system brick definitions, SVG assets, layout payloads, and catalog
metadata are stored in a SQLite database (``db.sqlite3``) that is
populated by the ``sync_system_bricks`` maintenance script.  The backend
boot path reads exclusively from this database — it never touches
``raw_brick_smiles.json`` at runtime.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

_DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent.parent / "db.sqlite3"


def _connect(db_path: Path = _DEFAULT_DB_PATH) -> sqlite3.Connection:
    """Open a read-only connection to the system brick database."""

    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _row_to_definition(
    row: sqlite3.Row,
    *,
    include_metadata: bool = False,
) -> dict[str, Any]:
    """Convert a single database row into a brick-definition dictionary."""

    definition = json.loads(row["definition_json"])
    if not include_metadata:
        return definition
    return {
        **definition,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_system_bricks(
    db_path: Path = _DEFAULT_DB_PATH,
) -> list[dict[str, Any]]:
    """Return all system brick definitions in catalog order.

    Args:
        db_path: Path to the system brick SQLite database.

    Returns:
        A list of brick-definition dictionaries ordered by numeric id.
    """

    with _connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT id, definition_json, created_at, updated_at
            FROM system_bricks
            ORDER BY CAST(id AS INTEGER) ASC, id ASC
            """
        ).fetchall()

    return [_row_to_definition(row, include_metadata=True) for row in rows]


def get_system_brick(
    brick_id: str,
    db_path: Path = _DEFAULT_DB_PATH,
) -> dict[str, Any] | None:
    """Return a single system brick definition by its id.

    Args:
        brick_id: The brick identifier (e.g. ``"27"`` for Thiophene).
        db_path: Path to the system brick SQLite database.

    Returns:
        The brick-definition dictionary, or ``None`` if not found.
    """

    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT id, definition_json, created_at, updated_at FROM system_bricks WHERE id = ?",
            (str(brick_id).strip(),),
        ).fetchone()

    if row is None:
        return None

    return _row_to_definition(row, include_metadata=True)


def get_brick_svg(
    brick_id: str,
    db_path: Path = _DEFAULT_DB_PATH,
) -> str | None:
    """Return the rendered SVG text for a system brick.

    Args:
        brick_id: The brick identifier.
        db_path: Path to the system brick SQLite database.

    Returns:
        The SVG string, or ``None`` if the brick has no rendered asset.
    """

    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT svg_text FROM system_bricks WHERE id = ?",
            (str(brick_id).strip(),),
        ).fetchone()

    if row is None or row["svg_text"] is None:
        return None
    return str(row["svg_text"])


def get_brick_layout(
    brick_id: str,
    db_path: Path = _DEFAULT_DB_PATH,
) -> dict[str, Any] | None:
    """Return the layout JSON payload for a system brick.

    Args:
        brick_id: The brick identifier.
        db_path: Path to the system brick SQLite database.

    Returns:
        The layout dictionary, or ``None`` if not stored.
    """

    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT layout_json FROM system_bricks WHERE id = ?",
            (str(brick_id).strip(),),
        ).fetchone()

    if row is None or row["layout_json"] is None:
        return None
    return json.loads(row["layout_json"])


def get_catalog_shared_coordinate_size(
    db_path: Path = _DEFAULT_DB_PATH,
) -> tuple[float, float] | None:
    """Return the shared coordinate size used to normalize brick renders.

    Args:
        db_path: Path to the system brick SQLite database.

    Returns:
        A ``(width, height)`` tuple in Angstroms, or ``None`` if not set.
    """

    with _connect(db_path) as connection:
        row = connection.execute(
            "SELECT value FROM metadata WHERE key = 'catalog_shared_coordinate_size'"
        ).fetchone()

    if row is None or row["value"] is None:
        return None

    raw = json.loads(row["value"])
    if not isinstance(raw, list) or len(raw) < 2:
        return None
    return (float(raw[0]), float(raw[1]))
