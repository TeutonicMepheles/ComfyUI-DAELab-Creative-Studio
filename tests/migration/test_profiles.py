"""Synthetic profiles only; descriptors and fake HTTP observations are not host acceptance."""
import copy
import hashlib
import json
import os
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

from backend.jobs.ledger import JobLedger
from tools.migration.prepare import BASELINES, initialize_workspace, migrate
from tools.migration.profiles import (prepare_profiles, active_profile, select_profile, observe_runtime,
                                      seal_profile, profile_identity, profile_inventory)
from tools.migration.safety import MigrationError, inventory, canonical, file_hash, copy_verified, json_hash


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = self.root / "owned"
        initialize_workspace(self.workspace)
        self.source = self.root / "source"
        (self.source / "workflows").mkdir(parents=True)
        (self.source / "input").mkdir()
        (self.source / "output").mkdir()
        (self.source / "workflows/graph.json").write_bytes(canonical({"version": 0.4, "nodes": [], "links": []}))
        (self.source / "input/input.png").write_bytes(b"synthetic input bytes, not decoder evidence")
        (self.source / "output/output.png").write_bytes(b"synthetic output bytes, not decoder evidence")
        new = self.root / "new-code"
        package = new / "custom_nodes/ComfyUI-DAELab-Creative-Studio"
        package.mkdir(parents=True)
        (package / "__init__.py").write_bytes(b"# synthetic code identity; never imported\n")
        self.build_id = "b" * 64
        commit = "a" * 40
        release = {"schemaVersion": 1, "revision": commit, "frontendBuildId": self.build_id,
                   "files": [{"path": "__init__.py", "bytes": (package / "__init__.py").stat().st_size,
                              "sha256": file_hash(package / "__init__.py")}]}
        (package / "release-candidate.json").write_bytes(canonical(release))
        old = self.root / "old-code"
        legacy_roots, snapshots = {}, []
        for name, revision in BASELINES.items():
            folder = old / "custom_nodes" / name
            folder.mkdir(parents=True)
            (folder / "__init__.py").write_bytes(b"# synthetic old package identity\n")
            archive = self.root / (name + ".zip")
            with zipfile.ZipFile(archive, "w") as output:
                output.comment = revision.encode("ascii")
                output.writestr("__init__.py", (folder / "__init__.py").read_bytes())
            legacy_roots[name] = str(folder)
            snapshots.append({"name": name, "source_commit": revision, "archive": str(archive),
                              "archive_sha256": file_hash(archive), "files": [
                                  {"path": entry["path"], "bytes": entry["size"], "sha256": entry["sha256"]}
                                  for entry in inventory(folder)]})
        (old / "prepared.json").write_bytes(canonical({"configuration": {"owner": "creative-studio-old-baseline-v1"}, "snapshots": snapshots}))
        probe = old / "custom_nodes/StudioMigration.LegacyProbe"
        probe.mkdir()
        probe_source = Path(__file__).resolve().parents[2] / "tools/migration/legacy_probe"
        for name in ("__init__.py", "probe.py", "probe-manifest.json"):
            shutil.copyfile(probe_source / name, probe / name)
        new_probe = new / "custom_nodes/StudioMigration.LegacyProbe"
        new_probe.mkdir()
        for name in ("__init__.py", "probe.py", "probe-manifest.json"):
            shutil.copyfile(probe_source / name, new_probe / name)
        self.plan = {"schemaVersion": 1, "migrationId": "migration", "sourceRoot": str(self.source),
                     "workspaceRoot": str(self.workspace), "files": [
                         {"path": "workflows/graph.json", "kind": "workflow"},
                         {"path": "input/input.png", "kind": "media"}, {"path": "output/output.png", "kind": "media"}],
                     "versions": {**BASELINES, "comfyui": "0.39.2"}, "quiesced": True, "unpersistedTasks": 0,
                     "recoveryPlans": [{"requestId": "r-retired", "provider": "libtv", "providerTaskId": "t-retired", "action": "query_original_only"},
                                       {"requestId": "r-live", "provider": "remote-provider", "providerTaskId": "t-live", "action": "query_original_only"}],
                     "customNodeRoots": [str(new / "custom_nodes")], "newPackageRoot": str(package)}
        migrate(self.plan)
        self.profiles_plan = {"schemaVersion": 1, "workspaceRoot": str(self.workspace), "migrationId": "migration", "setId": "case",
                              "mapping": [{"source": "workflows/graph.json", "root": "user", "path": "default/workflows/graph.json"},
                                          {"source": "input/input.png", "root": "input", "path": "input.png"},
                                          {"source": "output/output.png", "root": "output", "path": "output.png"}],
                              "oldPackage": {"kind": "legacy", "installationRoot": str(old), "roots": legacy_roots, "commits": BASELINES,
                                             "observer": {"root": str(probe)}},
                              "newPackage": {"kind": "studio", "installationRoot": str(new), "root": str(package), "commit": commit,
                                             "observer": {"root": str(new_probe)}}}
        prepare_profiles(self.profiles_plan)
        self.old = self.workspace / "profiles/case-old"
        self.new = self.workspace / "profiles/case-new"

    def activate_old(self):
        return select_profile(self.workspace, "start-old", "case-old", expected_sequence=0)

    def fixture_evidence(self, marker, process, nonce):
        """Protocol fixture only. The actual probe has separate source/coverage tests."""
        probe, spec = marker["package"]["observer"], marker["package"]["spec"]
        runtime = {"pid": process["pid"], "processCreated": process["created"], "installationRoot": spec["installationRoot"]}
        if marker["role"] == "old":
            runtime.update(canvasRoot=spec["roots"]["canvas"], businessRoot=spec["roots"]["business"])
            sources = {"canvasCommit": BASELINES["canvas"], "businessCommit": BASELINES["business"], "files": [
                {"repository": key, "path": "__init__.py", "sha256": file_hash(Path(value) / "__init__.py")}
                for key, value in spec["roots"].items()]}
        else:
            runtime["studioRoot"] = spec["root"]
            sources = {"candidateCommit": spec["commit"], "frontendBuildId": self.build_id, "files": []}
        return {"schemaVersion": 1, "kind": "legacy-runtime-quiescence", "profileRole": marker["role"], "nonce": nonce,
                "observedAt": time.time(), "quiescence": "clear", "blockers": [], "coverageVersion": probe["coverageVersion"],
                "probeSourceSha256": probe["probeSourceSha256"], "runtime": runtime, "sources": sources,
                "observations": {"syntheticContractFixture": True}, "fence": {"id": "1" * 32, "active": True,
                    "profileSha256": json_hash(marker), "unreviewedEntrypoints": [], "acceptedAfterFence": 0,
                    "profileRole": marker["role"], "pid": process["pid"], "processCreated": process["created"],
                    "coverageVersion": "legacy-ingress-v1", "activeSequence": active_profile(self.workspace)["sequence"]}}

    def observe(self, profile_id):
        _, root, marker = profile_identity(self.workspace, profile_id)
        arguments = [sys.executable, "synthetic.py", "--base-directory", marker["package"]["spec"]["installationRoot"]]
        for name, value in marker["roots"].items():
            arguments.extend(["--" + name + "-directory", value])
        process = {"pid": 1234567, "created": 1.25, "executable": sys.executable, "arguments": arguments, "listeners": [8999]}
        def response(port, path):
            if path.startswith("/daelab/migration/legacy-runtime?nonce="):
                return self.fixture_evidence(marker, process, path.split("nonce=")[1])
            return ({"queue_running": [], "queue_pending": []} if path == "/queue" else
                    {"compatible": True, "frontendBuildId": self.build_id, "system": {"comfyui_version": "0.39.2"}})
        with patch("tools.migration.profiles._process", return_value=process), patch("tools.migration.profiles._get", side_effect=response):
            observed = observe_runtime(self.workspace, profile_id, process["pid"], 8999)
        return observed, process

    def seal(self, profile_id):
        observed, _ = self.observe(profile_id)
        with patch("tools.migration.profiles._process", return_value=None):
            return seal_profile(self.workspace, profile_id, observed["observationId"])["sealId"]

    def activate_new(self):
        self.activate_old()
        old_seal = self.seal("case-old")
        select_profile(self.workspace, "start-new", "case-new", expected_sequence=1, current_seal=old_seal)
        return old_seal

    def test_profiles_complete_mapping_repeated_preparation_preserves_source(self):
        before = inventory(self.source)
        first = inventory(self.workspace)
        prepare_profiles(self.profiles_plan)
        self.assertEqual(inventory(self.workspace), first)
        self.assertEqual(inventory(self.source), before)
        for root in (self.old, self.new):
            self.assertEqual((root / "input/input.png").read_bytes(), (self.source / "input/input.png").read_bytes())
            self.assertEqual((root / "user/default/workflows/graph.json").read_bytes(), (self.source / "workflows/graph.json").read_bytes())

    def test_release_cli_verifies_explicit_probe_without_bundled_probe_source(self):
        from tools.release.package_candidate import possible, excluded
        repository = Path(__file__).resolve().parents[2]
        release = self.root / "release-tree"
        # Use the actual release path selection, without importing/installing a host.
        for folder in ("backend", "compat", "tools/migration"):
            for source in (repository / folder).rglob("*.py"):
                name = source.relative_to(repository).as_posix()
                if possible(name) and not excluded(name):
                    target = release / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, target)
        self.assertTrue((release / "tools/migration/profiles.py").is_file())
        self.assertFalse((release / "tools/migration/legacy_probe").exists())
        self.assertFalse((release / "tools/migration/prepare_e5.py").exists())
        plan = self.root / "release-profile-plan.json"
        plan.write_bytes(canonical(self.profiles_plan))
        before = inventory(self.workspace)
        result = subprocess.run([sys.executable, "-E", "-B", "-m", "tools.migration", "prepare-profiles", str(plan)],
                                cwd=release, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["state"], "profiles_ready")
        self.assertEqual(inventory(self.workspace), before)

    def test_reviewed_probe_identity_pins_match_the_separately_distributed_source_bundle(self):
        from tools.migration import profiles
        source = Path(__file__).resolve().parents[2] / "tools/migration/legacy_probe"
        files = [{"path": name, "sha256": file_hash(source / name), "bytes": (source / name).stat().st_size}
                 for name in ("__init__.py", "probe.py")]
        self.assertEqual(tuple((item["path"], item["sha256"], item["bytes"]) for item in files), profiles.REVIEWED_PROBE_FILES)
        self.assertEqual(json_hash(files), profiles.REVIEWED_PROBE_SOURCE_SHA256)
        manifest = source / "probe-manifest.json"
        self.assertEqual(file_hash(manifest), profiles.REVIEWED_PROBE_MANIFEST_SHA256)
        self.assertEqual(manifest.stat().st_size, profiles.REVIEWED_PROBE_MANIFEST_BYTES)
        self.assertEqual(json.loads(manifest.read_text("utf-8")), {
            "schemaVersion": 1, "kind": "legacy-runtime-probe-package", "coverageVersion": profiles.REVIEWED_PROBE_COVERAGE,
            "files": files, "probeSourceSha256": profiles.REVIEWED_PROBE_SOURCE_SHA256})

    def test_probe_code_manifest_and_extra_files_cannot_self_attest_a_new_identity(self):
        from tools.migration.profiles import package_identity
        spec = self.profiles_plan["oldPackage"]
        probe = Path(spec["observer"]["root"])
        original = {name: (probe / name).read_bytes() for name in ("__init__.py", "probe.py", "probe-manifest.json")}
        for mutation in ("__init__.py", "probe.py", "manifest-bytes", "self-attested-manifest", "extra.py"):
            with self.subTest(mutation=mutation):
                try:
                    if mutation in {"__init__.py", "probe.py", "extra.py"}:
                        (probe / mutation).write_bytes(original.get(mutation, b"") + b"# changed\n")
                    elif mutation == "manifest-bytes":
                        (probe / "probe-manifest.json").write_bytes(original["probe-manifest.json"] + b"\n")
                    else:
                        (probe / "probe.py").write_bytes(original["probe.py"] + b"# unreviewed\n")
                        record = json.loads(original["probe-manifest.json"])
                        for entry in record["files"]:
                            entry.update(sha256=file_hash(probe / entry["path"]), bytes=(probe / entry["path"]).stat().st_size)
                        record["probeSourceSha256"] = json_hash(record["files"])
                        (probe / "probe-manifest.json").write_bytes(canonical(record))
                    with self.assertRaisesRegex(MigrationError, "fixed reviewed probe identity"):
                        package_identity(spec)
                finally:
                    for name, raw in original.items():
                        (probe / name).write_bytes(raw)
                    if (probe / "extra.py").exists():
                        (probe / "extra.py").unlink()
        self.assertTrue(package_identity(spec)["observer"])

    def test_package_identity_uses_exact_paths_independent_of_inventory_enumeration(self):
        from tools.migration.profiles import package_identity
        old_spec, new_spec = self.profiles_plan["oldPackage"], self.profiles_plan["newPackage"]
        prepared_path = Path(old_spec["installationRoot"]) / "prepared.json"
        prepared = json.loads(prepared_path.read_text("utf-8"))
        for root in [*(Path(value) for value in old_spec["roots"].values()), Path(new_spec["root"])]:
            for name in ("AGENTS.md", "docs/SKILL.md", "docs/agents/openai.yaml"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(("synthetic " + name).encode())
        for snapshot in prepared["snapshots"]:
            folder = Path(old_spec["installationRoot"]) / "custom_nodes" / snapshot["name"]
            snapshot["files"] = [{"path": entry["path"], "bytes": entry["size"], "sha256": entry["sha256"]}
                                 for entry in inventory(folder)]
            with zipfile.ZipFile(snapshot["archive"], "w") as archive:
                archive.comment = snapshot["source_commit"].encode("ascii")
                for entry in snapshot["files"]:
                    archive.writestr(entry["path"], (folder / entry["path"]).read_bytes())
            snapshot["archive_sha256"] = file_hash(snapshot["archive"])
        prepared_path.write_bytes(canonical(prepared))
        candidate = Path(new_spec["root"])
        manifest_path = candidate / "release-candidate.json"
        manifest = json.loads(manifest_path.read_text("utf-8"))
        manifest["files"] = [{"path": entry["path"], "bytes": entry["size"], "sha256": entry["sha256"]}
                             for entry in inventory(candidate) if entry["path"] != "release-candidate.json"]
        manifest_path.write_bytes(canonical(manifest))
        for spec, package in ((old_spec, Path(old_spec["roots"]["canvas"])), (new_spec, candidate)):
            with self.subTest(kind=spec["kind"]):
                identity = package_identity(spec)
                with patch("tools.migration.profiles.inventory", side_effect=lambda path: list(reversed(inventory(path)))):
                    self.assertEqual(package_identity(spec), identity)
                path = package / "AGENTS.md"
                original = path.read_bytes()
                try:
                    path.write_bytes(original + b"changed")
                    with self.assertRaises(MigrationError):
                        package_identity(spec)
                finally:
                    path.write_bytes(original)
                moved = package / "AGENTS-renamed.md"
                path.rename(moved)
                try:
                    with self.assertRaises(MigrationError):
                        package_identity(spec)
                finally:
                    moved.rename(path)
                self.assertEqual(package_identity(spec), identity)

    def test_nonempty_native_database_maps_both_owned_profiles_and_rolls_back_actual_new_data(self):
        source = self.source / "user/comfyui.db"
        source.parent.mkdir()
        schema = json.loads((Path(__file__).parent / "fixtures/comfyui-assets-schema.json").read_text("utf-8"))
        with closing(sqlite3.connect(source)) as db:
            for row in sorted(schema["schema"], key=lambda row: row["type"] != "table"):
                db.execute(row["sql"])
            db.execute("INSERT INTO alembic_version VALUES (?)", (schema["revision"],))
            media = self.source / "input/input.png"
            db.execute("INSERT INTO asset_contents(id,size_bytes,path,created_at) VALUES ('content-stable',?,?,?)",
                       (media.stat().st_size, str(media), "2026-01-01"))
            db.execute("INSERT INTO assets(id,content_id,name,loader_path,user_metadata,created_at,updated_at) VALUES ('asset-stable','content-stable','unchanged',?,?,?,?)",
                       (str(self.source / "output/output.png"), '{"favorite":true,"future":[3,1]}', "2026-01-01", "2026-01-01"))
            db.commit()
        original = source.read_bytes()
        migration = copy.deepcopy(self.plan)
        migration["migrationId"] = "native-db"
        migration["files"].append({"path": "user/comfyui.db", "kind": "host-sqlite"})
        migrate(migration)
        plan = copy.deepcopy(self.profiles_plan)
        plan.update(migrationId="native-db", setId="native")
        plan["mapping"].append({"source": "user/comfyui.db", "root": "user", "path": "comfyui.db"})
        def stop_after_db(point):
            if point == "profile_copied:old:user/comfyui.db":
                raise RuntimeError("synthetic converted DB publication interruption")
        with self.assertRaises(RuntimeError):
            prepare_profiles(plan, fault=stop_after_db)
        prepare_profiles(plan)
        before = inventory(self.workspace)
        prepare_profiles(plan)
        self.assertEqual(inventory(self.workspace), before)
        old = self.workspace / "profiles/native-old"
        new = self.workspace / "profiles/native-new"
        old_marker = profile_identity(self.workspace, "native-old")[2]
        new_marker = profile_identity(self.workspace, "native-new")[2]
        self.assertEqual(old_marker["comparisonInventory"], new_marker["comparisonInventory"])
        self.assertNotEqual(file_hash(old / "user/comfyui.db"), file_hash(new / "user/comfyui.db"))
        for root, marker in ((old, old_marker), (new, new_marker)):
            with closing(sqlite3.connect((root / "user/comfyui.db").as_uri() + "?mode=ro", uri=True)) as db:
                self.assertEqual(db.execute("SELECT id,path FROM asset_contents").fetchall(), [("content-stable", str(root / "input/input.png"))])
                self.assertEqual(db.execute("SELECT id,loader_path,user_metadata FROM assets").fetchall(),
                                 [("asset-stable", str(root / "output/output.png"), '{"favorite":true,"future":[3,1]}')])
            conversion = marker["transformations"][0]
            self.assertEqual(conversion["sourceSHA256"], hashlib.sha256(original).hexdigest())
            self.assertEqual(conversion["resultSHA256"], file_hash(root / "user/comfyui.db"))
            self.assertEqual(len(conversion["changedReferences"]), 2)
            self.assertEqual(conversion["nonPathMetadataSHA256"]["before"], conversion["nonPathMetadataSHA256"]["after"])
        select_profile(self.workspace, "native-old", "native-old", expected_sequence=0)
        old_seal = self.seal("native-old")
        select_profile(self.workspace, "native-new", "native-new", expected_sequence=1, current_seal=old_seal)
        with closing(sqlite3.connect(new / "user/comfyui.db")) as db:
            db.execute("UPDATE assets SET user_metadata=?", ('{"favorite":true,"newEdit":"kept"}',))
            db.commit()
        new_seal = self.seal("native-new")
        new_bytes = (new / "user/comfyui.db").read_bytes()
        selected = select_profile(self.workspace, "native-return", "native-old", expected_sequence=2,
                                  current_seal=new_seal, target_seal=old_seal, rollback=True)
        self.assertEqual((Path(selected["preservation"]["path"]) / "data/user/comfyui.db").read_bytes(), new_bytes)
        self.assertEqual(source.read_bytes(), original)
        self.assertEqual((self.workspace / "native-db/backup/user/comfyui.db").read_bytes(), original)

    def test_prepare_never_resurrects_deleted_workflow_in_selected_profile(self):
        select_profile(self.workspace, "initial-new", "case-new", expected_sequence=0)
        deleted = self.new / "user/default/workflows/graph.json"
        deleted.unlink()  # explicit user deletion inside this test's newly owned data
        before = inventory(self.workspace)
        with self.assertRaisesRegex(MigrationError, "deletions"):
            prepare_profiles(self.profiles_plan)
        self.assertFalse(deleted.exists())
        self.assertEqual(inventory(self.workspace), before)

    def test_prepare_prechecks_both_profiles_and_never_writes_while_bound(self):
        deleted = self.old / "input/input.png"
        deleted.unlink()
        (self.new / "output/output.png").write_bytes(b"edited new output")
        before = inventory(self.workspace)
        with self.assertRaises(MigrationError):
            prepare_profiles(self.profiles_plan)
        self.assertFalse(deleted.exists())
        self.assertEqual(inventory(self.workspace), before)
        process = SimpleNamespace(info={"pid": 123, "cmdline": ["python", "--user-directory", str(self.new / "user")],
                                       "cwd": str(self.root), "name": "python.exe"})
        with patch("psutil.process_iter", return_value=[process]), self.assertRaises(MigrationError):
            prepare_profiles(self.profiles_plan)
        self.assertEqual(inventory(self.workspace), before)

    def test_omitted_colliding_remapped_media_and_unowned_paths_refused(self):
        for mutation in (lambda p: p["mapping"].pop(),
                         lambda p: p["mapping"][1].update(path="renamed.png"),
                         lambda p: p["mapping"][0].update(path="../../outside.json"),
                         lambda p: p["mapping"][0].update(root="temp")):
            plan = copy.deepcopy(self.profiles_plan)
            mutation(plan)
            with self.assertRaises((MigrationError, ValueError)):
                prepare_profiles(plan)

    def test_active_descriptor_cas_and_repeated_operation_identity(self):
        first = self.activate_old()
        before = inventory(self.workspace)
        self.assertEqual(self.activate_old(), first)
        self.assertEqual(inventory(self.workspace), before)
        self.assertEqual(active_profile(self.workspace)["active"], "case-old")
        with self.assertRaises(MigrationError):
            select_profile(self.workspace, "start-old", "case-new", expected_sequence=0)
        with self.assertRaisesRegex(MigrationError, "changed"):
            select_profile(self.workspace, "stale", "case-new", expected_sequence=0)
        with self.assertRaisesRegex(MigrationError, "evidence"):
            select_profile(self.workspace, "no-evidence", "case-new", expected_sequence=1)

    def test_queue_process_birth_data_and_freshness_are_bound(self):
        self.activate_old()
        observed, process = self.observe("case-old")
        with patch("tools.migration.profiles._process", return_value=process), self.assertRaisesRegex(MigrationError, "stopped"):
            seal_profile(self.workspace, "case-old", observed["observationId"])
        with patch("tools.migration.profiles.time.time", return_value=observed["observedAt"] + 301), self.assertRaisesRegex(MigrationError, "stale"):
            seal_profile(self.workspace, "case-old", observed["observationId"])
        path = self.old / "user/default/workflows/graph.json"
        path.write_bytes(canonical({"nodes": [], "lateEdit": True}))
        with patch("tools.migration.profiles._process", return_value=None), self.assertRaisesRegex(MigrationError, "changed after"):
            seal_profile(self.workspace, "case-old", observed["observationId"])
        with patch("tools.migration.profiles._process", return_value=process), patch("tools.migration.profiles._get", return_value={"queue_running": [1], "queue_pending": []}), self.assertRaisesRegex(MigrationError, "empty"):
            observe_runtime(self.workspace, "case-old", 1234567, 8999)
        with self.assertRaises(MigrationError):
            observe_runtime(self.workspace, "case-old", 1234567, 8000)

    def test_wrong_roots_listener_and_candidate_build_are_rejected(self):
        self.activate_new()
        _, process = self.observe("case-new")
        for changed in ({**process, "listeners": []}, {**process, "arguments": [sys.executable]}):
            with patch("tools.migration.profiles._process", return_value=changed), self.assertRaises(MigrationError):
                observe_runtime(self.workspace, "case-new", 1234567, 8999)
        with patch("tools.migration.profiles._process", return_value=process), patch("tools.migration.profiles._get", side_effect=[{"queue_running": [], "queue_pending": []}, {"compatible": True, "frontendBuildId": "wrong"}]), self.assertRaisesRegex(MigrationError, "candidate"):
            observe_runtime(self.workspace, "case-new", 1234567, 8999)

    def test_rollback_preserves_actual_active_roots_not_stale_working(self):
        old_seal = self.activate_new()
        (self.new / "user/new-schema.json").write_bytes(canonical({"futureSchema": 7, "unknown": [3, 1]}))
        (self.new / "input/new.png").write_bytes(b"new input")
        (self.new / "output/new.png").write_bytes(b"new output")
        new_data = profile_inventory(self.new)
        new_seal = self.seal("case-new")
        with self.assertRaisesRegex(MigrationError, "rollback-profile"):
            select_profile(self.workspace, "wrong-route", "case-old", expected_sequence=2, current_seal=new_seal, target_seal=old_seal)
        def interrupt(point):
            if point == "active_new_preserved":
                raise RuntimeError("synthetic interruption")
        with self.assertRaises(RuntimeError):
            select_profile(self.workspace, "return-old", "case-old", expected_sequence=2, current_seal=new_seal,
                           target_seal=old_seal, rollback=True, fault=interrupt)
        self.assertEqual(active_profile(self.workspace)["active"], "case-new")
        preserved = self.workspace / "preservations/return-old"
        self.assertTrue((preserved / "COMPLETE.json").exists())
        self.assertEqual(inventory(preserved / "data"), sorted(new_data, key=lambda item: item["path"]))
        result = select_profile(self.workspace, "return-old", "case-old", expected_sequence=2, current_seal=new_seal, target_seal=old_seal, rollback=True)
        self.assertEqual(active_profile(self.workspace)["active"], "case-old")
        self.assertEqual(profile_inventory(self.new), new_data)
        self.assertFalse((self.old / "output/new.png").exists())
        self.assertFalse((self.workspace / "migration/working/output/new.png").exists())
        self.assertEqual(select_profile(self.workspace, "return-old", "case-old", expected_sequence=2, current_seal=new_seal, target_seal=old_seal, rollback=True), result)

    def test_inflight_ledger_and_credentials_block_sealing(self):
        self.activate_new()
        database = self.new / "user/studio.sqlite3"
        ledger = JobLedger(database)
        ledger.create_or_get("not-persisted-as-terminal", provider="synthetic", execution_kind="remote", snapshot={"prompt": "synthetic"})
        with self.assertRaisesRegex(MigrationError, "In-flight"):
            self.seal("case-new")

    def test_all_json_receipt_containers_and_retired_provider_recovery_remain_blocked(self):
        self.activate_new()
        receipt = {"requestId": "r-retired", "provider": "libtv", "execution_kind": "remote", "taskId": "t-retired", "phase": "running"}
        path = self.new / "user/active-receipts.json"
        for value in ([receipt], {"rows": [receipt]}, receipt, {"nested": json.dumps({"rows": [receipt]})}):
            with self.subTest(container=type(value).__name__):
                path.write_bytes(canonical(value))
                with self.assertRaisesRegex(MigrationError, "In-flight"):
                    self.seal("case-new")
        path.write_bytes(canonical({"provider": "remote-provider", "rows": [
            {"requestId": "r-live", "execution_kind": "remote", "taskId": "t-live", "phase": "running"}]}))
        self.assertTrue(self.seal("case-new"))
        (self.new / "user/sensitive.json").write_bytes(canonical({"api_key": "synthetic-secret-never-log"}))
        with self.assertRaises((MigrationError, ValueError)):
            self.seal("case-new")

    def test_package_mutation_and_undeclared_enabled_package_rejected(self):
        new = Path(self.profiles_plan["newPackage"]["root"])
        (new / "__init__.py").write_bytes(b"changed")
        with self.assertRaisesRegex(MigrationError, "bytes differ"):
            select_profile(self.workspace, "new-direct", "case-new", expected_sequence=0)
        extra = Path(self.profiles_plan["oldPackage"]["installationRoot"]) / "custom_nodes/extra"
        extra.mkdir()
        with self.assertRaisesRegex(MigrationError, "exactly"):
            self.activate_old()

    def test_live_unregistered_root_binding_blocks_never_selected_shortcut(self):
        marker = profile_identity(self.workspace, "case-old")[2]
        command = [sys.executable, "-c", "import time; time.sleep(10)", "--user-directory", marker["roots"]["user"]]
        child = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            with self.assertRaisesRegex(MigrationError, "process"):
                self.activate_old()
        finally:
            child.terminate()
            child.wait(timeout=5)

    def test_windows_long_sibling_name_does_not_break_valid_destination(self):
        # Reproduce the original .part-64hash failure without renaming user paths.
        folder = self.root / ("a" * 70) / ("b" * 70) / ("c" * 32)
        folder.mkdir(parents=True)
        source = self.source / "input/input.png"
        destination = folder / "image.png"
        entry = {"sha256": file_hash(source), "size": source.stat().st_size}
        self.assertGreater(len(str(folder / (".part-" + entry["sha256"]))), 260)
        copy_verified(source, destination, entry)
        self.assertEqual(file_hash(destination), entry["sha256"])
        self.assertEqual([path.name for path in folder.iterdir()], ["image.png"])

    def test_interrupted_preparation_and_descriptor_publication_resume(self):
        plan = copy.deepcopy(self.profiles_plan)
        plan["setId"] = "interrupted"
        def stop_copy(point):
            if point.startswith("profile_copied:old:"):
                raise RuntimeError("copy interrupted")
        with self.assertRaises(RuntimeError):
            prepare_profiles(plan, fault=stop_copy)
        with self.assertRaises((MigrationError, OSError)):
            select_profile(self.workspace, "too-early", "interrupted-old", expected_sequence=0)
        prepare_profiles(plan)
        def stop_after(point):
            if point == "active_descriptor_published":
                raise RuntimeError("caller lost response")
        with self.assertRaises(RuntimeError):
            select_profile(self.workspace, "selected-once", "interrupted-old", expected_sequence=0, fault=stop_after)
        before = inventory(self.workspace)
        selected = select_profile(self.workspace, "selected-once", "interrupted-old", expected_sequence=0)
        self.assertEqual(selected["sequence"], 1)
        self.assertEqual(inventory(self.workspace), before)

    def test_changes_after_seal_and_after_preservation_cannot_switch(self):
        old_seal = self.activate_new()
        new_seal = self.seal("case-new")
        def late_edit(point):
            if point == "active_new_preserved":
                (self.new / "output/late.png").write_bytes(b"late output")
        with self.assertRaisesRegex(MigrationError, "changed"):
            select_profile(self.workspace, "late-rollback", "case-old", expected_sequence=2, current_seal=new_seal,
                           target_seal=old_seal, rollback=True, fault=late_edit)
        self.assertEqual(active_profile(self.workspace)["active"], "case-new")
        preserved = self.workspace / "preservations/late-rollback/data"
        before = inventory(preserved)
        with self.assertRaisesRegex(MigrationError, "evidence"):
            select_profile(self.workspace, "late-rollback", "case-old", expected_sequence=2, current_seal=new_seal, target_seal=old_seal, rollback=True)
        self.assertEqual(inventory(preserved), before)

    def test_old_edits_cannot_silently_activate_stale_new_snapshot(self):
        self.activate_old()
        (self.old / "user/default/workflows/graph.json").write_bytes(canonical({"nodes": [], "editedInOld": True}))
        (self.old / "output/old-late.png").write_bytes(b"latest old output")
        old_seal = self.seal("case-old")
        with self.assertRaisesRegex(MigrationError, "fresh migration"):
            select_profile(self.workspace, "stale-new", "case-new", expected_sequence=1, current_seal=old_seal)
        self.assertEqual(active_profile(self.workspace)["active"], "case-old")
        self.assertTrue((self.old / "output/old-late.png").exists())
        # Explicitly snapshot all current old roots and prepare a fresh version;
        # no reset of the active journal or overwrite of either old set is needed.
        source = self.root / "fresh-source"
        source.mkdir()
        entries = profile_inventory(self.old)
        for entry in entries:
            target = source / entry["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.old / entry["path"], target)
        plan = copy.deepcopy(self.plan)
        plan.update(migrationId="fresh-migration", sourceRoot=str(source), files=[
            {"path": entry["path"], "kind": "workflow" if entry["path"].endswith(".json") else "media"} for entry in entries])
        migrate(plan)
        profiles = copy.deepcopy(self.profiles_plan)
        profiles.update(migrationId="fresh-migration", setId="fresh", mapping=[
            {"source": entry["path"], "root": entry["path"].split("/", 1)[0], "path": entry["path"].split("/", 1)[1]} for entry in entries])
        prepare_profiles(profiles)
        selected = select_profile(self.workspace, "fresh-new", "fresh-new", expected_sequence=1, current_seal=old_seal)
        self.assertEqual(selected["profileId"], "fresh-new")
        self.assertEqual(profile_inventory(self.workspace / "profiles/fresh-new"), entries)

    def test_equals_relative_abbreviated_and_unreadable_runtime_arguments_are_guarded(self):
        marker = profile_identity(self.workspace, "case-old")[2]
        for args, cwd in ((["python", "--user-directory=" + marker["roots"]["user"]], None),
                          (["python", "--user-dir=" + marker["roots"]["user"]], None),
                          (["python", "--input-directory", "input"], str(self.old)),
                          (["python", "--base-directory", str(self.old)], None),
                          (["python", "--input-directory", str(self.old / "input/subdir")], None),
                          (["python", "--input-directory", str(self.old)], None),
                          (["python", "--database-url=sqlite:///" + (self.old / "user/comfyui.db").as_posix()], None),
                          (None, None)):
            metadata = SimpleNamespace(info={"pid": 999, "cmdline": args, "cwd": cwd, "name": "python.exe"})
            with patch("psutil.process_iter", return_value=[metadata]), self.assertRaises(MigrationError):
                self.activate_old()
        self.assertIsNone(active_profile(self.workspace)["active"])
        # Chromium's --database is unrelated to ComfyUI's argparse abbreviation.
        unrelated = SimpleNamespace(info={"pid": 777, "cmdline": ["crashpad_handler.exe", "--database=" + str(self.root / "crash-reports")],
                                         "cwd": str(self.root), "name": "crashpad_handler.exe"})
        with patch("psutil.process_iter", return_value=[unrelated]):
            self.assertEqual(self.activate_old()["profileId"], "case-old")

    @unittest.skipUnless(os.name == "nt", "Win32 extended path alias")
    def test_extended_namespace_process_binding_cannot_bypass_live_guard(self):
        extended = "\\\\?\\" + str(self.old / "user")
        self.assertTrue(os.path.samefile(extended, self.old / "user"))
        process = SimpleNamespace(info={"pid": 999, "cmdline": ["python.exe", "--user-directory=" + extended],
                                       "name": "python.exe", "cwd": str(self.root)})
        with patch("psutil.process_iter", return_value=[process]), self.assertRaises(MigrationError):
            self.activate_old()
        self.assertIsNone(active_profile(self.workspace)["active"])

    def test_normal_wal_close_preserves_logical_seal_but_changed_rows_refuse(self):
        self.activate_old()
        path = self.old / "user/optimization.sqlite"
        connection = sqlite3.connect(path)
        self.addCleanup(connection.close)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE objects(kind TEXT,id TEXT,body TEXT,PRIMARY KEY(kind,id))")
        connection.execute("INSERT INTO objects VALUES ('config','fixed','{\"future\":[1,2]}')")
        connection.commit()
        self.assertTrue(Path(str(path) + "-wal").exists())
        observed, _ = self.observe("case-old")
        self.assertIn("user/optimization.sqlite-wal", {entry["path"] for entry in observed["rawInventory"]})
        connection.close()
        self.assertFalse(Path(str(path) + "-wal").exists())
        self.assertNotEqual(json_hash(profile_inventory(self.old)), observed["inventorySha256"])
        with patch("tools.migration.profiles._process", return_value=None):
            sealed = seal_profile(self.workspace, "case-old", observed["observationId"])
        self.assertEqual(sealed["inventorySha256"], json_hash(profile_inventory(self.old)))
        with closing(sqlite3.connect(path)) as db:
            db.execute("UPDATE objects SET body='{\"future\":[1,3]}'")
            db.commit()
        with patch("tools.migration.profiles._process", return_value=None), self.assertRaisesRegex(MigrationError, "changed"):
            seal_profile(self.workspace, "case-old", observed["observationId"])

    def test_external_database_binding_and_unfenced_old_observation_are_rejected(self):
        self.activate_old()
        _, process = self.observe("case-old")
        foreign = self.root / "foreign.sqlite3"
        foreign.write_bytes(b"outside profile")
        changed = {**process, "arguments": process["arguments"] + ["--database-url", "sqlite:///" + foreign.as_posix()]}
        with patch("tools.migration.profiles._process", return_value=changed), self.assertRaisesRegex(MigrationError, "database"):
            observe_runtime(self.workspace, "case-old", process["pid"], 8999)
        observed, _ = self.observe("case-old")
        path = self.old / "runtime" / (observed["observationId"] + ".json")
        observed["runtimeCoverage"]["fence"]["active"] = False
        path.write_bytes(canonical(observed))
        with patch("tools.migration.profiles._process", return_value=None), self.assertRaisesRegex(MigrationError, "fence"):
            seal_profile(self.workspace, "case-old", observed["observationId"])

    def test_real_owned_child_http_observation_and_exit_are_required(self):
        select_profile(self.workspace, "initial-new", "case-new", expected_sequence=0)
        marker = profile_identity(self.workspace, "case-new")[2]
        server = self.root / "synthetic_observer_server.py"
        server.write_text('''import json, os
from http.server import BaseHTTPRequestHandler,HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        value = {"queue_running": [], "queue_pending": []} if self.path == "/queue" else {"compatible": True, "frontendBuildId": "b" * 64}
        raw=json.dumps(value).encode()
        self.send_response(200); self.end_headers(); self.wfile.write(raw)
    def log_message(self,*args): pass
server=HTTPServer(("127.0.0.1",0),Handler)
print(json.dumps({"pid":os.getpid(),"port":server.server_port}),flush=True)
server.serve_forever()
''', encoding="utf-8", newline="\n")
        arguments = [sys.executable, str(server), "--base-directory", marker["package"]["spec"]["installationRoot"]]
        for name, value in marker["roots"].items():
            arguments.extend(["--" + name + "-directory", value])
        child = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        server_identity = None
        try:
            server_identity = json.loads(child.stdout.readline().strip())
            from tools.migration.profiles import _process
            fixture = self.fixture_evidence(marker, _process(server_identity["pid"]), "2" * 32)
            # Only the PID/listener/root/queue/health path is real in this case;
            # this tiny HTTP server is not a ComfyUI or probe acceptance environment.
            with patch("tools.migration.profiles._runtime_evidence", return_value=fixture):
                observed = observe_runtime(self.workspace, "case-new", server_identity["pid"], server_identity["port"])
            with self.assertRaisesRegex(MigrationError, "stopped"):
                seal_profile(self.workspace, "case-new", observed["observationId"])
        finally:
            # Windows venv launchers may be parents of the actual interpreter.
            # Stop only this freshly spawned synthetic server, never an arbitrary host.
            if server_identity:
                import psutil
                process = psutil.Process(server_identity["pid"])
                self.assertIn(str(server), process.cmdline())
                process.terminate()
                process.wait(timeout=5)
            elif child.poll() is None:
                child.terminate()
            child.communicate(timeout=5)
        sealed = seal_profile(self.workspace, "case-new", observed["observationId"])
        selected = select_profile(self.workspace, "real-child-evidence", "case-old", expected_sequence=1, current_seal=sealed["sealId"], rollback=True)
        self.assertFalse(selected["hostAcceptance"])
        self.assertEqual(selected["serviceAction"], "none")


if __name__ == "__main__":
    unittest.main()
