"""Explicit routes for the shared service, without legacy LibTV channel aliases."""
import asyncio

from ..contracts.errors import ContractError, Conflict, InvalidInput, InvalidTransition, MissingRecord
from ..contracts.validation import identity
from ..providers.contracts import ProviderUnavailable
from ..providers.parameters import QWEN_MODEL
from .media import image_data_reference
from .optimization import OptimizationFacade


def routes(service):
    from aiohttp import web
    optimization = getattr(service, '_optimization_facade', None)
    if optimization is None:
        optimization = service._optimization_facade = OptimizationFacade(service)

    async def guarded(operation):
        try:
            result = await operation()
            return result if isinstance(result, web.StreamResponse) else web.json_response(result)
        except ContractError as error:
            return web.json_response({'error': str(error), 'code': error.code, 'submitted': False, 'originalTaskMayExist': True}, status=503 if isinstance(error, ProviderUnavailable) else 404 if isinstance(error, MissingRecord) else 409 if isinstance(error, (Conflict, InvalidTransition)) else 400)
        except (TypeError, ValueError, KeyError):
            return web.json_response({'error': 'Invalid generation request.', 'submitted': False}, status=400)
        except Exception:
            # Neither transport bodies, paths nor credentials are exposed.
            return web.json_response({'error': 'Task storage or service is unavailable; inspect the original request identity.', 'code': 'service_unavailable'}, status=503)

    async def read_payload(request):
        payload = await request.json()
        if not isinstance(payload, dict) or payload.get('contractVersion', 1) != 1:
            raise InvalidInput('Unsupported generation contract version.')
        return payload

    async def submit(request):
        async def run():
            payload = await read_payload(request)
            return {'jobs': await service.submit(payload['jobs'])}
        return await guarded(run)

    async def status(request):
        async def run():
            payload = await read_payload(request)
            if 'source' in payload:
                source = payload['source']
                if (set(payload) - {'contractVersion', 'source', 'limit', 'offset'} or not isinstance(source, dict)
                        or set(source) != {'documentId', 'tableId', 'nodeId'}):
                    raise InvalidInput('Discovery requires exact document, table and node identities.')
                for value in source.values():
                    identity(value, 'source query identity')
                limit, offset = payload.get('limit', 100), payload.get('offset', 0)
                jobs = await asyncio.to_thread(service.jobs.list_jobs,
                    source_filter={key: source[key] for key in ('documentId', 'tableId')}, limit=limit, offset=offset)
                # SQL applies both stable scope fields before pagination. nodeId is
                # checked before reading/publicizing any result; the cursor counts
                # scanned rows so an empty filtered page never hides later matches.
                selected = [job for job in jobs if job['source'].get('nodeId') == source['nodeId']]
                return {'jobs': [await asyncio.to_thread(service.public, job['request_id']) for job in selected],
                        'nextOffset': offset + len(jobs) if len(jobs) == limit else None}
            ids = payload.get('requestIds')
            if not isinstance(ids, list) or not 1 <= len(ids) <= 500:
                raise InvalidInput('Select between 1 and 500 task identities.')
            return {'jobs': [await asyncio.to_thread(service.public, value) for value in ids]}
        return await guarded(run)

    async def control(request, action):
        async def run():
            payload = await read_payload(request)
            ids = payload.get('requestIds')
            if not isinstance(ids, list) or not 1 <= len(ids) <= 500:
                raise InvalidInput('Select between 1 and 500 task identities.')
            for value in ids:
                await getattr(service, action)(value)
            return {'jobs': [await asyncio.to_thread(service.public, value) for value in ids]}
        return await guarded(run)

    async def recover(request):
        return await control(request, 'recover')

    async def fence_unsubmitted(request):
        async def run():
            return {'jobs': [await service.fence_unsubmitted(await read_payload(request))]}
        return await guarded(run)

    async def cancel(request):
        return await control(request, 'cancel')

    async def retry_local(request):
        async def run():
            payload = await read_payload(request)
            return {'jobs': [await service.retry_local(payload['requestId'], payload['newRequestId'])]}
        return await guarded(run)

    async def reconcile_resource(request):
        async def run():
            if service.admission is None or not hasattr(service.admission, 'reconcile'):
                raise ProviderUnavailable('Explicit local resource recovery is not assembled.')
            await service.admission.reconcile()
            return {'resource': 'reconciled', 'modelReadinessChecked': False}
        return await guarded(run)

    async def capabilities(request):
        async def run():
            return await service.capabilities(request.query.get('model'))
        return await guarded(run)

    async def polish(request):
        async def run():
            payload = await read_payload(request)
            if payload.get('model') != 'qwen':
                raise ProviderUnavailable('Only explicitly assembled local Qwen can execute; cloud adapters are protocol fixtures only.')
            service.provider('local-qwen-text')
            assets = []
            if payload.get('mode') == 'reverse':
                assets.append(await asyncio.to_thread(image_data_reference, service.assets, payload.get('imageDataUrl')))
            data = {key: payload.get(key) for key in ('model', 'mode', 'source', 'instruction')}
            data.update(entry='canvas', assets=assets)
            source_scope = payload.get('sourceScope')
            if source_scope is not None and not isinstance(source_scope, dict):
                raise InvalidInput('Optimization sourceScope must be an explicit JSON object.')
            jobs = await service.prepare_batch([{'requestId': payload.get('requestId'), 'input': data, 'source': source_scope or {}}])
            job = jobs[0]
            if job['state'] == 'pending':
                service._schedule(job['request_id'], service.dispatch(job['request_id']))
            worker = service._workers.get(job['request_id'])
            if worker is not None:
                await asyncio.shield(worker)
            report = await asyncio.to_thread(service.public, job['request_id'])
            if report['phase'] != 'complete':
                return web.json_response({'contractVersion': 1, **report, 'error': report['error'] or 'Original response is unavailable; do not automatically resubmit.'}, status=409)
            return {'contractVersion': 1, **report, 'model': QWEN_MODEL, 'provider': 'qwen', 'usage': report['receipt'].get('metadata', {}).get('usage', {})}
        return await guarded(run)

    def optimization_handler(action):
        async def handle(request):
            async def run():
                payload = await read_payload(request)
                if not isinstance(payload, dict) or payload.get('contractVersion') != 1:
                    raise InvalidInput('契约版本不支持')
                return await getattr(optimization, 'continue_batch' if action == 'continue' else action)(payload)
            return await guarded(run)
        return handle

    return [('GET', '/daelab/studio/generation/capabilities', capabilities),
            ('POST', '/daelab/studio/generation/submit', submit),
            ('POST', '/daelab/studio/generation/status', status),
            ('POST', '/daelab/studio/generation/recover', recover),
            ('POST', '/daelab/studio/generation/fence-unsubmitted', fence_unsubmitted),
            ('POST', '/daelab/studio/generation/cancel', cancel),
            ('POST', '/daelab/studio/generation/pause', cancel),
            ('POST', '/daelab/studio/generation/retry-local', retry_local),
            ('POST', '/daelab/studio/generation/reconcile-resource', reconcile_resource),
            ('POST', '/daelab/studio/optimization/submit', submit),
            ('POST', '/daelab/prompt-optimization/polish', polish)] + [
            ('POST', '/daelab/prompt-optimization/' + action, optimization_handler(action))
            for action in ('capabilities', 'estimate', 'lease', 'submit', 'query', 'recover', 'permit', 'advance', 'stop', 'continue', 'skip', 'fence')]
