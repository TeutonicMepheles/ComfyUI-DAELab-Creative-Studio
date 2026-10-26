"""Review regressions; all files and credential sentinels are synthetic and temporary."""
from contextlib import closing
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.assets import AssetCatalog
from backend.contracts.database import Database
from backend.contracts.errors import ContractError, StorageError
from backend.jobs import JobLedger
from backend.integrations.comfyui.diagnostics import product_metadata
from backend.integrations.comfyui.services import CoreServices
from backend.media.validation import MediaResultValidator


def tiny_png():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"")


class StorageReview(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="studio-backend-review-")
        self.root = Path(self.temp.name)
        self.output = self.root / "output"
        self.output.mkdir()
        self.db = self.root / "studio.sqlite3"

    def tearDown(self):
        self.temp.cleanup()

    def fetching(self, ledger):
        ledger.create_or_get("review-task", provider="synthetic-local", execution_kind="local", snapshot={"prompt": "synthetic"})
        claimed = ledger.begin_submission("review-task", expected_version=0)
        submitted = ledger.mark_submitted("review-task", "synthetic-native-id", expected_version=claimed["version"], event_id="submitted")
        return ledger.transition("review-task", "fetching", expected_version=submitted["version"], event_id="fetching")

    def test_rejected_foreign_database_is_byte_identical_and_keeps_journal_mode(self):
        foreign = self.root / "foreign.sqlite3"
        with closing(sqlite3.connect(foreign)) as connection:
            connection.execute("PRAGMA application_id=123456")
            connection.execute("CREATE TABLE valuable(content TEXT)")
            connection.execute("INSERT INTO valuable VALUES('original')")
            connection.commit()
        before = foreign.read_bytes()
        with self.assertRaises(StorageError):
            Database(foreign)
        self.assertEqual(foreign.read_bytes(), before, "Rejecting an unowned DB must not change its file header/journal mode")

    def test_unversioned_database_with_only_views_is_not_adopted(self):
        foreign = self.root / "view-only.sqlite3"
        with closing(sqlite3.connect(foreign)) as connection:
            connection.execute("CREATE VIEW valuable_view AS SELECT 'original' AS content")
            connection.commit()
        with self.assertRaises(StorageError):
            Database(foreign)

    def test_common_provider_credential_fields_never_enter_snapshots(self):
        ledger = JobLedger(self.db)
        for index, field in enumerate(("X-API-Key", "OPENAI_API_KEY", "X-DAELab-DeepSeek-Key")):
            with self.subTest(field=field), self.assertRaises(ContractError):
                ledger.create_or_get(f"credential-{index}", provider="synthetic", execution_kind="local",
                                     snapshot={"headers": {field: "SYNTHETIC-REVIEW-SENTINEL-NOT-A-REAL-KEY"}})
        self.assertEqual(ledger.list_jobs(), [])

    def test_undecodable_media_cannot_be_committed_as_success(self):
        service = CoreServices(self.root / "user", self.root / "input", self.output)
        assets, ledger = service.assets, service.jobs
        fetching = self.fetching(ledger)
        (self.output / "broken.png").write_bytes(b"This is deliberately not image data.")
        with self.assertRaises(ContractError):
            asset = assets.register_file("output", "broken.png", kind="image")
            receipt = assets.result_receipt([asset["references"][0]["reference_id"]])
            ledger.transition("review-task", "succeeded", expected_version=fetching["version"], event_id="complete", result=receipt)
        self.assertEqual(ledger.get("review-task")["state"], "fetching")

    def test_committed_success_redelivery_is_idempotent_after_output_disappears(self):
        assets = AssetCatalog(self.db, roots={"output": self.output})
        ledger = JobLedger(self.db, result_validator=MediaResultValidator(assets))
        fetching = self.fetching(ledger)
        media = self.output / "result.png"
        media.write_bytes(tiny_png())
        asset = assets.register_file("output", "result.png", kind="image")
        receipt = assets.result_receipt([asset["references"][0]["reference_id"]])
        done = ledger.transition("review-task", "succeeded", expected_version=fetching["version"], event_id="complete", result=receipt)
        count = len(ledger.events("review-task"))
        media.unlink()
        duplicate = ledger.transition("review-task", "succeeded", expected_version=fetching["version"], event_id="complete", result=receipt)
        self.assertEqual(duplicate, done)
        self.assertEqual(len(ledger.events("review-task")), count)

    def test_malformed_frontend_manifest_is_an_actionable_unavailable_diagnostic(self):
        (self.root / "web").mkdir()
        (self.root / "pyproject.toml").write_text('[project]\nversion="0.1.0.dev0"\n', encoding="utf-8")
        (self.root / "web" / "build-manifest.json").write_text('{"version":', encoding="utf-8")
        result = product_metadata(self.root)
        self.assertFalse(result["compatible"])
        self.assertTrue(result["reason"])


if __name__ == "__main__":
    unittest.main()
