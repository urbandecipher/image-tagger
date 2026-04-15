import sqlite3
import json
from pathlib import Path
from typing import Optional

DEFAULT_COLLECTIONS = [
    "寫實人物", "動漫人物", "NSFW", "寫實場景", "動漫場景"
]

SCHEMA_SCAN_HISTORY = """
    CREATE TABLE IF NOT EXISTS scan_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        folder      TEXT    UNIQUE NOT NULL,
        first_scan  TEXT    DEFAULT (datetime('now','localtime')),
        last_scan   TEXT    DEFAULT (datetime('now','localtime')),
        scan_count  INTEGER DEFAULT 1,
        image_count INTEGER DEFAULT 0
    );
"""

class Database:
    def __init__(self, db_path: str = "tags.db"):
        self.db_path = db_path

    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init(self):
        with self._conn() as conn:
            # Create base tables (without collection_id first)
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS images (
                    id      INTEGER PRIMARY KEY AUTOINCREMENT,
                    path    TEXT    UNIQUE NOT NULL,
                    tagged  INTEGER DEFAULT 0,
                    tags    TEXT    DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS idx_path ON images(path);
                CREATE INDEX IF NOT EXISTS idx_tagged ON images(tagged);

                CREATE TABLE IF NOT EXISTS collections (
                    id      INTEGER PRIMARY KEY AUTOINCREMENT,
                    name    TEXT    UNIQUE NOT NULL,
                    sort_order INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS scan_history (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    folder      TEXT    UNIQUE NOT NULL,
                    first_scan  TEXT    DEFAULT (datetime('now','localtime')),
                    last_scan   TEXT    DEFAULT (datetime('now','localtime')),
                    scan_count  INTEGER DEFAULT 1,
                    image_count INTEGER DEFAULT 0
                );
            """)
            # Migrate: add collection_id column if not exists
            try:
                conn.execute("ALTER TABLE images ADD COLUMN collection_id INTEGER DEFAULT NULL")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_collection ON images(collection_id)")
            except Exception:
                pass
            # Seed default collections if empty
            count = conn.execute("SELECT COUNT(*) FROM collections").fetchone()[0]
            if count == 0:
                for i, name in enumerate(DEFAULT_COLLECTIONS):
                    conn.execute(
                        "INSERT OR IGNORE INTO collections (name, sort_order) VALUES (?,?)",
                        (name, i)
                    )

    # ── Collections ───────────────────────────────────────────────────────────
    def get_collections(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT c.id, c.name, c.sort_order, COUNT(i.id) as count "
                "FROM collections c LEFT JOIN images i ON i.collection_id = c.id "
                "GROUP BY c.id ORDER BY c.sort_order, c.name"
            ).fetchall()
            # Count uncollected
            uncollected = conn.execute(
                "SELECT COUNT(*) FROM images WHERE collection_id IS NULL"
            ).fetchone()[0]
        result = [dict(r) for r in rows]
        return result, uncollected

    def add_collection(self, name: str) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO collections (name) VALUES (?)", (name,)
            )
            return cur.lastrowid

    def rename_collection(self, collection_id: int, name: str):
        with self._conn() as conn:
            conn.execute(
                "UPDATE collections SET name = ? WHERE id = ?",
                (name, collection_id)
            )

    def delete_collection(self, collection_id: int):
        with self._conn() as conn:
            # Move images back to uncollected
            conn.execute(
                "UPDATE images SET collection_id = NULL WHERE collection_id = ?",
                (collection_id,)
            )
            conn.execute("DELETE FROM collections WHERE id = ?", (collection_id,))

    def set_images_collection(self, image_ids: list[int], collection_id: Optional[int]):
        with self._conn() as conn:
            placeholders = ",".join("?" * len(image_ids))
            conn.execute(
                f"UPDATE images SET collection_id = ? WHERE id IN ({placeholders})",
                [collection_id] + image_ids
            )

    # ── CRUD ──────────────────────────────────────────────────────────────────
    def add_image(self, path: str) -> int:
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT OR IGNORE INTO images (path) VALUES (?)", (path,)
            )
            return cur.lastrowid

    def get_image(self, image_id: int) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM images WHERE id = ?", (image_id,)
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def get_image_by_path(self, path: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM images WHERE path = ?", (path,)
            ).fetchone()
            return self._row_to_dict(row) if row else None

    def update_tags(self, image_id: int, tags: list[str]):
        tags = [t.replace("_", " ") for t in tags]
        with self._conn() as conn:
            conn.execute(
                "UPDATE images SET tags = ?, tagged = 1 WHERE id = ?",
                (json.dumps(tags, ensure_ascii=False), image_id),
            )

    def delete_image(self, image_id: int):
        with self._conn() as conn:
            conn.execute("DELETE FROM images WHERE id = ?", (image_id,))

    def update_image_path(self, image_id: int, new_path: str):
        with self._conn() as conn:
            conn.execute(
                "UPDATE images SET path = ? WHERE id = ?",
                (new_path, image_id)
            )

    # ── Query ─────────────────────────────────────────────────────────────────
    def search_images(
        self,
        tags: list[str],
        page: int = 1,
        per_page: int = 50,
        untagged_only: bool = False,
        collection_id: Optional[int] = None,
        uncollected: bool = False,
    ) -> tuple[list[dict], int]:
        offset = (page - 1) * per_page
        conditions = []
        params: list = []

        if untagged_only:
            conditions.append("tagged = 0")

        if uncollected:
            conditions.append("collection_id IS NULL")
        elif collection_id is not None:
            conditions.append("collection_id = ?")
            params.append(collection_id)

        for tag in tags:
            tag_s = tag.replace("_", " ")
            conditions.append("tags LIKE ?")
            params.append(f'%"{tag_s}"%')

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        with self._conn() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM images {where}", params
            ).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM images {where} ORDER BY id DESC LIMIT ? OFFSET ?",
                params + [per_page, offset],
            ).fetchall()

        return [self._row_to_dict(r) for r in rows], total

    def get_untagged_images(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM images WHERE tagged = 0"
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def count_images(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM images").fetchone()[0]

    def count_untagged(self) -> int:
        with self._conn() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM images WHERE tagged = 0"
            ).fetchone()[0]

    def get_all_tags(self, collection_id: Optional[int] = None, uncollected: bool = False) -> list[dict]:
        from collections import Counter
        with self._conn() as conn:
            if uncollected:
                rows = conn.execute(
                    "SELECT tags FROM images WHERE tagged = 1 AND collection_id IS NULL"
                ).fetchall()
            elif collection_id is not None:
                rows = conn.execute(
                    "SELECT tags FROM images WHERE tagged = 1 AND collection_id = ?",
                    (collection_id,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT tags FROM images WHERE tagged = 1"
                ).fetchall()
        counter: Counter = Counter()
        for row in rows:
            counter.update(json.loads(row[0]))
        return [{"tag": t, "count": c} for t, c in counter.most_common()]

    # ── Scan History ──────────────────────────────────────────────────────────
    def upsert_scan_history(self, folder: str, image_count: int):
        with self._conn() as conn:
            existing = conn.execute(
                "SELECT id FROM scan_history WHERE folder = ?", (folder,)
            ).fetchone()
            if existing:
                conn.execute("""
                    UPDATE scan_history
                    SET last_scan = datetime('now','localtime'),
                        scan_count = scan_count + 1,
                        image_count = ?
                    WHERE folder = ?
                """, (image_count, folder))
            else:
                conn.execute("""
                    INSERT INTO scan_history (folder, image_count)
                    VALUES (?, ?)
                """, (folder, image_count))

    def get_scan_history(self) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT * FROM scan_history ORDER BY last_scan DESC
            """).fetchall()
        return [dict(r) for r in rows]

    def delete_scan_history(self, folder: str):
        with self._conn() as conn:
            conn.execute("DELETE FROM scan_history WHERE folder = ?", (folder,))

    # ── Helper ────────────────────────────────────────────────────────────────
    @staticmethod
    def _row_to_dict(row) -> dict:
        d = dict(row)
        d["tags"] = json.loads(d.get("tags") or "[]")
        return d
