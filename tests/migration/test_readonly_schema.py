import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from compat.workflows.node_schemas import native_readonly_mappings, GPT_ID, GPT_WIDGETS, BATCH_WIDGETS

FIXTURES = Path(__file__).with_name("fixtures")


class ReadonlySchemaTests(unittest.TestCase):
    def test_compat_provenance_has_pinned_sources_and_current_destination_hashes(self):
        root = FIXTURES.parents[2]
        manifest = json.loads((root / "docs/provenance/compat-files.json").read_text("utf-8"))
        source = json.loads((FIXTURES / "legacy-source-contract.json").read_text("utf-8"))
        self.assertEqual(manifest["sourceCommit"], source["sourceCommit"])
        self.assertEqual(manifest["sources"], source["sources"])
        for entry in manifest["files"]:
            destination = root / entry["destination"]
            self.assertTrue(destination.resolve().is_relative_to(root.resolve()))
            self.assertEqual(hashlib.sha256(destination.read_bytes()).hexdigest(), entry["destinationSha256"], entry["destination"])

    def test_two_backend_schemas_match_pinned_source_ast_contract(self):
        contract = json.loads((FIXTURES / "legacy-source-contract.json").read_text("utf-8"))
        mappings = native_readonly_mappings()
        self.assertEqual(set(mappings), set(contract["nativeInputs"]))
        for name, cls in mappings.items():
            schema = cls.INPUT_TYPES()
            actual = {**schema["required"], **schema.get("optional", {})}
            expected = contract["nativeInputs"][name]
            self.assertEqual(list(actual), [item["name"] for item in expected])
            for item in expected:
                kind, options = actual[item["name"]]
                self.assertEqual("COMBO" if isinstance(kind, list) else kind, item["type"])
                for key, value in item["options"].items():
                    if key == "optional":
                        self.assertIn(item["name"], schema["optional"])
                    elif key == "options":
                        self.assertEqual(kind, value)
                    else:
                        self.assertEqual(options[{"force_input": "forceInput"}.get(key, key)], value)
            self.assertNotIn("hidden", schema)  # old server auth hooks are deliberately not requested

    def test_outputs_and_serialized_widget_order_are_pinned(self):
        fixture = json.loads((FIXTURES / "legacy-readonly-workflow.json").read_text("utf-8"))
        for raw in fixture["nodes"][:2]:
            cls = native_readonly_mappings()[raw["type"]]
            self.assertEqual([slot["name"] for slot in raw["outputs"]], list(cls.RETURN_NAMES))
            self.assertEqual([slot["type"] for slot in raw["outputs"]], list(cls.RETURN_TYPES))
            widgets = GPT_WIDGETS if raw["type"] == GPT_ID else BATCH_WIDGETS
            self.assertEqual(len(raw["widgets_values"]), len(widgets))
        self.assertEqual(len(fixture["nodes"][0]["inputs"]), 14)
        schema = native_readonly_mappings()[GPT_ID].INPUT_TYPES()
        self.assertEqual(list(schema["optional"]), ["imported_storyboard"])
        self.assertEqual(GPT_WIDGETS[10], "control_after_generate")

    def test_all_native_execution_and_cached_output_paths_refuse(self):
        with patch("subprocess.Popen", side_effect=AssertionError("old CLI must never run")), patch("socket.create_connection", side_effect=AssertionError("provider must never run")):
            for cls in native_readonly_mappings().values():
                self.assertTrue(cls.DEPRECATED)
                self.assertIsInstance(cls.VALIDATE_INPUTS(), str)
                self.assertNotEqual(cls.IS_CHANGED(), cls.IS_CHANGED())
                with self.assertRaisesRegex(RuntimeError, "未提交"):
                    cls().execute(storyboard_data='{"shots":[]}', force_run_token=99)

    def test_schema_objects_do_not_share_mutable_defaults(self):
        for cls in native_readonly_mappings().values():
            before = copy.deepcopy(cls.INPUT_TYPES())
            changed = cls.INPUT_TYPES()
            changed["required"].clear()
            self.assertEqual(cls.INPUT_TYPES(), before)


if __name__ == "__main__":
    unittest.main()
