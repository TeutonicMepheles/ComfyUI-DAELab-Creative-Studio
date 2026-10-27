"""Boundary tests for isolation: no production paths, startup or data overwrite."""
import importlib.util
import json
from pathlib import Path
import socket
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("prepare_isolated", Path(__file__).resolve().parents[2] / "tools/host/prepare_isolated.py")
HOST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOST)


class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.host = self.root / "host-source"
        self.package = self.root / "package"
        self.environment = self.root / "isolated"
        self.host.mkdir()
        self.package.mkdir()
        for name in ("main.py", "folder_paths.py"):
            (self.host / name).write_text("", encoding="utf-8")
        (self.package / "__init__.py").write_text("NODE_CLASS_MAPPINGS = {}\n", encoding="utf-8")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]

    def tearDown(self):
        self.temp.cleanup()

    def config(self, **overrides):
        values = dict(source_host=str(self.host), python=sys.executable,
                      environment_root=str(self.environment), package_root=str(self.package), port=self.port)
        values.update(overrides)
        return HOST.resolve_configuration(**values)

    def test_production_port_and_existing_user_data_are_rejected_without_changes(self):
        with self.assertRaises(HOST.IsolationError):
            self.config(port=8000)
        self.environment.mkdir()
        sentinel = self.environment / "valuable-workflow.json"
        sentinel.write_text('{"original":true}', encoding="utf-8")
        with self.assertRaises(HOST.IsolationError):
            self.config()
        self.assertEqual(sentinel.read_text(), '{"original":true}')
        self.assertEqual(list(self.environment.iterdir()), [sentinel])

    def test_source_and_data_paths_are_rejected(self):
        for path in (self.host / "new", self.package, self.root, self.root / "user" / "acceptance"):
            with self.subTest(path=path), self.assertRaises(HOST.IsolationError):
                self.config(environment_root=str(path))

    def test_busy_port_does_not_start_or_prepare(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", self.port))
            listener.listen()
            with self.assertRaises(HOST.IsolationError):
                self.config()
        self.assertFalse(self.environment.exists())

    def test_implicit_source_host_extra_paths_cannot_escape_the_isolated_whitelist(self):
        (self.host / "extra_model_paths.yaml").write_text("production:\n  custom_nodes: /existing/custom_nodes\n")
        with self.assertRaisesRegex(HOST.IsolationError, "implicit extra_model_paths"):
            self.config()
        self.assertFalse(self.environment.exists())

    def test_snapshot_excludes_private_data_and_isolates_all_writable_paths(self):
        (self.package / "dev").mkdir()
        (self.package / "dev" / "preview.mjs").write_text("throw Error('dev only')")
        (self.package / ".local").mkdir()
        (self.package / ".local" / "private.txt").write_text("private")
        manifest = HOST.prepare(self.config())
        copied = self.environment / "custom_nodes" / HOST.PACKAGE_NAME
        self.assertFalse((copied / ".local").exists())
        self.assertFalse((copied / "dev").exists())
        self.assertTrue((copied / "__init__.py").is_file())
        command = manifest["command"]
        for flag, name in (("--base-directory", ""), ("--user-directory", "user"),
                           ("--input-directory", "input"), ("--output-directory", "output"),
                           ("--temp-directory", "temp")):
            self.assertEqual(Path(command[command.index(flag) + 1]), self.environment / name)
        for flag in ("--cpu", "--offline", "--disable-all-custom-nodes"):
            self.assertIn(flag, command)
        self.assertNotIn("--models-directory", command)
        self.assertNotIn("--extra-model-paths-config", command)
        self.assertNotIn("--enable-manager", command)

    def test_credentials_database_and_raw_media_never_enter_runtime_snapshot(self):
        private = [".env", ".env.local", ".env.example", "credentials.json", "client_secret-test.json",
                   "auth.json", "token.json", "private.key", "local.sqlite", "local.sqlite-wal",
                   "local.db-shm", "private.png", "output.mp4", "weights.gguf"]
        for name in private:
            (self.package / name).write_text("synthetic sensitive fixture; not a real credential")
        for name in ("user", "input", "output", "temp", "models", "evidence"):
            (self.package / name).mkdir()
            (self.package / name / "private.json").write_text('{"private":true}')
        manifest = HOST.prepare(self.config())
        copied = self.environment / "custom_nodes" / HOST.PACKAGE_NAME
        self.assertEqual([entry["path"] for entry in manifest["package_snapshot"]["files"]], ["__init__.py"])
        self.assertEqual(sorted(p.name for p in copied.iterdir()), ["__init__.py"])

    def test_repeat_preserves_workflow_and_refresh_requires_explicit_flag(self):
        HOST.prepare(self.config())
        workflow = self.environment / "user" / "test.json"
        workflow.write_text('{"id":"keep"}')
        HOST.prepare(self.config())
        (self.package / "__init__.py").write_text("NODE_CLASS_MAPPINGS = {}\nVERSION=2\n")
        with self.assertRaises(HOST.IsolationError):
            HOST.prepare(self.config())
        manifest = HOST.prepare(self.config(), refresh_package=True)
        self.assertEqual(workflow.read_text(), '{"id":"keep"}')
        self.assertEqual(manifest["package_snapshot"]["files"][0]["path"], "__init__.py")

    def test_manifest_cannot_adopt_another_environment(self):
        HOST.prepare(self.config())
        marker = self.environment / HOST.MARKER
        manifest = json.loads(marker.read_text())
        manifest["package_root"] = str(self.root / "other")
        marker.write_text(json.dumps(manifest))
        with self.assertRaises(HOST.IsolationError):
            self.config()

    def test_test_fixture_requires_explicit_path_and_is_recorded_separately(self):
        fixture = self.root / "test-fixture"
        fixture.mkdir()
        (fixture / "__init__.py").write_text("NODE_CLASS_MAPPINGS = {'Acceptance.Test': object}\n")
        manifest = HOST.prepare(self.config(fixture_package=str(fixture)))
        self.assertIn(HOST.FIXTURE_NAME, manifest["command"])
        self.assertIsNotNone(manifest["fixture_snapshot"])
        self.assertTrue((self.environment / "custom_nodes" / HOST.FIXTURE_NAME / "__init__.py").is_file())


if __name__ == "__main__":
    unittest.main()
