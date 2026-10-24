"""Host wiring for persistent ports. No workers or provider submissions at import."""
import asyncio
from pathlib import Path

from ...assets import AssetCatalog
from ...jobs import JobLedger
from ...media.validation import MediaResultValidator
from ...contracts.errors import ContractError, MissingRecord
from .asset_api import AssetAPI


class CoreServices:
    def __init__(self, user_directory, input_directory, output_directory, *, temp_directory=None):
        product_user = Path(user_directory).resolve() / "daelab" / "creative-studio"
        database = product_user / "studio.sqlite3"
        roots = {"input": input_directory, "output": output_directory}
        if temp_directory is not None:
            roots["temp"] = temp_directory
        self.assets = AssetCatalog(database, roots=roots,
                                   frozen_root=product_user / "frozen-assets")
        self.jobs = JobLedger(database, result_validator=MediaResultValidator(self.assets))
        self.asset_api = AssetAPI(self.assets)
        # Restart reconciliation must be called by the execution lifecycle only once
        # it has proved all old workers stopped. A view/HTTP read never reconciles.
        self.routes = (("GET", "/daelab/studio/assets", self.search_assets),
                       ("GET", "/daelab/studio/jobs/{request_id}", self.read_job),
                       *self.asset_api.routes)

    async def search_assets(self, request):
        from aiohttp import web
        try:
            query = request.query.get("q", "")
            limit = int(request.query.get("limit", "100"))
            offset = int(request.query.get("offset", "0"))
            assets = await asyncio.to_thread(self.assets.search, query, kind=request.query.get("kind"), limit=limit, offset=offset)
            return web.json_response({"schemaVersion": 1, "assets": assets})
        except ContractError as error:
            return web.json_response({"error": error.public()}, status=400)
        except ValueError:
            return web.json_response({"error": {"code": "invalid_pagination", "message": "Asset pagination must be bounded integers.", "action": "review_input"}}, status=400)

    async def read_job(self, request):
        from aiohttp import web
        try:
            diagnostics = await asyncio.to_thread(self.jobs.diagnostics, request.match_info["request_id"])
            return web.json_response({"schemaVersion": 1, **diagnostics})
        except MissingRecord as error:
            return web.json_response({"error": error.public()}, status=404)
        except ContractError as error:
            return web.json_response({"error": error.public()}, status=400)


def register_core_services(server, *, user_directory, input_directory, output_directory, temp_directory=None):
    previous = getattr(server, "_creative_studio_services", None)
    if previous is not None:
        return previous
    instance = CoreServices(user_directory, input_directory, output_directory, temp_directory=temp_directory)
    existing = {(route.method, route.path) for route in server.routes
                if hasattr(route, "method") and hasattr(route, "path")}
    for method, route, _ in instance.routes:
        if (method, route) in existing:
            raise RuntimeError(f"Creative Studio service route already owned: {method} {route}")
    for method, route, handler in instance.routes:
        server.routes.route(method, route)(handler)
    server._creative_studio_services = instance
    return instance
