"""Native SQLite schema comes from the pinned host's actual offline Alembic chain."""
import json
import sqlite3
from pathlib import Path
from contextlib import closing
import tempfile
import unittest
import hashlib
import os
import shutil
from unittest.mock import patch

from tools.migration.host_database import inspect_host_database, HOST_COMMIT, REVISION
from tools.migration.host_database import remap_host_database, logical_database_digest
from tools.migration.safety import MigrationError, file_hash


class HostDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.database = self.root / "comfyui.db"
        self.fixture = json.loads((Path(__file__).parent / "fixtures/comfyui-assets-schema.json").read_text("utf-8"))
        self.assertEqual(self.fixture["sourceCommit"], HOST_COMMIT)
        with closing(sqlite3.connect(self.database)) as db:
            for row in sorted(self.fixture["schema"], key=lambda row: row["type"] != "table"):
                db.execute(row["sql"])
            db.execute("INSERT INTO alembic_version VALUES (?)", (REVISION,))
            db.commit()

    def test_pinned_native_schema_inspection_never_mutates_database(self):
        before = file_hash(self.database)
        report = inspect_host_database(self.database, [self.root])
        self.assertEqual(report["executionRecords"], 0)
        self.assertEqual(report["schemaVersion"], REVISION)
        self.assertEqual(file_hash(self.database), before)
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ["comfyui.db"])

    def test_unknown_version_schema_and_uncheckpointed_sidecar_refuse(self):
        with closing(sqlite3.connect(self.database)) as db:
            db.execute("UPDATE alembic_version SET version_num='future'")
            db.commit()
        with self.assertRaises(MigrationError):
            inspect_host_database(self.database, [self.root])
        with closing(sqlite3.connect(self.database)) as db:
            db.execute("UPDATE alembic_version SET version_num=?", (REVISION,))
            db.execute("CREATE TABLE unknown_facts (body TEXT)")
            db.commit()
        with self.assertRaises(MigrationError):
            inspect_host_database(self.database, [self.root])
        (self.root / "comfyui.db-wal").write_bytes(b"uncheckpointed")
        with self.assertRaisesRegex(MigrationError, "checkpoint"):
            inspect_host_database(self.database, [self.root])

    def test_native_asset_path_must_belong_to_profile_and_sensitive_metadata_refuses(self):
        asset = self.root / "image.png"
        asset.write_bytes(b"synthetic asset bytes")
        with closing(sqlite3.connect(self.database)) as db:
            db.execute("INSERT INTO asset_contents(id,size_bytes,path,created_at) VALUES ('c',?,?,?)", (asset.stat().st_size, str(asset), "2026-01-01"))
            db.commit()
        self.assertEqual(inspect_host_database(self.database, [self.root])["counts"]["asset_contents"], 1)
        foreign = self.root / "owned-input"
        foreign.mkdir()
        with self.assertRaises(MigrationError):
            inspect_host_database(self.database, [foreign])
        with closing(sqlite3.connect(self.database)) as db:
            db.execute("INSERT INTO asset_system_state(key,value) VALUES ('api_key','synthetic-sensitive')")
            db.commit()
        with self.assertRaises(MigrationError):
            inspect_host_database(self.database, [self.root])

    def populated(self):
        roots = {name: self.root / 'source' / name for name in ('user', 'input', 'output')}
        for root in roots.values():
            root.mkdir(parents=True)
        asset = roots['input'] / '素材.png'
        asset.write_bytes(b'synthetic asset; not a decoded media fixture')
        loader = roots['output'] / 'loader.png'
        loader.write_bytes(b'other loader bytes')
        with closing(sqlite3.connect(self.database)) as db:
            db.execute("INSERT INTO asset_contents VALUES ('content', 'opaque-native-blake3', ?, ?, 42, 0, '2026-01-01')", (asset.stat().st_size, str(asset)))
            for identity, path in [('one', str(loader)), ('two', 'nested/relative.png'), ('three', None)]:
                db.execute("INSERT INTO assets VALUES (?, 'content', ?, 'image/png', ?, 'job-identity', ?, ?, NULL, '2026-01-01', '2026-01-02', NULL)",
                           (identity, identity, '{"unknown":{"ids":[1,null,"中文"]}}', '{"rating":2}', path))
            db.execute("INSERT INTO tags VALUES ('tag')")
            db.execute("INSERT INTO asset_tags VALUES ('one','tag','user','2026-01-02')")
            db.execute("INSERT INTO asset_system_state VALUES ('last_scan','42')")
            db.commit()
        dest = {name: self.root / 'not-created' / name for name in roots}
        mapping = {str(asset): str(dest['input'] / asset.name), str(loader): str(dest['output'] / loader.name)}
        return roots, dest, mapping

    def test_remap_is_deterministic_readonly_and_preserves_every_nonpath_value(self):
        roots, dest, mapping = self.populated()
        before = self.database.read_bytes()
        result = remap_host_database(self.database, mapping, dest)
        self.assertEqual(remap_host_database(self.database, dict(reversed(list(mapping.items()))), dest), result)
        self.assertEqual(self.database.read_bytes(), before)
        self.assertFalse((self.root / 'not-created').exists())
        self.assertEqual(result['manifest']['sourceSHA256'], hashlib.sha256(before).hexdigest())
        self.assertEqual(result['manifest']['resultSHA256'], hashlib.sha256(result['bytes']).hexdigest())
        self.assertEqual(result['manifest']['integrity'], 'ok')
        self.assertEqual(len(result['manifest']['changedReferences']), 2)
        self.assertEqual(result['manifest']['counts']['assets'], 3)
        self.assertEqual(result['manifest']['nonPathMetadataSHA256']['before'], result['manifest']['nonPathMetadataSHA256']['after'])
        self.assertEqual(logical_database_digest(self.database, roots), logical_database_digest(result['bytes'], dest))
        target = self.root / 'result.db'
        target.write_bytes(result['bytes'])
        with closing(sqlite3.connect(target)) as db:
            self.assertEqual(db.execute("SELECT loader_path FROM assets ORDER BY id").fetchall(), [(mapping[next(k for k in mapping if k.endswith('loader.png'))],), (None,), ('nested/relative.png',)])
            db.execute("UPDATE assets SET updated_at='2026-01-03' WHERE id='one'")
            db.commit()
        self.assertNotEqual(logical_database_digest(target, dest), logical_database_digest(result['bytes'], dest))

    def test_old_and_new_role_roots_have_equal_logical_digest_but_distinct_bytes(self):
        roots, dest, mapping = self.populated()
        other = {key: self.root / 'other-role' / key for key in dest}
        other_mapping = {source: str(other['input' if Path(source).name == '素材.png' else 'output'] / Path(source).name) for source in mapping}
        first = remap_host_database(self.database, mapping, dest)
        second = remap_host_database(self.database, other_mapping, other)
        self.assertNotEqual(first['bytes'], second['bytes'])
        self.assertEqual(logical_database_digest(first['bytes'], dest), logical_database_digest(second['bytes'], other))
        self.assertEqual(logical_database_digest(first['bytes'], dest), logical_database_digest(self.database, roots))

    def test_missing_mapping_changed_source_external_and_overlapping_destination_refuse(self):
        roots, dest, mapping = self.populated()
        source = next(iter(mapping))
        for invalid in ({}, {**mapping, source: str(self.root / 'outside.png')}, {**mapping, source: str(dest['input'] / '..' / 'escape.png')}, {**mapping, source: str(dest['input'])}):
            with self.subTest(mapping=invalid), self.assertRaises(MigrationError):
                remap_host_database(self.database, invalid, dest)
        with self.assertRaises(MigrationError):
            remap_host_database(self.database, mapping, {**dest, 'output': dest['input'] / 'nested'})
        Path(source).write_bytes(b'changed size')
        with self.assertRaises(MigrationError):
            remap_host_database(self.database, mapping, dest)

    def test_unknown_schema_trigger_extra_index_and_sensitive_json_are_rejected(self):
        roots, dest, mapping = self.populated()
        before = self.database.read_bytes()
        for sql in ("CREATE TRIGGER no_write BEFORE UPDATE ON assets BEGIN SELECT 1; END", "CREATE INDEX surprise ON assets(job_id)", "UPDATE assets SET user_metadata='{\"api_key\":\"synthetic-secret\"}'"):
            self.database.write_bytes(before)
            with closing(sqlite3.connect(self.database)) as db:
                db.execute(sql)
                db.commit()
            with self.subTest(sql=sql), self.assertRaises(MigrationError):
                remap_host_database(self.database, mapping, dest)
            with self.assertRaises(MigrationError):
                logical_database_digest(self.database, roots)

    def test_nonpath_json_keys_and_timestamps_are_never_normalized_away(self):
        roots, dest, mapping = self.populated()
        before = logical_database_digest(self.database, roots)
        with closing(sqlite3.connect(self.database)) as db:
            db.execute("UPDATE assets SET system_metadata='{\"unknown\":{\"ids\":[1,null,\"中文\"],\"newField\":1}}' WHERE id='one'")
            db.commit()
        self.assertNotEqual(logical_database_digest(self.database, roots), before)
        transformed = remap_host_database(self.database, mapping, dest)
        self.assertEqual(logical_database_digest(self.database, roots), logical_database_digest(transformed['bytes'], dest))

    def test_bounds_sidecars_and_nonordinary_files_refuse_without_source_mutation(self):
        roots, dest, mapping = self.populated()
        before = self.database.read_bytes()
        with patch('tools.migration.host_database.MAX_DATABASE_BYTES', len(before) - 1), self.assertRaises(MigrationError):
            remap_host_database(self.database, mapping, dest)
        for suffix in ('-wal', '-shm', '-journal'):
            sidecar = self.database.with_name(self.database.name + suffix)
            sidecar.write_bytes(b'owned synthetic sidecar')
            with self.assertRaisesRegex(MigrationError, 'checkpoint'):
                remap_host_database(self.database, mapping, dest)
            sidecar.unlink()
        self.assertEqual(self.database.read_bytes(), before)
        with self.assertRaises(MigrationError):
            logical_database_digest(b'not sqlite', roots)

    def test_checkpointed_wal_source_is_read_without_creating_sidecars(self):
        roots, dest, mapping = self.populated()
        with closing(sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
        before = self.database.read_bytes()
        result = remap_host_database(self.database, mapping, dest)
        self.assertEqual(self.database.read_bytes(), before)
        self.assertFalse(self.database.with_name(self.database.name + '-wal').exists())
        self.assertFalse(self.database.with_name(self.database.name + '-shm').exists())
        self.assertEqual(logical_database_digest(self.database, roots), logical_database_digest(result['bytes'], dest))

    def test_returned_copy_passes_final_file_inspection_and_keeps_repeated_content_identity(self):
        roots, dest, mapping = self.populated()
        result = remap_host_database(self.database, mapping, dest)
        for root in dest.values():
            root.mkdir(parents=True)
        for source, destination in mapping.items():
            shutil.copyfile(source, destination)
        target = dest['user'] / 'comfyui.db'
        target.write_bytes(result['bytes'])
        report = inspect_host_database(target, dest.values())
        self.assertEqual(report['counts']['assets'], 3)
        self.assertEqual(report['counts']['asset_contents'], 1)
        self.assertEqual(report['sha256'], result['manifest']['resultSHA256'])
        with closing(sqlite3.connect(target)) as db:
            self.assertEqual(db.execute('SELECT DISTINCT content_id FROM assets').fetchall(), [('content',)])
        self.assertEqual(logical_database_digest(target, dest), logical_database_digest(self.database, roots))

    def test_hardlink_row_limit_invalid_header_and_destination_stream_are_rejected(self):
        roots, dest, mapping = self.populated()
        source = Path(next(iter(mapping)))
        linked = self.root / 'hardlink.png'
        os.link(source, linked)
        try:
            with self.assertRaises(MigrationError):
                remap_host_database(self.database, mapping, dest)
        finally:
            linked.unlink()
        with patch('tools.migration.host_database.MAX_ROWS', 2), self.assertRaises(MigrationError):
            logical_database_digest(self.database, roots)
        raw = self.database.read_bytes()
        with self.assertRaises(MigrationError):
            logical_database_digest(raw[:18] + b'\xff\xff' + raw[20:], roots)
        with self.assertRaises(MigrationError):
            remap_host_database(self.database, {**mapping, str(source): str(dest['input'] / 'file.png:stream')}, dest)

    def test_schema_semantics_cannot_change_while_retaining_column_names_and_types(self):
        for transform in (
            lambda sql: sql.replace('ON DELETE RESTRICT', 'ON DELETE CASCADE'),
            lambda sql: sql.replace('CHECK (size_bytes >= 0)', 'CHECK (size_bytes >= -1)'),
            lambda sql: sql.replace('path TEXT NOT NULL', 'path TEXT NOT NULL CHECK (length(path) > 0)'),
        ):
            database = self.root / 'changed-schema.db'
            if database.exists():
                database.unlink()
            with closing(sqlite3.connect(database)) as db:
                for row in sorted(self.fixture['schema'], key=lambda row: row['type'] != 'table'):
                    db.execute(transform(row['sql']))
                db.execute('INSERT INTO alembic_version VALUES (?)', (REVISION,))
                db.commit()
            with self.assertRaises(MigrationError):
                inspect_host_database(database, [self.root])


if __name__ == "__main__":
    unittest.main()
