"""Retirement checks: old identities stay unavailable and no credential is read."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.providers.contracts import ProviderUnavailable
from backend.providers.deepseek import configured_key, DeepSeekProvider
from backend.generation.service import GenerationService
from backend.generation.optimization import OptimizationFacade
from backend.generation.http import routes
from backend.integrations.comfyui.services import CoreServices
from test_optimization import snapshot
from test_integration import Request

class DeepSeekRetirementTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='studio-retired-')
        root = Path(self.temp.name)
        for part in ('input', 'output'): (root / part).mkdir()
        self.core = CoreServices(root/'user', root/'input', root/'output')
        self.service = GenerationService(self.core.jobs, self.core.assets)
        self.facade = OptimizationFacade(self.service)
        self.handlers = {(method,path): fn for method,path,fn in routes(self.service)}
    async def asyncTearDown(self):
        await self.service.wait_idle()
        self.temp.cleanup()
    async def test_catalog_and_capability_do_not_restore_retired_provider(self):
        self.assertFalse(any('deepseek' in item['id'] for item in self.service.model_catalog()['models']))
        with self.assertRaises(ProviderUnavailable): await self.service.capabilities('deepseek-flash')
        self.assertEqual(self.core.jobs.list_jobs(), [])
    async def test_original_identity_is_rejected_without_creating_or_rewriting_jobs(self):
        value = snapshot(); value['model'] = 'deepseek-flash'
        with self.assertRaises(ProviderUnavailable): await self.facade.estimate({'model':value['model'],'rows':[value]})
        self.assertEqual(value['model'], 'deepseek-flash')
        self.assertEqual(self.core.jobs.list_jobs(), [])
    async def test_legacy_headers_and_environment_are_not_read(self):
        class Headers(dict):
            def get(self, key, default=None):
                if 'deepseek' in key.lower(): raise AssertionError('retired key was read')
                return super().get(key, default)
        request = Request({'model':'deepseek','requestId':'old','mode':'polish','source':'original'}, headers=Headers())
        response = await self.handlers['POST','/daelab/prompt-optimization/polish'](request)
        self.assertEqual(response.status, 503)
        with patch('pathlib.Path.read_text', side_effect=AssertionError('must not read host keys')):
            self.assertEqual(configured_key(self.temp.name), '')
            provider = DeepSeekProvider(key_resolver=lambda: self.fail('must not read credentials'))
            with self.assertRaises(ProviderUnavailable): await provider.capabilities('deepseek-flash')
        self.assertEqual(self.core.jobs.list_jobs(), [])
