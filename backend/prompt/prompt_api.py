"""Explicit prompt parse/review/validate route; no generation or provider import."""
import asyncio
from aiohttp import web
from ..storyboard.http import json_body, register_definitions
from ..storyboard.services import ProviderUnavailable
from .prompt_service import parse_request


def routes(services):
    async def parse_prompts(request):
        try:
            payload = await json_body(request)
            result = await asyncio.to_thread(parse_request, payload, services.resolve_media)
            return web.json_response(result)
        except ProviderUnavailable as exc:
            return web.json_response({'error': str(exc), 'code': 'service_unavailable'}, status=503)
        except (ValueError, TypeError, KeyError) as exc:
            return web.json_response({'error': str(exc)}, status=400)
    return [('POST', '/daelab/storyboard/parse-prompts', parse_prompts)]


def register(server, services):
    return register_definitions(server, services, routes(services))
