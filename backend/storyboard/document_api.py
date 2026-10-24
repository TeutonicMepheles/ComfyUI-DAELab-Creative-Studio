"""Document preview route with injected assembly and no global host singleton."""
import asyncio
from aiohttp import web
from .document_import import MAX_DOCUMENT_SIZE, parse_storyboard_document, preview_storyboard_document
from .http import document_body, register_definitions


def routes(services):
    async def import_document(request):
        try:
            payload, filename = await document_body(request, MAX_DOCUMENT_SIZE)
            parser = preview_storyboard_document if request.query.get('preview') == '1' else parse_storyboard_document
            return web.json_response(await asyncio.to_thread(parser, filename, payload))
        except (AssertionError, ValueError, TypeError, KeyError) as exc:
            return web.json_response({'error': str(exc)}, status=400)
        except Exception:
            return web.json_response({'error': '文档无法解析；原文件未修改'}, status=400)
    return [('POST', '/daelab/storyboard/import_document', import_document)]


def register(server, services):
    return register_definitions(server, services, routes(services))
