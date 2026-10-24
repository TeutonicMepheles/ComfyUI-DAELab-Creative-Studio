"""Persistent service contracts and synthetic media; no host/provider TC claim."""

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import struct
import zlib
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from backend.assets import AssetCatalog
from backend.contracts.database import APPLICATION_ID, SCHEMA_VERSION, Database, _MIGRATIONS
from backend.contracts.errors import Conflict, InvalidInput, InvalidTransition, StorageError
from backend.jobs import JobLedger
from backend.media.validation import MediaResultValidator

ROOT = Path(__file__).resolve().parents[2]


def tiny_png():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"")


class ServicesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="studio-services-test-")
        self.root = Path(self.temp.name)
        self.db = self.root / "studio.sqlite3"
        self.input = self.root / "input"
        self.output = self.root / "output"
        self.input.mkdir()
        self.output.mkdir()
        self.ledger = JobLedger(self.db)
        self.assets = AssetCatalog(self.db, roots={"input": self.input, "output": self.output}, frozen_root=self.root / "frozen")

    def tearDown(self):
        self.temp.cleanup()

    def create(self, request="request-1", kind="local", **snapshot):
        return self.ledger.create_or_get(request, provider="test-local", execution_kind=kind, snapshot=snapshot or {"prompt": "合成测试"}, source={"workflow": "workflow-a", "node": "node-a"})[0]

    def submitted(self, request="request-1", kind="local"):
        self.create(request, kind)
        claim = self.ledger.begin_submission(request, expected_version=0)
        return self.ledger.mark_submitted(request, "native-"+request, expected_version=claim["version"], event_id="accepted")

    def test_shared_versioned_database_and_refuse_foreign_schema(self):
        with closing(sqlite3.connect(self.db)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], SCHEMA_VERSION)
            self.assertEqual(connection.execute("PRAGMA application_id").fetchone()[0], APPLICATION_ID)
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertTrue({"jobs", "assets", "favorites"}.issubset(tables))
        bad = self.root / "future.sqlite3"
        with closing(sqlite3.connect(bad)) as connection:
            connection.execute("PRAGMA user_version=999")
        with self.assertRaises(StorageError):
            JobLedger(bad)

    def test_schema_upgrade_preserves_prior_data_and_failed_migration_rolls_back(self):
        self.create("pre-upgrade")
        with closing(sqlite3.connect(self.db)) as connection:
            saved_job = connection.execute('SELECT * FROM jobs WHERE request_id=?', ('pre-upgrade',)).fetchone()
        legacy = self.root / 'actual-v1.sqlite3'
        with closing(sqlite3.connect(legacy)) as connection:
            for statement in _MIGRATIONS[1]:
                connection.execute(statement)
            connection.execute('INSERT INTO jobs VALUES(' + ','.join('?' for _ in saved_job) + ')', saved_job)
            connection.execute(f'PRAGMA application_id={APPLICATION_ID}')
            connection.execute("PRAGMA user_version=1")
            connection.commit()
        with patch("backend.contracts.database._MIGRATIONS", {2: ["CREATE TABLE incomplete(x)", "INVALID MIGRATION SQL"]}):
            with self.assertRaises(StorageError):
                JobLedger(legacy)
        with closing(sqlite3.connect(legacy)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
            self.assertIsNone(connection.execute("SELECT 1 FROM sqlite_master WHERE name='incomplete'").fetchone())
        upgraded = JobLedger(legacy)
        self.assertEqual(upgraded.get("pre-upgrade")["state"], "pending")
        with closing(sqlite3.connect(legacy)) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], SCHEMA_VERSION)

    def test_idempotency_frozen_snapshot_and_source_scope(self):
        original = {"prompt": "test", "options": {"seed": 1}}
        first, created = self.ledger.create_or_get("same", provider="local", execution_kind="local", snapshot=original)
        original["options"]["seed"] = 2
        self.assertEqual(self.ledger.get("same")["snapshot"]["options"]["seed"], 1)
        second, created_again = self.ledger.create_or_get("same", provider="local", execution_kind="local", snapshot={"options": {"seed": 1}, "prompt": "test"})
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first["fingerprint"], second["fingerprint"])
        with self.assertRaises(Conflict):
            self.ledger.create_or_get("same", provider="local", execution_kind="local", snapshot=original)
        with self.assertRaises(Conflict):
            self.ledger.create_or_get("same", provider="local", execution_kind="local", snapshot=first["snapshot"], source={"workflow": "other"})

    def test_six_processes_claim_and_create_only_once(self):
        self.create("race")
        counter = self.root / "fake-provider-creates.txt"
        program = """
import sys
from pathlib import Path
from backend.jobs import JobLedger
from backend.contracts.errors import Conflict,InvalidTransition
ledger=JobLedger(sys.argv[1])
try:
    ledger.begin_submission('race',expected_version=0)
except (Conflict,InvalidTransition):
    print('not-claimed')
else:
    with Path(sys.argv[2]).open('a') as stream: stream.write('create\\n')
    print('claimed')
"""
        processes = [subprocess.Popen([sys.executable, "-c", program, str(self.db), str(counter)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(6)]
        outputs = [p.communicate(timeout=30) for p in processes]
        self.assertTrue(all(p.returncode == 0 for p in processes), outputs)
        self.assertEqual(sum(out.strip() == "claimed" for out, _ in outputs), 1)
        self.assertEqual(counter.read_text().splitlines(), ["create"])
        self.assertEqual(len(self.ledger.attempts("race")), 1)

    def test_process_exit_after_provider_acceptance_remains_unknown_without_resubmission(self):
        self.create("lost")
        counter = self.root / "fake-provider-creates.txt"
        program = """
import os,sys
from pathlib import Path
from backend.jobs import JobLedger
JobLedger(sys.argv[1]).begin_submission('lost',expected_version=0)
with Path(sys.argv[2]).open('a') as stream:
    stream.write('create\\n');stream.flush();os.fsync(stream.fileno())
os._exit(17)
"""
        result = subprocess.run([sys.executable, "-c", program, str(self.db), str(counter)], cwd=ROOT, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 17)
        restarted = JobLedger(self.db)
        restarted.reconcile_restart()
        self.assertEqual(restarted.get("lost")["state"], "unknown")
        self.assertEqual(restarted.recovery_action("lost")["action"], "manual_reconciliation")
        self.assertEqual(restarted.recovery_action("lost", supports_idempotency_lookup=True)["action"], "lookup_original_request")
        with self.assertRaises(InvalidTransition):
            restarted.begin_submission("lost", expected_version=restarted.get("lost")["version"])
        self.assertEqual(counter.read_text().splitlines(), ["create"])

    def test_restart_preserves_original_id_terminal_facts_and_duplicate_events(self):
        job = self.submitted()
        self.ledger.transition(job["request_id"], "running", expected_version=job["version"], event_id="running")
        restarted = JobLedger(self.db)
        reconciled = restarted.reconcile_restart()[0]
        self.assertEqual(reconciled["provider_task_id"], "native-request-1")
        self.assertEqual(restarted.recovery_action("request-1", supports_query=True)["action"], "query_original")
        fetching = restarted.transition("request-1", "fetching", expected_version=reconciled["version"], event_id="download")
        receipt = {"kind": "text", "text": "completed synthetic output"}
        done = restarted.transition("request-1", "succeeded", expected_version=fetching["version"], event_id="done", result=receipt)
        duplicate = restarted.transition("request-1", "succeeded", expected_version=fetching["version"], event_id="done", result=receipt)
        self.assertEqual(done, duplicate)
        self.assertEqual(restarted.reconcile_restart(), [])
        with self.assertRaises(InvalidTransition):
            restarted.transition("request-1", "running", expected_version=done["version"], event_id="late-running")
        with self.assertRaises(Conflict):
            restarted.transition("request-1", "succeeded", expected_version=fetching["version"], event_id="done", result={"kind": "text", "text": "different"})

    def test_provider_identity_cannot_cross_tasks(self):
        first = self.submitted("first")
        self.create("second")
        claim = self.ledger.begin_submission("second", expected_version=0)
        with self.assertRaises(Conflict):
            self.ledger.mark_submitted("second", first["provider_task_id"], expected_version=claim["version"], event_id="wrong-identity")

    def test_queued_cancel_is_final_active_cancel_requires_owned_confirmation(self):
        self.create("queued")
        cancelled = self.ledger.request_cancel("queued", expected_version=0)
        self.assertEqual(cancelled["job"]["state"], "cancelled")
        with self.assertRaises(InvalidTransition):
            self.ledger.begin_submission("queued", expected_version=cancelled["job"]["version"])
        remote = self.submitted("remote", "remote")
        intent = self.ledger.request_cancel("remote", expected_version=remote["version"])
        self.assertEqual(intent["action"], "continue_tracking_original")
        self.assertEqual(intent["job"]["state"], "submitted")
        with self.assertRaises(InvalidTransition):
            self.ledger.confirm_cancelled("remote", expected_version=intent["job"]["version"], provider_task_id="someone-else", confirmation="provider_cancelled")
        local = self.submitted("local")
        intent = self.ledger.request_cancel("local", expected_version=local["version"])
        stopped = self.ledger.confirm_cancelled("local", expected_version=intent["job"]["version"], provider_task_id=local["provider_task_id"], confirmation="owned_native_execution_stopped")
        fresh, created = self.ledger.retry_local_as_new("local", "explicit-retry")
        self.assertTrue(created)
        self.assertEqual(stopped["state"], "cancelled")
        self.assertEqual(fresh["state"], "pending")
        self.assertEqual(fresh["source"]["previous_request_id"], "local")
        self.assertEqual(self.ledger.get("remote")["state"], "submitted")

    def test_recovery_attempts_are_bounded(self):
        self.submitted()
        job = self.ledger.reconcile_restart()[0]
        for _ in range(3):
            job = self.ledger.claim_recovery("request-1", expected_version=job["version"], limit=3)
        with self.assertRaises(InvalidTransition):
            self.ledger.claim_recovery("request-1", expected_version=job["version"], limit=3)
        self.assertEqual(len(self.ledger.attempts("request-1")), 1)

    def test_credentials_rejected_without_echo_or_storage(self):
        sentinel = "SYNTHETIC-SECRET-NEVER-STORE"
        for nested in [{"api_key": sentinel}, {"nested": [{"Authorization": sentinel}]}, {"credentials": {"x": sentinel}}]:
            with self.assertRaises(InvalidInput) as caught:
                self.create("credential-test", payload=nested)
            self.assertNotIn(sentinel, str(caught.exception))
        self.assertEqual(self.ledger.list_jobs(), [])
        self.assertNotIn(sentinel.encode(), self.db.read_bytes())

    def test_diagnostics_keep_correlation_but_omit_private_input_and_results(self):
        self.create("private", prompt="PRIVATE-USER-PROMPT", context={"private": "PRIVATE-SOURCE"})
        claim = self.ledger.begin_submission("private", expected_version=0)
        submitted = self.ledger.mark_submitted("private", "native-private", expected_version=claim["version"], event_id="accepted")
        fetching = self.ledger.transition("private", "fetching", expected_version=submitted["version"], event_id="fetching")
        self.ledger.transition("private", "succeeded", expected_version=fetching["version"], event_id="done", result={"kind": "text", "text": "PRIVATE-RESULT"})
        report = json.dumps(self.ledger.diagnostics("private"))
        self.assertIn("native-private", report)
        for private in ["PRIVATE-USER-PROMPT", "PRIVATE-SOURCE", "PRIVATE-RESULT"]:
            self.assertNotIn(private, report)

    def test_database_fault_rolls_back_task_and_event_together(self):
        self.create()
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute("CREATE TRIGGER injected_failure BEFORE INSERT ON job_events WHEN NEW.event_type='submission_claimed' BEGIN SELECT RAISE(ABORT,'fault'); END")
        with self.assertRaises(StorageError):
            self.ledger.begin_submission("request-1", expected_version=0)
        reopened = JobLedger(self.db)
        self.assertEqual(reopened.get("request-1")["state"], "pending")
        self.assertEqual(reopened.attempts("request-1"), [])
        self.assertEqual(len(reopened.events("request-1")), 1)

    def test_file_paths_are_rooted_and_missing_invalid_or_oversize_rejected(self):
        outside = self.root / "outside.png"
        outside.write_bytes(b"synthetic")
        for filename in ["../outside.png", str(outside), "C:\\outside.png", "a/../../outside.png", "image.png:stream"]:
            with self.assertRaises(InvalidInput):
                self.assets.register_file("input", filename, kind="image")
        with self.assertRaises(InvalidInput):
            self.assets.register_file("input", "missing.png", kind="image")
        (self.input / "empty.png").touch()
        with self.assertRaises(InvalidInput):
            self.assets.register_file("input", "empty.png", kind="image")
        (self.input / "large.png").write_bytes(b"12345")
        tiny = AssetCatalog(self.db, roots={"input": self.input}, max_file_bytes=4)
        with self.assertRaises(InvalidInput):
            tiny.register_file("input", "large.png", kind="image")
        self.assertEqual(outside.read_bytes(), b"synthetic")

    def test_file_identity_and_immutable_freeze_survive_source_replacement(self):
        original = b"synthetic-original-media"
        (self.input / "one.png").write_bytes(original)
        (self.input / "two.png").write_bytes(original)
        one = self.assets.register_file("input", "one.png", kind="image", provenance={"workflow": "a"})
        two = self.assets.register_file("input", "two.png", kind="image", provenance={"workflow": "b"})
        self.assertEqual(one["asset_id"], two["asset_id"])
        self.assertEqual(len(two["references"]), 2)
        frozen = self.assets.freeze(one["references"][0]["reference_id"])
        self.create("frozen-job", media=frozen)
        (self.input / "one.png").write_bytes(b"new-source")
        self.assertEqual(self.assets.validate_reference(one["references"][0]["reference_id"])["status"], "changed")
        self.assertEqual((self.root / "frozen" / frozen["filename"]).read_bytes(), original)
        self.assertEqual(JobLedger(self.db).get("frozen-job")["snapshot"]["media"], frozen)

    def test_asset_dedupe_retains_distinct_provenance(self):
        (self.input / "same.png").write_bytes(b"same-file")
        first = self.assets.register_file("input", "same.png", kind="image", provenance={"request_id": "a"})
        second = self.assets.register_file("input", "same.png", kind="image", provenance={"request_id": "b"})
        third = self.assets.register_file("input", "same.png", kind="image", provenance={"request_id": "a"})
        self.assertEqual(first["asset_id"], second["asset_id"])
        self.assertEqual(len(third["references"]), 1)
        self.assertEqual({p["detail"]["request_id"] for p in third["provenance"]}, {"a", "b"})

    def test_freeze_failure_does_not_publish_reference_or_partial_result(self):
        (self.input / "source.png").write_bytes(b"original-media")
        asset = self.assets.register_file("input", "source.png", kind="image")
        with patch("backend.assets.catalog.os.link", side_effect=OSError("disk full")):
            with self.assertRaises(StorageError):
                self.assets.freeze(asset["references"][0]["reference_id"])
        self.assertEqual(len(self.assets.get(asset["asset_id"])["references"]), 1)
        self.assertEqual(list((self.root / "frozen").iterdir()), [])

    def test_missing_or_modified_output_cannot_be_committed_as_success(self):
        (self.output / "result.png").write_bytes(tiny_png())
        asset = self.assets.register_file("output", "result.png", kind="image")
        receipt = self.assets.result_receipt([asset["references"][0]["reference_id"]])
        submitted = self.submitted()
        fetching = self.ledger.transition("request-1", "fetching", expected_version=submitted["version"], event_id="fetching")
        with self.assertRaises(InvalidTransition):
            self.ledger.transition("request-1", "succeeded", expected_version=fetching["version"], event_id="unverified", result=receipt)
        hash_only = JobLedger(self.db, result_validator=self.assets.validate_result_receipt)
        with self.assertRaises(InvalidTransition):
            hash_only.transition("request-1", "succeeded", expected_version=fetching["version"], event_id="hash-only", result=receipt)
        verified = JobLedger(self.db, result_validator=MediaResultValidator(self.assets))
        (self.output / "result.png").write_bytes(b"modified-output")
        with self.assertRaises(InvalidInput):
            verified.transition("request-1", "succeeded", expected_version=fetching["version"], event_id="modified", result=receipt)
        self.assertEqual(verified.get("request-1")["state"], "fetching")
        (self.output / "result.png").unlink()
        with self.assertRaises(InvalidInput):
            verified.transition("request-1", "succeeded", expected_version=fetching["version"], event_id="missing", result=receipt)
        (self.output / "result.png").write_bytes(tiny_png())
        done = verified.transition("request-1", "succeeded", expected_version=fetching["version"], event_id="verified", result=receipt)
        self.assertEqual(done["state"], "succeeded")

    def test_legacy_raw_unknown_fields_are_preserved_and_safe(self):
        legacy = {"futureField": {"version": 42}, "savedNode": {"unknown": True}}
        entries = [{"legacy_id": "old", "kind": "text", "text": "snapshot", "legacy_raw": legacy}]
        self.assets.import_legacy_favorites(origin="origin", entries=entries)
        raw = json.loads(self.assets.export_favorites()["origins"][0]["raw_json"])
        self.assertEqual(raw["legacy_raw"], legacy)

    def test_legacy_origins_dedupe_media_preserve_text_snapshots_and_missing_report(self):
        (self.input / "source.png").write_bytes(b"shared-media")
        entries = [
            {"legacy_id": "image", "kind": "image", "root": "input", "filename": "source.png", "display_name": "图"},
            {"legacy_id": "text", "kind": "text", "text": "旧文本", "display_name": "文本"},
            {"legacy_id": "missing", "kind": "video", "root": "output", "filename": "missing.mp4", "display_name": "失效视频"},
        ]
        report = self.assets.import_legacy_favorites(origin="http://old-origin", entries=entries)
        self.assertEqual(report[-1]["status"], "missing")
        self.assets.import_legacy_favorites(origin="http://old-origin", entries=entries)
        other = json.loads(json.dumps(entries[:2]));other[1]["text"] = "新文本快照"
        self.assets.import_legacy_favorites(origin="http://second-origin", entries=other)
        reopened = AssetCatalog(self.db, roots={"input": self.input, "output": self.output})
        result = reopened.search()
        self.assertEqual(len(result), 4)
        self.assertEqual({x["text_snapshot"] for x in result if x["kind"] == "text"}, {"旧文本", "新文本快照"})
        self.assertEqual(len(reopened.export_favorites()["origins"]), 5)

    def test_legacy_import_is_atomic_on_conflicting_identity(self):
        self.assets.import_legacy_favorites(origin="origin", entries=[{"legacy_id": "a", "kind": "text", "text": "first"}])
        before = self.assets.export_favorites()
        with self.assertRaises(Conflict):
            self.assets.import_legacy_favorites(origin="origin", entries=[{"legacy_id": "b", "kind": "text", "text": "would-be-new"}, {"legacy_id": "a", "kind": "text", "text": "changed"}])
        self.assertEqual(self.assets.export_favorites(), before)

    def test_search_literals_and_backup_preserve_catalog(self):
        for text in ["100% 品质", "1000 品质", "a_b", "acb"]:
            asset = self.assets.register_text(text)
            self.assets.favorite(asset["asset_id"], display_name=text)
        self.assertEqual(len(self.assets.search("%")), 1)
        self.assertEqual(len(self.assets.search("_")), 1)
        backup = self.root / "backup.sqlite3"
        self.assets.database.backup(backup)
        restored = AssetCatalog(backup, roots={"input": self.input})
        self.assertEqual(restored.export_favorites(), self.assets.export_favorites())
        with self.assertRaises(StorageError):
            self.assets.database.backup(backup)


if __name__ == "__main__":
    unittest.main()
