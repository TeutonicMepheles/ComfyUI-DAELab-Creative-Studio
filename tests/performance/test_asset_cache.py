import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest


spec = importlib.util.spec_from_file_location("studio_test_asset_cache", Path(__file__).parents[1] / "host_fixture" / "asset_cache.py")
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


def check_code_and_media_policy():
    for path in ("/extensions/Studio/canvas.mjs", "/extensions/Studio/main.js", "/extensions/Studio/theme.css", "/extensions/Studio/build-manifest.json"):
        response = SimpleNamespace(headers={"ETag": "fixture-etag"})
        asyncio.run(cache.no_store_test_code(SimpleNamespace(path=path, method="GET"), response))
        assert response.headers == {"ETag": "fixture-etag", "Cache-Control": "no-store, max-age=0"}
    for path, method in (("/view", "GET"), ("/extensions/Studio/font.woff2", "GET"), ("/prompt", "POST")):
        response = SimpleNamespace(headers={"Cache-Control": "private"})
        asyncio.run(cache.no_store_test_code(SimpleNamespace(path=path, method=method), response))
        assert response.headers == {"Cache-Control": "private"}


def check_single_callback():
    server = SimpleNamespace(app=SimpleNamespace(on_response_prepare=[]))
    cache.install_test_asset_cache_policy(server)
    cache.install_test_asset_cache_policy(server)
    assert server.app.on_response_prepare == [cache.no_store_test_code]


class AcceptanceAssetCacheTests(unittest.TestCase):
    def test_code_changes_cannot_reuse_stale_cache_without_changing_media_policy(self):
        check_code_and_media_policy()

    def test_reinstallation_keeps_one_response_callback(self):
        check_single_callback()
