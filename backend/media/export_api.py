"""Explicit same-origin export routes; blocking file/SQLite work leaves the loop."""
import asyncio
import json

from ..contracts.errors import ContractError, Conflict, InvalidInput, InvalidTransition, MissingRecord, StorageError
from ..contracts.validation import clean_json
from ..providers.contracts import ProviderUnavailable


class ExportAPI:
    def __init__(self, service):
        self.service = service
        prefix = '/daelab/studio/media-exports'
        self.routes = (('POST', prefix, self.submit), ('GET', prefix + '/{request_id}', self.get),
                       ('POST', prefix + '/{request_id}/cancel', self.cancel),
                       ('POST', prefix + '/{request_id}/recover', self.recover))

    @staticmethod
    async def _body(request):
        if (request.headers.get('Origin') != f'{request.scheme}://{request.host}'
                or request.headers.get('Sec-Fetch-Site') == 'cross-site'):
            raise InvalidInput('Export writes require the current ComfyUI origin.')
        if request.content_type != 'application/json':
            raise InvalidInput('Export requests require application/json.')
        raw = bytearray()
        async for chunk in request.content.iter_chunked(65536):
            raw.extend(chunk)
            if len(raw) > 2 * 1024 * 1024:
                raise InvalidInput('Export request exceeds its size limit.')
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise InvalidInput('Export request is not valid JSON.') from None
        if not isinstance(value, dict):
            raise InvalidInput('Export request must be an object.')
        clean_json(value)
        return value

    @staticmethod
    def _failure(exc):
        from aiohttp import web
        if not isinstance(exc, ContractError):
            exc = StorageError('Export could not complete; inspect the original request before taking another action.')
        status = (404 if isinstance(exc, MissingRecord) else 409 if isinstance(exc, (Conflict, InvalidTransition))
                  else 503 if isinstance(exc, (ProviderUnavailable, StorageError)) else 400)
        return web.json_response({'error': exc.public()}, status=status)

    async def submit(self, request):
        from aiohttp import web
        try:
            value = await self._body(request)
            if set(value) - {'requestId', 'edit_data', 'connections', 'source'} or not {'requestId', 'edit_data'} <= set(value):
                raise InvalidInput('Export requires requestId and edit_data with optional connections/source.')
            job = await self.service.submit(value['requestId'], value['edit_data'],
                                           connections=value.get('connections'), source=value.get('source'))
            return web.json_response(self.service.view(job), status=202)
        except Exception as exc:
            return self._failure(exc)

    async def get(self, request):
        from aiohttp import web
        try:
            return web.json_response(await asyncio.to_thread(self.service.get, request.match_info['request_id']))
        except Exception as exc:
            return self._failure(exc)

    async def cancel(self, request):
        from aiohttp import web
        try:
            value = await self._body(request)
            if set(value) != {'expectedVersion'}:
                raise InvalidInput('Cancellation requires the last observed expectedVersion.')
            job = await self.service.cancel(request.match_info['request_id'], expected_version=value['expectedVersion'])
            return web.json_response(self.service.view(job))
        except Exception as exc:
            return self._failure(exc)

    async def recover(self, request):
        from aiohttp import web
        try:
            if await self._body(request) != {}:
                raise InvalidInput('Recovery queries the original identity and accepts no replacement inputs.')
            job = await self.service.recover(request.match_info['request_id'])
            return web.json_response(self.service.view(job))
        except Exception as exc:
            return self._failure(exc)
