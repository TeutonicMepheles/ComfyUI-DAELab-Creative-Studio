"""Optional host boundaries without launching a host, model, child or socket."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import patch
import zipfile

from tools.host import prepare_optional_comfytv as optional


class OptionalComfyTVTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def guard(self):
        (self.root / 'logs').mkdir(exist_ok=True)
        (self.root / optional.MARKER).write_text('{}', encoding='utf-8')
        namespace = {'__file__': str(self.root / 'guarded-main.py')}
        # Load definitions only. Never install a process-wide hook in test discovery.
        exec(compile(optional.GUARD.split('sys.addaudithook(audit)')[0], '<guard>', 'exec'), namespace)
        return namespace['audit']

    def test_command_owns_all_data_and_has_exactly_two_packages(self):
        config = {'environment_root': str(self.root), 'source_host': str(self.root / 'host'),
                  'python': 'python.exe', 'port': 8227, 'fixture_package': None}
        command = optional.optional_command(config)
        start = command.index('--whitelist-custom-nodes') + 1
        self.assertEqual(command[start:command.index('--feature-flag')],
                         [optional.isolated.PACKAGE_NAME, 'ComfyTV'])
        self.assertEqual(command[:3], ['python.exe', '-B', '-s'])
        for flag, name in [('--base-directory', ''), ('--user-directory', 'user'),
                           ('--input-directory', 'input'), ('--output-directory', 'output'),
                           ('--temp-directory', 'temp')]:
            self.assertEqual(Path(command[command.index(flag) + 1]), self.root / name)
        self.assertIn('--cpu', command)
        self.assertIn('--offline', command)
        self.assertIn('--disable-all-custom-nodes', command)
        self.assertNotIn('--extra-model-paths-config', command)
        for changes in ({'fixture_package': 'unexpected'}, {'port': 8000}, {'port': 8226}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                optional.optional_command({**config, **changes})

    def test_guard_refuses_external_dns_and_protected_hosts_without_connections(self):
        audit = self.guard()
        for host, port in [('example.com', 443), ('8.8.8.8', 53), ('127.0.0.1', 8000),
                           ('::1', 8225), ('localhost', 8226), ('127.0.0.1', 11434)]:
            for event, args in [('socket.connect', (None, (host, port))),
                                ('socket.getaddrinfo', (host, port, 0, 0, 0))]:
                with self.subTest(event=event, host=host, port=port), self.assertRaises(PermissionError):
                    audit(event, args)
        audit('socket.connect', (None, ('127.0.0.1', 3210)))
        audit('socket.getaddrinfo', ('localhost', 8227, 0, 0, 0))
        records = [json.loads(line) for line in (self.root / 'logs/network-process-audit.jsonl').read_text().splitlines()]
        self.assertEqual(sum(row['blocked'] for row in records), 12)

    def test_guard_only_allows_reviewed_read_only_startup_child_commands(self):
        audit = self.guard()
        for command in (['rocm-sdk', 'path', '--root'], 'rocm-sdk path --root',
                        ['git', '-C', str(self.root / 'custom_nodes/ComfyTV'), 'ls-files', '-z', '--', 'workflows']):
            audit('subprocess.Popen', (None, command, None, None))
        for command in (['ollama', 'serve'], ['rocm-sdk', 'install'], ['python', '-c', 'print(1)'],
                        ['git', 'fetch', 'ls-files'], ['git', '-C', str(self.root), 'ls-files', '-z', '--', 'workflows']):
            with self.subTest(command=command), self.assertRaises(PermissionError):
                audit('subprocess.Popen', (None, command, None, None))

    def test_verified_source_requires_exact_clean_revision_and_regular_tree(self):
        def fake_git(root, *args):
            return {('rev-parse', '--show-toplevel'): str(self.root).encode(),
                    ('rev-parse', 'HEAD'): optional.COMFYTV_COMMIT.encode(),
                    ('status', '--porcelain'): b'',
                    ('ls-tree', '-rz', optional.COMFYTV_COMMIT): b'100644 blob abc\t__init__.py\0'}[args]
        with patch.object(optional, 'git', side_effect=fake_git):
            self.assertEqual(optional.verify_source(self.root), self.root)
        for key, value in [(('rev-parse', 'HEAD'), b'bad'), (('status', '--porcelain'), b' M changed.py'),
                           (('ls-tree', '-rz', optional.COMFYTV_COMMIT), b'120000 blob abc\tlink\0')]:
            with self.subTest(key=key), patch.object(optional, 'git', side_effect=lambda root, *args: value if args == key else fake_git(root, *args)):
                with self.assertRaises(ValueError):
                    optional.verify_source(self.root)

    def test_archive_checks_before_extraction_and_never_replaces_existing_files(self):
        archive = self.root / 'source.zip'
        with zipfile.ZipFile(archive, 'w') as zipped:
            zipped.writestr('__init__.py', b'NODE_CLASS_MAPPINGS = {}\n')
            zipped.writestr('web/entry.js', b'export const synthetic = true;\n')
        records = optional.archive_members(archive)
        destination = self.root / 'copy'
        optional.extract_new(archive, destination, records)
        for record in records:
            self.assertEqual(hashlib.sha256((destination / record['path']).read_bytes()).hexdigest(), record['sha256'])
        with self.assertRaises(ValueError):
            optional.extract_new(archive, destination, records)
        with zipfile.ZipFile(archive, 'w') as zipped:
            zipped.writestr('__init__.py', b'')
            zipped.writestr('../outside.py', b'')
        with self.assertRaises(ValueError):
            optional.archive_members(archive)
        self.assertFalse((self.root.parent / 'outside.py').exists())

    def test_existing_or_outside_environment_is_rejected_before_preparation(self):
        runtime = self.root / 'runtime.json'
        runtime.write_text('{}', encoding='utf-8')
        with patch.object(optional, 'verify_source', return_value=self.root), patch.object(optional.isolated, 'prepare') as prepare:
            for environment in (self.root, self.root.parent / 'new-optional-host'):
                with self.subTest(environment=environment), self.assertRaises(ValueError):
                    optional.prepare(runtime, self.root, environment)
            prepare.assert_not_called()

    def test_preparation_records_exact_written_guard_and_archived_source_bytes(self):
        package, host, source = (self.root / name for name in ('package', 'host', 'upstream'))
        for path in (package / 'web', host, source):
            path.mkdir(parents=True)
        (package / '__init__.py').write_text('NODE_CLASS_MAPPINGS = {}\n')
        (package / 'web/build-manifest.json').write_text('{"sourceFingerprint":"synthetic-build"}')
        for name in ('main.py', 'folder_paths.py'):
            (host / name).write_text('')
        runtime = self.root / 'runtime.json'
        runtime.write_text(json.dumps({'host': {'root': str(host), 'gitHead': optional.HOST_COMMIT,
                                                'python': sys.executable}}))
        environment = package / '.local/optional'

        def archive(command, *, stdout, **kwargs):
            self.assertEqual(command, ['git', '-C', str(source), 'archive', '--format=zip', optional.COMFYTV_COMMIT])
            with zipfile.ZipFile(stdout, 'w') as zipped:
                zipped.writestr('__init__.py', b'# fixed synthetic archive\n')

        with patch.object(optional, 'ROOT', package), patch.object(optional, 'verify_source', return_value=source), \
             patch.object(optional, 'git', side_effect=lambda root, *args: optional.HOST_COMMIT.encode() if args == ('rev-parse', 'HEAD') else b''), \
             patch.object(optional.subprocess, 'run', side_effect=archive), \
             patch.object(optional.isolated, 'port_free', return_value=True):
            manifest = optional.prepare(runtime, source, environment)
        self.assertEqual(manifest['guardSha256'], hashlib.sha256((environment / 'guarded-main.py').read_bytes()).hexdigest())
        self.assertEqual(manifest['frontendBuildId'], 'synthetic-build')
        self.assertEqual((environment / 'custom_nodes/ComfyTV/__init__.py').read_bytes(), b'# fixed synthetic archive\n')
        self.assertEqual(list(source.iterdir()), [])
        self.assertNotIn('pid', manifest)


if __name__ == '__main__':
    unittest.main()
