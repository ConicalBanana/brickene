"""SQLite-backed storage for user-defined brick configurations."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_BRICK_DB_PATH = Path(__file__).resolve().parent.parent / "db.sqlite3"


class BrickStore:
    """Persist and query user-defined brick definitions in SQLite."""

    def __init__(self, db_path: Path = DEFAULT_BRICK_DB_PATH) -> None:
        """Initialize the store and ensure its schema exists.

        Args:
            db_path: Location of the SQLite database file.
        """

        self.db_path = Path(db_path)
        self._initialize()

    def list_bricks(self) -> list[dict[str, Any]]:
        """Return all stored brick definitions in creation order."""

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM user_bricks
                ORDER BY id ASC
                """
            ).fetchall()

        return [self._row_to_definition(row, include_metadata=True) for row in rows]

    def get_brick(self, brick_id: str) -> dict[str, Any] | None:
        """Return one stored brick definition by its user-facing id."""

        row_id = self._parse_brick_id(brick_id)
        if row_id is None:
            return None

        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM user_bricks
                WHERE id = ?
                """,
                (row_id,),
            ).fetchone()

        if row is None:
            return None

        return self._row_to_definition(row, include_metadata=True)

    def save_brick(self, definition: dict[str, Any]) -> dict[str, Any]:
        """Insert one normalized brick definition and return the stored record."""

        serialized_definition = json.dumps(
            self._strip_storage_metadata(definition),
            sort_keys=True,
        )

        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO user_bricks (definition_json)
                VALUES (?)
                """,
                (serialized_definition,),
            )
            row = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM user_bricks
                WHERE id = ?
                """,
                (int(cursor.lastrowid),),
            ).fetchone()

        if row is None:
            raise RuntimeError("Failed to read stored brick definition.")

        return self._row_to_definition(row, include_metadata=True)

    def count_bricks(self) -> int:
        """Return the number of stored user-defined bricks."""

        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM user_bricks"
            ).fetchone()

        if row is None:
            return 0

        return int(row["count"])

    def catalog_entries(self) -> dict[str, dict[str, Any]]:
        """Return stored brick definitions keyed by their runtime brick id."""

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM user_bricks
                ORDER BY id ASC
                """
            ).fetchall()

        catalog: dict[str, dict[str, Any]] = {}
        for row in rows:
            definition = self._row_to_definition(row, include_metadata=False)
            catalog[str(definition["id"])] = definition

        return catalog

    def _connect(self) -> sqlite3.Connection:
        """Open one SQLite connection configured for row access."""

        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        """Create the SQLite schema when it does not already exist."""

        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS user_bricks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    definition_json TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    @staticmethod
    def _format_brick_id(row_id: int) -> str:
        """Convert one SQLite row id into the public brick id."""

        return f"user-{row_id}"

    @classmethod
    def _parse_brick_id(cls, brick_id: str) -> int | None:
        """Parse one public brick id back into the SQLite row id."""

        normalized = str(brick_id).strip()
        if normalized.startswith("user-"):
            normalized = normalized.removeprefix("user-")

        if not normalized.isdigit():
            return None

        return int(normalized)

    @classmethod
    def _row_to_definition(
        cls,
        row: sqlite3.Row,
        *,
        include_metadata: bool,
    ) -> dict[str, Any]:
        """Deserialize one database row into a brick definition payload."""

        definition = json.loads(row["definition_json"])
        definition["id"] = cls._format_brick_id(int(row["id"]))

        if include_metadata:
            definition["created_at"] = row["created_at"]
            definition["updated_at"] = row["updated_at"]

        return definition

    @staticmethod
    def _strip_storage_metadata(definition: dict[str, Any]) -> dict[str, Any]:
        """Remove storage-managed fields before persisting a definition."""

        return {
            key: value
            for key, value in definition.items()
            if key not in {"id", "created_at", "updated_at"}
        }
