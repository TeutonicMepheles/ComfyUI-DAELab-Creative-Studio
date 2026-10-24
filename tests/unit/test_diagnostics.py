import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("studio_diagnostics", Path(__file__).parents[2] / "backend/integrations/comfyui/diagnostics.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DiagnosticsTests(unittest.TestCase):
    def test_version_mismatch_is_visible_and_core_does_not_import_providers(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "web").mkdir()
            (root / "pyproject.toml").write_text('[project]\nversion="0.1.0.dev0"\n', encoding="utf-8")
            (root / "web/build-manifest.json").write_text(json.dumps({"version": "0.2.0", "sourceFingerprint": "a" * 64}), encoding="utf-8")
            self.assertFalse(module.product_metadata(root)["compatible"])
            self.assertIn("versions differ", module.product_metadata(root)["reason"])
            (root / "web/build-manifest.json").write_text(json.dumps({"version": "0.1.0-dev.0", "sourceFingerprint": "a" * 64}), encoding="utf-8")
            self.assertTrue(module.product_metadata(root)["compatible"])
            self.assertTrue(module.capabilities()[0]["available"])
            self.assertTrue(all(c["reason"] for c in module.capabilities()[2:]))

    def test_missing_build_is_unavailable_not_a_fake_success(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "pyproject.toml").write_text('[project]\nversion="0.1.0.dev0"\n', encoding="utf-8")
            result = module.product_metadata(root)
            self.assertFalse(result["compatible"])
            self.assertIsNone(result["buildFingerprint"])

    def test_corrupt_metadata_has_a_public_error_without_echoing_raw_data(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "web").mkdir()
            (root / "pyproject.toml").write_text('[project]\nversion="0.1.0.dev0"\n', encoding="utf-8")
            for value in ['secret-sentinel-invalid-json', '[]', '{"version":42}']:
                (root / "web/build-manifest.json").write_text(value, encoding="utf-8")
                result = module.product_metadata(root)
                self.assertFalse(result["compatible"])
                self.assertNotIn('secret-sentinel', json.dumps(result))


class DiagnosticsReadinessTests(unittest.IsolatedAsyncioTestCase):
    async def test_configuration_and_admission_readiness_are_distinct_without_provider_calls(self):
        class Provider:
            def __getattr__(self, _name):
                raise AssertionError('Diagnostics cannot call providers')
        server = SimpleNamespace(_creative_studio_generation=SimpleNamespace(providers={'local-h3': Provider()}))
        diagnostics = module.Diagnostics(Path('.'), server)
        body = json.loads((await diagnostics.read_capabilities(None)).text)
        self.assertTrue(body['localGeneration']['configured'])
        self.assertFalse(body['localGeneration']['readinessVerified'])
        server._creative_studio_generation.providers = {}
        server._creative_studio_generation_configuration_error = 'Explicit local configuration is invalid.'
        body = json.loads((await diagnostics.read_capabilities(None)).text)
        self.assertFalse(body['localGeneration']['configured'])
        self.assertEqual(body['localGeneration']['reason'], server._creative_studio_generation_configuration_error)


class FrontendRevalidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_actual_static_code_revalidates_and_etag_304_keeps_policy(self):
        from aiohttp import web
        from aiohttp.test_utils import TestClient, TestServer
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'Studio'
            root.mkdir()
            code = root / 'canvas.mjs'
            code.write_text('export const version = 1;', encoding='utf-8')
            app = web.Application()
            server = SimpleNamespace(app=app, routes=web.RouteTableDef())
            module.register_diagnostics(server, root)
            module.register_diagnostics(server, root)
            self.assertEqual(len(app.on_response_prepare), 1)
            async def serve_file(request):
                return web.FileResponse(code)
            app.router.add_get('/extensions/Studio/canvas.mjs', serve_file)
            app.router.add_get('/extensions/Other/canvas.mjs', serve_file)
            app.router.add_get('/view', serve_file)
            async with TestClient(TestServer(app)) as client:
                first = await client.get('/extensions/Studio/canvas.mjs')
                self.assertEqual(first.status, 200)
                self.assertEqual(first.headers['Cache-Control'], 'no-cache')
                etag = first.headers['ETag']
                await first.read()
                unchanged = await client.get('/extensions/Studio/canvas.mjs', headers={'If-None-Match': etag})
                self.assertEqual(unchanged.status, 304)
                self.assertEqual(unchanged.headers['Cache-Control'], 'no-cache')
                code.write_text('export const version = 222;', encoding='utf-8')
                changed = await client.get('/extensions/Studio/canvas.mjs', headers={'If-None-Match': etag})
                self.assertEqual(changed.status, 200)
                self.assertIn('222', await changed.text())
                for path in ('/view', '/extensions/Other/canvas.mjs'):
                    other = await client.get(path)
                    self.assertNotIn('Cache-Control', other.headers)
                    await other.read()


if __name__ == "__main__":
    unittest.main()
