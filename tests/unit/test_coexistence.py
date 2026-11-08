import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "studio_coexistence",
    Path(__file__).parents[2] / "backend/integrations/comfyui/coexistence.py")
coexistence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coexistence)


def valid_arbitration():
    return {
        "allowLegacyPackages": ["ComfyUI-DAELab-Custom-Nodes-Library"],
        "layerOwners": {
            "canvas": "studio", "business": "studio",
            "generation": "studio", "prompt-optimization": "studio",
        },
        "nodeOwners": {
            "DAELAB.Table": "studio", "DAELAB.ScriptParser": "studio",
            "DAELAB.LLMStylePreviewB": "studio",
            "DAELAB.ComfyTV.GPTImageStoryboardStage": "cnl",
        },
        "routeOwners": {
            "POST /daelab/storyboard/import_document": "studio",
            "POST /daelab/storyboard/parse-prompts": "studio",
            "POST /daelab/script-parser/document": "studio",
            "POST /daelab/script-parser/normalize": "studio",
            "POST /daelab/script-parser/classify": "studio",
            "GET  /daelab/script-parser/ai-status": "studio",
        },
        "routePrefixes": {
            "POST /daelab/prompt-optimization/": {
                "owner": "studio",
                "allowedActions": ["polish", "capabilities", "estimate", "lease", "submit",
                                   "query", "recover", "permit", "advance", "stop",
                                   "interrupt", "continue", "skip", "fence"],
            },
        },
        "extensionOwners": {
            "DAELab.DataTable": "studio", "DAELab.ScriptParser": "studio",
            "DAELab.LLMStylePreview": "studio",
            "DAELab.PromptOptimization.Identity.v1": "studio",
        },
    }


def write_arbitration(directory, data):
    user = Path(directory) / "daelab"
    user.mkdir(parents=True)
    (user / "coexistence.json").write_text(json.dumps(data), encoding="utf-8")
    return Path(directory)


class ArbitrationLoadingTests(unittest.TestCase):
    def test_missing_file_means_not_opted_in(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(coexistence.load_arbitration(Path(directory)))

    def test_valid_file_round_trips(self):
        with tempfile.TemporaryDirectory() as directory:
            write_arbitration(directory, valid_arbitration())
            self.assertEqual(coexistence.load_arbitration(Path(directory)), valid_arbitration())

    def test_malformed_json_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            user = Path(directory) / "daelab"
            user.mkdir()
            (user / "coexistence.json").write_text("{not json", encoding="utf-8")
            with self.assertRaises(ValueError):
                coexistence.load_arbitration(Path(directory))

    def test_non_object_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            write_arbitration(directory, ["not", "an", "object"])
            with self.assertRaises(ValueError):
                coexistence.load_arbitration(Path(directory))


class ValidationTests(unittest.TestCase):
    def test_complete_arbitration_has_no_errors(self):
        self.assertEqual(coexistence.validate_arbitration(valid_arbitration()), [])

    def test_missing_node_owner_is_an_error(self):
        data = valid_arbitration()
        del data["nodeOwners"]["DAELAB.Table"]
        errors = coexistence.validate_arbitration(data)
        self.assertTrue(any("nodeOwners" in error for error in errors))

    def test_missing_route_owner_is_an_error(self):
        data = valid_arbitration()
        del data["routeOwners"]["POST /daelab/storyboard/import_document"]
        self.assertTrue(any("routeOwners" in error for error in coexistence.validate_arbitration(data)))

    def test_missing_extension_owner_is_an_error(self):
        data = valid_arbitration()
        del data["extensionOwners"]["DAELab.DataTable"]
        self.assertTrue(any("extensionOwners" in error for error in coexistence.validate_arbitration(data)))

    def test_missing_prompt_optimization_prefix_is_an_error(self):
        data = valid_arbitration()
        del data["routePrefixes"]
        self.assertTrue(any("routePrefixes" in error for error in coexistence.validate_arbitration(data)))

    def test_wrong_owner_value_is_an_error(self):
        data = valid_arbitration()
        data["nodeOwners"]["DAELAB.Table"] = "canvas"
        errors = coexistence.validate_arbitration(data)
        self.assertTrue(any("DAELAB.Table" in error for error in errors))

    def test_incomplete_action_list_is_an_error(self):
        data = valid_arbitration()
        data["routePrefixes"]["POST /daelab/prompt-optimization/"]["allowedActions"].pop()
        self.assertTrue(any("allowedActions" in error for error in coexistence.validate_arbitration(data)))


class AuthorisationTests(unittest.TestCase):
    def test_authorized_packages_are_the_directory_names(self):
        arbitration = valid_arbitration()
        self.assertEqual(coexistence.authorized_legacy_packages(arbitration),
                         {"ComfyUI-DAELab-Custom-Nodes-Library"})

    def test_missing_allow_legacy_packages_means_nothing_authorized(self):
        self.assertEqual(coexistence.authorized_legacy_packages({}), set())


class ConditionalRegistrationTests(unittest.TestCase):
    def test_readonly_mapping_is_skipped_when_owned_by_cnl(self):
        mappings = {"DAELAB.ComfyTV.GPTImageStoryboardStage": object,
                    "DAELAB.LibTV.StoryboardBatch": object}
        filtered = coexistence.filter_readonly_mappings(mappings, valid_arbitration())
        self.assertEqual(set(filtered), {"DAELAB.LibTV.StoryboardBatch"})

    def test_readonly_mappings_are_untouched_without_arbitration(self):
        mappings = {"DAELAB.ComfyTV.GPTImageStoryboardStage": object,
                    "DAELAB.LibTV.StoryboardBatch": object}
        self.assertEqual(coexistence.filter_readonly_mappings(mappings, {}), mappings)


class ModuleClassificationTests(unittest.TestCase):
    def test_studio_module_is_classified_as_studio(self):
        self.assertEqual(coexistence.classify_module("ComfyUI-DAELab-Creative-Studio.compat.workflows.node_schemas"), "studio")

    def test_cnl_module_is_classified_as_cnl(self):
        self.assertEqual(coexistence.classify_module("ComfyUI-DAELab-Custom-Nodes-Library.nodes.daelab_comfytv_storyboard"), "cnl")

    def test_unrelated_module_is_unknown(self):
        self.assertEqual(coexistence.classify_module("some.other.package"), "unknown")

    def test_studio_full_path_module_is_classified_as_studio(self):
        self.assertEqual(coexistence.classify_module(
            r"B:\x\custom_nodes\ComfyUI-DAELab-Creative-Studio.backend.integrations.comfyui.business_nodes.approved_result"),
            "studio")

    def test_cnl_full_path_module_is_classified_as_cnl(self):
        self.assertEqual(coexistence.classify_module(
            r"B:\x\custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library.nodes.daelab_comfytv_storyboard.node"),
            "cnl")

    def test_posix_full_path_module_is_classified(self):
        self.assertEqual(coexistence.classify_module(
            "/x/custom_nodes/ComfyUI-DAELab-Custom-Nodes-Library.nodes.daelab_comfytv_storyboard.node"),
            "cnl")

    def test_repo_checkout_path_is_not_classified_as_studio(self):
        self.assertEqual(coexistence.classify_module(
            r"B:\GithubProject\ComfyUI-DAELab-Creative-Studio\.local\reviewer-gap-final-b4992bb"),
            "unknown")

    def test_repo_root_tools_path_is_not_classified(self):
        self.assertEqual(coexistence.classify_module(
            r"B:\GithubProject\ComfyUI-DAELab-Creative-Studio\.local\tools\build.mjs"),
            "unknown")

    def test_empty_module_name_is_unknown(self):
        self.assertEqual(coexistence.classify_module(""), "unknown")


class NodeOwnerSelfCheckTests(unittest.TestCase):
    def test_correct_owners_pass(self):
        modules = {
            "DAELAB.Table": "ComfyUI-DAELab-Creative-Studio.backend.x",
            "DAELAB.ScriptParser": "ComfyUI-DAELab-Creative-Studio.backend.x",
            "DAELAB.LLMStylePreviewB": "ComfyUI-DAELab-Creative-Studio.backend.x",
            "DAELAB.ComfyTV.GPTImageStoryboardStage": "ComfyUI-DAELab-Custom-Nodes-Library.nodes.x",
        }
        self.assertEqual(coexistence.check_node_owners(modules, valid_arbitration()), [])

    def test_cnl_owned_node_registered_by_studio_fails(self):
        modules = {
            "DAELAB.Table": "ComfyUI-DAELab-Creative-Studio.backend.x",
            "DAELAB.ScriptParser": "ComfyUI-DAELab-Creative-Studio.backend.x",
            "DAELAB.LLMStylePreviewB": "ComfyUI-DAELab-Creative-Studio.backend.x",
            "DAELAB.ComfyTV.GPTImageStoryboardStage": "ComfyUI-DAELab-Creative-Studio.compat.x",
        }
        errors = coexistence.check_node_owners(modules, valid_arbitration())
        self.assertEqual(len(errors), 1)
        self.assertIn("GPTImageStoryboardStage", errors[0])

    def test_missing_registration_fails(self):
        modules = {"DAELAB.Table": "ComfyUI-DAELab-Creative-Studio.backend.x"}
        errors = coexistence.check_node_owners(modules, valid_arbitration())
        self.assertTrue(any("not registered" in error for error in errors))


class RouteSelfCheckTests(unittest.TestCase):
    def test_exact_fourteen_named_actions_pass(self):
        routes = [("POST", "/daelab/prompt-optimization/" + action)
                  for action in coexistence.PROMPT_OPTIMIZATION_ACTIONS]
        self.assertEqual(coexistence.check_prompt_optimization_routes(routes, valid_arbitration()), [])

    def test_wildcard_action_fails(self):
        routes = [("POST", "/daelab/prompt-optimization/polish"),
                  ("POST", "/daelab/prompt-optimization/{action}")]
        errors = coexistence.check_prompt_optimization_routes(routes, valid_arbitration())
        self.assertTrue(any("wildcard" in error for error in errors))

    def test_missing_named_action_fails(self):
        routes = [("POST", "/daelab/prompt-optimization/" + action)
                  for action in coexistence.PROMPT_OPTIMIZATION_ACTIONS[:-1]]
        errors = coexistence.check_prompt_optimization_routes(routes, valid_arbitration())
        self.assertTrue(any("expected exactly one handler" in error for error in errors))


class ContestedRouteSelfCheckTests(unittest.TestCase):
    def _literal_routes(self):
        return [tuple(key.split(" ", 1)) for key in coexistence.CONTESTED_ROUTES]

    def test_each_literal_route_registered_once_passes(self):
        routes = self._literal_routes()
        self.assertEqual(coexistence.check_contested_routes(routes, valid_arbitration()), [])

    def test_duplicate_literal_route_fails(self):
        routes = self._literal_routes()
        routes.append(("POST", "/daelab/storyboard/parse-prompts"))
        errors = coexistence.check_contested_routes(routes, valid_arbitration())
        self.assertEqual(len(errors), 1)
        self.assertIn("parse-prompts", errors[0])

    def test_missing_literal_route_fails(self):
        routes = [tuple(key.split(" ", 1)) for key in coexistence.CONTESTED_ROUTES][:-1]
        errors = coexistence.check_contested_routes(routes, valid_arbitration())
        self.assertTrue(any("expected exactly one handler" in error for error in errors))


class ExtensionOwnerSelfCheckTests(unittest.TestCase):
    def test_correct_owners_pass(self):
        sources = {
            "DAELab.DataTable": "studio", "DAELab.ScriptParser": "studio",
            "DAELab.LLMStylePreview": "studio", "DAELab.PromptOptimization.Identity.v1": "studio",
        }
        self.assertEqual(coexistence.check_extension_owners(sources, valid_arbitration()), [])

    def test_duplicate_registration_fails(self):
        sources = {
            "DAELab.DataTable": "duplicate", "DAELab.ScriptParser": "studio",
            "DAELab.LLMStylePreview": "studio", "DAELab.PromptOptimization.Identity.v1": "studio",
        }
        errors = coexistence.check_extension_owners(sources, valid_arbitration())
        self.assertEqual(len(errors), 1)
        self.assertIn("DAELab.DataTable", errors[0])

    def test_missing_registration_fails(self):
        sources = {"DAELab.ScriptParser": "studio"}
        errors = coexistence.check_extension_owners(sources, valid_arbitration())
        self.assertTrue(any("not registered" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
