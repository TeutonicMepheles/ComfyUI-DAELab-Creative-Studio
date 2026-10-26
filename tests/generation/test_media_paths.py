"""Real catalog/path regressions; synthetic PNGs and an inert provider only."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlencode

from backend.contracts.errors import InvalidInput
from backend.generation.media import freeze_reference
from backend.integrations.comfyui.generation_nodes.node import read_current_result
from backend.integrations.comfyui.services import CoreServices
from backend.providers.parameters import IMAGE_MODEL
from test_service import png, FakeProvider, Admission, GenerationService


class CanonicalMediaPathsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='studio-canonical-media-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for root in ('input', 'output'):
            folder = self.root / root / 'DAELAB/clip'
            folder.mkdir(parents=True)
            (folder / 'result.png').write_bytes(png())
        self.core = CoreServices(self.root / 'user', self.root / 'input', self.root / 'output')

    @staticmethod
    def aliases():
        values = ['DAELAB/clip', r'DAELAB\clip', 'DAELAB/./clip']
        if os.name == 'nt':
            values.append(r'daelab\clip')
        return values

    @staticmethod
    def url(root, subfolder, filename='result.png'):
        return '/view?' + urlencode({'filename': filename, 'subfolder': subfolder, 'type': root})

    async def test_freeze_reference_aliases_use_one_canonical_frozen_asset(self):
        for root in ('input', 'output'):
            original = None
            for alias in self.aliases():
                with self.subTest(root=root, alias=alias):
                    frozen = freeze_reference(self.core.assets, {'url': self.url(root, alias), 'kind': 'image'})
                    if original is None:
                        original = frozen
                    self.assertEqual(frozen, original)
                    self.assertTrue(self.core.assets.validate_reference(frozen['reference_id'])['usable'])
                    catalog = self.core.assets.register_file(root, 'DAELAB/clip/result.png', kind='image')
                    matching = [r for r in catalog['references'] if r['root_key'] == root]
                    self.assertEqual([r['relative_path'] for r in matching], ['DAELAB/clip/result.png'])
        self.assertEqual(self.core.jobs.list_jobs(), [])

    async def test_native_saved_aliases_retain_original_receipt_ownership(self):
        fake = FakeProvider()
        fake.file = 'DAELAB/clip/result.png'
        service = GenerationService(self.core.jobs, self.core.assets, providers={fake.id: fake}, admission=Admission(), poll_interval=0)
        source = {'documentId': 'doc', 'tableId': 'table', 'nodeId': 'node', 'recordId': 'row', 'fieldId': 'out', 'inputDigest': 'a' * 64}
        await service.submit([{'requestId': 'canonical-read', 'source': source, 'input': {
            'config': {'model': IMAGE_MODEL, 'kind': 'image', 'mode': 'text2image'},
            'segments': [{'type': 'text', 'text': 'synthetic'}]}}])
        await service.wait_idle()
        selected = {**service.public('canonical-read')['result'], 'provenance': {'requestId': 'canonical-read'}}
        row = {'id': 'row', 'values': {'out': [selected]}, 'meta': {'studioGenerationRefs': {'out': [
            {'requestId': 'canonical-read', 'inputDigest': 'a' * 64, 'source': source, 'model': IMAGE_MODEL}]}}}
        data = {'currentId': 'row', 'fieldId': 'out', 'sourceScope': {k: source[k] for k in ('documentId', 'tableId', 'nodeId')}, 'table': {'records': [row]}}
        for alias in self.aliases():
            with self.subTest(alias=alias):
                selected['url'] = self.url('output', alias)
                kind, path, _report, url = read_current_result(service, json.dumps(data))
                self.assertEqual(kind, 'image')
                self.assertEqual(path, (self.root / 'output/DAELAB/clip/result.png').resolve())
                self.assertEqual(url, selected['url'])
        # Same bytes at another rooted path are still not this receipt's reference.
        (self.root / 'output/DAELAB/clip/other.png').write_bytes(png())
        selected['url'] = self.url('output', 'DAELAB/clip', 'other.png')
        with self.assertRaisesRegex(InvalidInput, 'immutable task receipt'):
            read_current_result(service, json.dumps(data))
        self.assertEqual(fake.creates, ['canonical-read'])
        self.assertEqual(self.core.jobs.get('canonical-read')['attempt'], 1)

    async def test_canonicalization_does_not_admit_root_escape(self):
        for folder in (r'..\output\DAELAB\clip', str(self.root / 'output/DAELAB/clip')):
            with self.subTest(folder=folder):
                url = self.url('input', folder)
                with self.assertRaises(InvalidInput):
                    freeze_reference(self.core.assets, {'url': url, 'kind': 'image'})
                data = {'currentId': 'row', 'fieldId': 'out', 'table': {'records': [
                    {'id': 'row', 'values': {'out': [{'url': self.url('output', folder), 'kind': 'image'}]}}]}}
                service = GenerationService(self.core.jobs, self.core.assets)
                with self.assertRaises(InvalidInput):
                    read_current_result(service, json.dumps(data))
        self.assertEqual(self.core.jobs.list_jobs(), [])


if __name__ == '__main__':
    unittest.main()
