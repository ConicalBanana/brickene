"""SQLite-backed storage for system and user-defined brick configurations."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_BRICK_DB_PATH = Path(__file__).resolve().parent.parent / "db.sqlite3"


class BrickStore:
    """Persist and query system and user-defined brick definitions in SQLite."""

    def __init__(self, db_path: Path = DEFAULT_BRICK_DB_PATH) -> None:
        """Initialize the store and ensure its schema exists.

        Args:
            db_path: Location of the SQLite database file.
        """

        self.db_path = Path(db_path)
        self._initialize()

    def list_bricks(self) -> list[dict[str, Any]]:
        """Return all stored brick definitions in runtime order."""

        return self.list_system_bricks() + self.list_user_bricks()

    def list_system_bricks(self) -> list[dict[str, Any]]:
        """Return all built-in brick definitions in catalog order."""

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM system_bricks
                ORDER BY CAST(id AS INTEGER) ASC, id ASC
                """
            ).fetchall()

        return [
            self._row_to_definition(
                row,
                include_metadata=True,
                is_user_defined=False,
            )
            for row in rows
        ]

    def list_user_bricks(self) -> list[dict[str, Any]]:
        """Return all stored user-defined brick definitions in creation order."""

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM user_bricks
                ORDER BY id ASC
                """
            ).fetchall()

        return [
            self._row_to_definition(
                row,
                include_metadata=True,
                is_user_defined=True,
            )
            for row in rows
        ]

    def get_brick(self, brick_id: str) -> dict[str, Any] | None:
        """Return one stored brick definition by its public id."""

        normalized_brick_id = str(brick_id).strip()

        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM system_bricks
                WHERE id = ?
                """,
                (normalized_brick_id,),
            ).fetchone()

        if row is not None:
            return self._row_to_definition(
                row,
                include_metadata=True,
                is_user_defined=False,
            )

        row_id = self._parse_user_brick_id(brick_id)
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

        return self._row_to_definition(
            row,
            include_metadata=True,
            is_user_defined=True,
        )

    def get_brick_svg_text(self, brick_id: str) -> str | None:
        """Return one stored SVG asset for a built-in brick id."""

        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT svg_text
                FROM system_bricks
                WHERE id = ?
                """,
                (str(brick_id).strip(),),
            ).fetchone()

        if row is None or row["svg_text"] is None:
            return None

        return str(row["svg_text"])

    def get_brick_layout(self, brick_id: str) -> dict[str, Any] | None:
        """Return one stored layout JSON payload for a built-in brick id."""

        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT layout_json
                FROM system_bricks
                WHERE id = ?
                """,
                (str(brick_id).strip(),),
            ).fetchone()

        if row is None or row["layout_json"] is None:
            return None

        return json.loads(row["layout_json"])

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

        return self._row_to_definition(
            row,
            include_metadata=True,
            is_user_defined=True,
        )

    def count_bricks(self) -> int:
        """Return the number of stored user-defined bricks."""

        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM user_bricks"
            ).fetchone()

        if row is None:
            return 0

        return int(row["count"])

    def count_system_bricks(self) -> int:
        """Return the number of stored built-in bricks."""

        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM system_bricks"
            ).fetchone()

        if row is None:
            return 0

        return int(row["count"])

    def catalog_entries(self) -> dict[str, dict[str, Any]]:
        """Return all runtime brick definitions keyed by public brick id."""

        catalog = {
            str(definition["id"]): definition
            for definition in self.list_system_bricks_without_metadata()
        }
        catalog.update(
            {
                str(definition["id"]): definition
                for definition in self.list_user_bricks_without_metadata()
            }
        )
        return catalog

    def list_system_bricks_without_metadata(self) -> list[dict[str, Any]]:
        """Return all built-in brick definitions without storage metadata."""

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM system_bricks
                ORDER BY CAST(id AS INTEGER) ASC, id ASC
                """
            ).fetchall()

        return [
            self._row_to_definition(
                row,
                include_metadata=False,
                is_user_defined=False,
            )
            for row in rows
        ]

    def list_user_bricks_without_metadata(self) -> list[dict[str, Any]]:
        """Return all user-defined brick definitions without storage metadata."""

        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM user_bricks
                ORDER BY id ASC
                """
            ).fetchall()

        return [
            self._row_to_definition(
                row,
                include_metadata=False,
                is_user_defined=True,
            )
            for row in rows
        ]

    def sync_system_bricks(self, definitions: dict[str, dict[str, Any]]) -> int:
        """Replace the built-in brick definition set from an in-memory payload."""

        active_ids: list[str] = []

        with self._connect() as connection:
            for config_key, definition in definitions.items():
                brick_id = str(definition.get("id") or config_key).strip() or str(
                    config_key
                )
                serialized_definition = json.dumps(
                    {
                        **definition,
                        "id": brick_id,
                    },
                    sort_keys=True,
                )

                connection.execute(
                    """
                    INSERT INTO system_bricks (
                        id,
                        definition_json
                    )
                    VALUES (?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        definition_json = excluded.definition_json,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (brick_id, serialized_definition),
                )
                active_ids.append(brick_id)

            self._delete_stale_system_bricks(connection, active_ids)

        return len(active_ids)

    def save_system_brick_assets(
        self,
        brick_id: str,
        svg_text: str | None,
        layout_payload: dict[str, Any] | str | None,
    ) -> None:
        """Store one built-in brick SVG/layout asset bundle in SQLite."""

        serialized_layout = (
            layout_payload
            if isinstance(layout_payload, str) or layout_payload is None
            else json.dumps(layout_payload, sort_keys=True)
        )

        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE system_bricks
                SET svg_text = ?,
                    layout_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (svg_text, serialized_layout, str(brick_id).strip()),
            )

        if cursor.rowcount == 0:
            raise ValueError(f"Unknown system brick id: {brick_id}")

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
                CREATE TABLE IF NOT EXISTS system_bricks (
                    id TEXT PRIMARY KEY,
                    definition_json TEXT NOT NULL,
                    svg_text TEXT,
                    layout_json TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
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
    def _format_user_brick_id(row_id: int) -> str:
        """Convert one SQLite row id into the public user brick id."""

        return f"user-{row_id}"

    @classmethod
    def _parse_user_brick_id(cls, brick_id: str) -> int | None:
        """Parse one public user brick id back into the SQLite row id."""

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
        is_user_defined: bool,
    ) -> dict[str, Any]:
        """Deserialize one database row into a brick definition payload."""

        definition = json.loads(row["definition_json"])
        definition["id"] = (
            cls._format_user_brick_id(int(row["id"]))
            if is_user_defined
            else str(row["id"])
        )

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

    @staticmethod
    def _delete_stale_system_bricks(
        connection: sqlite3.Connection,
        active_ids: list[str],
    ) -> None:
        """Remove built-in rows that no longer exist in the source catalog."""

        if not active_ids:
            connection.execute("DELETE FROM system_bricks")
            return

        placeholders = ", ".join("?" for _ in active_ids)
        connection.execute(
            f"DELETE FROM system_bricks WHERE id NOT IN ({placeholders})",
            tuple(active_ids),
        )
