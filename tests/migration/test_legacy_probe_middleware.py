"""Real aiohttp middleware/WS chains on a temporary loopback test server only."""
import asyncio
import threading
import types
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, unused_port

from tools.migration.legacy_probe import probe
import test_legacy_probe as baseline

NONCE = baseline.NONCE


class LegacyMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    setUp = baseline.LegacyProbeTests.setUp
    module = baseline.LegacyProbeTests.module

    async def client(self, extra_middlewares=()):
        self.server.app = web.Application(middlewares=[self.module("prompt_optimization/local_qwen").gpu_middleware, *extra_middlewares])
        self.server.routes = web.RouteTableDef()
        self.synthetic_host_module.web = web
        exec("async def websocket_handler(request):\n    socket = web.WebSocketResponse()\n    await socket.prepare(request)\n    async for message in socket:\n        pass\n    return socket\n", vars(self.synthetic_host_module))
        ws = self.synthetic_host_module.websocket_handler
        self.server.routes.get("/ws")(ws)
        self.unknown_entered, self.unknown_done = asyncio.Event(), asyncio.Event()
        async def unknown(request):
            self.unknown_entered.set()
            await self.unknown_done.wait()
            return web.json_response({"done": True})
        self.server.routes.get("/unknown")(unknown)
        audit = patch.object(probe, "audit_host", return_value=(self.synthetic_audit, {"/ws": ws.__code__}, self.synthetic_host_module))
        audit.start()
        self.addCleanup(audit.stop)
        constructor = probe.IngressFence
        def capture(*args):
            self.fence = constructor(*args)
            return self.fence
        port = unused_port()
        with patch.object(probe, "IngressFence", side_effect=capture):
            probe.register(self.server, self.folder_paths, types.SimpleNamespace(port=port, listen="127.0.0.1"))
        self.server.app.add_routes(self.server.routes)
        client = TestClient(TestServer(self.server.app, port=port))
        await client.start_server()
        self.addAsyncCleanup(client.close)
        return client

    async def drained(self):
        for _ in range(50):
            if not self.fence.stack_requests:
                return
            await asyncio.sleep(.01)
        self.fail("Transparent request context survived request/WS exit")

    async def observed(self, client):
        async with client.get(probe.ENDPOINT + "?nonce=" + NONCE) as response:
            self.assertEqual(response.status, 200)
            return await response.json()

    async def test_exact_get_and_fence_middleware_chain_does_not_observe_itself(self):
        client = await self.client()
        result = await self.observed(client)
        self.assertEqual(result["observations"]["legacyStacks"], {
            "asyncTasksInLegacyCode": 0, "threadsInLegacyCode": 0, "threadsWithOwnedTargets": 0})
        self.assertEqual(result["blockers"], ["ingress-not-fenced"])
        async with client.post(probe.ENDPOINT + "/fence", json={"nonce": NONCE, "profileSha256": self.profile_hash}) as response:
            self.assertEqual(response.status, 200)
            fenced = await response.json()
        self.assertEqual(fenced["quiescence"], "clear")
        self.assertEqual((await self.observed(client))["quiescence"], "clear")
        await self.drained()

    async def test_existing_audited_native_ws_is_transparent_but_unknown_get_is_busy(self):
        client = await self.client()
        socket = await client.ws_connect("/ws")
        try:
            result = await self.observed(client)
            self.assertEqual(result["observations"]["legacyStacks"]["asyncTasksInLegacyCode"], 0)
            pending = asyncio.create_task(client.get("/unknown"))
            await self.unknown_entered.wait()
            try:
                result = await self.observed(client)
                self.assertGreaterEqual(result["observations"]["legacyStacks"]["asyncTasksInLegacyCode"], 1)
                self.assertIn("legacy-work-active", result["blockers"])
            finally:
                self.unknown_done.set()
                response = await pending
                response.release()
            async with client.post(probe.ENDPOINT + "/fence", json={"nonce": NONCE, "profileSha256": self.profile_hash}) as response:
                self.assertEqual((await response.json())["quiescence"], "clear")
            self.assertFalse(socket.closed)
        finally:
            await socket.close()
        await self.drained()

    async def test_real_owned_worker_coroutine_and_thread_remain_busy(self):
        client = await self.client()
        event = asyncio.Event()
        task = asyncio.create_task(self.module("prompt_optimization/canvas").polish(event))
        await asyncio.sleep(0)
        stop = threading.Event()
        thread = threading.Thread(target=self.module("prompt_optimization/canvas").synthetic_thread, args=(stop,))
        thread.start()
        try:
            result = await self.observed(client)
            counts = result["observations"]["legacyStacks"]
            self.assertGreaterEqual(counts["asyncTasksInLegacyCode"], 1)
            self.assertGreaterEqual(counts["threadsInLegacyCode"], 1)
            self.assertGreaterEqual(counts["threadsWithOwnedTargets"], 1)
            self.assertIn("legacy-work-active", result["blockers"])
        finally:
            event.set()
            await task
            stop.set()
            thread.join(timeout=2)

    async def test_replaced_legacy_middleware_code_is_unknown_not_exempted(self):
        client = await self.client()
        module = self.module("prompt_optimization/local_qwen")
        async def replaced(request, handler):
            return await handler(request)
        with patch.object(module, "gpu_middleware", replaced):
            result = await self.observed(client)
        self.assertEqual(result["quiescence"], "unknown")
        self.assertIsNone(result["observations"])
        self.assertIn("loaded-function-replaced", result["blockers"])

    async def test_same_thread_other_owned_middleware_is_never_exempted(self):
        # A second legacy frame is not hidden merely because this is our own
        # approved GET request and the GPU middleware is transparent.
        module = self.module("prompt_optimization/canvas")
        module.web = web
        source = "@web.middleware\nasync def other_owned_middleware(request, handler):\n    return await handler(request)\n"
        exec(compile(source, module.__file__, "exec"), vars(module))
        client = await self.client(extra_middlewares=[module.other_owned_middleware])
        result = await self.observed(client)
        self.assertGreaterEqual(result["observations"]["legacyStacks"]["threadsInLegacyCode"], 1)
        self.assertIn("legacy-work-active", result["blockers"])

    async def test_request_context_requires_exact_method_path_and_handler(self):
        await self.client()
        handler = self.fence.probe_handler
        self.assertEqual(self.fence.classify("GET", probe.ENDPOINT, handler), "control")
        self.assertEqual(self.fence.classify("POST", probe.ENDPOINT + "/fence", self.fence.fence_handler), "control")
        for method, path, actual in (("POST", probe.ENDPOINT, handler), ("GET", "/shadow", handler),
                                     ("GET", probe.ENDPOINT, self.fence.fence_handler),
                                     ("GET", "/ws", types.FunctionType(self.synthetic_host_module.websocket_handler.__code__, {"web": web}))):
            with self.subTest(method=method, path=path):
                self.assertEqual(self.fence.classify(method, path, actual), "mutation-or-unknown")


if __name__ == "__main__":
    unittest.main()
