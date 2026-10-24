"""Old-baseline harness boundary checks; no ComfyUI/model process is launched."""
import importlib.util
import hashlib
import json
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from tools.performance.prepare_observer import prepare_package as prepare_observer

SPEC = importlib.util.spec_from_file_location("prepare_baseline", Path(__file__).resolve().parents[2] / "tools/host/prepare_baseline.py")
BASELINE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASELINE)


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.DEVNULL).decode().strip()


class BaselineIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="studio-baseline-test-")
        self.root = Path(self.temp.name)
        self.host = self.root / "host"
        self.host.mkdir()
        self.pinned = {}
        self.sources = {}
        for label, (name, _) in BASELINE.PINNED.items():
            repo = self.root / name
            repo.mkdir()
            (repo / "__init__.py").write_text("NODE_CLASS_MAPPINGS = {}\n")
            (repo / "web").mkdir()
            (repo / "web/shared.mjs").write_text("export const source = 'fixed';\n")
            git(repo, "init", "-b", "main")
            git(repo, "add", ".")
            git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "synthetic baseline")
            git(repo, "remote", "add", "origin", f"https://github.com/TeutonicMepheles/{name}.git")
            commit = git(repo, "rev-parse", "HEAD")
            self.pinned[label] = (name, commit)
            self.sources[label] = {"path": str(repo), "commit": commit}
        for name in ["main.py", "folder_paths.py"]:
            (self.host / name).write_text("# synthetic host fixture\n")
        git(self.host, "init", "-b", "main")
        git(self.host, "add", ".")
        git(self.host, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "synthetic host")
        self.host_commit = git(self.host, "rev-parse", "HEAD")
        self.runtime = self.root / "runtime.json"
        self.runtime.write_text(json.dumps({"host": {"root": str(self.host), "python": sys.executable, "gitHead": self.host_commit}, "sourceBaselines": self.sources}))
        self.environment = self.root / "isolated-old"
        self.archive = self.root / "baseline-archives"
        # Windows can allocate a low ephemeral port; never select a protected
        # application port as the otherwise-valid synthetic fixture default.
        while True:
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                self.port = listener.getsockname()[1]
            if 1024 <= self.port <= 65535 and self.port not in BASELINE.PROTECTED_PORTS:
                break
        self.patch_pinned = patch.object(BASELINE, "PINNED", self.pinned)
        self.patch_host = patch.object(BASELINE, "HOST_COMMIT", self.host_commit)
        self.patch_pinned.start();self.patch_host.start()

    def tearDown(self):
        self.patch_pinned.stop();self.patch_host.stop()
        self.temp.cleanup()

    def config(self, **overrides):
        arguments = dict(runtime_file=self.runtime, environment_root=self.environment, archive_root=self.archive, port=self.port)
        arguments.update(overrides)
        return BASELINE.resolve_configuration(**arguments)

    def observer(self):
        package = self.root / "passive-observer"
        prepare_observer(package)
        return package

    def test_explicit_observer_adds_only_passive_web_to_new_baseline(self):
        package = self.observer()
        with patch.object(BASELINE.subprocess, "Popen", wraps=subprocess.Popen) as processes:
            manifest = BASELINE.prepare(self.config(), package)
            # Git archive/read processes are expected; no ComfyUI process may start.
            self.assertTrue(all(call.args[0][0] == "git" for call in processes.call_args_list))
        self.assertEqual(manifest["observer"]["nodeRegistrations"], 0)
        self.assertEqual(len(manifest["snapshots"]), 2)
        copied = self.environment / "custom_nodes" / BASELINE.OBSERVER_NAME
        self.assertEqual((copied / "__init__.py").read_bytes(), BASELINE.OBSERVER_ENTRY)
        self.assertEqual((copied / "web/performance.js").read_bytes(), (package / "web/performance.js").read_bytes())
        self.assertIn(BASELINE.OBSERVER_NAME, manifest["command"])
        self.assertNotIn("observer", json.loads((self.environment / "prepared.json").read_text()))
        self.assertEqual(BASELINE.prepare(self.config()), manifest)

    def test_add_observer_to_stopped_existing_baseline_preserves_archives_and_user_data(self):
        first = BASELINE.prepare(self.config())
        prepared = (self.environment / "prepared.json").read_bytes()
        ownership = (self.environment / BASELINE.MARKER).read_bytes()
        archives = {entry["archive"]: Path(entry["archive"]).read_bytes() for entry in first["snapshots"]}
        for name in ("user", "input", "output", "temp"):
            (self.environment / name / "sentinel.txt").write_text("original " + name)
        second = BASELINE.prepare(self.config(), self.observer())
        self.assertEqual((self.environment / "prepared.json").read_bytes(), prepared)
        self.assertEqual((self.environment / BASELINE.MARKER).read_bytes(), ownership)
        self.assertEqual(first["snapshots"], second["snapshots"])
        for name in ("user", "input", "output", "temp"):
            self.assertEqual((self.environment / name / "sentinel.txt").read_text(), "original " + name)
        for name, content in archives.items(): self.assertEqual(Path(name).read_bytes(), content)
        self.assertEqual(BASELINE.prepare(self.config(), self.root / "passive-observer"), second)
        copied = self.environment / "custom_nodes" / BASELINE.OBSERVER_NAME / "web/performance.js"
        copied.write_text("tampered")
        with self.assertRaises(BASELINE.BaselineError): BASELINE.prepare(self.config())
        self.assertEqual(copied.read_text(), "tampered")

    def test_observer_rejects_active_python_extra_files_and_unreviewed_javascript(self):
        package = self.observer()
        original = (package / "__init__.py").read_bytes()
        (package / "__init__.py").write_bytes(original + b"import os\n")
        with self.assertRaises(BASELINE.BaselineError): BASELINE.prepare(self.config(), package)
        self.assertFalse(self.environment.exists())
        (package / "__init__.py").write_bytes(original)
        extra = package / "provider.py"; extra.write_text("# forbidden fixture execution closure")
        with self.assertRaises(BASELINE.BaselineError): BASELINE.prepare(self.config(), package)
        extra.unlink()
        extra_directory = package / "unexpected"; extra_directory.mkdir()
        with self.assertRaises(BASELINE.BaselineError): BASELINE.prepare(self.config(), package)
        extra_directory.rmdir()
        script = package / "web/performance.js"; script.write_text("export const unexpected = true;")
        marker = json.loads((package / "observer-package.json").read_text())
        marker["sourceSha256"] = hashlib.sha256(script.read_bytes()).hexdigest()
        (package / "observer-package.json").write_text(json.dumps(marker))
        with self.assertRaises(BASELINE.BaselineError): BASELINE.prepare(self.config(), package)
        self.assertFalse(self.environment.exists())

    def test_observer_refuses_busy_host_and_unowned_destination_without_changes(self):
        BASELINE.prepare(self.config())
        package = self.observer()
        config = self.config()
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", self.port)); listener.listen()
            with self.assertRaises(BASELINE.BaselineError): BASELINE.prepare(config, package)
        destination = self.environment / "custom_nodes" / BASELINE.OBSERVER_NAME
        self.assertFalse(destination.exists())
        destination.mkdir(); (destination / "keep.txt").write_text("untouched")
        with self.assertRaises(BASELINE.BaselineError): BASELINE.prepare(self.config(), package)
        self.assertEqual((destination / "keep.txt").read_text(), "untouched")
        self.assertFalse((self.environment / BASELINE.OBSERVER_RECORD).exists())

    def test_protected_ports_overlap_unowned_data_and_busy_port_are_rejected(self):
        for port in [8000, 8224, 8226]:
            with self.assertRaises(BASELINE.BaselineError): self.config(port=port)
        for destination in [self.host, Path(self.sources["canvas"]["path"]) / "nested", self.root, self.root / "user/old"]:
            with self.assertRaises(BASELINE.BaselineError): self.config(environment_root=destination)
        self.environment.mkdir()
        sentinel = self.environment / "user-original.json"
        sentinel.write_text("preserve")
        with self.assertRaises(BASELINE.BaselineError): self.config()
        self.assertEqual(sentinel.read_text(), "preserve")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", self.port));listener.listen()
            with self.assertRaises(BASELINE.BaselineError): self.config(environment_root=self.root / "another")

    def test_fixed_archives_ignore_worktree_edits_and_never_copy_user_workflows(self):
        source = Path(self.sources["canvas"]["path"])
        (source / "__init__.py").write_text("user uncommitted modifications")
        (source / "user-secret.json").write_text("untracked")
        manifest = BASELINE.prepare(self.config())
        copied = self.environment / "custom_nodes" / self.pinned["canvas"][0]
        self.assertEqual((copied / "__init__.py").read_text(), "NODE_CLASS_MAPPINGS = {}\n")
        self.assertFalse((copied / "user-secret.json").exists())
        self.assertEqual(list((self.environment / "user").iterdir()), [])
        self.assertEqual(manifest["workflow_imports"], 0)
        self.assertEqual(len(manifest["snapshots"]), 2)
        self.assertEqual((source / "__init__.py").read_text(), "user uncommitted modifications")

    def test_reuse_verifies_exact_snapshot_and_preserves_existing_user_data(self):
        first = BASELINE.prepare(self.config())
        sentinel = self.environment / "user/keep.json"
        sentinel.write_text("preserve")
        second = BASELINE.prepare(self.config())
        self.assertEqual(first, second)
        self.assertEqual(sentinel.read_text(), "preserve")
        copied = self.environment / "custom_nodes" / self.pinned["canvas"][0] / "__init__.py"
        copied.write_text("tampered")
        with self.assertRaises(BASELINE.BaselineError): BASELINE.prepare(self.config())
        self.assertEqual(copied.read_text(), "tampered")

    def test_wrong_commit_remote_host_changes_and_global_model_paths_fail_closed(self):
        original = json.loads(self.runtime.read_text())
        changed = json.loads(json.dumps(original));changed["sourceBaselines"]["canvas"]["commit"] = "0" * 40
        self.runtime.write_text(json.dumps(changed))
        with self.assertRaises(BASELINE.BaselineError): self.config()
        self.runtime.write_text(json.dumps(original))
        source = Path(self.sources["canvas"]["path"])
        git(source, "remote", "set-url", "origin", "https://github.com/another-owner/repo.git")
        with self.assertRaises(BASELINE.BaselineError): self.config()
        git(source, "remote", "set-url", "origin", f"https://github.com/TeutonicMepheles/{self.pinned['canvas'][0]}.git")
        (self.host / "main.py").write_text("changed host")
        with self.assertRaises(BASELINE.BaselineError): self.config()
        (self.host / "main.py").write_text("# synthetic host fixture\n")
        (self.host / "extra_model_paths.yaml").write_text("production-models")
        with self.assertRaises(BASELINE.BaselineError): self.config()

    def test_archive_traversal_absolute_case_collision_and_symlink_rejected_before_extract(self):
        for index, names in enumerate([["../outside"], ["C:/outside"], ["/absolute"], ["folder\\file"], ["same", "SAME"], ["folder/./file"], ["folder//file"], ["folder/.. /outside"], ["NUL.txt"]]):
            archive = self.root / f"unsafe-{index}.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("__init__.py", "")
                for name in names: zipped.writestr(name, "bad")
            if names == ["folder\\file"]:
                # Windows ZipInfo normalizes backslashes while writing. Patch both
                # directory/header names to exercise an actual foreign malformed ZIP.
                archive.write_bytes(archive.read_bytes().replace(b"folder/file", b"folder\\file"))
            with self.assertRaises(BASELINE.BaselineError): BASELINE.archive_members(archive)
        archive = self.root / "symlink.zip"
        link = zipfile.ZipInfo("symlink")
        link.create_system = 3;link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("__init__.py", "");zipped.writestr(link, "../../outside")
        with self.assertRaises(BASELINE.BaselineError): BASELINE.archive_members(archive)
        self.assertFalse((self.root / "outside").exists())

    def test_command_has_only_old_whitelist_cpu_offline_and_isolated_writes(self):
        command = BASELINE.command_for(self.config())
        for flag, child in [("--base-directory", ""), ("--user-directory", "user"), ("--input-directory", "input"), ("--output-directory", "output"), ("--temp-directory", "temp")]:
            self.assertEqual(Path(command[command.index(flag)+1]), self.environment / child)
        start, end = command.index("--whitelist-custom-nodes")+1, command.index("--feature-flag")
        self.assertEqual(command[start:end], [entry[0] for entry in self.pinned.values()])
        for flag in ["--cpu", "--offline", "--disable-auto-launch", "--disable-all-custom-nodes"]:self.assertIn(flag, command)
        for flag in ["--extra-model-paths-config", "--models-directory", "--enable-manager"]:self.assertNotIn(flag, command)
        self.assertNotIn("ComfyTV", command)

    def test_configuration_and_command_mutations_are_revalidated(self):
        config = self.config();config["port"] = 8000
        with self.assertRaises(BASELINE.BaselineError):BASELINE.prepare(config)
        self.assertFalse(self.environment.exists())
        manifest = BASELINE.prepare(self.config())
        manifest["command"].append("--auto-launch")
        with self.assertRaises(BASELINE.BaselineError):BASELINE.start(manifest, timeout=0)

    def test_no_overwrite_of_incomplete_owned_fixture_or_existing_extraction(self):
        config = self.config()
        self.environment.mkdir()
        (self.environment / BASELINE.MARKER).write_text(json.dumps(config))
        with self.assertRaises(BASELINE.BaselineError):BASELINE.prepare(config)
        archive = self.root / "valid.zip"
        with zipfile.ZipFile(archive, "w") as zipped:zipped.writestr("__init__.py", "original")
        destination = self.root / "existing-package";destination.mkdir()
        (destination / "__init__.py").write_text("keep")
        with self.assertRaises(BASELINE.BaselineError):BASELINE.extract_new(archive, destination, BASELINE.archive_members(archive))
        self.assertEqual((destination / "__init__.py").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
