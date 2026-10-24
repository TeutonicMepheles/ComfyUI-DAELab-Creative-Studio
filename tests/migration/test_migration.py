"""Synthetic offline data only. These are tooling checks, not M6 host acceptance."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from unittest.mock import patch

from backend.jobs.ledger import JobLedger
from backend.assets.catalog import AssetCatalog
from compat.receipts.reader import inspect_receipts, inspect_database, read_receipt
from compat.workflows.reader import READ_ONLY, inspect_workflow, read_compat_node, readonly_node_mappings
from tools.migration.prepare import BASELINES, initialize_workspace, preflight, migrate, rollback
from tools.migration.safety import MigrationError, canonical, file_hash, inventory, relative

ROOT = Path(__file__).resolve().parents[2]


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.workspace = self.root / "owned"
        initialize_workspace(self.workspace)
        self.plan = {"schemaVersion": 1, "migrationId": "synthetic-v1", "sourceRoot": str(self.source),
                     "workspaceRoot": str(self.workspace), "files": [], "versions": {**BASELINES, "comfyui": "0.39.2"},
                     "quiesced": True, "unpersistedTasks": 0, "recoveryPlans": []}
        self.workflow = {"last_node_id": 91, "version": 0.4, "nodes": [
            {"id": 1, "type": "DAELAB.MediaUpload", "inputs": [{"name": "x", "slot_index": 3}],
             "outputs": [{"links": [42], "slot_index": 4}], "widgets_values": ["unchanged"],
             "properties": {"material": '{"type":"input","filename":"picture.png","extra":17}', "unknown": {"v": 2}}},
            {"id": 91, "type": "External.Unknown", "properties": {"future": "untouched"}}],
            "links": [[42, 1, 4, 91, 3, "IMAGE"]], "groups": [{"id": "group-b"}, {"id": "group-a"}],
            "extra": {"daelabCreativeCanvasV1": {"future_version": 9}, "future": [3, 1, 2]}}
        self.add_json("workflows/graph.json", self.workflow, "workflow")
        self.add_file("input/picture.png", b"synthetic-media-not-for-decoding", "media")

    def add_file(self, name, payload, kind):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        self.plan["files"].append({"path": name, "kind": kind})
        return path

    def add_json(self, name, value, kind):
        return self.add_file(name, canonical(value), kind)

    def save_plan(self):
        path = self.root / "plan.json"
        path.write_bytes(canonical(self.plan))
        return path

    def test_dry_run_writes_nothing_and_preserves_graph_bytes(self):
        before = inventory(self.root)
        report = preflight(self.plan)
        self.assertEqual(inventory(self.root), before)
        self.assertFalse(report["activationAllowed"])
        self.assertIn("unknown_nodes_preserved", report["files"][1]["issues"])
        result = migrate(self.plan)
        target = Path(result["path"])
        self.assertEqual((target / "working/workflows/graph.json").read_bytes(), canonical(self.workflow))
        self.assertEqual(inventory(self.source), report["inventory"])
        self.assertEqual(json.loads((target / "working/workflows/graph.json").read_text()), self.workflow)
        self.assertFalse(result["activationAllowed"])

    def test_six_compatibility_nodes_are_deprecated_and_never_execute(self):
        mappings = readonly_node_mappings()
        self.assertEqual(set(mappings), {"DAELAB.ComfyTV.GPTImageStoryboardStage", "DAELAB.LibTV.StoryboardBatch"})
        self.assertEqual(len(READ_ONLY), 6)
        with patch("subprocess.Popen", side_effect=AssertionError("execution forbidden")), patch("socket.create_connection", side_effect=AssertionError("network forbidden")):
            for kind in READ_ONLY:
                node = {"id": 5, "type": kind, "widgets_values": ["historical"], "outputs": [{"slot_index": 9}], "opaque": 7}
                result = read_compat_node(node)
                self.assertEqual(result["raw"], node)
                result["raw"]["opaque"] = 8
                self.assertEqual(node["opaque"], 7)
            for cls in mappings.values():
                self.assertTrue(cls.DEPRECATED)
                self.assertIsInstance(cls.VALIDATE_INPUTS(), str)
                with self.assertRaisesRegex(RuntimeError, "只读"):
                    cls().execute(original_json=json.dumps(node))

    def test_published_business_ids_are_preserved_as_supported(self):
        workflow = {"nodes": [{"id": index, "type": kind} for index, kind in enumerate(
            ("DAELAB.Table", "DAELAB.ScriptParser", "DAELAB.StoryboardImport", "DAELAB.LibTV.VideoGenerate"))]}
        self.assertTrue(all(node["disposition"] == "supported" for node in inspect_workflow(workflow)["nodes"]))

    def test_repeated_migration_has_same_entities_and_files(self):
        self.add_json("receipts/old.json", {"requestId": "r-1", "provider": "libtv", "phase": "complete", "result": {"file": "output/a.mp4"}}, "receipt-json")
        first = migrate(self.plan)
        before = inventory(Path(first["path"]))
        self.assertEqual(migrate(self.plan), first)
        self.assertEqual(inventory(Path(first["path"])), before)

    def test_inflight_and_memory_workers_block_switch_without_new_identity(self):
        self.add_json("receipts/tasks.json", [
            {"requestId": "known", "provider": "comfy", "execution_kind": "remote", "phase": "running", "taskId": "remote-1"},
            {"requestId": "unknown", "provider": "comfy", "phase": "unknown"},
            {"requestId": "retired", "provider": "libtv", "phase": "running", "taskId": "old-1"}], "receipt-json")
        self.plan["unpersistedTasks"] = 1
        self.plan["recoveryPlans"] = [{"requestId": "known", "provider": "comfy", "providerTaskId": "remote-1", "action": "query_original_only"},
                                      {"requestId": "retired", "provider": "libtv", "providerTaskId": "old-1", "action": "query_original_only"}]
        report = preflight(self.plan)
        blocked = [issue.get("requestId") for issue in report["blockers"] if issue["code"] == "inflight_task_blocks_switch"]
        self.assertEqual(blocked, ["unknown", "retired"])
        self.assertEqual(report["executionCalls"], 0)
        self.assertTrue(any(issue["code"] == "unpersisted_workers_not_migratable" for issue in report["blockers"]))
        self.assertEqual({task["requestId"] for task in report["tasks"]}, {"known", "unknown", "retired"})

    def test_product_execution_kind_preserved_and_local_media_cannot_use_remote_recovery_plan(self):
        path = self.source / "studio.sqlite3"
        ledger = JobLedger(path)
        self.plan["files"].append({"path": "studio.sqlite3", "kind": "product-sqlite"})
        for request_id, provider, kind in (("native-image", "local-qwen-image", "local"),
                                           ("custom-native", "unfamiliar-provider", "local"),
                                           ("media-render", "render-worker", "media"),
                                           ("remote-job", "remote-provider", "remote"),
                                           ("conflicting-kind", "local-h3", "remote")):
            job, _ = ledger.create_or_get(request_id, provider=provider, execution_kind=kind, snapshot={"synthetic": True})
            job = ledger.begin_submission(request_id, expected_version=job["version"])
            ledger.mark_submitted(request_id, "original-" + request_id, expected_version=job["version"], event_id="ack")
            self.plan["recoveryPlans"].append({"requestId": request_id, "provider": provider,
                "providerTaskId": "original-" + request_id, "action": "query_original_only"})
        before = path.read_bytes()
        report = preflight(self.plan)
        tasks = {task["requestId"]: task for task in report["tasks"]}
        self.assertEqual(tasks["native-image"]["executionKind"], "local")
        self.assertEqual(tasks["media-render"]["executionKind"], "media")
        self.assertTrue(tasks["remote-job"]["queryOnlySwitchEligible"])
        blocked = {item["requestId"] for item in report["blockers"] if item["code"] == "inflight_task_blocks_switch"}
        self.assertEqual(blocked, {"native-image", "custom-native", "media-render", "conflicting-kind"})
        self.assertFalse(report["switchPreflightClear"])
        self.assertFalse(report["activationAllowed"])
        self.assertEqual(path.read_bytes(), before)

    def test_missing_unknown_or_conflicting_execution_kind_never_grants_query_only_switch(self):
        receipts = [{"requestId": "unknown-" + str(index), "provider": "remote-provider", "state": "running",
                     "taskId": "original-" + str(index), **extra}
                    for index, extra in enumerate(({}, {"execution_kind": "future-kind"}, {"execution_kind": ["remote"]}))]
        receipts.append({"requestId": "owned-mismatch", "provider": "local-qwen-text", "state": "running", "taskId": "owned-original", "execution_kind": "remote"})
        self.add_json("receipts/unknown-kind.json", receipts, "receipt-json")
        self.plan["recoveryPlans"] = [{"requestId": row["requestId"], "provider": row["provider"],
            "providerTaskId": row["taskId"], "action": "query_original_only"} for row in receipts]
        report = preflight(self.plan)
        self.assertEqual({item["requestId"] for item in report["blockers"] if item["code"] == "inflight_task_blocks_switch"},
                         {row["requestId"] for row in receipts})
        self.assertTrue(all(task["queryOnlySwitchEligible"] is False for task in report["tasks"]))

    def test_workflow_widget_receipts_history_and_nested_subgraphs_block_switch_without_mutation(self):
        current = {"requestId": "saved-current", "input": {"config": {"model": "synthetic-local"}}, "forceNew": False, "stamp": "synthetic", "phase": "complete",
                   "history": [{"requestId": "saved-inflight", "phase": "running", "input": {"synthetic": True}}]}
        table = {"version": 1, "fields": [], "records": [{"id": "r", "values": {}, "meta": {"generationColumns": {"f": current}, "generation": {"request": "old-batch", "phase": "waiting"}}}], "meta": {}}
        workflow = {"nodes": [{"id": 5, "type": "DAELAB.Table", "widgets_values": [json.dumps(table)],
                               "properties": {"daelabTableReports": {"p:b": {"rows": [{"request_id": "old-report", "phase": "running"}]}}}}], "links": [],
                    "definitions": {"subgraphs": [{"nodes": [{"id": 8, "type": "DAELAB.Table", "widgets_values": [json.dumps({"futureTask": {"requestId": "future-task", "status": "pending"}})]}]}]}}
        file = self.source / "workflows/graph.json"
        file.write_bytes(canonical(workflow)); before = file.read_bytes()
        report = preflight(self.plan)
        self.assertEqual(report["files"][1]["embeddedTaskCount"], 5)
        tasks = {item["requestId"]: item for item in report["tasks"]}
        self.assertTrue(tasks["saved-current"]["terminal"])
        self.assertFalse(tasks["saved-inflight"]["terminal"])
        self.assertIn("#json", tasks["saved-inflight"]["provenance"]["jsonPath"])
        self.assertEqual(tasks["future-task"]["provenance"]["nodeId"], "8")
        blocked = {item["requestId"] for item in report["blockers"] if item["code"] == "inflight_task_blocks_switch"}
        self.assertEqual(blocked, {"saved-inflight", "old-report", "future-task", None})
        self.assertFalse(report["switchPreflightClear"])
        target = Path(migrate(self.plan)["path"])
        self.assertEqual(file.read_bytes(), before)
        self.assertEqual((target / "working/workflows/graph.json").read_bytes(), before)
        self.assertEqual(migrate(self.plan)["path"], str(target))

    def test_workflow_unknown_receipts_duplicate_embedded_keys_and_batch_refs_require_review(self):
        workflow = {"nodes": [{"id": 5, "type": "DAELAB.Table", "widgets_values": [
            '{"generationColumns":{"f":{"requestId":"hidden-running","phase":"running","phase":"complete"}}}'],
            "properties": {"daelabLibTVBatch": {"rows": [{"request_id": "old-unknown", "phase": "future-phase"}]},
                           "daelabPromptOptimizationV1": {"version": 1, "batches": [{"batchId": "saved-batch"}]}}}], "links": []}
        (self.source / "workflows/graph.json").write_bytes(canonical(workflow))
        report = preflight(self.plan)
        issues = report["files"][1]["issues"]
        self.assertIn("uninspectable_embedded_json", issues)
        self.assertIn("optimization_batch_references_require_review", issues)
        self.assertIn("unknown_receipt_schema", issues)
        self.assertFalse(report["switchPreflightClear"])
        self.assertTrue(report["snapshotAllowed"])

    def test_detects_enabled_old_and_renamed_duplicate_packages(self):
        custom = self.root / "custom_nodes"
        package = custom / "ComfyUI-DAELab-Creative-Studio"
        package.mkdir(parents=True)
        old = custom / "ComfyUI-DAELab-Creative-Canvas"
        old.mkdir()
        (old / "__init__.py").write_text("# synthetic")
        duplicate = custom / "renamed"
        duplicate.mkdir()
        (duplicate / "pyproject.toml").write_text('[project]\nname="comfyui-daelab-creative-studio"\n')
        self.plan.update(customNodeRoots=[str(custom)], newPackageRoot=str(package))
        report = preflight(self.plan)
        conflict = next(issue for issue in report["blockers"] if issue["code"] == "old_or_duplicate_implementation_enabled")
        self.assertEqual(set(conflict["paths"]), {str(old), str(duplicate)})
        self.assertTrue(old.exists())

    def test_credentials_and_missing_media_are_reported_without_values(self):
        sentinel = "SYNTHETIC_SECRET_MUST_NOT_APPEAR"
        self.add_json("settings.json", {"api_key": sentinel}, "config")
        (self.source / "input/picture.png").unlink()
        self.plan["files"] = [entry for entry in self.plan["files"] if entry["path"] != "input/picture.png"]
        report = preflight(self.plan)
        self.assertNotIn(sentinel, json.dumps(report))
        self.assertFalse(report["snapshotAllowed"])
        self.assertIn("missing_media:input/picture.png", report["files"][1]["issues"])
        with self.assertRaises(MigrationError):
            migrate(self.plan)
        self.assertFalse((self.workspace / "synthetic-v1").exists())

    def test_unquiesced_copy_is_refused(self):
        self.plan["quiesced"] = False
        self.assertFalse(preflight(self.plan)["snapshotAllowed"])
        with self.assertRaises(MigrationError):
            migrate(self.plan)

    def test_embedded_widget_credential_is_refused_without_leak(self):
        self.workflow["nodes"][0]["widgets_values"] = ['{"api_key":"synthetic-inner-secret"}']
        (self.source / "workflows/graph.json").write_bytes(canonical(self.workflow))
        report = preflight(self.plan)
        self.assertFalse(report["snapshotAllowed"])
        self.assertNotIn("synthetic-inner-secret", json.dumps(report))

    def test_historical_results_are_readable_but_have_no_execution_port(self):
        for provider in ("libtv", "legacy-gpt"):
            for status in ("complete", "waiting", "running", "unknown"):
                receipt = {"requestId": "original", "provider": provider, "phase": status,
                           "taskId": "old-remote", "result": {"type": "output", "filename": "old.png"}}
                with patch("socket.create_connection", side_effect=AssertionError("network forbidden")), patch("subprocess.Popen", side_effect=AssertionError("CLI forbidden")), patch.object(JobLedger, "create_or_get", side_effect=AssertionError("new identity forbidden")):
                    value = read_receipt(receipt)
                    self.assertFalse(value["canResume"])
                    self.assertFalse(value["canSubmit"])
                    self.assertEqual(value["raw"], receipt)
                    self.assertTrue(value["report"]["records"][0]["retired"])

    def test_malformed_status_and_stopped_receipt_do_not_claim_terminal_success(self):
        result = inspect_receipts([{"requestId": "bad", "phase": {"unexpected": True}},
                                   {"requestId": "stopped", "provider": "libtv", "phase": "stopped"}])
        self.assertIn("unknown_receipt_schema", result["issues"])
        self.assertTrue(all(not row["terminal"] for row in result["records"]))

    def test_unknown_schema_and_duplicate_receipt_identity_visible(self):
        self.add_json("receipts/tasks.json", {"schemaVersion": 99, "jobs": [
            {"requestId": "same", "provider": "libtv", "phase": "complete"},
            {"requestId": "same", "provider": "libtv", "phase": "failed"}]}, "receipt-json")
        report = preflight(self.plan)
        receipts = next(item for item in report["files"] if item["kind"] == "receipt-json")
        self.assertIn("unknown_receipt_version", receipts["issues"])
        self.assertIn("conflicting_request_identity", receipts["issues"])
        self.assertTrue(migrate(self.plan)["reviewRequired"])

    def test_invalid_or_unlisted_json_refuses_copy_preserves_original(self):
        broken = self.add_file("broken.json", b'{"bad":', "receipt-json")
        before = broken.read_bytes()
        self.assertFalse(preflight(self.plan)["snapshotAllowed"])
        with self.assertRaises(MigrationError):
            migrate(self.plan)
        self.assertEqual(broken.read_bytes(), before)
        self.plan["files"].pop()
        with self.assertRaises(MigrationError):
            preflight(self.plan)

    def test_offline_optimization_sqlite_reads_all_records_without_sidecars(self):
        db = self.source / "optimization.sqlite3"
        with closing(sqlite3.connect(db)) as conn, conn:
            conn.execute("CREATE TABLE objects(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))")
            conn.execute("INSERT INTO objects VALUES(?,?,?)", ("batch", "b", json.dumps({"contractVersion": 1, "provider": "comfy", "rows": [
                {"requestId": "r", "status": "submitted", "remoteResponseId": "remote-7", "snapshot": {"text": "synthetic"}}]})))
        self.plan["files"].append({"path": db.name, "kind": "receipt-sqlite"})
        before = inventory(self.source)
        result = preflight(self.plan)
        self.assertEqual(inventory(self.source), before)
        self.assertEqual(result["tasks"][0]["providerTaskId"], "remote-7")
        migrate(self.plan)
        self.assertEqual(inventory(self.source), before)

    def test_sqlite_wal_and_secret_rows_refuse_snapshot(self):
        db = self.source / "ledger.sqlite3"
        with closing(sqlite3.connect(db)) as conn, conn:
            conn.execute("CREATE TABLE objects(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))")
            conn.execute("INSERT INTO objects VALUES(?,?,?)", ("quote", "q", '{"authorization":"synthetic-secret"}'))
        result = inspect_database(db)
        self.assertIn("sensitive_or_unsupported_json", result["issues"])
        self.assertNotIn("synthetic-secret", json.dumps(result))
        Path(str(db) + "-wal").write_bytes(b"uncheckpointed")
        self.assertEqual(inspect_database(db)["issues"], ["database_requires_offline_checkpoint"])

    def test_product_ledger_public_creation_readonly_snapshot_preserves_jobs(self):
        path = self.source / "studio.sqlite3"
        ledger = JobLedger(path)
        ledger.create_or_get("original-identity", provider="local", execution_kind="local", snapshot={"text": "fixture"})
        # Close all service connections before the offline tool inspects the fixture.
        self.plan["files"].append({"path": path.name, "kind": "product-sqlite"})
        result = preflight(self.plan)
        self.assertEqual(result["tasks"][0]["requestId"], "original-identity")
        target = Path(migrate(self.plan)["path"])
        self.assertEqual(file_hash(path), file_hash(target / "backup/studio.sqlite3"))
        self.assertEqual(ledger.get("original-identity")["state"], "pending")

    def test_asset_catalog_references_check_snapshot_hashes_without_mutation(self):
        path = self.source / "studio.sqlite3"
        assets = AssetCatalog(path, roots={"input": self.source / "input"})
        original = assets.register_file("input", "picture.png", kind="image", provenance={"source": "fixture"})
        self.plan["files"].append({"path": path.name, "kind": "product-sqlite"})
        before = file_hash(path)
        first = preflight(self.plan)
        db_report = next(item for item in first["files"] if item["kind"] == "product-sqlite")
        self.assertEqual(db_report["issues"], [])
        (self.source / "input/picture.png").write_bytes(b"changed media content")
        second = preflight(self.plan)
        db_report = next(item for item in second["files"] if item["kind"] == "product-sqlite")
        self.assertIn("asset_content_changed:input/picture.png", db_report["issues"])
        self.assertEqual(file_hash(path), before)
        self.assertEqual(assets.get(original["asset_id"])["asset_id"], original["asset_id"])

    def test_fault_after_each_commit_boundary_resumes_exactly(self):
        points = ["manifest_created", "backup_complete", "before_manifest_commit", "complete"]
        for number, point in enumerate(points):
            with self.subTest(point=point):
                self.plan["migrationId"] = f"resume-{number}"
                def fail(here):
                    if here == point:
                        raise OSError("synthetic failure")
                with self.assertRaises(OSError):
                    migrate(self.plan, fault=fail)
                target = self.workspace / self.plan["migrationId"]
                if point != "complete":
                    self.assertFalse((target / "COMPLETE.json").exists())
                self.assertEqual(migrate(self.plan)["state"], "snapshot_complete")
                self.assertEqual(inventory(target / "backup"), inventory(self.source))

    def test_interrupted_metadata_publication_recovers_but_unknown_target_refuses(self):
        from tools.migration import prepare
        real_write = prepare.write_json
        def interrupt(path, value):
            if path.name == "manifest.json":
                payload = canonical(value) + b"\n"
                partial = path.parent / (".part-" + hashlib.sha256(payload).hexdigest())
                partial.write_bytes(payload[:50])
                raise OSError("crash during manifest write")
            return real_write(path, value)
        with patch.object(prepare, "write_json", side_effect=interrupt):
            with self.assertRaises(OSError):
                migrate(self.plan)
        self.assertEqual(migrate(self.plan)["state"], "snapshot_complete")
        self.plan["migrationId"] = "unknown-existing"
        (self.workspace / "unknown-existing").mkdir()
        with self.assertRaises(MigrationError):
            migrate(self.plan)

    def test_rollback_refuses_changed_new_data_after_preservation(self):
        target = Path(migrate(self.plan)["path"])
        def fail(point):
            if point == "new_data_preserved":
                raise OSError("stop")
        with self.assertRaises(OSError):
            rollback(self.workspace, self.plan["migrationId"], fault=fail)
        (target / "working/late-user-file.json").write_text('{"new":true}')
        with self.assertRaises(MigrationError):
            rollback(self.workspace, self.plan["migrationId"])
        self.assertTrue((target / "working/late-user-file.json").exists())
        self.assertFalse((target / "rollback/restored-old").exists())

    def test_process_death_after_copy_resumes_with_no_half_complete_marker(self):
        plan = self.save_plan()
        code = "import os,sys; from tools.migration.prepare import migrate; from tools.migration.safety import load_json; migrate(load_json(sys.argv[1]), fault=lambda p: os._exit(73) if p.startswith('working_copied:') else None)"
        result = subprocess.run([sys.executable, "-c", code, str(plan)], cwd=ROOT, capture_output=True)
        self.assertEqual(result.returncode, 73, result.stderr.decode())
        target = self.workspace / self.plan["migrationId"]
        self.assertFalse((target / "COMPLETE.json").exists())
        self.assertEqual(migrate(self.plan)["state"], "snapshot_complete")
        self.assertEqual(inventory(target / "working"), inventory(self.source))

    def test_two_processes_cannot_migrate_concurrently(self):
        plan = self.save_plan()
        signal = self.root / "locked"
        code = "import sys,time; from pathlib import Path; from tools.migration.prepare import migrate; from tools.migration.safety import load_json; migrate(load_json(sys.argv[1]), fault=lambda p: (Path(sys.argv[2]).write_text('locked'),time.sleep(1.5)) if p=='manifest_created' else None)"
        process = subprocess.Popen([sys.executable, "-c", code, str(plan), str(signal)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 10
            while not signal.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(signal.exists())
            with self.assertRaisesRegex(MigrationError, "already running"):
                migrate(self.plan)
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, stderr.decode())
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_partial_copy_and_link_publication_recover(self):
        def fail(point):
            if point == "backup_complete":
                raise OSError("stop")
        with self.assertRaises(OSError):
            migrate(self.plan, fault=fail)
        target = self.workspace / self.plan["migrationId"]
        working = target / "working"
        (working / "input").mkdir(parents=True)
        data = (self.source / "input/picture.png").read_bytes()
        digest = file_hash(self.source / "input/picture.png")
        partial = working / "input" / (".part-" + digest)
        partial.write_bytes(data[:6])
        self.assertEqual(migrate(self.plan)["state"], "snapshot_complete")
        self.assertFalse(partial.exists())
        # Crash just after link publication, before deleting its exact staging link.
        os.link(working / "input/picture.png", partial)
        self.assertEqual(migrate(self.plan)["state"], "snapshot_complete")
        self.assertFalse(partial.exists())

    def test_rollback_preserves_new_data_before_restore_and_resumes(self):
        target = Path(migrate(self.plan)["path"])
        working = target / "working"
        (working / "future-schema.json").write_text('{"schemaVersion":77,"new":"saved"}')
        (working / "workflows/graph.json").write_text('{"new_workflow":true}')
        expected_new = inventory(working)
        def fail(point):
            if point == "new_data_preserved":
                raise OSError("stop before restoration")
        with self.assertRaises(OSError):
            rollback(self.workspace, self.plan["migrationId"], fault=fail)
        self.assertFalse((target / "rollback/restored-old").exists())
        self.assertEqual(inventory(target / "rollback/preserved-new"), expected_new)
        result = rollback(self.workspace, self.plan["migrationId"])
        self.assertEqual(inventory(target / "rollback/restored-old"), inventory(self.source))
        self.assertEqual(inventory(working), expected_new)
        self.assertFalse(result["activationAllowed"])
        self.assertEqual(rollback(self.workspace, self.plan["migrationId"]), result)

    def test_tampered_backup_or_working_refuses_overwrite(self):
        target = Path(migrate(self.plan)["path"])
        (target / "working/input/picture.png").write_bytes(b"new-user-file")
        with self.assertRaises(MigrationError):
            migrate(self.plan)
        self.assertEqual((target / "working/input/picture.png").read_bytes(), b"new-user-file")
        (target / "backup/input/picture.png").write_bytes(b"tampered")
        with self.assertRaises(MigrationError):
            rollback(self.workspace, self.plan["migrationId"])
        self.assertFalse((target / "rollback").exists())

    def test_path_traversal_unknown_directory_and_hardlinks_refused(self):
        for path in ("../outside", "/absolute", "a/../b", "a\\b", "C:/x", "file:stream", "NUL", "a."):
            with self.subTest(path=path), self.assertRaises(MigrationError):
                relative(path)
        unknown = self.root / "unknown"
        unknown.mkdir()
        with self.assertRaises(MigrationError):
            initialize_workspace(unknown)
        plan = copy.deepcopy(self.plan)
        plan["workspaceRoot"] = str(unknown)
        with self.assertRaises((MigrationError, OSError)):
            migrate(plan)
        os.link(self.source / "input/picture.png", self.root / "external-link.png")
        with self.assertRaises(MigrationError):
            preflight(self.plan)

    def test_symlink_escape_refused_when_supported(self):
        external = self.root / "external"
        external.mkdir()
        link = self.source / "linked"
        try:
            link.symlink_to(external, target_is_directory=True)
        except OSError:
            if os.name != "nt":
                raise
            env = {**os.environ, "STUDIO_TEST_LINK": str(link), "STUDIO_TEST_TARGET": str(external)}
            result = subprocess.run(["powershell", "-NoProfile", "-Command", "New-Item -ItemType Junction -Path $env:STUDIO_TEST_LINK -Target $env:STUDIO_TEST_TARGET | Out-Null"], env=env, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
            self.assertTrue(link.is_junction())
        with self.assertRaises(MigrationError):
            preflight(self.plan)

    def test_cli_dry_run_has_nonzero_review_exit_and_no_body_leak(self):
        result = subprocess.run([sys.executable, "-m", "tools.migration", "preflight", str(self.save_plan())],
                                cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 2, result.stderr)
        report = json.loads(result.stdout)
        self.assertFalse(report["activationAllowed"])
        self.assertNotIn("untouched", result.stdout)


if __name__ == "__main__":
    unittest.main()
