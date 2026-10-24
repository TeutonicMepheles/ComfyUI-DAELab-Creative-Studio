import sys
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parents[2]))
from backend.integrations.comfyui.services import CoreServices


class CoreServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_temp_media_is_frozen_in_the_same_catalog_before_source_disappears(self):
        from backend.contracts.errors import InvalidInput
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ('input', 'output', 'temp'):
                (root / name).mkdir()
            source = root / 'temp' / 'clip.mp4'
            source.write_bytes(b'synthetic identity fixture; not a valid media result')
            service = CoreServices(root / 'user', root / 'input', root / 'output', temp_directory=root / 'temp')
            asset = service.assets.register_file('temp', 'clip.mp4', kind='video', provenance={'origin': 'native-temp'})
            frozen = service.assets.freeze(asset['references'][0]['reference_id'])
            source.unlink()
            self.assertEqual(frozen['asset_id'], asset['asset_id'])
            self.assertTrue(service.assets.resolve_reference('frozen', frozen['filename'])[0].is_file())
            self.assertEqual(service.assets.get(asset['asset_id'])['content_sha256'], frozen['sha256'])
            self.assertEqual(service.assets.search_page()['total'], 0)  # registration never adds a favorite
            without_temp = CoreServices(root / 'user', root / 'input', root / 'output')
            with self.assertRaises(InvalidInput):
                without_temp.assets.resolve_reference('temp', 'clip.mp4')

    async def test_composed_http_favorite_uses_the_same_persistent_asset_catalog(self):
        from aiohttp import web
        from aiohttp.test_utils import TestClient, TestServer
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'input').mkdir()
            (root / 'output').mkdir()
            service = CoreServices(root / 'user', root / 'input', root / 'output')
            application = web.Application()
            for method, route, handler in service.routes:
                application.router.add_route(method, route, handler)
            async with TestClient(TestServer(application)) as client:
                origin = str(client.make_url('/')).rstrip('/')
                response = await client.post('/daelab/studio/asset-library/favorites',
                                             json={'kind': 'text', 'text': '独立保存的合成文本', 'name': '收藏 A'},
                                             headers={'Origin': origin})
                self.assertEqual(response.status, 200, await response.text())
                entry = (await response.json())['entry']
                assets = await (await client.get('/daelab/studio/assets')).json()
                self.assertEqual([item['asset_id'] for item in assets['assets']], [entry['assetId']])
            reopened = CoreServices(root / 'user', root / 'input', root / 'output')
            self.assertEqual(reopened.assets.search_page()['total'], 1)
            self.assertEqual(reopened.jobs.list_jobs(), [])

    async def test_read_routes_keep_missing_tasks_missing_and_reject_invalid_bounds(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            input_dir, output_dir = root / 'input', root / 'output'
            input_dir.mkdir()
            output_dir.mkdir()
            service = CoreServices(root / 'user', input_dir, output_dir)
            response = await service.search_assets(SimpleNamespace(query={}))
            self.assertEqual(response.status, 200)
            self.assertIn('"assets": []', response.text)
            invalid = await service.search_assets(SimpleNamespace(query={'limit': 'unbounded'}))
            self.assertEqual(invalid.status, 400)
            missing = await service.read_job(SimpleNamespace(match_info={'request_id': 'missing-task'}))
            self.assertEqual(missing.status, 404)
            self.assertEqual(service.jobs.list_jobs(), [])
            self.assertTrue((root / 'user/daelab/creative-studio/studio.sqlite3').is_file())


if __name__ == '__main__':
    unittest.main()
