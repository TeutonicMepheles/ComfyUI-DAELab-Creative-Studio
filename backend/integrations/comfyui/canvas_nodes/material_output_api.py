import asyncio
from aiohttp import web
import folder_paths
from ....media.material_output_files import import_materials
from ..asset_api import register_asset, asset_source
from ....contracts.errors import ContractError, StorageError

_catalog = None

def bind_asset_catalog(catalog):
    global _catalog
    _catalog = catalog


async def output_materials(request):
    if request.remote not in ('127.0.0.1','::1'):
        return web.json_response({'error':'请从本机使用素材输出'},status=403)
    origin=request.headers.get('Origin')
    if origin and origin.rstrip('/') not in ('http://'+request.host,'https://'+request.host):
        return web.json_response({'error':'来源不匹配'},status=403)
    try:
        body=await request.json()
        if not isinstance(body, dict):
            raise ValueError("素材输出请求需要 JSON 对象")
        if _catalog is None:
            raise StorageError('资产目录不可用；原素材已保留')
        catalog = _catalog
        source = asset_source(body.get('source', {'operation':'material-output'}))
        assets=await asyncio.to_thread(import_materials,body.get('assets'),
            folder_paths.get_input_directory(),folder_paths.get_output_directory(),
            register=lambda value:register_asset(catalog,{**value,'source':{**source,**value.get('source',{})}}))
        return web.json_response({'assets':assets})
    except ContractError as error:
        return web.json_response({'error':error.public()['message']},status=503 if isinstance(error,StorageError) else 400)
    except (ValueError,TypeError,KeyError,OSError) as error:
        return web.json_response({'error':str(error)},status=400)


ROUTES = (("POST", "/daelab/creative/material-output", output_materials),)
