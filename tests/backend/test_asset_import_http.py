"""Legacy import through real loopback HTTP, backed by an owned SQLite catalog."""
import copy
import hashlib
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from backend.assets.catalog import AssetCatalog
from backend.integrations.comfyui.asset_api import AssetAPI


PREFIX = '/daelab/studio/asset-library'


def png(pixel):
    """A complete one-pixel RGB PNG; no external files, codecs or model outputs."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\x00' + bytes(pixel))) + chunk(b'IEND', b''))


class ImportedAssetHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.roots = {key: self.root / key for key in ('input', 'output')}
        for path in self.roots.values():
            (path / 'legacy').mkdir(parents=True)
        self.files = {'input': png((255, 0, 0)), 'output': png((0, 0, 255))}
        for key, content in self.files.items():
            (self.roots[key] / 'legacy' / 'sample.png').write_bytes(content)
        self.catalog = AssetCatalog(self.root / 'catalog.sqlite', roots=self.roots)
        self.api = AssetAPI(self.catalog)
        app = web.Application()
        for method, path, handler in self.api.routes:
            app.router.add_route(method, path, handler)
        self.client = TestClient(TestServer(app, host='127.0.0.1'))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.origin = str(self.client.make_url('/')).rstrip('/')

    def media(self, key, *, filename='sample.png'):
        return {'kind': 'image', 'name': f'legacy {key}', 'asset': {
            'version': 1, 'kind': 'image', 'name': f'legacy {key}',
            'filename': filename, 'subfolder': 'legacy', 'type': key}}

    async def post(self, suffix, value, *, status=200):
        response = await self.client.post(PREFIX + suffix, json=value, headers={'Origin': self.origin})
        text = await response.text()
        self.assertEqual(response.status, status, text)
        return await response.json()

    async def search(self, **query):
        response = await self.client.get(PREFIX + '/favorites', params=query)
        text = await response.text()
        self.assertEqual(response.status, 200, text)
        return await response.json()

    async def test_import_three_reopen_search_and_reuse_preserve_complete_identity(self):
        text = '旧收藏合成文本\nUTF-8 snapshot'
        document = {'version': 1, 'entries': [
            {'id': 'old-text', 'kind': 'text', 'name': 'legacy text', 'text': text,
             'unknown': {'preserved': [1, 'value']}},
            {'id': 'old-input', **self.media('input')},
            {'id': 'old-output', **self.media('output')},
        ]}
        original = copy.deepcopy(document)
        payload = {'origin': 'http://old.example:8000', 'document': document}
        imported = await self.post('/import', payload)
        self.assertEqual((imported['accepted'], imported['rejected']), (3, 0))
        self.assertTrue(imported['source_preserved'])
        stored = self.catalog.export_favorites()
        # Reopen the actual database, then exercise the same installed HTTP routes.
        self.catalog = AssetCatalog(self.root / 'catalog.sqlite', roots=self.roots)
        self.api.catalog = self.catalog
        with patch('backend.assets.catalog._hash_file', side_effect=AssertionError('search must not hash files')):
            first = await self.search(limit='2')
            second = await self.search(limit='2', offset='2')
            images = await self.search(kind='image', q='legacy')
        self.assertEqual((first['total'], second['total'], images['total']), (3, 3, 2))
        self.assertEqual((first['hasMore'], second['hasMore']), (True, False))
        entries = first['entries'] + second['entries']
        self.assertEqual(len({entry['id'] for entry in entries}), 3)
        self.assertEqual(self.catalog.export_favorites(), stored)
        for entry in entries:
            value = {'kind': entry['kind'], 'name': entry['name']}
            if entry['kind'] == 'text':
                self.assertEqual(entry['text'], text)
                resolved = await self.post('/resolve', {'assetId': entry['assetId']})
                self.assertEqual(resolved['registration']['byteSize'], len(text.encode('utf-8')))
                value['text'] = text
            else:
                reference = entry['asset']
                expected = self.files[reference['type']]
                self.assertEqual(reference['assetId'], entry['assetId'])
                self.assertEqual(reference['referenceId'], entry['referenceId'])
                self.assertEqual(reference['byteSize'], len(expected))
                self.assertEqual(reference['contentSha256'], hashlib.sha256(expected).hexdigest())
                self.assertEqual(entry['status'], 'available')
                resolved = await self.post('/resolve', {
                    'assetId': entry['assetId'], 'referenceId': entry['referenceId']})
                for field in ('assetId', 'referenceId', 'contentSha256', 'byteSize'):
                    self.assertEqual(resolved['registration'][field], reference[field])
                value['asset'] = reference
            reused = await self.post('/register', value)
            self.assertEqual(reused['registration']['assetId'], entry['assetId'])
            if entry['kind'] == 'image':
                self.assertEqual(reused['registration']['asset'], entry['asset'])
            for operation in ('/lookup', '/favorites'):
                self.assertEqual((await self.post(operation, value))['entry'], entry)
        reused_catalog = self.catalog.export_favorites()
        for key in ('schema_version', 'favorites', 'origins'):
            self.assertEqual(reused_catalog[key], stored[key])
        self.assertEqual(len(reused_catalog['assets']), len(stored['assets']))
        for before, after in zip(stored['assets'], reused_catalog['assets']):
            if before['kind'] == 'text':
                # Explicit text registration adds its provenance record; it must
                # not replace the imported snapshot, identity or origin bytes.
                self.assertEqual([{key: item[key] for key in ('reference_id', 'detail')}
                                  for item in after['provenance']], [{'reference_id': None, 'detail': {}}])
                after = {**after, 'provenance': before['provenance']}
            self.assertEqual(after, before)
        repeated = await self.post('/import', payload)
        self.assertEqual([item['status'] for item in repeated['report']], ['already_imported'] * 3)
        self.assertEqual(self.catalog.export_favorites(), reused_catalog)
        self.assertEqual(document, original)
        for key, content in self.files.items():
            self.assertEqual((self.roots[key] / 'legacy' / 'sample.png').read_bytes(), content)

    async def test_missing_import_is_listed_without_inventing_size_or_usable_identity(self):
        value = {'id': 'missing', **self.media('input', filename='absent.png')}
        imported = await self.post('/import', {'origin': 'http://old.example:8000',
                                              'document': {'version': 1, 'entries': [value]}})
        self.assertEqual(imported['report'][0]['status'], 'missing')
        entry = (await self.search())['entries'][0]
        self.assertEqual(entry['status'], 'missing')
        self.assertIsNone(entry['asset']['byteSize'])
        self.assertIsNone(entry['asset']['contentSha256'])
        await self.post('/resolve', {'assetId': entry['assetId'], 'referenceId': entry['referenceId']}, status=409)
        self.assertFalse((self.roots['input'] / 'legacy' / 'absent.png').exists())

    async def test_normal_file_favorite_search_matches_write_and_rejects_changed_reuse(self):
        created = (await self.post('/favorites', self.media('input')))['entry']
        page = await self.search(kind='image')
        self.assertEqual(page['entries'], [created])
        self.assertEqual(page['entries'][0]['asset']['byteSize'], len(self.files['input']))
        original = self.catalog.export_favorites()
        (self.roots['input'] / 'legacy' / 'sample.png').write_bytes(png((0, 255, 0)))
        for route in ('/register', '/lookup', '/favorites'):
            await self.post(route, {'kind': 'image', 'name': created['name'], 'asset': created['asset']}, status=409)
        self.assertEqual(self.catalog.export_favorites(), original)

    async def test_imported_video_search_and_reuse_keep_stored_size_and_hash(self):
        content = (Path(__file__).resolve().parents[1] / 'fixtures/performance/media/loop.mp4').read_bytes()
        (self.roots['output'] / 'legacy' / 'loop.mp4').write_bytes(content)
        value = {'id': 'old-video', 'kind': 'video', 'name': 'legacy video', 'asset': {
            'version': 1, 'kind': 'video', 'name': 'legacy video',
            'filename': 'loop.mp4', 'subfolder': 'legacy', 'type': 'output'}}
        imported = await self.post('/import', {'origin': 'http://old.example:8000',
                                              'document': {'version': 1, 'entries': [value]}})
        self.assertEqual((imported['accepted'], imported['rejected']), (1, 0))
        entry = (await self.search(kind='video'))['entries'][0]
        self.assertEqual(entry['asset']['byteSize'], len(content))
        self.assertEqual(entry['asset']['contentSha256'], hashlib.sha256(content).hexdigest())
        reused = await self.post('/register', {'kind': 'video', 'name': entry['name'], 'asset': entry['asset']})
        self.assertEqual(reused['registration']['asset'], entry['asset'])
        resolved = await self.post('/resolve', {'assetId': entry['assetId'], 'referenceId': entry['referenceId']})
        for field in ('assetId', 'referenceId', 'contentSha256', 'byteSize'):
            self.assertEqual(resolved['registration'][field], entry['asset'][field])


if __name__ == '__main__':
    unittest.main()
