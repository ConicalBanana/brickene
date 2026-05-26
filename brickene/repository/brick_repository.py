"""SQLite-backed storage for system and user-defined brick configurations."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_BRICK_DB_PATH = Path(__file__).resolve().parent.parent.parent / "db.sqlite3"
DEFAULT_USER_BRICK_DB_PATH = Path(__file__).resolve().parent.parent.parent / "user.sqlite3"


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
        """Return one stored SVG asset for a system or user brick id."""

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
            row_id = self._parse_user_brick_id(brick_id)
            if row_id is None:
                return None

            with self._connect() as connection:
                row = connection.execute(
                    """
                    SELECT svg_text
                    FROM user_bricks
                    WHERE id = ?
                    """,
                    (row_id,),
                ).fetchone()

            if row is None or row["svg_text"] is None:
                return None

        return str(row["svg_text"])

    def get_brick_layout(self, brick_id: str) -> dict[str, Any] | None:
        """Return one stored layout JSON payload for a system or user brick id."""

        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT layout_json
                FROM system_bricks
                WHERE id = ?
                """,
                (str(brick_id).strip(),),
            ).fetchone()

        if row is not None and row["layout_json"] is not None:
            return json.loads(row["layout_json"])

        row_id = self._parse_user_brick_id(brick_id)
        if row_id is None:
            return None

        with self._connect() as connection:
            row = connection.execute(
                "SELECT layout_json FROM user_bricks WHERE id = ?",
                (row_id,),
            ).fetchone()

        if row is None or row["layout_json"] is None:
            return None

        return json.loads(row["layout_json"])

    def save_brick(
        self,
        definition: dict[str, Any],
        *,
        svg_text: str | None = None,
        layout_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Insert one normalized brick definition and return the stored record."""

        layout_json = (
            json.dumps(layout_payload, sort_keys=True)
            if layout_payload is not None
            else None
        )
        return self._upsert_user_brick(
            definition, svg_text=svg_text, layout_json=layout_json
        )

    def upsert_user_brick(
        self,
        definition: dict[str, Any],
        *,
        public_id: str,
        svg_text: str | None = None,
        layout_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Insert or replace one user brick while preserving its public id."""

        layout_json = (
            json.dumps(layout_payload, sort_keys=True)
            if layout_payload is not None
            else None
        )
        return self._upsert_user_brick(
            definition,
            public_id=public_id,
            svg_text=svg_text,
            layout_json=layout_json,
        )

    def _upsert_user_brick(
        self,
        definition: dict[str, Any],
        public_id: str | None = None,
        svg_text: str | None = None,
        layout_json: str | None = None,
    ) -> dict[str, Any]:
        """Insert or update one normalized user brick definition."""

        serialized_definition = json.dumps(
            self._strip_storage_metadata(definition),
            sort_keys=True,
        )

        row_id: int | None = None
        if public_id is not None:
            row_id = self._parse_user_brick_id(public_id)
            if row_id is None:
                raise ValueError(f"Invalid user brick id: {public_id}")

        with self._connect() as connection:
            if row_id is None:
                cursor = connection.execute(
                    """
                    INSERT INTO user_bricks (definition_json, svg_text, layout_json)
                    VALUES (?, ?, ?)
                    """,
                    (serialized_definition, svg_text, layout_json),
                )
                persisted_row_id = int(cursor.lastrowid)
            else:
                connection.execute(
                    """
                    INSERT INTO user_bricks (id, definition_json, svg_text, layout_json)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        definition_json = excluded.definition_json,
                        svg_text = excluded.svg_text,
                        layout_json = excluded.layout_json,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    (row_id, serialized_definition, svg_text, layout_json),
                )
                persisted_row_id = row_id

            row = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM user_bricks
                WHERE id = ?
                """,
                (persisted_row_id,),
            ).fetchone()

        if row is None:
            raise RuntimeError("Failed to read stored brick definition.")

        return self._row_to_definition(
            row,
            include_metadata=True,
            is_user_defined=True,
        )

    def delete_user_brick(self, brick_id: str) -> bool:
        """Delete one user-defined brick. Returns True if the row was removed.

        Args:
            brick_id: Public user brick id (e.g. ``user-3``).

        Returns:
            ``True`` when a row was deleted; ``False`` when none matched.
        """

        row_id = self._parse_user_brick_id(brick_id)
        if row_id is None:
            return False

        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM user_bricks WHERE id = ?",
                (row_id,),
            )

        return cursor.rowcount > 0

    def save_system_brick(
        self,
        brick_id: str,
        definition: dict[str, Any],
        *,
        svg_text: str | None = None,
        layout_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Insert or replace one system brick and return the stored record.

        Args:
            brick_id: Numeric string id for the system brick.
            definition: Brick definition payload (storage metadata is stripped).
            svg_text: Pre-rendered SVG asset, or ``None``.
            layout_payload: Pre-computed layout object, or ``None``.

        Returns:
            The stored brick definition including storage metadata.
        """

        clean_definition = self._strip_storage_metadata(definition)
        clean_definition["id"] = brick_id
        serialized_definition = json.dumps(clean_definition, sort_keys=True)
        layout_json = (
            json.dumps(layout_payload, sort_keys=True)
            if layout_payload is not None
            else None
        )

        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO system_bricks (id, definition_json, svg_text, layout_json)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    definition_json = excluded.definition_json,
                    svg_text = excluded.svg_text,
                    layout_json = excluded.layout_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (brick_id, serialized_definition, svg_text, layout_json),
            )
            row = connection.execute(
                """
                SELECT id, definition_json, created_at, updated_at
                FROM system_bricks
                WHERE id = ?
                """,
                (brick_id,),
            ).fetchone()

        if row is None:
            raise RuntimeError("Failed to read stored system brick definition.")

        return self._row_to_definition(
            row, include_metadata=True, is_user_defined=False
        )

    def get_next_system_brick_id(self) -> str:
        """Return the next available numeric system brick id (min 1000).

        Scans existing system brick ids, interprets any that are pure
        integers, and returns ``str(max(current_max, 999) + 1)``.
        """

        with self._connect() as connection:
            rows = connection.execute("SELECT id FROM system_bricks").fetchall()

        max_id = 999
        for row in rows:
            try:
                max_id = max(max_id, int(str(row["id"])))
            except (ValueError, TypeError):
                pass

        return str(max_id + 1)

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

    def save_catalog_shared_coordinate_size(
        self,
        coordinate_size: tuple[float, float],
    ) -> None:
        """Persist the catalog-wide shared coordinate size for user-brick rendering."""

        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO metadata (key, value)
                VALUES ('catalog_shared_coordinate_size', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (json.dumps(list(coordinate_size)),),
            )

    def get_catalog_shared_coordinate_size(
        self,
    ) -> tuple[float, float] | None:
        """Return the stored catalog shared coordinate size, or None if absent."""

        with self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM metadata WHERE key = ?",
                ("catalog_shared_coordinate_size",),
            ).fetchone()

        if row is None:
            return None

        parsed = json.loads(row["value"])
        return (float(parsed[0]), float(parsed[1]))

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
                    svg_text TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            self._ensure_column(connection, "user_bricks", "svg_text", "TEXT")
            self._ensure_column(connection, "user_bricks", "layout_json", "TEXT")

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

    @staticmethod
    def _ensure_column(
        connection: sqlite3.Connection,
        table_name: str,
        column_name: str,
        column_sql: str,
    ) -> None:
        """Add one missing SQLite column in place for existing databases."""

        column_names = {
            str(row["name"])
            for row in connection.execute(
                f"PRAGMA table_info({table_name})"
            ).fetchall()
        }
        if column_name in column_names:
            return

        connection.execute(
            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"
        )


class RuntimeBrickStore:
    """Expose one merged runtime view across system and user databases."""

    def __init__(
        self,
        system_db_path: Path = DEFAULT_BRICK_DB_PATH,
        user_db_path: Path = DEFAULT_USER_BRICK_DB_PATH,
    ) -> None:
        """Initialize the system and user stores backing runtime queries.

        Args:
            system_db_path: SQLite database containing built-in brick rows.
            user_db_path: SQLite database containing user-defined brick rows.
        """

        self.system_db_path = Path(system_db_path)
        self.user_db_path = Path(user_db_path)
        self._system_store = BrickStore(self.system_db_path)
        self._user_store = BrickStore(self.user_db_path)
        self._migrate_legacy_user_bricks()

    def list_bricks(self) -> list[dict[str, Any]]:
        """Return all runtime brick definitions in frontend order."""

        return self.list_system_bricks() + self.list_user_bricks()

    def list_system_bricks(self) -> list[dict[str, Any]]:
        """Return all built-in brick definitions in catalog order."""

        return self._system_store.list_system_bricks()

    def list_user_bricks(self) -> list[dict[str, Any]]:
        """Return all stored user-defined brick definitions in creation order."""

        return self._user_store.list_user_bricks()

    def get_brick(self, brick_id: str) -> dict[str, Any] | None:
        """Return one brick definition from the correct backing database."""

        normalized_brick_id = str(brick_id).strip()
        if normalized_brick_id.startswith("user-"):
            return self._user_store.get_brick(normalized_brick_id)

        return self._system_store.get_brick(normalized_brick_id)

    def get_brick_svg_text(self, brick_id: str) -> str | None:
        """Return one stored SVG asset for a system or user brick id."""

        normalized_brick_id = str(brick_id).strip()
        if normalized_brick_id.startswith("user-"):
            return self._user_store.get_brick_svg_text(normalized_brick_id)

        return self._system_store.get_brick_svg_text(normalized_brick_id)

    def get_catalog_shared_coordinate_size(
        self,
    ) -> tuple[float, float] | None:
        """Return the catalog shared coordinate size stored in the system database."""

        return self._system_store.get_catalog_shared_coordinate_size()

    def get_brick_layout(self, brick_id: str) -> dict[str, Any] | None:
        """Return one stored layout JSON payload for a system or user brick id."""

        normalized_brick_id = str(brick_id).strip()
        if normalized_brick_id.startswith("user-"):
            return self._user_store.get_brick_layout(normalized_brick_id)
        return self._system_store.get_brick_layout(normalized_brick_id)

    def save_brick(
        self,
        definition: dict[str, Any],
        *,
        svg_text: str | None = None,
        layout_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Persist one user-defined brick in the user database."""

        return self._user_store.save_brick(
            definition, svg_text=svg_text, layout_payload=layout_payload
        )

    def delete_brick(self, brick_id: str) -> bool:
        """Delete one user-defined brick from the user database.

        Args:
            brick_id: Public user brick id (e.g. ``user-3``).

        Returns:
            ``True`` when a row was deleted; ``False`` when the brick was not
            found or is a system brick (which cannot be removed via this path).
        """

        normalized = str(brick_id).strip()
        if not normalized.startswith("user-"):
            return False

        return self._user_store.delete_user_brick(normalized)

    def update_brick(
        self,
        brick_id: str,
        definition: dict[str, Any],
        *,
        svg_text: str | None = None,
        layout_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Update one user-defined brick definition in place.

        Args:
            brick_id: Public user brick id (e.g. ``user-3``).
            definition: Updated brick definition payload.
            svg_text: Re-rendered SVG asset, or ``None``.
            layout_payload: Re-computed layout object, or ``None``.

        Returns:
            The updated stored definition, or ``None`` if the brick was not
            found or is a system brick.
        """

        normalized = str(brick_id).strip()
        if not normalized.startswith("user-"):
            return None

        if self._user_store.get_brick(normalized) is None:
            return None

        return self._user_store.upsert_user_brick(
            definition,
            public_id=normalized,
            svg_text=svg_text,
            layout_payload=layout_payload,
        )

    def promote_brick(
        self,
        brick_id: str,
        *,
        svg_text: str | None = None,
        layout_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Promote one user-defined brick into the system brick catalog.

        Reads the user brick, assigns the next available numeric system id
        (starting at 1000), and writes it to the system database.  The
        original user brick is preserved.

        Args:
            brick_id: Public user brick id (e.g. ``user-3``).
            svg_text: Pre-rendered SVG asset, or ``None``.
            layout_payload: Pre-computed layout object, or ``None``.

        Returns:
            The newly stored system brick definition, or ``None`` if the user
            brick was not found.
        """

        normalized = str(brick_id).strip()
        definition = self._user_store.get_brick(normalized)
        if definition is None:
            return None

        new_id = self._system_store.get_next_system_brick_id()
        return self._system_store.save_system_brick(
            new_id,
            definition,
            svg_text=svg_text,
            layout_payload=layout_payload,
        )

    def count_bricks(self) -> int:
        """Return the number of stored user-defined bricks."""

        return self._user_store.count_bricks()

    def count_system_bricks(self) -> int:
        """Return the number of stored built-in bricks."""

        return self._system_store.count_system_bricks()

    def catalog_entries(self) -> dict[str, dict[str, Any]]:
        """Return all runtime brick definitions keyed by public brick id."""

        catalog = {
            str(definition["id"]): definition
            for definition in self._system_store.list_system_bricks_without_metadata()
        }
        catalog.update(
            {
                str(definition["id"]): definition
                for definition in self._user_store.list_user_bricks_without_metadata()
            }
        )
        return catalog

    def _migrate_legacy_user_bricks(self) -> None:
        """Copy any user bricks still stored in the system DB into user.sqlite3."""

        for definition in self._system_store.list_user_bricks():
            public_id = str(definition.get("id") or "").strip()
            if not public_id.startswith("user-"):
                continue

            if self._user_store.get_brick(public_id) is not None:
                continue

            self._user_store.upsert_user_brick(
                definition,
                public_id=public_id,
                svg_text=self._system_store.get_brick_svg_text(public_id),
            )
