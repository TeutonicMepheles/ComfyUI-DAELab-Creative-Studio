"""Public synthetic data + sealed-copy CLI plans, not real host acceptance."""
import json
import unittest
from pathlib import Path

from tools.migration.prepare import migrate, preflight
from tools.migration.prepare_e5 import seed, capture
from tools.migration.profiles import prepare_profiles, select_profile, profile_identity
from tools.migration.safety import inventory, load_json, MigrationError


class E5PreparationTests(unittest.TestCase):
    def setUp(self):
        from test_profiles import ProfileTests
        self.fixture = ProfileTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.bindings = {key: self.fixture.profiles_plan[key] for key in ("oldPackage", "newPackage")}

    def prepare(self):
        report = seed(self.fixture.root / "e5", self.bindings)
        migration = load_json(report["migrationPlan"])
        self.assertTrue(preflight(migration)["switchPreflightClear"])
        migrate(migration)
        prepare_profiles(load_json(report["profilePlan"]))
        self.fixture.workspace = Path(report["workspace"])
        self.fixture.old = self.fixture.workspace / "profiles/round1-old"
        self.fixture.new = self.fixture.workspace / "profiles/round1-new"
        return report

    def test_seed_has_nonempty_assets_legacy_favorites_and_unknown_workflow_fields(self):
        report = self.prepare()
        old = profile_identity(report["workspace"], "round1-old")[2]
        self.assertEqual(old["transformations"][0]["counts"]["assets"], 2)
        self.assertEqual(len(old["transformations"][0]["changedReferences"]), 4)
        source = self.fixture.root / "e5/source"
        workflow = load_json(source / "user/default/workflows/M6-synthetic.json")
        self.assertIn("unknownWorkflow", workflow)
        self.assertNotEqual(workflow["unknownWorkflow"], workflow["extensions"]["unknownWorkflow"])
        favorites = load_json(source / "user/imports/legacy-favorites.json")
        self.assertEqual([item["kind"] for item in favorites["entries"]], ["text", "image", "video"])
        before = inventory(source)
        with self.assertRaises(MigrationError):
            seed(self.fixture.root / "e5", self.bindings)
        self.assertEqual(inventory(source), before)

    def test_capture_after_old_edit_produces_fresh_new_copy_without_changing_original(self):
        report = self.prepare()
        workspace = report["workspace"]
        select_profile(workspace, "initial-old", "round1-old", expected_sequence=0)
        workflow_path = self.fixture.old / "user/default/workflows/M6-synthetic.json"
        workflow = load_json(workflow_path)
        workflow["unknownWorkflow"]["newOldEdit"] = "preserved"
        workflow_path.write_text(json.dumps(workflow, ensure_ascii=False), encoding="utf-8", newline="\n")
        seal = self.fixture.seal("round1-old")
        original = inventory(self.fixture.root / "e5/source")
        fresh = capture(self.fixture.root / "fresh", self.bindings, workspace, "round1-old", seal, "after-old-ui", "round2")
        migrate(load_json(fresh["migrationPlan"]))
        prepare_profiles(load_json(fresh["profilePlan"]))
        result = select_profile(workspace, "select-fresh-new", "round2-new", expected_sequence=1, current_seal=seal)
        self.assertEqual(result["profileId"], "round2-new")
        self.assertEqual(load_json(Path(result["roots"]["user"]) / "default/workflows/M6-synthetic.json"), workflow)
        self.assertEqual(inventory(self.fixture.root / "e5/source"), original)

    def test_overlapping_seed_or_capture_refuses_before_creating_any_file(self):
        installation = Path(self.bindings["oldPackage"]["installationRoot"])
        before = inventory(installation)
        target = installation / "accidental-e5"
        with self.assertRaises(MigrationError):
            seed(target, self.bindings)
        self.assertFalse(target.exists())
        self.assertEqual(inventory(installation), before)
        report = self.prepare()
        workspace = Path(report["workspace"])
        select_profile(workspace, "initial-old", "round1-old", expected_sequence=0)
        seal = self.fixture.seal("round1-old")
        before = inventory(workspace)
        for target in (self.fixture.old / "user/accidental-capture", workspace / "accidental-capture"):
            with self.assertRaises(MigrationError):
                capture(target, self.bindings, workspace, "round1-old", seal, "overlap", "overlap")
            self.assertFalse(target.exists())
        self.assertEqual(inventory(workspace), before)


if __name__ == "__main__":
    unittest.main()
