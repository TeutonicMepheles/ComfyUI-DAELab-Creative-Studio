"""Offline preparation regressions. No model, service or provider is executed."""
from copy import deepcopy
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest

from tools.evals.prepare_local_inputs import ROOT, no_external_io, safe_relative, save_new, selected, synthetic_images, validate_fixed_inputs
from tools.evals.request_contract import RequestContractError, compare_requests, sha256, validate_payload


def capture():
    return {"sampleId": "LOCAL-H3-001", "finalRequest": {"prompt": "镜头：3。红球向右移动。", "seed": 20261023, "runId": "old", "save": {"inputs": {"filename_prefix": "old/output"}}},
            "effective": {"expandedText": "镜头：3。红球向右移动。", "referenceOrder": ["first", "last"], "weightSha256": ["a" * 64], "steps": 20}}


class RequestComparisonTests(unittest.TestCase):
    def test_same_request_and_only_explicit_output_prefix_or_run_id_changes_pass(self):
        old, new = capture(), capture()
        new["finalRequest"]["runId"] = "new"
        new["finalRequest"]["save"]["inputs"]["filename_prefix"] = "new/output"
        new["entry"] = ["new implementation"]
        result = compare_requests(old, new)
        self.assertTrue(result["passed"])
        self.assertFalse(result["inferenceAcceptance"])

    def test_unexplained_wire_difference_blocks_and_exact_review_allows_only_that_diff(self):
        old, new = capture(), capture()
        new["finalRequest"]["clientMetadata"] = "studio"
        result = compare_requests(old, new)
        self.assertFalse(result["passed"])
        explanation = {**result["differences"][0], "reason": "New transport correlation metadata; effective request unchanged.", "reviewer": "synthetic-reviewer"}
        self.assertTrue(compare_requests(old, new, [explanation])["passed"])
        new["finalRequest"]["clientMetadata"] = "changed-again"
        self.assertFalse(compare_requests(old, new, [explanation])["passed"])

    def test_effective_parameters_weights_and_reference_order_cannot_be_excused(self):
        for key, value in (("steps", 8), ("weightSha256", ["b" * 64]), ("referenceOrder", ["last", "first"])):
            old, new = capture(), capture()
            new["effective"][key] = value
            result = compare_requests(old, new)
            explanations = [{**d, "reason": "synthetic reason", "reviewer": "synthetic-reviewer"} for d in result["differences"]]
            self.assertFalse(compare_requests(old, new, explanations)["passed"])

    def test_changed_raw_seed_cannot_be_excused_by_keeping_effective_metadata_stale(self):
        old, new = capture(), capture()
        new["finalRequest"]["seed"] = 42
        result = compare_requests(old, new)
        explanations = [{**d, "reason": "effective metadata unchanged", "reviewer": "synthetic-reviewer"} for d in result["differences"]]
        self.assertFalse(compare_requests(old, new, explanations)["passed"])

    def test_numeric_camera_defect_and_whitespace_are_not_silently_normalized(self):
        for text in ("固定镜头。红球向右移动。", "镜头：3。 红球向右移动。"):
            old, new = capture(), capture()
            new["effective"]["expandedText"] = text
            self.assertFalse(compare_requests(old, new)["passed"])

    def test_nested_lookalike_ignore_keys_are_still_compared(self):
        old, new = capture(), capture()
        old["finalRequest"]["settings"] = {"outputPrefix": "semantic-a"}
        new["finalRequest"]["settings"] = {"outputPrefix": "semantic-b"}
        self.assertFalse(compare_requests(old, new)["passed"])

    def test_missing_null_bool_and_number_remain_distinct(self):
        for a, b in ((None, 0), (False, 0), (True, 1)):
            old, new = capture(), capture()
            old["finalRequest"]["value"], new["finalRequest"]["value"] = a, b
            self.assertFalse(compare_requests(old, new)["passed"])
        old, new = capture(), capture()
        new["finalRequest"]["optional"] = None
        self.assertFalse(compare_requests(old, new)["passed"])

    def test_unknown_sample_or_duplicate_explanations_are_rejected(self):
        old, new = capture(), capture()
        new["sampleId"] = "LOCAL-H3-002"
        with self.assertRaises(RequestContractError):
            compare_requests(old, new)
        item = {"path": "/missing", "baselineSha256": "a", "studioSha256": "b", "reason": "synthetic", "reviewer": "synthetic"}
        with self.assertRaises(RequestContractError):
            compare_requests(old, old, [item, item])
        self.assertFalse(compare_requests(old, old, [item])["passed"])

    def test_credentials_are_rejected_without_echo(self):
        for field in ("X-API-Key", "OPENAI_API_KEY", "X-DAELab-DeepSeek-Key", "Authorization", "cookie"):
            payload = {"headers": {field: "SYNTHETIC-NOT-A-REAL-SECRET"}}
            with self.assertRaises(RequestContractError) as error:
                validate_payload(payload)
            self.assertNotIn(payload["headers"][field], str(error.exception))


class PreparationSafetyTests(unittest.TestCase):
    def test_network_and_child_execution_are_denied(self):
        with no_external_io():
            with socket.socket() as connection, self.assertRaises(RuntimeError):
                connection.connect(("127.0.0.1", 8000))
            with self.assertRaises(RuntimeError):
                subprocess.Popen(["never-launched"])

    def test_ast_capture_preserves_function_but_never_runs_module_side_effects(self):
        namespace = selected("raise RuntimeError('package registration must not run')\nCONST=3\ndef build(value):\n return {'value':value,'steps':CONST}\n", ["CONST", "build"], {})
        self.assertEqual(namespace["build"]("input"), {"value": "input", "steps": 3})
        with self.assertRaises(ValueError):
            selected("pass", ["missing"], {})

    def test_evidence_is_create_only_and_paths_remain_rooted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            save_new(root / "record.json", {"first": True})
            save_new(root / "record.json", {"first": True})
            with self.assertRaises(ValueError):
                save_new(root / "record.json", {"first": False})
            with self.assertRaises(ValueError):
                safe_relative(root, "../outside")
            self.assertEqual(json.loads((root / "record.json").read_text()), {"first": True})

    def test_public_images_are_deterministic_and_fixed_samples_match_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            first = synthetic_images(Path(directory))
            self.assertEqual(first, synthetic_images(Path(directory)))
            self.assertEqual(len(first), 4)
        samples = json.loads((ROOT / "tests/fixtures/local-eval/samples.json").read_text("utf-8"))
        plan = json.loads((ROOT / "docs/validation/catalog/local-eval-plan.json").read_text("utf-8"))
        validate_payload(samples)
        self.assertEqual([s["id"] for s in samples["samples"]], [s["id"] for s in plan["samples"]])
        self.assertEqual(sum(s["repetitionsPerVariant"] * 2 for s in plan["samples"]), 44)
        validate_fixed_inputs(samples, plan)
        for sample_id, field, value in (("LOCAL-IMAGE-001", "seed", 1), ("LOCAL-H3-001", "turbo", True), ("LOCAL-H3-003", "duration", 2)):
            changed = deepcopy(samples)
            next(s for s in changed["samples"] if s["id"] == sample_id)["settings"][field] = value
            with self.assertRaises(ValueError):
                validate_fixed_inputs(changed, plan)


if __name__ == "__main__":
    unittest.main()
