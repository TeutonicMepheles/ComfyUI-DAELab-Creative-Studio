"""Real SQLite WAL snapshots; no host, model, source checkpoint or task mutation."""
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from tools.migration.sqlite_snapshot import snapshot_sqlite, sqlite_logical_digest
from tools.migration.safety import MigrationError, file_hash


class SQLiteSnapshotTests(unittest.TestCase):
    def test_native_wal_close_same_values_but_metadata_change_is_distinct(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "comfyui.db"
            schema = json.loads((Path(__file__).parent / "fixtures/comfyui-assets-schema.json").read_text("utf-8"))
            db = sqlite3.connect(path)
            try:
                db.execute("PRAGMA journal_mode=WAL")
                for row in sorted(schema["schema"], key=lambda row: row["type"] != "table"):
                    db.execute(row["sql"])
                db.execute("INSERT INTO alembic_version VALUES (?)", (schema["revision"],))
                db.execute("INSERT INTO asset_system_state VALUES ('metadata','{\"unknown\":1}')")
                db.commit()
                before = {str(item): file_hash(item) for item in (path, Path(str(path) + "-wal"))}
                observed = sqlite_logical_digest(snapshot_sqlite(path))
                self.assertEqual(before, {name: file_hash(Path(name)) for name in before})
            finally:
                db.close()
            self.assertFalse(Path(str(path) + "-wal").exists())
            self.assertEqual(observed, sqlite_logical_digest(snapshot_sqlite(path)))
            with closing(sqlite3.connect(path)) as db:
                db.execute("UPDATE asset_system_state SET value='{\"unknown\":2}'")
                db.commit()
            self.assertNotEqual(observed, sqlite_logical_digest(snapshot_sqlite(path)))

    def test_all_types_duplicate_rows_and_schema_are_not_normalized_away(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "old.db"
            with closing(sqlite3.connect(path)) as db:
                db.execute("CREATE TABLE objects(kind,id,body)")
                db.execute("INSERT INTO objects VALUES ('a',1,?)", (b"text",))
                db.commit()
            original = sqlite_logical_digest(snapshot_sqlite(path))
            with closing(sqlite3.connect(path)) as db:
                db.execute("UPDATE objects SET body='text'")
                db.commit()
            text_digest = sqlite_logical_digest(snapshot_sqlite(path))
            self.assertNotEqual(original, text_digest)
            with closing(sqlite3.connect(path)) as db:
                db.execute("INSERT INTO objects SELECT * FROM objects")
                db.commit()
            self.assertNotEqual(text_digest, sqlite_logical_digest(snapshot_sqlite(path)))
            with closing(sqlite3.connect(path)) as db:
                db.execute("CREATE TABLE unknown(secret TEXT)")
                db.commit()
            with self.assertRaises(MigrationError):
                sqlite_logical_digest(snapshot_sqlite(path))


if __name__ == "__main__":
    unittest.main()
