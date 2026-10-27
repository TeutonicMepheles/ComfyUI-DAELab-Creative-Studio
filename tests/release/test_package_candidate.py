"""Synthetic committed trees, real ZIP extraction and metadata-only wheel checks."""
from copy import deepcopy
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest
import zipfile

from tools.release.package_candidate import (
    ROOT, PACKAGE, LICENSES, FONT_MANIFEST, FONT_NAMES, candidate_bytes, collect,
    committed_files, digest, safe_path, write_candidate,
)


REVISION = 'a' * 40


def put_manifest(files):
    files['web/build-manifest.json'] = json.dumps({
        'version': '0.1.0-dev.0', 'sourceFingerprint': 'b' * 64,
        'files': [{'path': name[4:], 'sha256': digest(raw)} for name, raw in sorted(files.items())
                  if name.startswith('web/') and name != 'web/build-manifest.json'],
    }).encode()


def synthetic_tree():
    files = {
        '__init__.py': b'# synthetic Comfy directory entry\n',
        'pyproject.toml': (ROOT / 'pyproject.toml').read_bytes(),
        'requirements.txt': (ROOT / 'requirements.txt').read_bytes(),
        'package.json': json.dumps({'version': '0.1.0-dev.0', 'private': True}).encode(),
        'README.md': b'Synthetic candidate, not install acceptance.',
        'backend/integrations/comfyui/bootstrap.py': b'# synthetic backend entry\n',
        'compat/workflows/reader.py': b'# synthetic read-only compatibility\n',
        'tools/migration/__main__.py': b'# synthetic migration entry\n',
        'docs/migration.md': b'Synthetic migration instructions.',
        'web/integrations/comfyui/index.js': (
            "export const STUDIO_VERSION = '0.1.0-dev.0';\n"
            "export const FRONTEND_BUILD_ID = '" + 'b' * 64 + "';\n").encode(),
    }
    for license in LICENSES:
        files[license] = b'Synthetic test notice; not a real resource license.'
    fonts = []
    for name in sorted(FONT_NAMES):
        raw = ('synthetic font bytes:' + name).encode()
        files[str(Path(FONT_MANIFEST).parent.as_posix()) + '/' + name] = raw
        fonts.append({'file': name, 'bytes': len(raw), 'sha256': digest(raw)})
    files[FONT_MANIFEST] = json.dumps(fonts).encode()
    put_manifest(files)
    return files


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.PIPE)


def make_commit(root, files):
    git(root, 'init', '-q')
    git(root, 'config', 'core.autocrlf', 'false')
    git(root, 'config', 'core.hooksPath', str(root / 'no-hooks'))
    git(root, 'config', 'user.name', 'Synthetic Candidate Test')
    git(root, 'config', 'user.email', 'synthetic@example.invalid')
    for name, raw in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    git(root, 'add', '--all')
    git(root, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Synthetic package fixture')
    return git(root, 'rev-parse', 'HEAD').decode().strip()


class CandidateContractTests(unittest.TestCase):
    def test_real_zip_extracts_exact_runtime_allowlist_and_preserves_every_hash(self):
        files = synthetic_tree()
        extras = {'dev/table/preview.mjs', 'frontend/src/secret.js', 'node_modules/package/index.js', 'tests/fixture.py',
                  '.local/session.json', 'backend/.local/session.py', 'backend/tests/fixture.py',
                  'tools/migration/legacy_probe/__init__.py', 'tools/migration/legacy_probe/probe.py',
                  'tools/migration/prepare_e5.py',
                  'docs/credentials.json', 'docs/secrets.json', 'docs/.env', 'backend/weight.safetensors'}
        files.update({name: b'SYNTHETIC-EXCLUDED-DATA' for name in extras})
        raw, manifest = candidate_bytes(files, REVISION)
        self.assertFalse(manifest['releaseAllowed'])
        self.assertEqual(manifest['revision'], REVISION)
        with tempfile.TemporaryDirectory() as temporary, zipfile.ZipFile(io.BytesIO(raw)) as archive:
            archive.extractall(temporary)
            self.assertEqual(archive.testzip(), None)
            selected = {row['path'] for row in manifest['files']}
            self.assertFalse(selected & extras)
            self.assertTrue(LICENSES <= selected)
            self.assertEqual(set(archive.namelist()), {PACKAGE + '/' + name for name in selected | {'release-candidate.json'}})
            for row in manifest['files']:
                data = (Path(temporary) / PACKAGE / row['path']).read_bytes()
                self.assertEqual((len(data), digest(data)), (row['bytes'], row['sha256']))
            self.assertEqual(json.loads((Path(temporary) / PACKAGE / 'release-candidate.json').read_bytes()), manifest)

    def test_archive_is_byte_deterministic_independent_of_dictionary_order(self):
        files = synthetic_tree()
        raw, record = candidate_bytes(files, REVISION)
        again, same = candidate_bytes(dict(reversed(list(files.items()))), REVISION)
        self.assertEqual(raw, again)
        self.assertEqual(record, same)

    def test_missing_changed_duplicate_and_unmanifested_web_files_are_rejected(self):
        for alteration in ('missing', 'changed', 'duplicate', 'unmanifested'):
            with self.subTest(alteration=alteration):
                files = synthetic_tree()
                name = 'web/integrations/comfyui/index.js'
                if alteration == 'missing':
                    files.pop(name)
                elif alteration == 'changed':
                    files[name] += b'\nchanged'
                elif alteration == 'duplicate':
                    manifest = json.loads(files['web/build-manifest.json'])
                    manifest['files'].append(manifest['files'][0])
                    files['web/build-manifest.json'] = json.dumps(manifest).encode()
                else:
                    files['web/unmanifested.js'] = b'not built'
                with self.assertRaises(ValueError):
                    collect(files)

    def test_versions_embedded_identity_and_dependencies_cannot_diverge(self):
        alterations = {
            'python-version': lambda f: f.__setitem__('pyproject.toml', f['pyproject.toml'].replace(b'0.1.0.dev0', b'0.1.1.dev0')),
            'requirements': lambda f: f.__setitem__('requirements.txt', f['requirements.txt'] + b'UnexpectedRuntimeDependency==1\n'),
            'index-version': lambda f: f.__setitem__('web/integrations/comfyui/index.js', f['web/integrations/comfyui/index.js'].replace(b'0.1.0-dev.0', b'0.1.1-dev.0')),
            'index-fingerprint': lambda f: f.__setitem__('web/integrations/comfyui/index.js', f['web/integrations/comfyui/index.js'].replace(b'b' * 64, b'c' * 64)),
            'auto-discovery': lambda f: f.__setitem__('pyproject.toml', f['pyproject.toml'].replace(b'packages = []', b'packages = ["backend"]')),
        }
        for key, alter in alterations.items():
            with self.subTest(case=key):
                files = synthetic_tree()
                alter(files)
                put_manifest(files)  # Hash consistency cannot hide the wrong product identity.
                with self.assertRaises(ValueError):
                    collect(files)

    def test_removed_license_or_font_still_fails_after_updating_web_manifest(self):
        for missing in [*LICENSES, 'web/design/vendor/alibaba-puhuiti-3/' + sorted(FONT_NAMES)[0]]:
            files = synthetic_tree()
            files.pop(missing)
            put_manifest(files)
            with self.assertRaises(ValueError):
                collect(files)
        files = synthetic_tree()
        name = 'web/design/vendor/alibaba-puhuiti-3/' + sorted(FONT_NAMES)[0]
        files[name] = b'changed font bytes'
        put_manifest(files)
        with self.assertRaises(ValueError):
            collect(files)

    def test_portable_paths_case_collisions_and_forbidden_web_payloads_are_rejected(self):
        for value in (None, '', '../escape', '/absolute', 'a/../b', 'a//b', 'C:/drive', 'a\\b',
                      'a/CON.txt', 'a/file.', 'a/file ', 'a/file:stream', 'a/\x00file'):
            with self.subTest(path=value), self.assertRaises(ValueError):
                safe_path(value)
        for name in ('web/design/../escape.js', 'web/tests/helper.js', 'web/model.gguf', 'web/.env',
                     'web/Design/other.svg'):
            with self.subTest(path=name):
                files = synthetic_tree()
                files[name] = b'excluded'
                put_manifest(files)
                with self.assertRaises(ValueError):
                    collect(files)


class CommittedTreeTests(unittest.TestCase):
    def test_archive_uses_exact_commit_and_never_current_worktree_or_existing_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = synthetic_tree()
            revision = make_commit(root, files)
            (root / '__init__.py').write_bytes(b'UNCOMMITTED MUST NOT LEAK')
            git(root, 'add', '__init__.py')  # The staged index must also be ignored.
            (root / 'web/untracked-secret.js').write_bytes(b'UNTRACKED MUST NOT LEAK')
            commit, committed = committed_files(root, revision)
            self.assertEqual(commit, revision)
            self.assertEqual(committed['__init__.py'], files['__init__.py'])
            output = root / 'candidate.zip'
            metadata = write_candidate(root, revision, output)
            before = output.read_bytes()
            self.assertEqual(metadata['sha256'], digest(before))
            with self.assertRaises(FileExistsError):
                write_candidate(root, revision, output)
            self.assertEqual(output.read_bytes(), before)
            with self.assertRaises(ValueError):
                committed_files(root, 'HEAD')
            with self.assertRaises(subprocess.CalledProcessError):
                committed_files(root, 'f' * 40)

    def test_committed_symlink_is_refused_without_following_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_commit(root, synthetic_tree())
            oid = subprocess.check_output(['git', '-C', str(root), 'hash-object', '-w', '--stdin'], input=b'../outside').decode().strip()
            git(root, 'update-index', '--add', '--cacheinfo', '120000,' + oid + ',backend/linked.py')
            git(root, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Synthetic forbidden symlink')
            revision = git(root, 'rev-parse', 'HEAD').decode().strip()
            with self.assertRaises(ValueError):
                committed_files(root, revision)


class PythonMetadataTests(unittest.TestCase):
    def test_packages_empty_builds_only_dependency_metadata_without_installing(self):
        import setuptools  # Explicit CI build-test dependency, never a product install.
        config = tomllib.loads((ROOT / 'pyproject.toml').read_text('utf-8'))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'pyproject.toml').write_bytes((ROOT / 'pyproject.toml').read_bytes())
            for name in ('backend', 'compat', 'frontend', 'node_modules'):
                (root / name).mkdir()
                (root / name / '__init__.py').write_bytes(b'raise RuntimeError("must not import/discover")')
            (root / '__init__.py').write_bytes(b'raise RuntimeError("must not import")')
            code = 'from setuptools.build_meta import build_wheel; build_wheel("dist")'
            completed = subprocess.run([sys.executable, '-c', code], cwd=root, capture_output=True, text=True, timeout=60)
            self.assertEqual(completed.returncode, 0, completed.stderr[-1800:])
            wheels = list((root / 'dist').glob('*.whl'))
            self.assertEqual(len(wheels), 1)
            with zipfile.ZipFile(wheels[0]) as archive:
                self.assertTrue(all('.dist-info/' in name for name in archive.namelist()))
                from email.parser import BytesParser
                metadata = BytesParser().parsebytes(archive.read(next(name for name in archive.namelist() if name.endswith('/METADATA'))))
                self.assertEqual(metadata['Version'], config['project']['version'])
                # setuptools may reorder comma-separated specifiers; compare parsed requirements.
                from packaging.requirements import Requirement
                self.assertEqual({str(Requirement(v)) for v in metadata.get_all('Requires-Dist')},
                                 {str(Requirement(v)) for v in config['project']['dependencies']})


if __name__ == '__main__':
    unittest.main()
