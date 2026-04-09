import sqlite3
import json
from pathlib import Path
from typing import Optional


class Database:
    def __init__(self, db_path: str = "tags.db"):
        self.db_path = db_path

    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init(self):
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS images (
                    id      INTEGER PRIMARY KEY AUTOINCREMENT,
                    path    TEXT    UNIQUE NOT NULL,
                    tagged  INTEGER DEFAULT 0,
                    tags    TEXT    DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS idx_path ON images(path);
                CREATE INDEX IF NOT EXISTS idx_tagged ON images(tagged);
            """)

    # ── CRUD ─────────────────────────────────────────────────────────────────
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
        # Normalize: always store tags with spaces, never underscores
        tags = [t.replace("_", " ") for t in tags]
        with self._conn() as conn:
            conn.execute(
                "UPDATE images SET tags = ?, tagged = 1 WHERE id = ?",
                (json.dumps(tags, ensure_ascii=False), image_id),
            )

    def delete_image(self, image_id: int):
        with self._conn() as conn:
            conn.execute("DELETE FROM images WHERE id = ?", (image_id,))

    # ── Query ─────────────────────────────────────────────────────────────────
    def search_images(
        self,
        tags: list[str],
        page: int = 1,
        per_page: int = 50,
        untagged_only: bool = False,
    ) -> tuple[list[dict], int]:
        offset = (page - 1) * per_page
        conditions = []
        params: list = []

        if untagged_only:
            conditions.append("tagged = 0")

        for tag in tags:
            # Normalize search term to space format (matches normalized DB)
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

    def get_all_tags(self) -> list[dict]:
        """Return all unique tags with their frequency."""
        from collections import Counter
        with self._conn() as conn:
            rows = conn.execute("SELECT tags FROM images WHERE tagged = 1").fetchall()
        counter: Counter = Counter()
        for row in rows:
            tags = json.loads(row[0])
            counter.update(tags)
        return [{"tag": t, "count": c} for t, c in counter.most_common()]

    # ── Helper ────────────────────────────────────────────────────────────────
    @staticmethod
    def _row_to_dict(row) -> dict:
        d = dict(row)
        d["tags"] = json.loads(d.get("tags") or "[]")
        return d
