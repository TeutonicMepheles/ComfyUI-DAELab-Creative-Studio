"""Stable asset identity, rooted file references and immutable text favorites."""

import hashlib
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath

from ..contracts.database import Database
from ..contracts.errors import Conflict, InvalidInput, MissingRecord, StorageError
from ..contracts.validation import clean_json, digest, identity, safe_label

_EXTENSIONS = {"image": {".png", ".jpg", ".jpeg", ".webp"}, "video": {".mp4", ".webm", ".mov", ".mkv", ".m4v"}, "audio": {".wav", ".mp3", ".m4a", ".ogg"}}
MAX_FAVORITES = 2000


def _now():
    return datetime.now(timezone.utc).isoformat()


def _stable(namespace, key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "creative-studio:" + namespace + ":" + key))


def _boundary_identity(resolved):
    """Compare already-resolved Windows paths in one namespace, without new IO.

    During concurrent publication ntpath.realpath can retain the Win32 extended
    prefix after its second OS lookup. It denotes the same drive/UNC path, not an
    escape. Keep the original resolved Path for IO; normalize only comparison.
    Other device namespaces are deliberately not aliases of configured roots.
    """
    if isinstance(resolved, PureWindowsPath):
        value = str(resolved)
        if value[:8].casefold() == '\\\\?\\unc\\':
            return PureWindowsPath('\\\\' + value[8:])
        if (value.startswith('\\\\?\\') and len(value) >= 7
                and value[4].isascii() and value[4].isalpha() and value[5:7] == ':\\'):
            return PureWindowsPath(value[4:])
    return resolved


def _hash_file(file, maximum):
    result, size = hashlib.sha256(), 0
    try:
        with file.open("rb") as stream:
            before = os.fstat(stream.fileno())
            if before.st_size == 0 or before.st_size > maximum:
                raise InvalidInput("Media is empty or exceeds the configured size limit.")
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                size += len(block)
                if size > maximum:
                    raise InvalidInput("Media exceeds the configured size limit.")
                result.update(block)
            after = os.fstat(stream.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                raise Conflict("Media changed during inspection; retry with a stable source.")
    except OSError:
        raise InvalidInput("Media cannot be read from the configured file root.") from None
    return result.hexdigest(), size


class AssetCatalog:
    def __init__(self, database_path, *, roots, frozen_root=None, max_file_bytes=4 * 1024**3):
        if not isinstance(roots, dict) or not roots:
            raise InvalidInput("Configure explicit input/output file roots.")
        self.roots = {identity(key, "file root"): Path(value).resolve() for key, value in roots.items()}
        if not isinstance(max_file_bytes, int) or isinstance(max_file_bytes, bool) or max_file_bytes < 1:
            raise InvalidInput("File size limit must be a positive integer.")
        self.max_file_bytes = max_file_bytes
        self.frozen_root = Path(frozen_root).resolve() if frozen_root is not None else None
        if self.frozen_root is not None:
            if "frozen" in self.roots and _boundary_identity(self.roots["frozen"]) != _boundary_identity(self.frozen_root):
                raise InvalidInput("Frozen root conflicts with configured roots.")
            self.roots["frozen"] = self.frozen_root
        self.database = Database(database_path)

    def resolve_reference(self, root_key, relative_path, *, must_exist=True):
        if not isinstance(root_key, str) or root_key not in self.roots or not isinstance(relative_path, str) or not relative_path or "\x00" in relative_path:
            raise InvalidInput("Media reference requires a configured root and relative filename.")
        relative = relative_path.replace("\\", "/")
        windows = PureWindowsPath(relative)
        if Path(relative).is_absolute() or windows.drive or windows.is_absolute() or any(p in {"..", ""} for p in relative.split("/")) or ":" in relative:
            raise InvalidInput("Media reference must stay inside its configured root.")
        root = self.roots[root_key]
        target = (root / relative).resolve()
        boundary_root, boundary_target = _boundary_identity(root), _boundary_identity(target)
        if not boundary_target.is_relative_to(boundary_root) or boundary_target == boundary_root:
            raise InvalidInput("Media reference escaped its configured root.")
        if must_exist and not target.is_file():
            raise InvalidInput("Referenced media file is missing.")
        return target, boundary_target.relative_to(boundary_root).as_posix()

    @staticmethod
    def _check_kind(kind, filename):
        if not isinstance(kind, str) or kind not in _EXTENSIONS or not isinstance(filename, str) or Path(filename).suffix.lower() not in _EXTENSIONS[kind]:
            raise InvalidInput("Media type or file extension is not supported for this asset kind.")

    def _file_record(self, root_key, relative_path, kind, provenance, allow_missing=False):
        self._check_kind(kind, relative_path)
        file, relative = self.resolve_reference(root_key, relative_path, must_exist=not allow_missing)
        if file.is_file():
            sha256, size = _hash_file(file, self.max_file_bytes)
            status = "available"
            key = "file:" + kind + ":" + sha256
        else:
            sha256, size, status = None, None, "missing"
            key = "missing:" + kind + ":" + root_key + ":" + relative
        return {"asset_id": _stable("asset", key), "identity_key": key, "kind": kind, "content_sha256": sha256, "byte_size": size, "text_snapshot": None, "reference_id": _stable("reference", key+":"+root_key+":"+relative), "root_key": root_key, "relative_path": relative, "status": status, "provenance_json": clean_json(provenance)}

    @staticmethod
    def _text_record(text):
        if not isinstance(text, str) or not text or len(text.encode("utf-8")) > 2 * 1024 * 1024:
            raise InvalidInput("Text asset must be nonempty and within the size limit.")
        sha256 = hashlib.sha256(text.encode("utf-8")).hexdigest()
        key = "text:" + sha256
        return {"asset_id": _stable("asset", key), "identity_key": key, "kind": "text", "content_sha256": sha256, "byte_size": len(text.encode("utf-8")), "text_snapshot": text}

    @staticmethod
    def _insert(connection, record):
        connection.execute("INSERT OR IGNORE INTO assets(asset_id,identity_key,kind,content_sha256,byte_size,text_snapshot,created_at) VALUES(?,?,?,?,?,?,?)", (record["asset_id"], record["identity_key"], record["kind"], record["content_sha256"], record["byte_size"], record["text_snapshot"], _now()))
        if "reference_id" in record:
            connection.execute("INSERT OR IGNORE INTO asset_references(reference_id,asset_id,root_key,relative_path,content_sha256,byte_size,status,provenance_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)", (record["reference_id"], record["asset_id"], record["root_key"], record["relative_path"], record["content_sha256"], record["byte_size"], record["status"], record["provenance_json"], _now()))
        if "provenance_json" in record:
            provenance_id = _stable("provenance", digest({"asset": record["asset_id"], "reference": record.get("reference_id"), "detail": json.loads(record["provenance_json"])}))
            connection.execute("INSERT OR IGNORE INTO asset_provenance(provenance_id,asset_id,reference_id,detail_json,created_at) VALUES(?,?,?,?,?)", (provenance_id, record["asset_id"], record.get("reference_id"), record["provenance_json"], _now()))

    def register_file(self, root_key, relative_path, *, kind, provenance=None):
        record = self._file_record(root_key, relative_path, kind, provenance or {})
        with self.database.transaction() as connection:
            self._insert(connection, record)
        return self.get(record["asset_id"])

    def register_text(self, text, *, provenance=None):
        record = self._text_record(text)
        record["provenance_json"] = clean_json(provenance or {})
        with self.database.transaction() as connection:
            self._insert(connection, record)
        return self.get(record["asset_id"])

    @staticmethod
    def _get(connection, asset_id):
        row = connection.execute("SELECT * FROM assets WHERE asset_id=?", (asset_id,)).fetchone()
        if row is None:
            raise MissingRecord("Asset identity was not found.")
        result = dict(row)
        result["references"] = [{**dict(ref), "provenance": json.loads(ref["provenance_json"])} for ref in connection.execute("SELECT * FROM asset_references WHERE asset_id=? ORDER BY created_at,reference_id", (asset_id,))]
        result["provenance"] = [{"id": row["provenance_id"], "reference_id": row["reference_id"], "detail": json.loads(row["detail_json"])} for row in connection.execute("SELECT * FROM asset_provenance WHERE asset_id=? ORDER BY created_at,provenance_id", (asset_id,))]
        return result

    def get(self, asset_id):
        identity(asset_id, "asset ID")
        with self.database.read() as connection:
            return self._get(connection, asset_id)

    def validate_reference(self, reference_id):
        with self.database.read() as connection:
            row = connection.execute("SELECT * FROM asset_references WHERE reference_id=?", (reference_id,)).fetchone()
            if row is None:
                raise MissingRecord("Asset reference was not found.")
            reference = dict(row)
        status = "missing"
        try:
            file, _ = self.resolve_reference(reference["root_key"], reference["relative_path"])
            sha256, size = _hash_file(file, self.max_file_bytes)
            status = "available" if reference["content_sha256"] == sha256 and reference["byte_size"] == size else "changed"
        except InvalidInput:
            pass
        with self.database.transaction() as connection:
            connection.execute("UPDATE asset_references SET status=? WHERE reference_id=?", (status, reference_id))
        return {**reference, "status": status, "usable": status == "available"}

    def result_receipt(self, reference_ids):
        if not isinstance(reference_ids, list) or not reference_ids or len(reference_ids) > 1000:
            raise InvalidInput("Result must contain a bounded nonempty reference list.")
        items = []
        for reference_id in reference_ids:
            checked = self.validate_reference(identity(reference_id, "reference ID"))
            if not checked["usable"] or checked["root_key"] not in {"output", "frozen"}:
                raise InvalidInput("Result media must be intact in output or frozen storage.")
            items.append({"asset_id": checked["asset_id"], "reference_id": reference_id, "sha256": checked["content_sha256"], "bytes": checked["byte_size"]})
        return {"kind": "assets", "items": items}

    def validate_result_receipt(self, receipt):
        if not isinstance(receipt, dict) or set(receipt) != {"kind", "items"} or receipt["kind"] != "assets" or not isinstance(receipt["items"], list):
            raise InvalidInput("Invalid asset result receipt.")
        for item in receipt["items"]:
            if not isinstance(item, dict) or set(item) != {"asset_id", "reference_id", "sha256", "bytes"}:
                raise InvalidInput("Invalid asset result item.")
        fresh = self.result_receipt([item["reference_id"] for item in receipt["items"]])
        if fresh != receipt:
            raise Conflict("Result receipt no longer matches its original asset identity and hash.")
        return True

    def freeze(self, reference_id):
        """Copy to a content-addressed immutable path before creating a job snapshot."""
        if self.frozen_root is None:
            raise InvalidInput("Frozen asset storage is not configured.")
        checked = self.validate_reference(reference_id)
        if not checked["usable"]:
            raise Conflict("Source media is missing or changed; cannot freeze the old reference.")
        source, _ = self.resolve_reference(checked["root_key"], checked["relative_path"])
        destination_name = checked["content_sha256"] + source.suffix.lower()
        if (self.frozen_root / destination_name).is_symlink():
            raise InvalidInput("Frozen media cannot be installed through a symbolic link.")
        destination, _ = self.resolve_reference("frozen", destination_name, must_exist=False)
        temporary = None
        try:
            self.frozen_root.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                existing_hash, existing_size = _hash_file(destination, self.max_file_bytes)
                if (existing_hash, existing_size) != (checked["content_sha256"], checked["byte_size"]):
                    raise Conflict("Frozen asset content was changed; preserve it for diagnostics.")
            else:
                fd, temporary = tempfile.mkstemp(prefix=".freeze-", dir=self.frozen_root)
                with os.fdopen(fd, "wb") as target, source.open("rb") as origin:
                    copied = 0
                    for block in iter(lambda: origin.read(1024 * 1024), b""):
                        copied += len(block)
                        if copied > self.max_file_bytes:
                            raise InvalidInput("Media grew beyond the configured limit while freezing.")
                        target.write(block)
                    target.flush()
                    os.fsync(target.fileno())
                actual_hash, actual_size = _hash_file(Path(temporary), self.max_file_bytes)
                if (actual_hash, actual_size) != (checked["content_sha256"], checked["byte_size"]):
                    raise Conflict("Source changed while freezing; no task snapshot was created.")
                # Hard-link installation is atomic and will never overwrite a concurrent writer.
                try:
                    os.link(temporary, destination)
                except FileExistsError:
                    if _hash_file(destination, self.max_file_bytes) != (actual_hash, actual_size):
                        raise Conflict("Conflicting frozen asset appeared during installation.")
            asset = self.get(checked["asset_id"])
            frozen = self.register_file("frozen", destination_name, kind=asset["kind"], provenance={"source_reference_id": reference_id, "frozen": True})
            reference = next(r for r in frozen["references"] if r["root_key"] == "frozen" and r["relative_path"] == destination_name)
            return {"asset_id": frozen["asset_id"], "reference_id": reference["reference_id"], "root": "frozen", "filename": destination_name, "sha256": checked["content_sha256"], "bytes": checked["byte_size"]}
        except OSError:
            raise StorageError("Cannot freeze asset; no partial file was published as a task input.") from None
        finally:
            if temporary is not None:
                try:
                    Path(temporary).unlink(missing_ok=True)
                except OSError:
                    pass  # An unreferenced .freeze file is never a completed asset.

    @staticmethod
    def _favorite(connection, asset_id, display_name, *, revive=True):
        AssetCatalog._get(connection, asset_id)
        favorite_id = _stable("favorite", asset_id)
        previous = connection.execute("SELECT removed_at FROM favorites WHERE favorite_id=?", (favorite_id,)).fetchone()
        if previous is not None and (previous['removed_at'] is None or not revive):
            return favorite_id
        if connection.execute("SELECT COUNT(*) FROM favorites WHERE removed_at IS NULL").fetchone()[0] >= MAX_FAVORITES:
            raise InvalidInput('收藏已达 2000 项，请先整理资产库')
        if previous is not None:
            connection.execute("UPDATE favorites SET removed_at=NULL,display_name=? WHERE favorite_id=?", (display_name, favorite_id))
            return favorite_id
        connection.execute("INSERT OR IGNORE INTO favorites(favorite_id,asset_id,display_name,created_at) VALUES(?,?,?,?)", (favorite_id, asset_id, display_name, _now()))
        return favorite_id

    def favorite(self, asset_id, *, display_name):
        safe_label(display_name)
        with self.database.transaction() as connection:
            return self._favorite(connection, asset_id, display_name)

    def unfavorite(self, favorite_id):
        identity(favorite_id, 'favorite ID')
        with self.database.transaction() as connection:
            previous = connection.execute('SELECT * FROM favorites WHERE favorite_id=?', (favorite_id,)).fetchone()
            if previous is None:
                raise MissingRecord('Favorite was not found.')
            connection.execute('UPDATE favorites SET removed_at=COALESCE(removed_at,?) WHERE favorite_id=?', (_now(), favorite_id))
            return {'favorite_id': favorite_id, 'removed': True}

    def find_favorite(self, asset_id, *, include_removed=False):
        identity(asset_id, 'asset ID')
        with self.database.read() as connection:
            row = connection.execute('SELECT * FROM favorites WHERE asset_id=?', (asset_id,)).fetchone()
            if row is None or row['removed_at'] is not None and not include_removed:
                return None
            return {**dict(row), 'asset': self._get(connection, asset_id)}

    def import_legacy_favorites(self, *, origin, entries):
        """Explicit normalized import contract; legacy format adapters live in compat."""
        safe_label(origin, "origin", limit=4096)
        if not origin or not isinstance(entries, list) or len(entries) > 10000:
            raise InvalidInput("Legacy import needs an origin and a bounded entry list.")
        clean_json(entries, max_bytes=32 * 1024 * 1024)
        prepared, report = [], []
        ids = set()
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) - {"legacy_id", "kind", "text", "root", "filename", "display_name", "provenance", "legacy_raw"}:
                raise InvalidInput("Legacy adapter must supply the normalized favorite contract.")
            legacy_id = identity(entry.get("legacy_id"), "legacy favorite ID")
            if legacy_id in ids:
                raise InvalidInput("Duplicate legacy favorite IDs in one import.")
            ids.add(legacy_id)
            display_name = safe_label(entry.get("display_name", ""))
            if entry.get("kind") == "text":
                record = self._text_record(entry.get("text"))
            else:
                record = self._file_record(entry.get("root"), entry.get("filename"), entry.get("kind"), entry.get("provenance", {}), allow_missing=True)
            prepared.append((entry, record, display_name, digest(entry)))
        with self.database.transaction() as connection:
            for entry, record, name, fingerprint in prepared:
                legacy_id = entry["legacy_id"]
                prior = connection.execute("SELECT fingerprint,favorite_id FROM favorite_origins WHERE origin=? AND legacy_id=?", (origin, legacy_id)).fetchone()
                if prior:
                    if prior["fingerprint"] != fingerprint:
                        raise Conflict("Legacy identity changed contents; import as an explicit new source version.")
                    removed = connection.execute('SELECT removed_at FROM favorites WHERE favorite_id=?', (prior['favorite_id'],)).fetchone()[0]
                    report.append({"legacy_id": legacy_id, "favorite_id": prior["favorite_id"], "status": "already_imported_cancelled" if removed else "already_imported"})
                    continue
                self._insert(connection, record)
                favorite_id = self._favorite(connection, record["asset_id"], name, revive=False)
                connection.execute("INSERT INTO favorite_origins(origin,legacy_id,fingerprint,favorite_id,raw_json) VALUES(?,?,?,?,?)", (origin, legacy_id, fingerprint, favorite_id, clean_json(entry)))
                removed = connection.execute('SELECT removed_at FROM favorites WHERE favorite_id=?', (favorite_id,)).fetchone()[0]
                report.append({"legacy_id": legacy_id, "favorite_id": favorite_id, "asset_id": record["asset_id"], "status": 'cancelled_preserved' if removed else record.get("status", "available")})
        return report

    def search(self, query="", *, kind=None, limit=100, offset=0):
        safe_label(query, "search query")
        if kind is not None and kind not in {*_EXTENSIONS, "text"} or isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000 or isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            raise InvalidInput("Invalid asset search bounds or kind.")
        # Escape LIKE wildcards: the search box searches literal text, not SQL patterns.
        pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        sql = """SELECT f.*,a.kind,a.content_sha256,a.text_snapshot FROM favorites f
                 JOIN assets a USING(asset_id) WHERE f.removed_at IS NULL AND (f.display_name LIKE ? ESCAPE '\\' OR COALESCE(a.text_snapshot,'') LIKE ? ESCAPE '\\')"""
        params = [pattern, pattern]
        if kind:
            sql += " AND a.kind=?"
            params.append(kind)
        sql += " ORDER BY f.created_at DESC,f.favorite_id LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self.database.read() as connection:
            results = [dict(row) for row in connection.execute(sql, params)]
            for result in results:
                result["references"] = [dict(row) for row in connection.execute("SELECT reference_id,root_key,relative_path,status FROM asset_references WHERE asset_id=?", (result["asset_id"],))]
            return results

    def search_page(self, query='', *, kind=None, limit=48, offset=0):
        # One bounded row list per page; no file hashing or media decoding while searching.
        items = self.search(query, kind=kind, limit=limit, offset=offset)
        pattern = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        sql = """SELECT COUNT(*) FROM favorites f JOIN assets a USING(asset_id)
                 WHERE f.removed_at IS NULL AND (f.display_name LIKE ? ESCAPE '\\' OR COALESCE(a.text_snapshot,'') LIKE ? ESCAPE '\\')"""
        params = [pattern, pattern]
        if kind is not None:
            sql += ' AND a.kind=?'
            params.append(kind)
        with self.database.read() as connection:
            total = connection.execute(sql, params).fetchone()[0]
        return {'items': items, 'total': total, 'limit': limit, 'offset': offset, 'has_more': offset + len(items) < total}

    def export_favorites(self):
        with self.database.read() as connection:
            return {"schema_version": 1, "favorites": [dict(row) for row in connection.execute("SELECT * FROM favorites ORDER BY favorite_id")], "assets": [self._get(connection, row[0]) for row in connection.execute("SELECT asset_id FROM favorites ORDER BY asset_id")], "origins": [dict(row) for row in connection.execute("SELECT * FROM favorite_origins ORDER BY origin,legacy_id")]}
