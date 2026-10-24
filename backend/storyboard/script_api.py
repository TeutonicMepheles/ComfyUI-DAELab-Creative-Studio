"""Explicit ScriptParser routes; construction never calls a model or opens a file."""
import asyncio
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile
from aiohttp import web

from .http import document_body, json_body, register_definitions
from .script_document import MAX_DOCUMENT_SIZE
from .services import ProviderUnavailable

INPUT_ERRORS = (ValueError, TypeError, KeyError, IndexError, ParseError, BadZipFile)


def routes(services):
    async def document(request):
        try:
            payload, filename = await document_body(request, MAX_DOCUMENT_SIZE)
            result = await asyncio.to_thread(services.import_document, payload, filename)
            return web.json_response(result)
        except INPUT_ERRORS as exc:
            return web.json_response({'error': str(exc)}, status=400)
        except OSError:
            return web.json_response({'error': '文档存储不可用；请保留原件后重试'}, status=503)

    async def normalize(request):
        try:
            body = await json_body(request)
            result = await asyncio.to_thread(services.normalize, body)
            return web.json_response(result)
        except INPUT_ERRORS as exc:
            return web.json_response({'error': str(exc)}, status=400)

    async def ai_status(request):
        configured = services.classifier is not None
        return web.json_response({'configured': configured,
                                  'model': services.classifier_model if configured else '',
                                  **({} if configured else {'error': 'AI 归类未接入，可继续手工映射'})})

    async def classify(request):
        try:
            result = await services.classify(await json_body(request))
            return web.json_response({'choices': result})
        except ProviderUnavailable as exc:
            return web.json_response({'error': str(exc), 'code': 'provider_unavailable'}, status=503)
        except INPUT_ERRORS as exc:
            return web.json_response({'error': str(exc)}, status=400)
        except Exception:
            # Never expose provider endpoints, credentials or response bodies.
            return web.json_response({'error': '归类服务失败；原草稿保留，可手工处理'}, status=502)

    return [('POST', '/daelab/script-parser/document', document),
            ('POST', '/daelab/script-parser/normalize', normalize),
            ('GET', '/daelab/script-parser/ai-status', ai_status),
            ('POST', '/daelab/script-parser/classify', classify)]


def register(server, services):
    return register_definitions(server, services, routes(services))
