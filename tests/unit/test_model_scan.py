import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.integrations.comfyui.model_scan import discover, match, suggest, confirm, _hash_file, match_installed_families, generation_file_report
from backend.providers.native import ModelInventory
from backend.providers.contracts import ProviderUnavailable


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


class FakeFolderPaths:
    """Minimal ComfyUI folder_paths surface for the pure scan functions."""
    def __init__(self, files):
        # files: {directory: {name: (full_path, size_bytes)}}
        self._files = files

    def get_filename_list(self, directory):
        return list(self._files.get(directory, {}).keys())

    def get_full_path(self, directory, name):
        item = self._files.get(directory, {}).get(name)
        return item[0] if item else None


class ModelScanDiscoveryTests(unittest.TestCase):
    def test_generation_menu_checks_only_supported_local_files_in_its_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = root / 'model.safetensors'
            model.write_bytes(b'123')
            folder = FakeFolderPaths({'diffusion_models': {name: (str(model), 3) for name in (model.name, 'unrelated.bin')}})
            entry = dict(family='video', category='diffusion_models', name=model.name, bytes=3, sha256=_sha(b'123'))
            entries = [entry, dict(entry, family='image'), dict(entry, family='text_pe'),
                       dict(entry, family='video_high', bytes=4), dict(entry, family='video_high', category='video_vae', name='missing.safetensors')]
            with patch('backend.integrations.comfyui.model_scan.load_manifest', return_value=entries):
                report = generation_file_report(folder, 'video', None)
                self.assertEqual(set(report), {'video', 'video_high'})
                self.assertEqual(report['video'][0]['status'], 'found')
                self.assertEqual([item['status'] for item in report['video_high']], ['wrongSize', 'missing'])
                self.assertEqual(report['video_high'][1]['category'], 'vae')
                folder._files['diffusion_models']['sub/' + model.name] = (str(model), 3)
                self.assertEqual(generation_file_report(folder, 'video', None)['video'][0]['status'], 'ambiguous')
                explicit = {'modelBindings': {'video': {'diffusion_models': {'name': model.name, 'path': str(root/'old'), 'sha256': entry['sha256']},
                                                        'loras': {'name': 'extra.safetensors', 'path': str(root/'extra.safetensors'), 'sha256': 'a'*64}}}}
                self.assertEqual([item['status'] for item in generation_file_report(folder, 'video', explicit)['video']], ['pathMismatch', 'missing'])

    def test_automatic_match_is_portable_and_only_hashes_on_submission(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = root / 'model.safetensors'
            model.write_bytes(b'xxxx')
            folder = FakeFolderPaths({'diffusion_models': {'sub/model.safetensors': (str(model), 4)}})
            folder.get_user_directory = lambda: root
            entry = dict(family='video', category='diffusion_models', name=model.name, bytes=4, sha256=_sha(b'good'))
            missing = dict(entry, family='video_high', category='loras', name='missing.safetensors')
            with patch('backend.integrations.comfyui.model_scan.load_manifest', return_value=[entry, dict(entry, family='video_high'), missing]):
                config = match_installed_families(folder, None)
                self.assertEqual(set(config['modelBindings']), {'video'})
                stack = config['modelBindings']['video']
                self.assertEqual(stack['diffusion_models']['name'], 'sub/model.safetensors')
                inventory = ModelInventory(stack, lambda: {}, folder.get_full_path)
                models = inventory.descriptions(stack)
                with patch('backend.providers.native._verify_shared', side_effect=AssertionError('preview must not hash')):
                    inventory.check_available(models, {})
                with self.assertRaises(ProviderUnavailable):
                    inventory.verify(models, {})
                folder._files['diffusion_models']['other/model.safetensors'] = (str(model), 4)
                self.assertIsNone(match_installed_families(folder, None))

    def test_maps_categories_and_matches_by_name(self):
        root = Path(tempfile.mkdtemp(prefix='model-scan-'))
        diffusion = root / 'diffusion.safetensors'
        diffusion.write_bytes(b'x' * 10)
        text = root / 'mmproj.gguf'
        text.write_bytes(b'y' * 20)

        folder = FakeFolderPaths({
            'diffusion_models': {'diffusion.safetensors': (str(diffusion), 10)},
            'text_encoders': {'mmproj.gguf': (str(text), 20)},
        })
        entries = [
            {'family': 'image', 'category': 'diffusion_models', 'name': 'diffusion.safetensors', 'bytes': 10, 'sha256': _sha(b'x' * 10)},
            {'family': 'image', 'category': 'mmproj', 'name': 'mmproj.gguf', 'bytes': 20, 'sha256': _sha(b'y' * 20)},
        ]
        candidates = discover(folder, entries)
        self.assertEqual(candidates[('image', 'diffusion_models')][0]['path'], str(diffusion))
        # mmproj maps to the text_encoders directory (native.py:85 mapping).
        self.assertEqual(candidates[('image', 'mmproj')][0]['path'], str(text))

    def test_size_mismatch_is_still_a_candidate_for_conflict_reporting(self):
        root = Path(tempfile.mkdtemp(prefix='model-scan-'))
        wrong_size = root / 'text.gguf'
        wrong_size.write_bytes(b'z' * 3)
        folder = FakeFolderPaths({
            'text_encoders': {'text.gguf': (str(wrong_size), 3)},
        })
        entries = [
            {'family': 'image', 'category': 'text_encoders', 'name': 'text.gguf', 'bytes': 20, 'sha256': 'a' * 64},
        ]
        candidates = discover(folder, entries)
        # Same name is a candidate even though the size differs, so the scan can
        # surface "疑似装错量化/版本" instead of a false "缺失".
        self.assertEqual(candidates[('image', 'text_encoders')][0]['bytes'], 3)

    def test_subdirectory_file_keeps_raw_name(self):
        root = Path(tempfile.mkdtemp(prefix='model-scan-'))
        (root / 'sub').mkdir()
        model = root / 'sub' / 'model.safetensors'
        model.write_bytes(b'm' * 7)
        folder = FakeFolderPaths({
            'diffusion_models': {'sub/model.safetensors': (str(model), 7)},
        })
        entries = [
            {'family': 'image', 'category': 'diffusion_models', 'name': 'model.safetensors', 'bytes': 7, 'sha256': _sha(b'm' * 7)},
        ]
        candidates = discover(folder, entries)
        # The raw name (with the relative subdirectory) is preserved, not basename.
        self.assertEqual(candidates[('image', 'diffusion_models')][0]['name'], 'sub/model.safetensors')


class ModelScanMatchTests(unittest.TestCase):
    def test_classifies_hit_conflict_and_missing(self):
        root = Path(tempfile.mkdtemp(prefix='model-scan-'))
        hit = root / 'hit.safetensors'
        hit.write_bytes(b'hit')
        conflict = root / 'conflict.safetensors'
        conflict.write_bytes(b'not-the-expected-content')
        folder = FakeFolderPaths({
            'diffusion_models': {
                'hit.safetensors': (str(hit), 3),
                'conflict.safetensors': (str(conflict), len(b'not-the-expected-content')),
            },
        })
        entries = [
            {'family': 'image', 'category': 'diffusion_models', 'name': 'hit.safetensors', 'bytes': 3, 'sha256': _sha(b'hit')},
            {'family': 'video', 'category': 'diffusion_models', 'name': 'conflict.safetensors', 'bytes': 1, 'sha256': _sha(b'expected')},
            {'family': 'text_pe', 'category': 'text_encoders', 'name': 'absent.safetensors', 'bytes': 1, 'sha256': 'b' * 64},
        ]
        candidates = discover(folder, entries)
        hits, conflicts, missing = match(candidates, entries)
        self.assertEqual([(h['family'], h['category']) for h in hits], [('image', 'diffusion_models')])
        self.assertEqual(hits[0]['sha256'], _sha(b'hit'))
        self.assertEqual([(c['family'], c['category']) for c in conflicts], [('video', 'diffusion_models')])
        self.assertEqual(conflicts[0]['actualSha256'], _sha(b'not-the-expected-content'))
        self.assertEqual(conflicts[0]['expectedSha256'], _sha(b'expected'))
        self.assertIs(conflicts[0]['sizeMismatch'], True)
        self.assertEqual([(m['family'], m['category']) for m in missing], [('text_pe', 'text_encoders')])

    def test_hashes_each_unique_file_once_across_families(self):
        root = Path(tempfile.mkdtemp(prefix='model-scan-'))
        shared = root / 'shared.safetensors'
        shared.write_bytes(b'shared')
        folder = FakeFolderPaths({
            'text_encoders': {'shared.safetensors': (str(shared), 6)},
        })
        entries = [
            {'family': 'video', 'category': 'text_encoders', 'name': 'shared.safetensors', 'bytes': 6, 'sha256': _sha(b'shared')},
            {'family': 'video_reference', 'category': 'text_encoders', 'name': 'shared.safetensors', 'bytes': 6, 'sha256': _sha(b'shared')},
        ]
        candidates = discover(folder, entries)
        with patch('backend.integrations.comfyui.model_scan._hash_file', wraps=_hash_file) as hasher:
            hits, conflicts, missing = match(candidates, entries)
        self.assertEqual(len(hits), 2)
        self.assertEqual(hasher.call_count, 1)

    def test_multiple_same_name_files_prefer_the_hash_match(self):
        root = Path(tempfile.mkdtemp(prefix='model-scan-'))
        (root / 'a').mkdir(); (root / 'b').mkdir()
        good = root / 'a' / 'model.safetensors'; good.write_bytes(b'correct')
        wrong = root / 'b' / 'model.safetensors'; wrong.write_bytes(b'wrong-content')
        folder = FakeFolderPaths({
            'diffusion_models': {
                'a/model.safetensors': (str(good), 7),
                'b/model.safetensors': (str(wrong), 13),
            },
        })
        entries = [
            {'family': 'image', 'category': 'diffusion_models', 'name': 'model.safetensors', 'bytes': 7, 'sha256': _sha(b'correct')},
        ]
        candidates = discover(folder, entries)
        hits, conflicts, missing = match(candidates, entries)
        # The hash match wins even though found[0] is the wrong-size file.
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]['path'], str(good))
        self.assertEqual(conflicts, [])
        self.assertEqual(missing, [])


class ModelScanSuggestTests(unittest.TestCase):
    def test_minimal_new_config_generates_default_resource_lock(self):
        hits = [{'family': 'image', 'category': 'diffusion_models', 'name': 'm.safetensors', 'path': '/abs/m.safetensors', 'sha256': 'a' * 64}]
        user = Path(tempfile.mkdtemp(prefix='model-scan-'))
        config = suggest(hits, [], existing_config=None, user_directory=user)
        self.assertEqual(config['schemaVersion'], 1)
        self.assertIs(config['enabled'], True)
        self.assertTrue(config['resourceLock'].endswith('.lock'))
        self.assertTrue(Path(config['resourceLock']).is_absolute())
        self.assertEqual(set(config['modelBindings']), {'image'})
        self.assertNotIn('qwenBinding', config)

    def test_merge_preserves_existing_lock_and_qwen(self):
        user = Path(tempfile.mkdtemp(prefix='model-scan-'))
        existing = {
            'resourceLock': str(user / 'existing.lock'),
            'modelBindings': {'image': {'diffusion_models': {'name': 'old.safetensors', 'path': str(user / 'old.safetensors'), 'sha256': 'c' * 64}}},
            'qwenBinding': {'manifestPath': str(user / 'manifest.json'), 'installedManifestPath': str(user / 'installed'), 'blobsRoot': str(user / 'blobs'), 'manifestSha256': 'd' * 64, 'blobs': []},
        }
        hits = [{'family': 'video', 'category': 'diffusion_models', 'name': 'new.safetensors', 'path': str(user / 'new.safetensors'), 'sha256': 'e' * 64}]
        config = suggest(hits, [], existing_config=existing, user_directory=user)
        self.assertEqual(config['resourceLock'], existing['resourceLock'])
        self.assertEqual(config['qwenBinding'], existing['qwenBinding'])
        # Existing family is preserved and the scanned family is added.
        self.assertEqual(set(config['modelBindings']), {'image', 'video'})
        self.assertEqual(config['modelBindings']['image']['diffusion_models']['name'], 'old.safetensors')
        self.assertEqual(config['modelBindings']['video']['diffusion_models']['name'], 'new.safetensors')

    def test_conflict_adoption_writes_path_and_actual_hash(self):
        user = Path(tempfile.mkdtemp(prefix='model-scan-'))
        conflict = {'family': 'video', 'category': 'diffusion_models', 'name': 'c.safetensors', 'path': str(user / 'c.safetensors'), 'actualSha256': 'f' * 64}
        config = suggest([], [conflict], existing_config=None, user_directory=user)
        binding = config['modelBindings']['video']['diffusion_models']
        self.assertEqual(binding, {'name': 'c.safetensors', 'path': str(user / 'c.safetensors'), 'sha256': 'f' * 64})


class ModelScanConfirmTests(unittest.TestCase):
    def test_confirm_writes_local_generation_json(self):
        user = Path(tempfile.mkdtemp(prefix='model-scan-'))
        config = {'schemaVersion': 1, 'enabled': True, 'resourceLock': str(user / 'r.lock'), 'modelBindings': {}}
        path = confirm(config, user)
        self.assertEqual(path.name, 'local-generation.json')
        written = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(written, config)


if __name__ == '__main__':
    unittest.main()
