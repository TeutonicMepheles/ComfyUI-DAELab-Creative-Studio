"""Read-only SQLite snapshots for fenced runtime observation, never checkpoints.

The read-only connection participates in SQLite's existing shared-memory locks;
it does not change application rows, schema or source journal mode. A WAL source
must already own its SHM file so observation never creates that companion.
"""
import hashlib
import math
import re
import sqlite3
import time
from contextlib import closing

from .safety import MigrationError, canonical, checked, file_hash

MAX_BYTES = 128 * 1024 * 1024
MAX_ROWS = 100000
MAX_SECONDS = 10


def snapshot_sqlite(path):
    path = checked(path, exists=True)
    file_hash(path)  # ordinary, unlinked file; no source-body logging
    if not 100 <= path.stat().st_size <= MAX_BYTES:
        raise MigrationError("SQLite snapshot exceeds its bounded size.")
    companions = {suffix: path.with_name(path.name + suffix) for suffix in ("-wal", "-shm", "-journal")}
    if companions["-journal"].exists():
        raise MigrationError("Rollback journals require explicit offline review.")
    for companion in companions.values():
        if companion.exists():
            file_hash(companion)
            if companion.stat().st_size > MAX_BYTES:
                raise MigrationError("SQLite companion exceeds its bounded size.")
    if companions["-wal"].exists() and not companions["-shm"].exists():
        raise MigrationError("Live WAL observation requires the runtime's existing SHM file.")
    deadline = time.monotonic() + MAX_SECONDS
    def progress(status, remaining, total):
        if time.monotonic() > deadline or total > MAX_BYTES // 512:
            raise MigrationError("SQLite snapshot exceeded its time or page bound.")
    try:
        # Immutable is correct only without WAL: it must never discard committed
        # WAL rows from a live, fenced database.
        uri = path.as_uri() + ("?mode=ro" if companions["-wal"].exists() else "?mode=ro&immutable=1")
        with closing(sqlite3.connect(uri, uri=True, timeout=1)) as source, closing(sqlite3.connect(":memory:")) as target:
            source.execute("PRAGMA query_only=ON")
            source.execute("PRAGMA trusted_schema=OFF")
            source.backup(target, pages=128, progress=progress, sleep=0.01)
            raw = target.serialize()
            if len(raw) > MAX_BYTES:
                raise MigrationError("SQLite snapshot exceeds its bounded size.")
            return raw
    except sqlite3.Error:
        raise MigrationError("Read-only SQLite snapshot could not be collected.") from None


def _value(value):
    if value is None:
        return ["null"]
    if isinstance(value, bytes):
        return ["blob", value.hex()]
    if isinstance(value, str):
        return ["text", value]
    if isinstance(value, int):
        return ["integer", str(value)]
    if isinstance(value, float) and math.isfinite(value):
        return ["real", value.hex()]
    raise MigrationError("Unsupported SQLite value requires review.")


def sqlite_logical_digest(raw):
    """Hash all stored values/schema with typed rows; ignore only physical layout."""
    if not isinstance(raw, bytes) or not 100 <= len(raw) <= MAX_BYTES or not raw.startswith(b"SQLite format 3\x00"):
        raise MigrationError("Invalid SQLite snapshot bytes.")
    try:
        with closing(sqlite3.connect(":memory:")) as db:
            # These header flags affect only the private memory handle.
            db.deserialize(raw[:18] + b"\x01\x01" + raw[20:])
            db.execute("PRAGMA query_only=ON")
            db.execute("PRAGMA trusted_schema=OFF")
            deadline = time.monotonic() + MAX_SECONDS
            db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or db.execute("PRAGMA foreign_key_check").fetchall():
                raise MigrationError("SQLite snapshot integrity requires review.")
            schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
            tables = [row[1] for row in schema if row[0] == "table"]
            if any(row[0] not in {"table", "index"} for row in schema) or any(not re.fullmatch(r"[a-z_]+", name) for name in tables):
                raise MigrationError("SQLite executable or unknown schema requires review.")
            allowed = ({"objects", "sqlite_sequence"} if "objects" in tables else
                       {"jobs", "job_attempts", "job_events", "assets", "asset_references", "favorites", "favorite_origins", "asset_provenance", "sqlite_sequence"} if "jobs" in tables else
                       {"alembic_version", "asset_contents", "assets", "asset_tags", "tags", "asset_system_state"} if "alembic_version" in tables else set())
            if not tables or set(tables) - allowed:
                raise MigrationError("Unknown SQLite storage family requires review.")
            digest = hashlib.sha256()
            digest.update(canonical({"basis": "sqlite-all-values-v1", "schema": schema,
                                     "applicationId": db.execute("PRAGMA application_id").fetchone()[0],
                                     "userVersion": db.execute("PRAGMA user_version").fetchone()[0],
                                     "encoding": db.execute("PRAGMA encoding").fetchone()[0]}))
            count = 0
            for name in sorted(tables):
                digest.update(canonical({"table": name, "columns": db.execute(f'PRAGMA table_xinfo("{name}")').fetchall()}))
                rows = []
                for row in db.execute(f'SELECT * FROM "{name}"'):
                    count += 1
                    if count > MAX_ROWS:
                        raise MigrationError("SQLite row bound exceeded.")
                    rows.append(canonical([_value(value) for value in row]))
                for row in sorted(rows):
                    digest.update(len(row).to_bytes(8, "big"))
                    digest.update(row)
            return digest.hexdigest()
    except sqlite3.Error:
        raise MigrationError("SQLite logical comparison failed.") from None
