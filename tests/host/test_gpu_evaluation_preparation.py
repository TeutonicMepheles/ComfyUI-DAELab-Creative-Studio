"""Preparation must preserve all sources and never execute a host or model."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools.host import prepare_gpu_evaluation as gpu


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.DEVNULL).decode().strip()


class GPUPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="studio-gpu-preparation-")
        self.root = Path(self.temp.name)
        self.sources, self.pinned = {}, {}
        for name in ("host", "canvas", "business", "ggufPlugin", "studio"):
            repo = self.root / name
            repo.mkdir()
            (repo / "__init__.py").write_text("raise AssertionError('Preparation must never import the snapshot')\n")
            (repo / "main.py").write_text("raise AssertionError('Preparation must never launch a host')\n")
            (repo / "web").mkdir()
            (repo / "web/build-manifest.json").write_text(json.dumps({"sourceFingerprint": "a" * 64, "files": [{"path": "index.js"}]}))
            git(repo, "init", "-b", "main")
            git(repo, "add", ".")
            git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Synthetic snapshot")
            self.sources[name] = {"path": str(repo), "commit": git(repo, "rev-parse", "HEAD")}
            if name in gpu.PINNED_SOURCES:
                self.pinned[name] = self.sources[name]["commit"]
        self.studio = self.root / "studio"
        self.model_root = self.root / "weights"
        files = [
            "diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors",
            "text_encoders/Qwen-Image-2.1-Turbo-Abliterated-Uncensored-Q8_0.gguf",
            "text_encoders/mmproj-Qwen-Image-2.1-Turbo-Abliterated-Uncensored-F16.gguf",
            "vae/qwen_image_2.1_vae_bf16.safetensors",
            "diffusion_models/MiniMax-H3_FL2VA-NVFP4.safetensors",
            "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
            "vae/minimax_h3_video_vae_fp16.safetensors", "vae/minimax_h3_audio_vae_fp32.safetensors",
        ]
        weights = []
        for relative in files:
            file = self.model_root / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"synthetic not weights")
            weights.append({"path": relative, "bytes": file.stat().st_size, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
        self.runtime = self.root / "runtime.json"
        self.runtime.write_text(json.dumps({"host": {"root": str(self.root / "host"), "python": sys.executable,
            "gitHead": self.sources["host"]["commit"]}, "sourceBaselines": self.sources,
            "weightRoot": str(self.model_root), "weights": weights, "ollama": {"running": False}}))
        self.destination = self.studio / ".local/evaluation"
        self.pin_patch = patch.object(gpu, "PINNED_SOURCES", self.pinned)
        self.pin_patch.start()

    def tearDown(self):
        self.pin_patch.stop()
        self.temp.cleanup()

    def plan(self, **changes):
        args = dict(runtime_file=self.runtime, studio_repository=self.studio, studio_commit=self.sources["studio"]["commit"],
                    destination=self.destination, old_port=8260, new_port=8261)
        args.update(changes)
        return gpu.plan(**args)

    def test_archives_exact_commits_with_distinct_directories_and_no_cache(self):
        canvas = Path(self.sources["canvas"]["path"])
        (canvas / "__init__.py").write_text("uncommitted user work")
        config = self.plan()
        outputs = gpu.prepare(config)
        self.assertFalse(config["activationAllowed"])
        self.assertFalse(config["modelsRehashedAtPreparation"])
        self.assertEqual((canvas / "__init__.py").read_text(), "uncommitted user work")
        for variant, output in outputs.items():
            self.assertFalse(output["activationAllowed"])
            self.assertEqual(output["samplerExecutions"], 0)
            self.assertIn("--cache-none", output["command"])
            self.assertNotIn("--cpu", output["command"])
            self.assertEqual(output["command"][output["command"].index("--port")+1], str(config["ports"][variant]))
            self.assertTrue((Path(output["root"]) / "fixed-model-paths.yaml").is_file())
        copied = Path(outputs["baseline"]["root"]) / "custom_nodes/canvas/__init__.py"
        self.assertIn("Preparation must never import", copied.read_text())
        with self.assertRaises(ValueError):
            gpu.prepare(config)

    def test_rejects_production_ports_foreign_paths_and_moving_commit_aliases(self):
        for changes in ({"old_port": 8000}, {"new_port": 8260}, {"destination": self.root / "outside"}, {"studio_commit": "HEAD"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.plan(**changes)
        self.assertFalse(self.destination.exists())

    def test_config_tampering_or_model_size_change_cannot_prepare(self):
        config = self.plan()
        tampered = copy.deepcopy(config)
        tampered["activationAllowed"] = True
        with self.assertRaises(ValueError):
            gpu.prepare(tampered)
        self.assertFalse(self.destination.exists())
        model = next(self.model_root.rglob("*.gguf"))
        model.write_bytes(b"different")
        with self.assertRaises(ValueError):
            gpu.prepare(config)
        self.assertFalse(self.destination.exists())

    def test_dirty_fixed_host_is_rejected_before_creating_output(self):
        (self.root / "host/main.py").write_text("changed host")
        with self.assertRaises(ValueError):
            self.plan()
        self.assertFalse(self.destination.exists())


if __name__ == "__main__":
    unittest.main()
