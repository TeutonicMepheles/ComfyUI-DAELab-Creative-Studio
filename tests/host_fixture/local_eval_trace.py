"""OPTIONAL test-only dispatch gate; NEVER imported by the fixture package entry.

An isolated reviewed host must explicitly connect the real dispatch, weight
resolution, network denial, native events and completion hooks. Merely installing
this module provides no such capabilities. It does not construct or execute a
graph, start a service, query Ollama, or load/unload any model.
"""
from __future__ import annotations

import asyncio
from copy import deepcopy
import json
from pathlib import Path
import threading
import time

from tools.evals.run_local_evaluation import (
    Blocked, PREFIX, REQUIRED_HOOKS, canonical, compare_requests, endpoint,
    file_hash, require, utc, validate_payload, verify_weights, write_new,
)
from tools.host.prepare_baseline import _plain_ancestors


class BoundaryGate:
    """One-use observations, not a job store or executor. Unknown dispatch is denied.

    Hook callables are reviewed integration dependencies, not boolean promises:
    - dispatch-gate: verifies that ALL real dispatch paths are guarded;
    - resolved-weight-rehash: returns actual resolver-selected file records;
    - network-deny-audit: returns current complete OS/process-level deny evidence;
    - native-event-stream: verifies interception of native send_sync events;
    - live-host-identity: reads actual process paths, flags, version and queue;
    - ollama-final-response: verifies real generate response interception.

    The wrapper must call before_dispatch with a projection derived from the
    actual final graph/body immediately before forwarding that exact request.
    It must not synthesize the projection from the armed expectation.
    """
    def __init__(self, evidence_root, identity, *, hooks=None, read_roots=()):
        self.root = Path(evidence_root).resolve()
        _plain_ancestors(self.root)
        require(not self.root.exists(), 'new-trace-directory-required')
        endpoint('http://127.0.0.1:' + str(identity['port']))
        self.root.mkdir(parents=True)
        self.identity = deepcopy(identity)
        self.read_roots = []
        for old in read_roots:
            old = Path(old).resolve()
            _plain_ancestors(old)
            previous = json.loads((old / 'identity.json').read_text('utf-8'))
            require(all(previous.get(k) == identity.get(k) for k in ('variant', 'hostCommit', 'studioCommit', 'preparedSha256', 'root', 'port')),
                    'foreign-prior-trace-root')
            self.read_roots.append(old)
        self.hooks = dict(hooks or {})
        self.lock = threading.RLock()
        self.records, self.listeners = {}, {}
        self.active = None
        write_new(self.root / 'identity.json', self.identity)

    def capabilities(self):
        hooks = []
        for name in self.hooks:
            if callable(self.hooks[name]):
                hooks.append(name)
        ready = REQUIRED_HOOKS <= set(hooks)
        if ready:
            # These inspect installed hooks/deny policy; they must never generate.
            ready = self.hooks['dispatch-gate']() is True and self.hooks['native-event-stream']() is True
            network = self.hooks['network-deny-audit']()
            ready = ready and network.get('complete') is True and network.get('externalAttempts') == 0
        live = self.hooks['live-host-identity']() if 'live-host-identity' in hooks else {}
        return {**self.identity, **live, 'schemaVersion': 1, 'hooks': hooks, 'ready': ready,
                'traceModuleSha256': file_hash(__file__)}

    def _append(self, request_id, event):
        import os
        validate_payload(event)
        # A crash leaves the original journal intact. This gate intentionally does
        # not re-arm identities after restart; resume only reads the old journal.
        with (self.root / request_id / 'journal.jsonl').open('a', encoding='utf-8', newline='\n') as stream:
            stream.write(canonical(event) + '\n')
            stream.flush()
            os.fsync(stream.fileno())

    def arm(self, payload):
        validate_payload(payload)
        slot, case = payload['slot'], payload['case']
        request_id = slot['requestId']
        import re
        require(re.fullmatch('[a-f0-9-]{36}', request_id) is not None, 'invalid-eval-identity')
        require(slot['variant'] == self.identity['variant'], 'wrong-variant')
        require(self.capabilities()['ready'], 'required-live-boundary-hook-missing')
        with self.lock:
            require(self.active is None and request_id not in self.records and not (self.root / request_id).exists()
                    and not any((old / request_id).exists() for old in self.read_roots), 'identity-or-active-evaluation-conflict')
            (self.root / request_id).mkdir()
            write_new(self.root / request_id / 'armed.json', payload)
            record = {'schemaVersion': 1, 'requestId': request_id, 'providerTaskId': None,
                      'state': 'armed', 'dispatches': 0, 'ledgerReuse': None, 'comparison': None,
                      'finalRequest': None, 'weightRehashVerified': None, 'weights': None,
                      'events': [], 'outputs': None, 'text': None, 'metrics': None,
                      'ollama': None, 'preprocessing': None, 'network': None, 'blocks': []}
            self.records[request_id] = {'slot': deepcopy(slot), 'case': deepcopy(case), 'report': record, 'started': None}
            self.active = request_id
            self._append(request_id, {'type': 'armed', 'at': utc(), 'requestId': request_id})
            return {'requestId': request_id, 'state': 'armed'}

    def before_dispatch(self, request_id, task_id, actual_capture):
        """Synchronous, before the side effect; rejects unknown/repeated owners."""
        validate_payload(actual_capture)
        with self.lock:
            require(self.active == request_id and request_id in self.records, 'unarmed-dispatch-refused')
            entry = self.records[request_id]
            report, case = entry['report'], entry['case']
            require(report['state'] == 'armed' and report['dispatches'] == 0, 'duplicate-dispatch-refused')
            require(isinstance(task_id, str) and task_id, 'original-provider-identity-required')
            comparison = compare_requests(case['expected'], actual_capture, case.get('runtimeDifferences', []))
            report['comparison'], report['finalRequest'] = comparison, deepcopy(actual_capture)
            try:
                require(comparison['passed'], 'actual-final-request-differs')
                weights = self.hooks['resolved-weight-rehash'](request_id, deepcopy(actual_capture))
                report['weights'] = verify_weights(weights, actual_capture['effective']['weightSha256'])
                report['weightRehashVerified'] = True
                network = self.hooks['network-deny-audit']()
                require(network.get('complete') is True and network.get('externalAttempts') == 0, 'network-denial-not-proven')
            except Exception:
                report['state'] = 'blocked'
                report['blocks'].append('dispatch-admission-failed')
                self._append(request_id, {'type': 'blocked-before-dispatch', 'report': report, 'at': utc()})
                raise
            # Durable consume precedes the real submission. Lost ACK cannot re-arm.
            write_new(self.root / request_id / 'dispatch-consumed.json', {'requestId': request_id, 'providerTaskId': task_id,
                                                                        'comparison': comparison, 'weights': report['weights'], 'at': utc()})
            report.update(state='dispatching', dispatches=1, ledgerReuse=False, providerTaskId=task_id)
            entry['started'] = time.perf_counter_ns()
            return deepcopy(report)

    def native_event(self, event_type, data):
        """Call with the actual PromptServer.send_sync event, without invented events."""
        validate_payload(data)
        with self.lock:
            if self.active is None:
                return
            entry = self.records[self.active]
            if data.get('prompt_id') != entry['report']['providerTaskId']:
                return
            if event_type not in {'execution_start', 'execution_cached', 'executing', 'executed', 'execution_success', 'execution_error', 'execution_interrupted', 'progress'}:
                return
            # Host error messages can contain paths or arbitrary request text.
            # Retain identity/type rather than copying exception bodies.
            public = {k: data[k] for k in ('prompt_id', 'node', 'nodes', 'value', 'max', 'timestamp') if k in data}
            event = {'source': 'PromptServer.send_sync', 'type': event_type, 'data': deepcopy(public), 'at': utc()}
            entry['report']['events'].append(event)
            self._append(self.active, event)
            for loop, queue in self.listeners.get(self.active, []):
                loop.call_soon_threadsafe(queue.put_nowait, deepcopy(event))

    def h3_tensor_boundary(self, request_id, boundary, hashes):
        """Actual ordered float32 little-endian tensor hashes, before tokenize/encode.

        This is called by the explicitly installed runtime tensor hook. No tensor
        is allocated here. A mismatch raises BEFORE that model boundary executes.
        """
        with self.lock:
            require(request_id == self.active and boundary in ('tokenize', 'vae'), 'foreign-tensor-boundary')
            entry = self.records[request_id]
            expected = entry['case'].get('expectedPreprocessingSha256')
            if not (expected and hashes == expected and entry['report']['state'] == 'dispatching'):
                entry['report']['state'] = 'blocked'
                entry['report']['blocks'].append('h3-preprocessing-differs')
                self._append(request_id, {'type': 'h3-preprocessing-differs', 'at': utc()})
                raise Blocked('h3-preprocessing-differs')
            current = entry['report'].setdefault('preprocessing', None) or {}
            require(boundary + 'Sha256' not in current, 'duplicate-tensor-boundary')
            current[boundary + 'Sha256'] = list(hashes)
            entry['report']['preprocessing'] = current
            self._append(request_id, {'type': 'h3-tensor-boundary', 'boundary': boundary, 'sha256': hashes, 'at': utc()})

    def finish(self, request_id, *, state, outputs=None, text=None, ollama=None, metrics=None, preprocessing=None):
        with self.lock:
            require(request_id in self.records and self.active == request_id, 'foreign-completion')
            entry = self.records[request_id]
            require(entry['report']['state'] == 'dispatching' and state in ('complete', 'failed', 'unknown'), 'invalid-completion')
            report = entry['report']
            # Runtime tensor observations cannot be replaced by a later summary.
            require(preprocessing is None, 'use-live-h3-tensor-boundary')
            report.update(state=state, outputs=outputs, text=text, ollama=ollama, metrics=metrics,
                          network=self.hooks['network-deny-audit'](), observedWallDurationMs=(time.perf_counter_ns() - entry['started']) / 1e6)
            validate_payload(report)
            write_new(self.root / request_id / 'observation.json', report)
            self._append(request_id, {'type': 'finished', 'at': utc(), 'state': state})
            for loop, queue in self.listeners.get(request_id, []):
                loop.call_soon_threadsafe(queue.put_nowait, None)
            self.active = None
            return deepcopy(report)

    def observe(self, request_id):
        import re
        require(re.fullmatch('[a-f0-9-]{36}', request_id) is not None, 'invalid-eval-identity')
        with self.lock:
            if request_id in self.records:
                return deepcopy(self.records[request_id]['report'])
            for old in self.read_roots:
                path = old / request_id / 'observation.json'
                _plain_ancestors(path)
                if path.is_file():
                    result = json.loads(path.read_text('utf-8'))
                    validate_payload(result)
                    require(result.get('requestId') == request_id, 'foreign-prior-observation')
                    return result
            # A crash before a durable observation leaves unknown facts. Neither a
            # prior dispatch intent nor an absent response permits another dispatch.
            raise Blocked('original-observation-unavailable-no-retry')

    async def stream(self, request_id, websocket):
        loop, queue = asyncio.get_running_loop(), asyncio.Queue()
        with self.lock:
            require(request_id in self.records, 'unarmed-event-stream')
            self.listeners.setdefault(request_id, []).append((loop, queue))
            report = self.observe(request_id)
            for event in report['events']:
                queue.put_nowait(event)
            if report['state'] in ('complete', 'failed', 'unknown', 'blocked'):
                queue.put_nowait(None)
        try:
            while True:
                event = await queue.get()
                if event is None:
                    await websocket.send_json({'type': 'eval-stream-complete', 'requestId': request_id})
                    break
                await websocket.send_json(event)
        finally:
            with self.lock:
                self.listeners[request_id].remove((loop, queue))


def register_local_eval_trace(server, gate):
    """Explicit test-only route registration. Does not install any product hooks."""
    from aiohttp import web
    import ipaddress

    def local(request):
        require(ipaddress.ip_address(request.remote).is_loopback and request.host == '127.0.0.1:' + str(gate.identity['port'])
                and not request.headers.get('Origin') and request.headers.get('Sec-Fetch-Site') != 'cross-site', 'test-loopback-client-required')

    async def identity(request):
        local(request)
        return web.json_response(gate.capabilities())

    async def arm(request):
        local(request)
        try:
            return web.json_response(gate.arm(await request.json()))
        except Blocked as error:
            return web.json_response({'blocked': str(error)}, status=409)

    async def observation(request):
        local(request)
        try:
            return web.json_response(gate.observe(request.match_info['request_id']))
        except Blocked as error:
            return web.json_response({'blocked': str(error)}, status=404)

    async def events(request):
        local(request)
        websocket = web.WebSocketResponse()
        await websocket.prepare(request)
        await gate.stream(request.match_info['request_id'], websocket)
        await websocket.close()
        return websocket

    # The caller may be a PromptServer or an isolated fake web.Application.
    router = getattr(server, 'routes', None)
    if router is None:
        server.add_routes([web.get(PREFIX + '/identity', identity), web.post(PREFIX + '/arm', arm),
                           web.get(PREFIX + '/observations/{request_id}', observation), web.get(PREFIX + '/events/{request_id}', events)])
    else:
        for method, path, handler in [('get', PREFIX + '/identity', identity), ('post', PREFIX + '/arm', arm),
                                      ('get', PREFIX + '/observations/{request_id}', observation), ('get', PREFIX + '/events/{request_id}', events)]:
            getattr(router, method)(path)(handler)
