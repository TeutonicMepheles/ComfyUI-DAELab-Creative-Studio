"""Pinned native asset metadata: read-only inspection and explicit copy remapping.

Only an in-memory copy may change asset_contents.path and absolute loader_path.
Source/backup files are never opened writable, checkpointed or upgraded. Returned
bytes are published exclusively by the owned-profile caller, not by this helper.
"""
import hashlib
import re
import sqlite3
from pathlib import Path, PureWindowsPath, PurePosixPath
from contextlib import closing, contextmanager

from backend.contracts.validation import clean_json
from backend.contracts.errors import InvalidInput
from .prepare import _inspect_embedded_json
from .safety import MigrationError, checked, file_hash, json_hash, relative

HOST_COMMIT = "3c1b7a17fdf239d35ce98cc777756f572d089795"
REVISION = "0008_drop_asset_meta"
# Schema signatures independently transcribed from the fixed host migrations;
# no upstream implementation is imported or executed by the migration tool.
TABLES = {
    "alembic_version": {"version_num": "VARCHAR(32)"},
    "asset_contents": {"id": "VARCHAR(36)", "hash": "VARCHAR(256)", "size_bytes": "BIGINT", "path": "TEXT",
                       "mtime_ns": "BIGINT", "is_missing": "BOOLEAN", "created_at": "DATETIME"},
    "assets": {"id": "VARCHAR(36)", "content_id": "VARCHAR(36)", "name": "VARCHAR(512)", "mime_type": "VARCHAR(255)",
               "system_metadata": "JSON", "job_id": "VARCHAR(36)", "user_metadata": "JSON", "loader_path": "TEXT",
               "preview_id": "VARCHAR(36)", "created_at": "DATETIME", "updated_at": "DATETIME", "last_access_time": "DATETIME"},
    "asset_tags": {"asset_id": "VARCHAR(36)", "tag_name": "VARCHAR(512)", "origin": "VARCHAR(32)", "added_at": "DATETIME"},
    "tags": {"name": "VARCHAR(512)"},
    "asset_system_state": {"key": "VARCHAR(256)", "value": "TEXT"},
}

MAX_DATABASE_BYTES = 128 * 1024 * 1024
MAX_ROWS = 100000
PRIMARY = {"alembic_version": ("version_num",), "asset_contents": ("id",), "assets": ("id",),
           "asset_tags": ("asset_id", "tag_name"), "tags": ("name",), "asset_system_state": ("key",)}
REQUIRED = {"alembic_version": {"version_num"}, "asset_contents": {"id", "size_bytes", "path", "is_missing", "created_at"},
            "assets": {"id", "content_id", "name", "created_at", "updated_at"},
            "asset_tags": {"asset_id", "tag_name", "origin", "added_at"}, "tags": {"name"}, "asset_system_state": {"key", "value"}}
INDEXES = {
    "ix_asset_contents_hash": ("asset_contents", ("hash",), 0, 0),
    "uq_asset_contents_path_live": ("asset_contents", ("path",), 1, 1),
    "ix_asset_tags_asset_id": ("asset_tags", ("asset_id",), 0, 0),
    "ix_asset_tags_tag_name": ("asset_tags", ("tag_name",), 0, 0),
    **{"ix_assets_" + name: ("assets", (name,), 0, 0) for name in ("content_id", "created_at", "name", "preview_id")},
}
FOREIGN = {"assets": {("asset_contents", "content_id", "id", "RESTRICT"), ("assets", "preview_id", "id", "SET NULL")},
           "asset_tags": {("assets", "asset_id", "id", "CASCADE"), ("tags", "tag_name", "name", "RESTRICT")}}
PATH_COLUMNS = {"asset_contents": "path", "assets": "loader_path"}


def _sidecars(path):
    if any(path.with_name(path.name + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
        raise MigrationError("Host database requires an offline checkpoint before inspection.")


@contextmanager
def _database(source):
    """Use a bounded snapshot. WAL input never causes a source checkpoint/write."""
    path = None
    try:
        with closing(sqlite3.connect(":memory:")) as db:
            if isinstance(source, bytes):
                if (len(source) < 100 or len(source) > MAX_DATABASE_BYTES or not source.startswith(b"SQLite format 3\x00")
                        or source[18] not in (1, 2) or source[19] not in (1, 2)):
                    raise MigrationError("Host database exceeds the bound or is not SQLite.")
                digest = hashlib.sha256(source).hexdigest()
                # SQLite deserialize cannot attach a WAL file. No WAL contents
                # are accepted; these two header bytes affect only this memory
                # handle, never the caller's bytes or any logical DB value.
                raw = source[:18] + b"\x01\x01" + source[20:]
                db.deserialize(raw)
            else:
                path = checked(source, exists=True)
                _sidecars(path)
                if not path.is_file() or path.stat().st_size > MAX_DATABASE_BYTES:
                    raise MigrationError("Host database exceeds the bounded inspection limit.")
                digest = file_hash(path)
                with closing(sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)) as original:
                    original.execute("PRAGMA query_only=ON")
                    original.backup(db)
            db.execute("PRAGMA trusted_schema=OFF")
            db.execute("PRAGMA query_only=ON")
            try:
                yield db, digest
            finally:
                if path is not None:
                    _sidecars(path)
                    if file_hash(path) != digest:
                        raise MigrationError("Host asset database changed during read-only inspection.")
    except (sqlite3.Error, InvalidInput, OSError, TypeError, OverflowError) as exc:
        raise MigrationError("Host asset database is uninspectable or contains invalid metadata.") from exc


def _snapshot(db):
    if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or db.execute("PRAGMA foreign_key_check").fetchall():
        raise MigrationError("Host asset database integrity failed.")
    objects = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type != 'index' OR name NOT LIKE 'sqlite_autoindex_%' ORDER BY type,name").fetchall()
    if ({name for kind, name, _, _ in objects if kind == "table"} != set(TABLES) or
            {name for kind, name, _, _ in objects if kind == "index"} != set(INDEXES) or
            any(kind not in {"table", "index"} for kind, *_ in objects)):
        raise MigrationError("Unknown host asset database schema.")
    rows = {}
    for table, expected in TABLES.items():
        columns = db.execute('PRAGMA table_xinfo("' + table + '")').fetchall()
        wanted = [(index, name, type_, int(name in REQUIRED[table]), "'0'" if (table, name) == ("asset_contents", "is_missing") else None,
                   PRIMARY[table].index(name) + 1 if name in PRIMARY[table] else 0, 0)
                  for index, (name, type_) in enumerate(expected.items())]
        if columns != wanted:
            raise MigrationError("Host database columns differ from the pinned schema.")
        foreign = db.execute('PRAGMA foreign_key_list("' + table + '")').fetchall()
        if ({(r[2], r[3], r[4], r[6]) for r in foreign} != FOREIGN.get(table, set()) or
                len(foreign) != len(FOREIGN.get(table, set())) or any(r[1] != 0 or r[5] != "NO ACTION" or r[7] != "NONE" for r in foreign)):
            raise MigrationError("Host database foreign keys differ from the pinned schema.")
        sql = next(sql for kind, name, _, sql in objects if kind == "table" and name == table)
        if re.search(r"\b(?:collate|deferrable|generated|virtual|without)\b", sql, re.I):
            raise MigrationError("Unsupported native schema clause.")
        checks = [re.sub(r'\s+|["`\[\]]', '', check).lower() for check in re.findall(r"\bCHECK\s*\(([^()]*)\)", sql, re.I)]
        if (len(checks) != len(re.findall(r"\bCHECK\s*\(", sql, re.I)) or
                sorted(checks) != (["mtime_ns>=0", "size_bytes>=0"] if table == "asset_contents" else [])):
            raise MigrationError("Host database checks differ from the pinned schema.")
        indexes = db.execute('PRAGMA index_list("' + table + '")').fetchall()
        primary = [r for r in indexes if r[3] == "pk"]
        if len(primary) != 1 or any(r[3] not in {"pk", "c"} for r in indexes):
            raise MigrationError("Unsupported native unique constraint.")
        for _, name, unique, origin, partial in indexes:
            info = db.execute('PRAGMA index_xinfo("' + name.replace('"', '""') + '")').fetchall()
            key_columns = tuple(r[2] for r in info if r[5])
            if any(r[3] or r[4] != "BINARY" for r in info):
                raise MigrationError("Unsupported native index ordering or collation.")
            if origin == "pk":
                if key_columns != PRIMARY[table] or unique != 1 or partial != 0:
                    raise MigrationError("Host primary key differs from the pinned schema.")
            elif INDEXES.get(name) != (table, key_columns, unique, partial):
                raise MigrationError("Host index differs from the pinned schema.")
        names = list(expected)
        order = ','.join('"' + name + '"' for name in PRIMARY[table])
        values = db.execute('SELECT * FROM "' + table + '" ORDER BY ' + order).fetchmany(MAX_ROWS + 1)
        if len(values) > MAX_ROWS:
            raise MigrationError("Host database exceeds the bounded row limit.")
        rows[table] = [dict(zip(names, row)) for row in values]
        for value in rows[table]:
            clean_json(value, max_bytes=8 * 1024 * 1024)
            _inspect_embedded_json(value)
            if table == "asset_system_state":
                clean_json({value["key"]: value["value"]})
    index_sql = next(sql for kind, name, _, sql in objects if name == "uq_asset_contents_path_live")
    if not re.search(r"\bWHERE\s+is_missing\s*=\s*0\s*$", index_sql, re.I):
        raise MigrationError("Host partial index predicate differs from the pinned schema.")
    if rows["alembic_version"] != [{"version_num": REVISION}]:
        raise MigrationError("Unknown host asset schema version; no upgrade was attempted.")
    return {"schema": objects, "rows": rows, "pragmas": {key: db.execute("PRAGMA " + key).fetchone()[0] for key in ("user_version", "application_id", "encoding")}}


def _absolute(value):
    if not isinstance(value, str) or "\x00" in value:
        raise MigrationError("Invalid native asset path.")
    candidate = Path(value)
    if candidate.is_absolute():
        return True
    if PureWindowsPath(value).drive or PureWindowsPath(value).root or PurePosixPath(value).is_absolute():
        raise MigrationError("Native asset path uses an unsupported absolute path format.")
    return False


def _roots(roots):
    if not isinstance(roots, dict) or set(roots) != {"user", "input", "output"}:
        raise MigrationError("Explicit user/input/output reference roots are required.")
    result = {name: checked(path) for name, path in roots.items()}
    for name, path in result.items():
        if path.exists() and not path.is_dir():
            raise MigrationError("A reference root must be a directory.")
        if any(other != name and (path.is_relative_to(value) or value.is_relative_to(path)) for other, value in result.items()):
            raise MigrationError("Reference roots must be distinct and nonoverlapping.")
    return result


def _reference(path, roots):
    path = checked(path)
    matched = [(name, root) for name, root in roots.items() if path != root and path.is_relative_to(root)]
    if len(matched) != 1:
        raise MigrationError("Host asset path needs an explicit reviewed profile remapping.")
    name, root = matched[0]
    name_within_root = path.relative_to(root).as_posix()
    relative(name_within_root)
    return {"root": name, "relative": name_within_root}


def _references(snapshot):
    for table, column in PATH_COLUMNS.items():
        for row in snapshot["rows"][table]:
            value = row[column]
            if table == "asset_contents":
                if not _absolute(value):
                    raise MigrationError("Native asset content requires an absolute path.")
                if row["is_missing"] != 0 or type(row["size_bytes"]) is not int or row["size_bytes"] < 0:
                    raise MigrationError("Host asset reference is missing or invalid.")
                yield table, row, column
            elif value is not None and _absolute(value):
                yield table, row, column


def _source_file(value, size=None):
    path = checked(value, exists=True)
    if not path.is_file() or path.stat().st_nlink != 1 or size is not None and path.stat().st_size != size:
        raise MigrationError("Host asset reference is missing, linked or changed.")
    return path


def _nonpath(snapshot):
    import copy
    result = copy.deepcopy(snapshot)
    for _, row, column in _references(result):
        row[column] = {"nativeAbsolutePath": True}
    return json_hash(result)


def inspect_host_database(path, roots):
    allowed = [checked(root, exists=True) for root in roots]
    with _database(path) as (db, digest):
        snapshot = _snapshot(db)
        for table, row, column in _references(snapshot):
            target = _source_file(row[column], row["size_bytes"] if table == "asset_contents" else None)
            if not any(target != root and target.is_relative_to(root) for root in allowed):
                raise MigrationError("Host asset path needs an explicit reviewed profile remapping.")
        return {"hostCommit": HOST_COMMIT, "schemaVersion": REVISION, "sha256": digest,
                "counts": {table: len(rows) for table, rows in snapshot["rows"].items()}, "executionRecords": 0}


def logical_database_digest(source, roots):
    """Normalize exactly the two absolute path fields, not IDs/JSON/time metadata.

    The bytes overload is used before the destination profile exists. It proves
    logical DB equality only; final file existence/hash proof belongs to profiles.
    """
    roots = _roots(roots)
    with _database(source) as (db, _):
        snapshot = _snapshot(db)
        for _, row, column in _references(snapshot):
            row[column] = _reference(row[column], roots)
        return json_hash(snapshot)


def remap_host_database(source_db, path_mapping, destination_roots):
    """Return deterministic SQLite bytes and a full path delta; publish nothing.

    Each source reference must be explicitly mapped to one contained destination.
    Caller binds that mapping to its full verified backup inventory; this helper
    independently checks referenced source files/size and records their SHA256.
    Native `asset_contents.hash` is opaque (upstream BLAKE3), never reinterpreted.
    """
    roots = _roots(destination_roots)
    if not isinstance(path_mapping, dict) or len(path_mapping) > MAX_ROWS * 2:
        raise MigrationError("An explicit bounded asset path mapping is required.")
    mapping = {}
    for source, destination in path_mapping.items():
        if not _absolute(source) or not isinstance(destination, str) or not _absolute(destination):
            raise MigrationError("Asset mappings require absolute paths.")
        key, value = checked(source), checked(destination)
        _reference(value, roots)
        if key in mapping and mapping[key] != value:
            raise MigrationError("Ambiguous normalized asset mapping.")
        mapping[key] = value
    with _database(source_db) as (db, source_hash):
        before = _snapshot(db)
        metadata_before = _nonpath(before)
        changed, verified = [], {}
        db.execute("PRAGMA query_only=OFF")
        db.execute("PRAGMA foreign_keys=ON")
        with db:
            for table, row, column in _references(before):
                source = _source_file(row[column], row["size_bytes"] if table == "asset_contents" else None)
                if source not in mapping:
                    raise MigrationError("An absolute native asset reference has no explicit mapping.")
                destination = mapping[source]
                if source not in verified:
                    verified[source] = {"path": str(source), "size": source.stat().st_size, "sha256": file_hash(source)}
                after = str(destination)
                if row[column] != after:
                    db.execute('UPDATE "' + table + '" SET "' + column + '"=? WHERE id=?', (after, row["id"]))
                    changed.append({"table": table, "id": row["id"], "column": column, "before": row[column], "after": after})
        db.execute("PRAGMA query_only=ON")
        after = _snapshot(db)
        metadata_after = _nonpath(after)
        if metadata_before != metadata_after:
            raise MigrationError("Native asset remapping changed nonpath metadata.")
        for _, row, column in _references(after):
            _reference(row[column], roots)
        for source, expected in verified.items():
            if source.stat().st_size != expected["size"] or file_hash(source) != expected["sha256"]:
                raise MigrationError("Referenced source changed during remapping.")
        raw = db.serialize()
        if len(raw) > MAX_DATABASE_BYTES:
            raise MigrationError("Transformed native database exceeds the bound.")
        return {"bytes": raw, "manifest": {"schemaVersion": 1, "hostCommit": HOST_COMMIT, "nativeRevision": REVISION,
                "sourceSHA256": source_hash, "resultSHA256": hashlib.sha256(raw).hexdigest(), "integrity": "ok",
                "counts": {table: len(rows) for table, rows in before["rows"].items()},
                "nonPathMetadataSHA256": {"before": metadata_before, "after": metadata_after},
                "changedReferences": changed, "verifiedSourceFiles": sorted(verified.values(), key=lambda row: row["path"]),
                "executionRecords": 0, "sourceWrites": 0, "publication": "caller-owned-copy-only"}}
