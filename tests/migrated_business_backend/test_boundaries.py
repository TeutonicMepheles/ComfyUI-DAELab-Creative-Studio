"""Owning-module and pinned-provenance regression checks, not product acceptance."""
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
DIRECTORIES = ('backend/storyboard', 'backend/prompt', 'backend/integrations/comfyui/business_nodes')


class BoundaryTests(unittest.TestCase):
    def test_no_retired_runtime_network_or_singleton_import(self):
        forbidden = ('libtv_bridge', 'PromptServer', 'folder_paths', 'requests', 'ClientSession', 'urlopen', 'comfy_api_nodes')
        for directory in DIRECTORIES:
            for path in (ROOT / directory).glob('*.py'):
                source = path.read_text('utf-8')
                tree = ast.parse(source)
                for node in ast.walk(tree):
                    if isinstance(node, (ast.Import, ast.ImportFrom)):
                        names = [n.name for n in node.names] + [getattr(node, 'module', '') or '']
                        self.assertFalse(any(part in name for part in forbidden for name in names), str(path))
                    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        for decorator in node.decorator_list:
                            self.assertNotIn('.routes.', ast.unparse(decorator), str(path))

    def test_importing_pure_services_and_assembly_requires_no_host(self):
        result = subprocess.run([sys.executable, '-c', '''
import sys
assert 'server' not in sys.modules
import backend.storyboard.script_document
import backend.storyboard.document_import
import backend.storyboard.services
import backend.prompt.prompt_service
import backend.integrations.comfyui.business_nodes
assert 'server' not in sys.modules
assert 'folder_paths' not in sys.modules
assert 'comfy_api' not in sys.modules
assert not any('libtv_bridge' in name for name in sys.modules)
'''], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_provenance_covers_every_owned_production_file_and_current_bytes(self):
        manifest = json.loads((ROOT / 'docs/provenance/business-backend-files.json').read_text('utf-8'))
        expected = {p.relative_to(ROOT).as_posix() for directory in DIRECTORIES for p in (ROOT / directory).glob('*.py')}
        self.assertEqual({f['destination'] for f in manifest['files']}, expected)
        self.assertEqual(manifest['sourceCommit'], '7ff56cb51ef6f7fc3bcf5707792d655037c61b30')
        for file in manifest['files']:
            self.assertEqual(hashlib.sha256((ROOT / file['destination']).read_bytes()).hexdigest(), file['destinationSha256'], file['destination'])
            if file['source']:
                self.assertIn('/blob/' + manifest['sourceCommit'] + '/', file['sourceUrl'])
                self.assertRegex(file['sourceSha256'], '^[0-9a-f]{64}$')


if __name__ == '__main__':
    unittest.main()
