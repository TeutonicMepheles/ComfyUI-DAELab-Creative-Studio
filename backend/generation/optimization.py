"""Old optimization UI DTOs over the shared ledger; controls are ephemeral.

No second job store exists. Batch membership and frozen inputs are immutable job
source/snapshot data. Losing leases, quotes or permits pauses untouched rows.
"""
import asyncio
import hashlib
import json
import math
import time
import uuid
from datetime import datetime

from ..contracts.errors import Conflict, InvalidInput, MissingRecord
from ..contracts.validation import identity, clean_json
from ..providers.contracts import ProviderUnavailable
from ..providers.parameters import QWEN_MODEL
from ..providers.optimization_contract import validate_snapshot, suggestion, MODEL_LIMITS
from ..providers.optimization_instructions import INSTRUCTIONS, INSTRUCTION_VERSION, INSTRUCTION_DIGEST, INPUT_VERSION

ACTIVE = {'submitting', 'submitted', 'running', 'fetching', 'needs_recovery'}
OPERATION = 'prompt_optimization'
PROVIDERS = {QWEN_MODEL: 'qwen', 'deepseek-flash': 'deepseek'}
PROVIDER_IDS = {QWEN_MODEL: 'local-qwen-text', 'deepseek-flash': 'deepseek-text'}


def now():
    return int(time.time() * 1000)


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def table_target(value):
    if not isinstance(value, dict) or set(value) != {'documentId', 'tableId'}:
        raise InvalidInput('Optimization requires a document and table identity.')
    return {key: identity(value[key], key) for key in value}


class OptimizationFacade:
    def __init__(self, service):
        self.service = service
        self.quotes, self.leases, self.permits, self.controls = {}, {}, {}, {}
        self.lock = asyncio.Lock()

    def _prune(self):
        for mapping in (self.quotes, self.leases, self.permits):
            for key in list(mapping):
                if mapping[key]['expiresAt'] <= now():
                    del mapping[key]

    def _jobs(self, **source):
        rows, offset = [], 0
        while True:
            page = self.service.jobs.list_jobs(source_filter={'operation': OPERATION, **source}, limit=500, offset=offset)
            rows.extend(page)
            if len(page) < 500:
                return rows
            offset += len(page)

    def _batch(self, batch_id):
        rows = self._jobs(batchId=identity(batch_id, 'batch ID'))
        if not rows:
            raise MissingRecord('找不到优化任务')
        return sorted(rows, key=lambda job: job['source']['position'])

    def _control(self, batch_id):
        return self.controls.setdefault(batch_id, {'paused': True, 'stopped': False, 'quoteId': None})

    def _overlap(self, jobs, batch_id, selected):
        return any(j['source']['batchId'] != batch_id
                   and digest(self._snapshot(j)['target']) in selected
                   and (j['state'] in ACTIVE or j['request_id'] in self.service._workers
                        or j['state'] == 'pending' and not self._control(j['source']['batchId'])['stopped']) for j in jobs)

    def _lease(self, target, lease_id):
        lease = self.leases.get(digest(table_target(target)))
        if not lease or lease['leaseId'] != lease_id or lease['expiresAt'] <= now():
            raise Conflict('控制租约已失效，请重新取得控制权')
        return lease

    @staticmethod
    def _target(job):
        return {key: job['source'][key] for key in ('documentId', 'tableId')}

    def _quote(self, quote_id, snapshots, budget):
        quote = self.quotes.get(quote_id)
        for snapshot in snapshots:
            validate_snapshot(snapshot)
        if not quote or quote['expiresAt'] <= now() or quote['snapshotDigest'] != digest(snapshots):
            raise Conflict('估算已失效或快照已改变，请重新估算')
        if isinstance(budget, bool) or not isinstance(budget, (int, float)) or not math.isfinite(budget) or budget < 0:
            raise InvalidInput('确认预算无效')
        if budget < quote['budgetUpperCredits']:
            raise InvalidInput('Confirmed budget is below the estimated upper bound.')
        return quote

    @staticmethod
    def _snapshot(job):
        return job['snapshot'].get('optimizationMeta') or job['snapshot']['input']['optimization']

    async def _report(self, jobs):
        # Ephemeral controls are owned by the event loop. The worker receives a
        # value snapshot; result validation and related ledger reads run together.
        control = dict(self._control(jobs[0]['source']['batchId']))
        return await asyncio.to_thread(self._build_report, jobs, control)

    def _build_report(self, jobs, control, related=None):
        first = jobs[0]
        source = first['source']
        rows = []
        for job in jobs:
            snapshot = self._snapshot(job)
            status = {'pending': 'stopped' if control['stopped'] else 'queued', 'running': 'polling', 'fetching': 'polling', 'needs_recovery': 'submitted', 'cancelled': 'skipped'}.get(job['state'], job['state'])
            row = {'requestId': job['request_id'], 'snapshot': snapshot, 'status': status,
                   'remoteResponseId': job['provider_task_id'], 'actualCredits': None, 'error': job['error_code'],
                   'version': job['version'], 'inputFingerprint': job['fingerprint'], 'source': job['source'],
                   'replacementAllowed': job['state'] == 'cancelled' and job['cancel_requested'] and job['attempt'] == 0}
            if job['state'] == 'succeeded':
                text = job['result'].get('text', '')
                row['suggestion'] = suggestion({'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': text}]}]}, snapshot)
                row['usage'] = job['result'].get('metadata', {}).get('usage', {})
            rows.append(row)
        return {'contractVersion': 1, 'batchId': source['batchId'], 'quoteId': control['quoteId'] or source['quoteId'],
                'range': source['range'], 'provider': self._price(source['model'])['provider'], 'currency': self._price(source['model'])['currency'], 'price': self._price(source['model']),
                'budgetCredits': control.get('budgetCredits', source.get('budgetCredits', 0)), 'paused': control['paused'], 'stopped': control['stopped'], 'rows': rows,
                'preflightSkipped': source.get('skipped', []), 'updatedAt': max(int(datetime.fromisoformat(j['updated_at']).timestamp() * 1000) for j in jobs),
                'unknownRequests': self._unknown([row['snapshot'] for row in rows], related)}

    def _unknown(self, snapshots, related=None):
        target = {key: snapshots[0]['target'][key] for key in ('documentId', 'tableId')}
        targets = {digest(s['target']) for s in snapshots}
        return [{'requestId': j['request_id'], 'batchId': j['source']['batchId'], 'target': self._snapshot(j)['target'], 'model': self._snapshot(j)['model']}
                for j in (self._jobs(**target) if related is None else related) if j['state'] == 'unknown' and digest(self._snapshot(j)['target']) in targets]

    @staticmethod
    def _price(model=QWEN_MODEL):
        if model == 'deepseek-flash':
            return {'provider': 'deepseek', 'currency': 'USD', 'model': model, 'input': .3, 'output': 1.2,
                    'version': 'deepseek-flash-20261030', 'unit': '1M tokens', 'basis': 'Official peak uncached USD rates; provider billing is authoritative.'}
        return {'provider': 'qwen', 'currency': 'local', 'model': QWEN_MODEL, 'input': 0, 'output': 0,
                'version': 'local-no-cloud-charge-v1', 'unit': 'local', 'basis': '本地执行；无云端积分扣费，不代表已完成生成。'}

    async def capabilities(self, payload):
        model = payload.get('model', QWEN_MODEL)
        if model not in PROVIDERS:
            raise ProviderUnavailable('Unsupported optimization model.')
        cap = await self.service.capabilities(model)
        return {'contractVersion': 1, 'available': bool(cap.get('available')),
                'models': [{'id': model, 'label': 'DeepSeek API' if model == 'deepseek-flash' else 'Qwen3.5-9B',
                            'provider': PROVIDERS[model], 'available': bool(cap.get('available')), **MODEL_LIMITS[model]}],
                'defaultModel': model, 'instructionVersion': INSTRUCTION_VERSION, 'instructionDigest': INSTRUCTION_DIGEST,
                'inputVersion': INPUT_VERSION, 'price': self._price(model), 'deepseekKeyConfigured': cap.get('deepseekKeyConfigured', False),
                'tokenAlgorithm': 'utf8-byte-upper-bound-v1'}

    async def estimate(self, payload):
        snapshots = payload.get('rows')
        if not isinstance(snapshots, list) or not 1 <= len(snapshots) <= 500:
            raise InvalidInput('Select between 1 and 500 optimization rows.')
        for s in snapshots:
            validate_snapshot(s)
            if s['model'] != payload.get('model') or s['model'] not in PROVIDERS:
                raise ProviderUnavailable('Unsupported optimization model.')
            count = len(INSTRUCTIONS.encode()) + len(s['inputText'].encode()) + 64
            if count + s['maxOutputTokens'] > MODEL_LIMITS[s['model']]['contextTokens']:
                raise InvalidInput('完整输入与输出预算超出此模型上下文限制')
        if len({digest({k: s['target'][k] for k in ('documentId', 'tableId')}) for s in snapshots}) != 1 or len({digest(s['target']) for s in snapshots}) != len(snapshots):
            raise InvalidInput('范围必须属于同一表格，且目标不能重复')
        await self.capabilities(payload)
        self._prune()
        price = self._price(payload['model'])
        quote = {'contractVersion': 1, 'quoteId': str(uuid.uuid4()), 'snapshotDigest': digest(snapshots), 'status': 'ready',
                 'price': price, 'provider': price['provider'], 'currency': price['currency'], 'inputTokens': sum(len(INSTRUCTIONS.encode()) + len(s['inputText'].encode()) + 64 for s in snapshots),
                 'expectedOutputTokens': sum(min(s['maxOutputTokens'], max(32, math.ceil(len(s['input']['prompt_text'].encode()) * .65))) for s in snapshots),
                 'maxOutputTokens': sum(s['maxOutputTokens'] for s in snapshots), 'estimatedCredits': 0, 'budgetUpperCredits': 0,
                 'expiresAt': now() + 300000, 'tokenAlgorithm': 'utf8-byte-upper-bound-v1', 'processed': len(snapshots),
                 'skipped': payload.get('skipped', []), 'unknownRequests': (await asyncio.to_thread(self._unknown, snapshots))}
        quote['estimatedCredits'] = (quote['inputTokens'] * price['input'] + quote['expectedOutputTokens'] * price['output']) / 1000000
        quote['budgetUpperCredits'] = (quote['inputTokens'] * price['input'] + quote['maxOutputTokens'] * price['output']) / 1000000
        self.quotes[quote['quoteId']] = quote
        return dict(quote)

    async def lease(self, payload):
        target = table_target(payload['target'])
        instance = identity(payload['instanceId'], 'instance ID')
        async with self.lock:
            key = digest(target)
            old = self.leases.get(key)
            if old and old['expiresAt'] > now() and old['instanceId'] != instance:
                raise Conflict('此表格已由另一个视图控制')
            if old is None or old['expiresAt'] <= now():
                for job in (await asyncio.to_thread(self._jobs, **target)):
                    self._control(job['source']['batchId'])['paused'] = True
            value = {'contractVersion': 1, 'leaseId': old['leaseId'] if old and old['expiresAt'] > now() else str(uuid.uuid4()), 'instanceId': instance, 'expiresAt': now() + 15000}
            self.leases[key] = value
            return dict(value)

    def _submission_items(self, payload, skipped):
        clean_json(payload)
        batch_id, quote_id = identity(payload['batchId'], 'batch ID'), identity(payload['quoteId'], 'quote ID')
        rows, scope = payload['rows'], payload['range']
        if not isinstance(rows, list) or not 1 <= len(rows) <= 500:
            raise InvalidInput('Select between 1 and 500 optimization rows.')
        if not isinstance(scope, dict):
            raise InvalidInput('Optimization scope is invalid.')
        snapshots = [row['snapshot'] for row in rows]
        for snapshot in snapshots: validate_snapshot(snapshot)
        keys = {'scope', 'fieldId', 'recordId'} if scope.get('scope') == 'cell' else {'scope', 'fieldId'}
        if scope.get('scope') not in ('cell', 'column') or set(scope) != keys or any(s['target']['fieldId'] != scope['fieldId'] for s in snapshots) or (scope['scope'] == 'cell' and (len(rows) != 1 or snapshots[0]['target']['recordId'] != scope['recordId'])):
            raise InvalidInput('范围字段与冻结行不一致')
        target = {k: snapshots[0]['target'][k] for k in ('documentId', 'tableId')}
        submission_digest = digest({k: payload[k] for k in ('quoteId', 'batchId', 'rows', 'budgetCredits', 'range')})
        items, seen = [], set()
        for i, row in enumerate(rows):
            request_id = identity(row['requestId'], 'request ID')
            if request_id in seen: raise InvalidInput('Duplicate optimization request identity.')
            seen.add(request_id)
            snapshot = row['snapshot']
            if any(snapshot['target'][key] != value for key, value in target.items()): raise Conflict('Optimization rows belong to different tables.')
            owner = row.get('source') or {}
            if owner:
                self.service._correlation_scope(owner, required=True)
                if any(owner.get(key) != value for key, value in snapshot['target'].items()) or owner['inputDigest'] != snapshot['snapshotDigest'] or owner['model'] != snapshot['model']:
                    raise Conflict('Optimization source does not match its frozen target and digest.')
            source = {**owner, **target, 'operation': OPERATION, 'batchId': batch_id, 'quoteId': quote_id,
                      'position': i, 'rowCount': len(rows), 'submissionDigest': submission_digest, 'range': scope,
                      'skipped': skipped, 'recordId': snapshot['target']['recordId'], 'fieldId': scope['fieldId'],
                      'inputDigest': snapshot['snapshotDigest'], 'model': snapshot['model']}
            if snapshot['model'] == 'deepseek-flash':
                source['budgetCredits'] = payload['budgetCredits']
            items.append({'requestId': request_id, 'input': {'entry': 'table', 'model': snapshot['model'], 'optimization': snapshot}, 'source': source})
        return items

    def _fence_references(self, payload):
        # Persistable references contain only identities and digests, never prompts.
        if set(payload) - {'contractVersion', 'provider', 'batchId', 'quoteId', 'range', 'references'}:
            raise InvalidInput('Unexpected optimization fence reference field.')
        clean_json(payload)
        if payload.get('provider', 'qwen') not in PROVIDERS.values(): raise InvalidInput('Unsupported optimization provider.')
        batch_id, quote_id = identity(payload['batchId'], 'batch ID'), identity(payload['quoteId'], 'quote ID')
        refs, scope = payload['references'], payload['range']
        if not isinstance(refs, list) or not 1 <= len(refs) <= 500 or not isinstance(scope, dict):
            raise InvalidInput('Invalid optimization fence references.')
        keys = {'scope', 'fieldId', 'recordId'} if scope.get('scope') == 'cell' else {'scope', 'fieldId'}
        if scope.get('scope') not in ('cell', 'column') or set(scope) != keys or scope['scope'] == 'cell' and len(refs) != 1:
            raise InvalidInput('Invalid optimization fence range.')
        result, seen, target = [], set(), None
        for i, ref in enumerate(refs):
            if not isinstance(ref, dict) or set(ref) != {'requestId', 'source', 'revision', 'requestSeq'}:
                raise InvalidInput('Invalid optimization fence reference.')
            request_id = identity(ref['requestId'], 'request ID')
            if request_id in seen: raise InvalidInput('Duplicate optimization fence reference.')
            seen.add(request_id)
            owner = ref['source']; self.service._correlation_scope(owner, required=True)
            if owner['model'] not in PROVIDERS or PROVIDERS[owner['model']] != payload.get('provider', 'qwen') or owner['fieldId'] != scope['fieldId'] or scope['scope'] == 'cell' and owner['recordId'] != scope['recordId']:
                raise Conflict('Optimization fence reference and range differ.')
            for key in ('revision', 'requestSeq'):
                if not isinstance(ref[key], int) or isinstance(ref[key], bool) or not 0 <= ref[key] <= 2**53 - 1:
                    raise InvalidInput('Invalid optimization fence revision.')
            row_target = {key: owner[key] for key in ('documentId', 'tableId', 'recordId', 'fieldId')}
            table = {key: owner[key] for key in ('documentId', 'tableId')}
            if target is not None and table != target: raise Conflict('Optimization references span tables.')
            target = table
            source = {**owner, 'operation': OPERATION, 'batchId': batch_id, 'quoteId': quote_id,
                      'position': i, 'rowCount': len(refs), 'range': scope,
                      'submissionDigest': digest(payload), 'skipped': []}
            meta = {'target': row_target, 'model': owner['model'], 'snapshotDigest': owner['inputDigest'],
                    'revision': ref['revision'], 'requestSeq': ref['requestSeq']}
            try: existing = self.service.jobs.get(request_id)
            except MissingRecord: existing = None
            if existing:
                expected = {**owner, 'operation': OPERATION, 'batchId': batch_id, 'position': i, 'rowCount': len(refs), 'range': scope}
                if existing['provider'] != PROVIDER_IDS[owner['model']] or any(existing['source'].get(key) != value for key, value in expected.items()) or any(self._snapshot(existing).get(key) != value for key, value in meta.items()):
                    raise Conflict('Original optimization owner, input digest or revision differs.')
                source = existing['source']
            result.append((request_id, source, meta))
        return result

    async def fence(self, payload):
        skipped = list((self.quotes.get(payload.get('quoteId')) or {}).get('skipped', []))
        jobs = await asyncio.to_thread(self._fence_jobs, payload, skipped)
        return await self._report(jobs)

    def _fence_jobs(self, payload, skipped):
        # Cancellation must be able to race a prepare currently awaiting provider
        # preflight under the facade lock. Each row competes atomically in SQLite.
        if 'references' in payload:
            references = self._fence_references(payload)
            results = [self.service._reserve_barrier(request_id, PROVIDER_IDS[metadata['model']], source,
                       preparation='fenced', optimization_meta=metadata) for request_id, source, metadata in references]
            return results
        items = self._submission_items(payload, skipped)
        results = []
        for item in items:
            # New UI callers retain the exact source ticket in their submit intent.
            owner = next(row.get('source') for row in payload['rows'] if row['requestId'] == item['requestId'])
            self.service._correlation_scope(owner, required=True)
            try:
                existing = self.service.jobs.get(item['requestId'])
            except MissingRecord:
                existing = None
            if existing:
                expected = item['source']
                if existing['provider'] != PROVIDER_IDS[item['input']['model']] or any(existing['source'].get(key) != value for key, value in expected.items() if key != 'skipped'):
                    raise Conflict('Original optimization request has different owner or frozen submission.')
                item['source'] = existing['source']
            from ..contracts.validation import digest as request_digest
            fingerprint = request_digest({'provider': PROVIDER_IDS[item['input']['model']], 'input': item['input'], 'source': item['source']})
            snapshot = item['input']['optimization']
            metadata = {key: snapshot[key] for key in ('target', 'model', 'snapshotDigest', 'revision', 'requestSeq')}
            results.append(self.service._reserve_barrier(item['requestId'], PROVIDER_IDS[item['input']['model']], item['source'], preparation='fenced', request_fingerprint=fingerprint, optimization_meta=metadata))
        return results

    async def submit(self, payload):
        async with self.lock:
            batch_id = identity(payload['batchId'], 'batch ID')
            rows = payload['rows']
            if not isinstance(rows, list) or not 1 <= len(rows) <= 500:
                raise InvalidInput('Select between 1 and 500 optimization rows.')
            submission_digest = digest({k: payload[k] for k in ('quoteId', 'batchId', 'rows', 'budgetCredits', 'range')})
            existing = (await asyncio.to_thread(self._jobs, batchId=batch_id))
            if existing:
                if any(j['source'].get('submissionDigest') != submission_digest for j in existing) or len(existing) != len(rows):
                    raise Conflict('相同批次 ID 的内容冲突')
                return (await self._report(sorted(existing, key=lambda j: j['source']['position'])))
            snapshots = [row['snapshot'] for row in rows]
            quote = self._quote(payload['quoteId'], snapshots, payload['budgetCredits'])
            scope = payload['range']
            keys = {'scope', 'fieldId', 'recordId'} if scope.get('scope') == 'cell' else {'scope', 'fieldId'}
            if scope.get('scope') not in ('cell', 'column') or set(scope) != keys or any(s['target']['fieldId'] != scope['fieldId'] for s in snapshots) or (scope['scope'] == 'cell' and (len(rows) != 1 or snapshots[0]['target']['recordId'] != scope['recordId'])):
                raise InvalidInput('范围字段与冻结行不一致')
            target = {k: snapshots[0]['target'][k] for k in ('documentId', 'tableId')}
            self._lease(target, payload['leaseId'])
            previous = (await asyncio.to_thread(self._jobs, **target))
            selected = {digest(s['target']) for s in snapshots}
            if self._overlap(previous, batch_id, selected):
                raise Conflict('请求范围与已有活动任务重叠；请先查看原任务，未创建新任务。')
            unknown = {r['requestId'] for r in (await asyncio.to_thread(self._unknown, snapshots))}
            if not unknown <= {r['requestId'] for r in quote['unknownRequests']} or not unknown <= set(payload.get('acknowledgeUnknownRequestIds', [])):
                raise Conflict('历史未知请求已变化或尚未确认；不会自动重新提交。')
            jobs = await self.service.prepare_batch((await asyncio.to_thread(self._submission_items, payload, quote['skipped'])))
            self.controls[batch_id] = {'paused': False, 'stopped': False, 'quoteId': quote['quoteId'], 'budgetCredits': payload['budgetCredits']}
            return (await self._report(jobs))

    async def query(self, payload):
        if payload.get('batchId'):
            return (await self._report((await asyncio.to_thread(self._batch, payload['batchId']))))
        jobs = (await asyncio.to_thread(self._jobs, **table_target(payload['target'])))
        groups = {}
        for job in jobs:
            groups.setdefault(job['source']['batchId'], []).append(job)
        controls = {key: dict(self._control(key)) for key in groups}
        return await asyncio.to_thread(self._batch_summaries, groups, controls, jobs)

    def _batch_summaries(self, groups, controls, related):
        summaries = []
        for batch_id, values in groups.items():
            report = self._build_report(values, controls[batch_id], related)
            counts = {}
            for row in report['rows']:
                counts[row['status']] = counts.get(row['status'], 0) + 1
            summaries.append({'batchId': report['batchId'], **report['range'], 'rowCount': len(values), 'statusCounts': counts, 'paused': report['paused'], 'stopped': report['stopped'], 'updatedAt': report['updatedAt']})
        return {'contractVersion': 1, 'batches': sorted(summaries, key=lambda s: s['updatedAt'], reverse=True)}

    async def recover(self, payload):
        jobs = (await asyncio.to_thread(self._batch, payload['batchId']))
        for job in jobs:
            if job['state'] in ACTIVE | {'unknown'}:
                self.service._schedule(job['request_id'], self.service.recover(job['request_id']))
        return (await self._report((await asyncio.to_thread(self._batch, payload['batchId']))))

    async def permit(self, payload):
        async with self.lock:
            jobs = (await asyncio.to_thread(self._batch, payload['batchId']))
            self._lease(self._target(jobs[0]), payload['leaseId'])
            control = self._control(payload['batchId'])
            job = next((j for j in jobs if j['request_id'] == payload['requestId']), None)
            if control['paused'] or control['stopped'] or not job or self.service._barrier(job) or job['state'] != 'pending' or any(j['state'] in ACTIVE for j in jobs):
                raise Conflict('此任务当前不能提交')
            snapshot = job['snapshot']['input']['optimization']
            if any(payload[k] != snapshot[k] for k in ('snapshotDigest', 'revision', 'requestSeq')):
                raise Conflict('当前表格与快照冲突')
            permit = {'contractVersion': 1, 'permitId': str(uuid.uuid4()), 'expiresAt': now() + 3000, **{k: payload[k] for k in ('batchId', 'requestId', 'leaseId')}}
            self.permits[permit['permitId']] = permit
            return dict(permit)

    async def advance(self, payload):
        async with self.lock:
            jobs = (await asyncio.to_thread(self._batch, payload['batchId']))
            self._lease(self._target(jobs[0]), payload['leaseId'])
            control = self._control(payload['batchId'])
            selected = next((j for j in jobs if j['request_id'] == payload['requestId']), None)
            if selected and selected['provider'] == 'deepseek-text':
                self.service.provider('deepseek-text').require_key()
            permit = self.permits.pop(payload['permitId'], None)
            if not permit or permit['expiresAt'] <= now() or any(permit[k] != payload[k] for k in ('batchId', 'requestId', 'leaseId')):
                raise Conflict('提交许可已过期或已消费')
            if control['paused'] or control['stopped'] or any(j['state'] in ACTIVE or j['request_id'] in self.service._workers for j in jobs):
                raise Conflict('任务已停止、暂停或有请求在途')
            job = next((j for j in jobs if j['request_id'] == payload['requestId']), None)
            if not job or self.service._barrier(job) or job['state'] != 'pending' or payload.get('provider', 'qwen') != PROVIDERS[job['source']['model']]:
                raise Conflict('此任务当前不能提交')
            self._quote(control['quoteId'], [j['snapshot']['input']['optimization'] for j in jobs], control.get('budgetCredits', job['source'].get('budgetCredits', 0)))
            def authorized():
                if control['paused'] or control['stopped']:
                    return False
                try:
                    self._lease(self._target(job), payload['leaseId'])
                    self._quote(control['quoteId'], [j['snapshot']['input']['optimization'] for j in jobs], control.get('budgetCredits', job['source'].get('budgetCredits', 0)))
                    return True
                except (Conflict, ValueError):
                    control['paused'] = True
                    return False
            self.service._schedule(job['request_id'], self.service.dispatch(job['request_id'], before_submit=authorized))
            # Worker ownership starts now; the ledger's atomic claim remains the
            # sole durable external-submission boundary.
            report = (await self._report(jobs))
            for row in report['rows']:
                if row['requestId'] == job['request_id']:
                    row['status'] = 'preparing'
            return report

    async def stop(self, payload):
        async with self.lock:
            jobs = (await asyncio.to_thread(self._batch, payload['batchId']))
            self._lease(self._target(jobs[0]), payload['leaseId'])
            self._control(payload['batchId']).update(paused=True, stopped=True)
            return (await self._report(jobs))

    async def continue_batch(self, payload):
        async with self.lock:
            jobs = (await asyncio.to_thread(self._batch, payload['batchId']))
            if any(self.service._barrier(job) for job in jobs):
                raise Conflict('Sealed preparations cannot continue; explicitly estimate a new request.')
            self._lease(self._target(jobs[0]), payload['leaseId'])
            self._quote(payload['quoteId'], [j['snapshot']['input']['optimization'] for j in jobs], payload['budgetCredits'])
            if any(j['state'] in ACTIVE for j in jobs):
                raise Conflict('仍有原请求在途，请继续查询')
            selected = {digest(j['snapshot']['input']['optimization']['target']) for j in jobs if j['state'] == 'pending'}
            if self._overlap((await asyncio.to_thread(self._jobs, **self._target(jobs[0]))), payload['batchId'], selected):
                raise Conflict('范围已有其他活动批次；未继续旧任务。')
            self._control(payload['batchId']).update(paused=False, stopped=False, quoteId=payload['quoteId'], budgetCredits=payload['budgetCredits'])
            return (await self._report(jobs))

    async def skip(self, payload):
        async with self.lock:
            jobs = (await asyncio.to_thread(self._batch, payload['batchId']))
            self._lease(self._target(jobs[0]), payload['leaseId'])
            job = next((j for j in jobs if j['request_id'] == payload['requestId']), None)
            if not job or job['state'] != 'pending' or job['request_id'] in self.service._workers:
                raise Conflict('只能跳过尚未发送的行')
            await self.service.cancel(job['request_id'])
            return (await self._report((await asyncio.to_thread(self._batch, payload['batchId']))))
