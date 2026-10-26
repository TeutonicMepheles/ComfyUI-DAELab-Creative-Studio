"""Preparation provenance guards; no Torch, GPU or host dependency in CI."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from tools.evals.capture_h3_preprocessing import verified_fixtures

ROOT = Path(__file__).resolve().parents[2]


class PreparationGuards(unittest.TestCase):
    def test_public_fixture_contains_three_ordered_h3_modes(self):
        samples = verified_fixtures(ROOT / 'tests/fixtures/local-eval')
        self.assertEqual([len(s['references']) for s in samples], [0, 1, 2])

    def test_changed_source_image_cannot_reuse_old_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'fixtures'
            shutil.copytree(ROOT / 'tests/fixtures/local-eval', root)
            (root / 'images/motion-last.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'synthetic image changed'):
                verified_fixtures(root)

    def test_changed_parameter_cannot_reuse_old_sample_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'fixtures'
            shutil.copytree(ROOT / 'tests/fixtures/local-eval', root)
            path = root / 'samples.json'
            data = json.loads(path.read_text('utf-8'))
            data['samples'][-1]['settings']['width'] = 640
            path.write_text(json.dumps(data), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'sample input changed'):
                verified_fixtures(root)


if __name__ == '__main__':
    unittest.main()
