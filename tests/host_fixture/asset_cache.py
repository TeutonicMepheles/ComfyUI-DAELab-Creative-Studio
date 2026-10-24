"""Prevent stale frontend modules in explicitly installed acceptance hosts only."""


async def no_store_test_code(request, response):
    path = request.path
    if request.method in {"GET", "HEAD"} and path.startswith("/extensions/") and path.endswith((".js", ".mjs", ".css", ".json")):
        response.headers["Cache-Control"] = "no-store, max-age=0"


def install_test_asset_cache_policy(server):
    callbacks = server.app.on_response_prepare
    if no_store_test_code not in callbacks:
        callbacks.append(no_store_test_code)
