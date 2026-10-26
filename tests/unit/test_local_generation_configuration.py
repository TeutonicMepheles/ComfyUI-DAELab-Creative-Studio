import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from backend.integrations.comfyui.local_generation import read_configuration, compose_configured_generation
from backend.generation.admission import ResourceAdmission


class LocalGenerationConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='studio-local-config-')
        self.root = Path(self.temp.name)
        self.user = self.root / 'user'
        self.file = self.user / 'daelab/creative-studio/local-generation.json'
        self.file.parent.mkdir(parents=True)
        self.config = {'schemaVersion': 1, 'enabled': True, 'resourceLock': str(self.root / 'shared-gpu.lock'),
                       'modelBindings': {'image': {'diffusion_models': {'name': 'fixed-image.safetensors', 'path': str(self.root / 'fixed-image.safetensors'), 'sha256': 'a' * 64}}},
                       'qwenBinding': {'manifestPath': str(self.root / 'manifest.json'), 'installedManifestPath': str(self.root / 'installed-manifest'),
                                       'blobsRoot': str(self.root / 'blobs'), 'manifestSha256': 'b' * 64,
                                       'blobs': [{'role': role, 'bytes': 1, 'sha256': 'c' * 64} for role in ['model', 'projector', 'config', 'template', 'license', 'params']]}}

    def tearDown(self):
        self.temp.cleanup()

    def save(self, config):
        self.file.write_text(json.dumps(config), encoding='utf-8')

    def test_missing_and_explicitly_disabled_configuration_leave_providers_absent(self):
        self.assertIsNone(read_configuration(self.user))
        self.save({'schemaVersion': 1, 'enabled': False})
        self.assertIsNone(read_configuration(self.user))
        core = SimpleNamespace(jobs=object(), assets=object(), resources=ResourceAdmission())
        service = compose_configured_generation(core, None, native_queue=None, node_types=None, resolve_model=None, release_native_models=None)
        self.assertEqual(service.providers, {})
        self.assertIs(service.jobs, core.jobs)
        self.assertIs(service.resources, core.resources)

    def test_explicit_composition_uses_same_ledger_without_reading_weights_or_dispatching(self):
        self.save(self.config)
        config = read_configuration(self.user)
        core = SimpleNamespace(jobs=object(), assets=object(), resources=ResourceAdmission())
        queue = SimpleNamespace(busy=lambda: False)
        with patch('backend.providers.qwen_binding.QwenModelBinding.verify', side_effect=AssertionError('early weight IO')), \
             patch('backend.providers.native.ModelInventory.verify', side_effect=AssertionError('early weight IO')):
            service = compose_configured_generation(core, config, native_queue=queue, node_types=lambda: {},
                                                   resolve_model=lambda *_: None, release_native_models=lambda: None)
        self.assertEqual(set(service.providers), {'local-qwen-text', 'local-qwen-image', 'local-h3'})
        self.assertEqual(service._workers, {})
        self.assertIs(service.jobs, core.jobs)
        self.assertIs(service.resources, core.resources)
        self.assertIs(service.assets, core.assets)
        self.assertFalse((self.root / 'shared-gpu.lock').exists())

    def test_rejects_unexpected_transport_secrets_relative_paths_and_incomplete_qwen_binding(self):
        invalid = []
        item = copy.deepcopy(self.config); item['cloudEndpoint'] = 'https://example.invalid'; invalid.append(item)
        item = copy.deepcopy(self.config); item['resourceLock'] = 'relative.lock'; invalid.append(item)
        item = copy.deepcopy(self.config); item['resourceLock'] = str(self.root / 'model.safetensors'); invalid.append(item)
        item = copy.deepcopy(self.config); item['qwenBinding']['blobs'][0]['token'] = 'must not enter config'; invalid.append(item)
        item = copy.deepcopy(self.config); item['qwenBinding']['blobs'].pop(); invalid.append(item)
        item = copy.deepcopy(self.config); item['modelBindings']['image']['diffusion_models']['path'] = 'relative.safetensors'; invalid.append(item)
        item = copy.deepcopy(self.config); item['modelBindings']['image']['diffusion_models']['sha256'] = 'model-name-only'; invalid.append(item)
        for config in invalid:
            with self.subTest(config=list(config)):
                self.save(config)
                with self.assertRaises(ValueError):
                    read_configuration(self.user)

    def test_bounded_invalid_file_is_not_accepted_as_empty_configuration(self):
        for raw in (b'{', b' ' * (256 * 1024 + 1), b'[]', b'{"schemaVersion":1,"enabled":1}',
                    b'{"schemaVersion":true,"enabled":false}'):
            self.file.write_bytes(raw)
            with self.assertRaises(ValueError):
                read_configuration(self.user)


    def test_explicit_native_model_disposal_runs_outside_http_event_loop(self):
        import asyncio
        import sys
        import threading
        from backend.integrations.comfyui.local_generation import assemble_host_generation
        owner = threading.get_ident()
        events, captured = [], {}
        def operation(name):
            self.assertNotEqual(threading.get_ident(), owner)
            events.append(name)
        management = SimpleNamespace(unload_all_models=lambda: operation('unload'), soft_empty_cache=lambda: operation('cache'))
        def compose(*args, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(admission=object())
        with patch('backend.integrations.comfyui.local_generation.read_configuration', return_value={'explicit': True}), \
             patch('backend.integrations.comfyui.local_generation.compose_configured_generation', side_effect=compose), \
             patch('backend.integrations.comfyui.generation_nodes.native_host.install_native_admission'), \
             patch.dict(sys.modules, {'nodes': SimpleNamespace(NODE_CLASS_MAPPINGS={}), 'comfy': SimpleNamespace(model_management=management), 'comfy.model_management': management}):
            assemble_host_generation(object(), object(), SimpleNamespace(get_user_directory=lambda: self.user, get_full_path=lambda *_: None), native_queue=object())
            self.assertEqual(events, [])  # Composition itself never releases models.
            asyncio.run(captured['release_native_models']())
        self.assertEqual(events, ['unload', 'cache'])

if __name__ == '__main__':
    unittest.main()
