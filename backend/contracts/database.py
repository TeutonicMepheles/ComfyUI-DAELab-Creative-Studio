"""Versioned product database shared by jobs and assets; no second job store."""

import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .errors import StorageError

SCHEMA_VERSION = 3
APPLICATION_ID = 0x43535431

_SCHEMA = [
    """CREATE TABLE jobs (
       request_id TEXT PRIMARY KEY, provider TEXT NOT NULL, execution_kind TEXT NOT NULL,
       input_json TEXT NOT NULL, fingerprint TEXT NOT NULL, source_json TEXT NOT NULL,
       state TEXT NOT NULL, version INTEGER NOT NULL, provider_task_id TEXT,
       attempt INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0,
       result_json TEXT, error_code TEXT, recovery_count INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
    """CREATE TABLE job_attempts (
       request_id TEXT NOT NULL REFERENCES jobs(request_id), attempt INTEGER NOT NULL,
       attempt_id TEXT NOT NULL UNIQUE, provider_task_id TEXT, state TEXT NOT NULL,
       created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
       PRIMARY KEY(request_id, attempt))""",
    """CREATE TABLE job_events (
       sequence INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL REFERENCES jobs(request_id),
       event_id TEXT NOT NULL, version INTEGER NOT NULL, event_type TEXT NOT NULL,
       detail_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(request_id,event_id))""",
    "CREATE INDEX jobs_state ON jobs(state,created_at)",
    """CREATE TABLE assets (
       asset_id TEXT PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
       content_sha256 TEXT, byte_size INTEGER, text_snapshot TEXT, created_at TEXT NOT NULL)""",
    """CREATE TABLE asset_references (
       reference_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(asset_id),
       root_key TEXT NOT NULL, relative_path TEXT NOT NULL, content_sha256 TEXT, byte_size INTEGER,
       status TEXT NOT NULL, provenance_json TEXT NOT NULL, created_at TEXT NOT NULL,
       UNIQUE(asset_id,root_key,relative_path))""",
    """CREATE TABLE favorites (
       favorite_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL UNIQUE REFERENCES assets(asset_id),
       display_name TEXT NOT NULL, created_at TEXT NOT NULL)""",
    """CREATE TABLE favorite_origins (
       origin TEXT NOT NULL, legacy_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
       favorite_id TEXT NOT NULL REFERENCES favorites(favorite_id), raw_json TEXT NOT NULL,
       PRIMARY KEY(origin,legacy_id))""",
    "CREATE INDEX favorites_search ON favorites(display_name)",
    "CREATE INDEX asset_reference_lookup ON asset_references(root_key,relative_path)",
]
_MIGRATIONS = {
    1: _SCHEMA,
    2: ["""CREATE TABLE asset_provenance (
        provenance_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(asset_id),
        reference_id TEXT REFERENCES asset_references(reference_id), detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL)"""],
    3: ["ALTER TABLE favorites ADD COLUMN removed_at TEXT",
        "CREATE INDEX favorites_active ON favorites(removed_at,created_at)"],
}


class Database:
    def __init__(self, database_path):
        if str(database_path) == ":memory:":
            raise StorageError("Use an explicit persistent database path.")
        self.path = Path(database_path).resolve()
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.transaction() as connection:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                app_id = connection.execute("PRAGMA application_id").fetchone()[0]
                if app_id not in (0, APPLICATION_ID) or version > SCHEMA_VERSION:
                    raise StorageError("Database belongs to another application or newer schema; preserve it for recovery.")
                if version == 0:
                    if connection.execute("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchone():
                        raise StorageError("Unversioned nonempty database cannot be adopted automatically.")
                    connection.execute(f"PRAGMA application_id={APPLICATION_ID}")
                elif app_id != APPLICATION_ID:
                    raise StorageError("Database application identity is missing.")
                for target in range(version + 1, SCHEMA_VERSION + 1):
                    for statement in _MIGRATIONS[target]:
                        connection.execute(statement)
                    connection.execute(f"PRAGMA user_version={target}")
            # journal_mode changes persistent database bytes and cannot be rolled
            # back with the schema transaction. Enable WAL only after ownership
            # and migration have both succeeded, never while probing foreign data.
            with self.read() as connection:
                connection.execute("PRAGMA journal_mode=WAL")
        except OSError:
            raise StorageError("Cannot initialize product storage.") from None

    def connect(self):
        connection = None
        try:
            connection = sqlite3.connect(self.path, timeout=15, isolation_level=None)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA busy_timeout=15000")
            return connection
        except sqlite3.Error:
            if connection is not None:
                connection.close()
            raise StorageError("Cannot open product storage.") from None

    @contextmanager
    def transaction(self):
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except sqlite3.Error:
            connection.rollback()
            raise StorageError("Product storage transaction failed; no partial database update was committed.") from None
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    @contextmanager
    def read(self):
        connection = self.connect()
        try:
            yield connection
        except sqlite3.Error:
            raise StorageError("Cannot read product storage.") from None
        finally:
            connection.close()

    def backup(self, destination):
        """SQLite online backup; destination must be new and never a source overwrite."""
        target = Path(destination).resolve()
        try:
            with target.open("xb"):
                pass
            with self.read() as source:
                backup = sqlite3.connect(target)
                try:
                    source.backup(backup)
                finally:
                    backup.close()
        except (OSError, sqlite3.Error):
            raise StorageError("Backup failed; existing data was not replaced.") from None
        return target
