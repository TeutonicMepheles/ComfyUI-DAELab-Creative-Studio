"""Reviewed local Eval orchestration. Never starts a host, model or downloader.

The optional host boundary fixture must independently intercept the actual native
queue / Ollama dispatch. Offline graph replay is deliberately not an entrypoint.
Missing instrumentation produces blocked evidence, never an inferred pass.
"""
from __future__ import annotations

import argparse
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import parse_qs, quote, urlsplit
import uuid

from tools.evals.request_contract import canonical, compare_requests, sha256, validate_payload
from tools.host.prepare_baseline import _plain_ancestors, _git, archive_members, verify_snapshot
from tools.host.prepare_gpu_evaluation import PINNED_SOURCES

ROOT = Path(__file__).resolve().parents[2]
OWNER = 'creative-studio-local-eval-runner-v1'
PREFIX = '/__creative_eval/v1'
MODELS = {'native-image': 'Qwen-Image-2.1 Turbo（本地）', 'native-video': 'MiniMax H3 FL（本地）',
          'polish': 'qwen3.5:9b-q4_K_M', 'table': 'qwen3.5:9b-q4_K_M'}
REQUIRED_HOOKS = {'dispatch-gate', 'resolved-weight-rehash', 'network-deny-audit', 'native-event-stream', 'live-host-identity'}


class Blocked(ValueError):
    """A safe, public reason code; never an unfiltered transport exception."""


def require(value, code):
    if not value:
        raise Blocked(code)


def read(path):
    value = json.loads(Path(path).read_text('utf-8-sig'))
    validate_payload(value)
    return value


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write_new(path, value):
    import os
    validate_payload(value)
    with Path(path).open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(canonical(value) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def utc():
    return datetime.now(timezone.utc).isoformat()


def rooted(root, relative):
    require(isinstance(relative, str) and relative and '\\' not in relative
            and not relative.startswith('/') and ':' not in relative
            and all(p not in ('', '.', '..') for p in relative.split('/')), 'unsafe-relative-path')
    root = Path(root).resolve()
    path = root / relative
    _plain_ancestors(path)
    require(path.resolve().is_relative_to(root), 'path-escaped-root')
    return path


def endpoint(value):
    try:
        parsed = urlsplit(value)
        require(parsed.scheme == 'http' and parsed.hostname == '127.0.0.1'
                and parsed.username is None and parsed.password is None
                and not parsed.query and not parsed.fragment and parsed.path in ('', '/')
                and type(parsed.port) is int and 1024 <= parsed.port <= 65535 and parsed.port != 8000,
                'isolated-loopback-endpoint-required')
        return f'http://127.0.0.1:{parsed.port}'
    except (ValueError, TypeError):
        raise Blocked('isolated-loopback-endpoint-required') from None


def schedule(plan):
    require(plan['baseInferenceCount'] == 44 and plan['pairedSmokeInferenceCount'] == 20
            and plan['variants'] == ['baseline', 'studio'] and len(plan['samples']) == 10,
            'unsupported-evaluation-plan')
    rows = []
    for repetition in range(1, max(s['repetitionsPerVariant'] for s in plan['samples']) + 1):
        for sample in plan['samples']:
            if sample['repetitionsPerVariant'] >= repetition:
                for variant in plan['variants']:
                    rows.append({'slot': len(rows) + 1, 'sampleId': sample['id'], 'variant': variant,
                                 'repetition': repetition, 'smoke': repetition == 1,
                                 'requestId': str(uuid.uuid4()), 'batchId': str(uuid.uuid4()),
                                 'clientId': str(uuid.uuid4()), 'attemptId': str(uuid.uuid4())})
    require(len(rows) == 44 and sum(r['smoke'] for r in rows) == 20, 'invalid-slot-multiplicity')
    return rows


def runtime_case(case, slot, environment, reviewer):
    """Derive only the pinned old H3 freeze paths after request IDs are fixed.

    Source: business 7ff56cb... media_snapshot.freeze_media, followed by
    LocalVideo.build_prompt. The original capture remains immutable. The gate
    still compares actual paths and actual ordered source-byte hashes exactly.
    """
    result = deepcopy(case)
    if slot['variant'] != 'baseline' or slot['sampleId'] not in ('LOCAL-H3-002', 'LOCAL-H3-003'):
        return result, None
    require(case['driver'] == 'native-video' and case['expected']['sampleId'] == slot['sampleId'], 'legacy-h3-case-identity-differs')
    payload, effective = case['payload'], case['expected']['effective']
    project = payload.get('project')
    require(isinstance(project, str) and 0 < len(project) <= 256 and not any(ord(c) < 32 for c in project)
            and re.fullmatch('[a-f0-9-]{36}', slot['requestId']) and isinstance(reviewer, str) and reviewer.strip(),
            'legacy-h3-reviewed-project-and-identity-required')
    count = 1 if slot['sampleId'] == 'LOCAL-H3-002' else 2
    assets, hashes = payload.get('assets'), effective.get('sourceImageSha256')
    require(isinstance(assets, list) and isinstance(hashes, list) and len(assets) == len(hashes) == count
            and len(effective.get('referenceOrder', [])) == count, 'legacy-h3-reference-count-differs')
    input_root = Path(environment['root']) / 'input'
    key = hashlib.sha256((project + '\n' + slot['requestId']).encode()).hexdigest()[:24]
    records, explanations = [], list(result.get('runtimeDifferences', []))
    for index, (asset, expected_hash) in enumerate(zip(assets, hashes)):
        require(isinstance(asset, dict) and isinstance(asset.get('url'), str), 'legacy-h3-local-view-reference-required')
        url = urlsplit(asset['url'])
        query = parse_qs(url.query, keep_blank_values=True)
        require(not url.scheme and not url.netloc and not url.fragment and url.path == '/view'
                and set(query) <= {'filename', 'subfolder', 'type'} and query.get('type') == ['input']
                and all(len(v) == 1 for v in query.values()) and query.get('filename')
                and '/' not in query['filename'][0] and '\\' not in query['filename'][0],
                'legacy-h3-local-view-reference-required')
        relative = '/'.join(p for p in (query.get('subfolder', [''])[0], query['filename'][0]) if p)
        source = rooted(input_root, relative)
        require(source.is_file() and source.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')
                and isinstance(expected_hash, str) and re.fullmatch('[a-f0-9]{64}', expected_hash)
                and file_hash(source) == expected_hash, 'legacy-h3-source-bytes-differ')
        role = ('first_frame', 'last_frame')[index]
        graph = case['expected']['finalRequest']
        node = graph.get(role, {})
        require(node.get('class_type') == 'LoadImage' and isinstance(node.get('inputs', {}).get('image'), str)
                and graph.get('condition', {}).get('inputs', {}).get(role) == [role, 0], 'legacy-h3-reference-slot-differs')
        target = f'daelab/table-local-h3/snapshots/{key}/{index}{source.suffix.lower()}'
        pointer = f'/finalRequest/{role}/inputs/image'
        require(not any(x.get('path') == pointer for x in explanations), 'legacy-h3-static-path-explanation-refused')
        before = node['inputs']['image']
        if before != target:
            explanations.append({'path': pointer, 'baselineSha256': sha256(before), 'studioSha256': sha256(target),
                'reviewer': reviewer, 'reason': 'Pinned old freeze_media(project, original requestId); ordered source bytes verified before dispatch.'})
        records.append({'role': role, 'sourcePath': str(source.resolve()), 'bytes': source.stat().st_size,
                        'sha256': expected_hash, 'runtimePath': target})
    result['runtimeDifferences'] = explanations
    projection = {'kind': 'pinned-legacy-h3-snapshot-v1', 'sourceCommit': PINNED_SOURCES['business'],
        'requestId': slot['requestId'], 'project': project, 'sourceFiles': records, 'runtimeDifferences': explanations}
    return result, projection


def reviewed_runtime_case(run, case, slot, environment, reviewer):
    result, projection = runtime_case(case, slot, environment, reviewer)
    require(projection == run.get('runtimeProjections', {}).get(slot['requestId']), 'slot-runtime-projection-changed')
    return result


def verify_prepared(prepared, approval, *, inspect_host=True):
    configuration = prepared['configuration']
    require(configuration['owner'] == 'creative-studio-gpu-eval-preparation-v1', 'foreign-preparation')
    require(approval.get('schemaVersion') == 1 and isinstance(approval.get('reviewer'), str)
            and approval['reviewer'].strip() and re.fullmatch('[a-f0-9]{40}', approval.get('studioCommit', ''))
            and re.fullmatch('[a-f0-9]{40}', approval.get('hostCommit', '')), 'explicit-commit-review-required')
    require(configuration['hostCommit'] == approval['hostCommit'], 'host-commit-not-reviewed')
    sources = {s['key']: s for s in configuration['sources']}
    require(sources['studio']['commit'] == approval['studioCommit'], 'studio-commit-not-reviewed')
    for key, commit in PINNED_SOURCES.items():
        require(sources[key]['commit'] == commit, 'old-source-commit-changed')
    root = Path(configuration['destination']).resolve()
    _plain_ancestors(root)
    require(set(prepared['environments']) == {'baseline', 'studio'}, 'paired-isolation-required')
    require(len(set(configuration['ports'].values())) == 2, 'ports-overlap')
    protected = [Path(configuration['host']).resolve(), Path(configuration['modelRoot']).resolve(),
                 *[Path(s['repository']).resolve() for s in sources.values() if s['key'] != 'studio']]
    for variant, environment in prepared['environments'].items():
        environment_root = Path(environment['root']).resolve()
        require(environment_root == root / variant, 'environment-root-changed')
        require(not any(environment_root == p or environment_root.is_relative_to(p)
                        or p.is_relative_to(environment_root) for p in protected), 'protected-root-overlap')
        command = environment['command']
        require('-B' in command and '--cache-none' in command and '--offline' in command and '--disable-all-custom-nodes' in command
                and environment['cachePolicy'] == 'none', 'host-cache-or-offline-policy-changed')
        for flag, name in [('--base-directory', None), ('--user-directory', 'user'), ('--input-directory', 'input'),
                           ('--output-directory', 'output'), ('--temp-directory', 'temp')]:
            expected = environment_root / name if name else environment_root
            require(command.count(flag) == 1 and Path(command[command.index(flag) + 1]).resolve() == expected,
                    'host-isolation-path-changed')
            _plain_ancestors(expected)
        port = configuration['ports'][variant]
        endpoint('http://127.0.0.1:' + str(port))
        require(command.count('--port') == 1 and command[command.index('--port') + 1] == str(port), 'host-port-changed')
        expected_keys = {'canvas', 'business', 'ggufPlugin'} if variant == 'baseline' else {'studio', 'ggufPlugin'}
        require(set(environment['snapshots']) == expected_keys, 'unexpected-custom-node-snapshot')
        require(command[command.index('--whitelist-custom-nodes') + 1:command.index('--feature-flag')]
                == [sources[k]['name'] for k in (('canvas', 'business', 'ggufPlugin') if variant == 'baseline' else ('studio', 'ggufPlugin'))],
                'custom-node-whitelist-changed')
        require({p.name for p in (environment_root / 'custom_nodes').iterdir()}
                == {sources[k]['name'] for k in expected_keys}, 'unreviewed-installed-package')
        for key, record in environment['snapshots'].items():
            archive = Path(record['archive'])
            require(archive.resolve().is_relative_to(root / 'archives') and file_hash(archive) == record['sha256'], 'snapshot-archive-changed')
            require(archive_members(archive) == record['files'], 'snapshot-manifest-changed')
            verify_snapshot(environment_root / 'custom_nodes' / sources[key]['name'], record['files'])
    instrumentation = configuration.get('instrumentation', {})
    if instrumentation.get('enabled'):
        directory = root / 'instrumentation'
        records = instrumentation.get('files') or []
        require(records and {p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()}
                == {r['path'] for r in records}, 'instrumentation-file-set-changed')
        for record in records:
            require(file_hash(rooted(directory, record['path'])) == record['sha256'], 'instrumentation-source-changed')
    if inspect_host:
        host = configuration['host']
        require(_git(host, 'rev-parse', 'HEAD').decode().strip() == approval['hostCommit'], 'host-head-drift')
        require(not _git(host, 'status', '--porcelain').strip(), 'host-worktree-drift')
        require(not (Path(host) / 'extra_model_paths.yaml').exists(), 'implicit-model-roots')
    return configuration


def verify_weights(weights, expected):
    require(isinstance(weights, list) and weights and len({w['sha256'] for w in weights}) == len(weights), 'weight-identity-missing')
    require(set(expected) == {w['sha256'] for w in weights}, 'actual-weight-set-differs')
    checked = []
    for record in weights:
        path = Path(record['path'])
        require(re.fullmatch('[a-f0-9]{64}', record['sha256']) and path.is_file(), 'weight-missing')
        before = path.stat()
        require(before.st_size == record['bytes'] and file_hash(path) == record['sha256'], 'weight-bytes-changed')
        after = path.stat()
        require((before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns), 'weight-changed-during-rehash')
        checked.append({**record, 'rehashAt': utc()})
    return checked


def validate_case(case, sample):
    require(case['driver'] in MODELS and MODELS[case['driver']] == sample['model'], 'unsupported-entry-or-model')
    require(case['expected']['sampleId'] == sample['id'] and case['expected']['effective']['model'] == sample['model'], 'wrong-capture-sample')
    require(compare_requests(case['expected'], case['expected'])['passed'], 'invalid-final-request')
    driver, payload = case['driver'], case['payload']
    effective = case['expected']['effective']
    require(effective.get('lora') == [], 'conditional-lora-batch-not-implemented')
    if driver == 'native-image':
        require(all(effective.get(k) == v for k, v in {'width': 1024, 'height': 1024, 'steps': 8, 'cfg': 1,
                    'scheduler': 'simple', 'seed': 20261013 if sample['id'] == 'LOCAL-IMAGE-001' else 20261014}.items())
                and effective.get('sampler', '').lower() == 'euler', 'fixed-image-parameters-changed')
    elif driver == 'native-video':
        require(all(effective.get(k) == v for k, v in {'width': 512, 'height': 288, 'steps': 20, 'seed': 20261023,
                    'inputDurationSeconds': 1.5, 'frames': 39, 'fps': 24, 'turbo': False}.items()), 'fixed-video-parameters-changed')
    else:
        table = driver == 'table'
        require(effective.get('temperature') == .4 and effective.get('seed') == 'omitted'
                and effective.get('contextTokens') == (16384 if table else 8192)
                and (32 <= effective.get('maxOutputTokens', 0) <= 1024 if table else effective.get('maxOutputTokens') == 768),
                'fixed-qwen-parameters-changed')
    if driver.startswith('native-'):
        require(payload['config']['model'] == sample['model'] and payload['config'].get('provider', 'local') == 'local'
                and 'graph' not in payload and 'prompt' not in payload, 'only-local-service-input-allowed')
    elif driver == 'polish':
        require(payload.get('model') == 'qwen' and payload.get('mode') in ('polish', 'reverse'), 'only-local-polish-allowed')
    else:
        require(payload['model'] == sample['model'] and payload.get('target') and payload.get('snapshotDigest'), 'table-snapshot-required')
    require(case.get('samplerNodes') and all(isinstance(n, str) for n in case['samplerNodes']) if driver.startswith('native-')
            else case.get('samplerNodes') == [], 'sampler-identities-required')
    if sample['id'] in ('LOCAL-H3-002', 'LOCAL-H3-003'):
        hashes = case.get('expectedPreprocessingSha256', [])
        require(len(hashes) == (1 if sample['id'] == 'LOCAL-H3-002' else 2)
                and all(isinstance(h, str) and re.fullmatch('[a-f0-9]{64}', h) for h in hashes),
                'reviewed-h3-preprocessing-required')
    validate_payload(case)


def verify_capture(case, variant=None):
    """Bind the expectation to a preserved builder capture, not historical outputs."""
    record = case['sourceCapture']
    path = Path(record['path'])
    require(file_hash(path) == record['sha256'], 'source-capture-changed')
    capture = read(path)
    require(capture.get('captureKind') in ('offline-pinned-source-construction', 'offline-studio-source-construction')
            and capture.get('transportSubmitted') is False and capture.get('inferenceExecuted') is False,
            'offline-builder-capture-required')
    if variant is not None:
        require(capture['captureKind'] == ('offline-pinned-source-construction' if variant == 'baseline' else 'offline-studio-source-construction'),
                'wrong-variant-builder-capture')
    keys = ('sampleId', 'inputSha256', 'finalRequest', 'effective')
    require(all(canonical(case['expected'].get(k)) == canonical(capture.get(k)) for k in keys), 'source-capture-projection-changed')
    return {'path': str(path.resolve()), 'sha256': record['sha256']}


def prepare_run(prepared_path, approval_path, cases_path, destination, *, plan_path=None, continuation_review_path=None):
    """Offline-only: immutable run definition, all 44 fresh identities, no sockets."""
    paths = {'prepared': Path(prepared_path).resolve(), 'approval': Path(approval_path).resolve(),
             'cases': Path(cases_path).resolve(), 'plan': Path(plan_path or ROOT / 'docs/validation/catalog/local-eval-plan.json').resolve(),
             'traceability': ROOT / 'docs/validation/catalog/traceability.json'}
    if continuation_review_path is not None:
        paths['continuationReview'] = Path(continuation_review_path).resolve()
    prepared, approval, cases, plan = (read(paths[k]) for k in ('prepared', 'approval', 'cases', 'plan'))
    require(file_hash(paths['prepared']) == approval.get('preparedSha256')
            and file_hash(paths['cases']) == approval.get('casesSha256')
            and file_hash(paths['plan']) == approval.get('planSha256'), 'reviewed-input-fingerprint-changed')
    require(file_hash(__file__) == approval.get('runnerSha256'), 'runner-not-reviewed')
    configuration = verify_prepared(prepared, approval)
    catalog = read(paths['traceability'])
    relevant = [row for row in catalog['acceptance'] if 'TC-SYS-036' in row['tests'] and 'EV-LOCAL' in row['evals']]
    require(relevant, 'evaluation-traceability-missing')
    links = {'test': 'TC-SYS-036', 'evals': ['EV-LOCAL'], 'deferredE2E': 'TC-SYS-032',
             'tasks': sorted({row['task'] for row in relevant}), 'features': sorted({row['feature'] for row in relevant}),
             'acceptance': sorted(row['id'] for row in relevant), 'usecases': sorted({uc for row in relevant for uc in row['usecases']})}
    by_sample = {s['id']: s for s in plan['samples']}
    require(set(cases) == {'baseline', 'studio'}, 'paired-cases-required')
    comparisons, capture_inputs = [], []
    for variant in plan['variants']:
        require(set(cases[variant]) == set(by_sample), 'all-ten-entry-cases-required')
        for sample_id, case in cases[variant].items():
            validate_case(case, by_sample[sample_id])
            capture_inputs.append(verify_capture(case, variant))
    for sample_id in by_sample:
        comparison = compare_requests(cases['baseline'][sample_id]['expected'], cases['studio'][sample_id]['expected'],
                                      approval.get('requestDifferences', {}).get(sample_id, []))
        require(comparison['passed'], 'unreviewed-final-request-difference')
        comparisons.append(comparison)
    destination = Path(destination).resolve()
    _plain_ancestors(destination)
    require(destination.is_relative_to(ROOT / '.local') and not destination.exists(), 'new-local-evidence-directory-required')
    env_root = Path(configuration['destination']).resolve()
    require(not destination.is_relative_to(env_root) and not env_root.is_relative_to(destination), 'evidence-environment-overlap')
    slots = schedule(plan)
    projections = {s['requestId']: runtime_case(cases[s['variant']][s['sampleId']], s,
        prepared['environments'][s['variant']], approval['reviewer'])[1] for s in slots}
    destination.mkdir(parents=True)
    run = {'schemaVersion': 1, 'owner': OWNER, 'createdAt': utc(), 'definitionId': str(uuid.uuid4()),
           'inputs': {k: {'path': str(p), 'sha256': file_hash(p)} for k, p in paths.items()},
           'runnerSha256': file_hash(__file__), 'captureInputs': capture_inputs, 'slots': slots, 'runtimeProjections': projections, 'comparisons': comparisons,
           'traceability': links, 'productAcceptance': False, 'qualityScores': None, 'inferencesExecuted': 0}
    if continuation_review_path is not None:
        from tools.evals.local_continuation import create_continuation
        review = read(paths['continuationReview'])
        require(review.get('schemaVersion') == 1 and review.get('reviewer') == approval['reviewer'],
                'continuation-reviewer-not-approved')
        parent = review['parentRun']
        require(file_hash(parent['path']) == parent['sha256'], 'continuation-parent-review-drift')
        continuation = create_continuation(parent['path'], run,
            completed_prefix=review['completedPrefix'], blocked_slot=review['blockedSlot'],
            blocked_trace_root=review['blockedTraceRoot'], reviewed_changes=review['reviewedChanges'],
            reviewer=review['reviewer'])
        continuation_path = destination / 'continuation.json'
        write_new(continuation_path, continuation)
        run['continuation'] = {'path': str(continuation_path), 'sha256': file_hash(continuation_path)}
    write_new(destination / 'run.json', run)
    return run


def verified_continuation(run):
    """Resolve immutable prior evidence without copying it into this run."""
    if 'continuation' not in run:
        return None, None
    from tools.evals.local_continuation import verify_continuation
    reference = run['continuation']
    require(file_hash(reference['path']) == reference['sha256'], 'continuation-manifest-drift')
    manifest = read(reference['path'])
    return manifest, verify_continuation(manifest, run)


class LocalHTTP:
    """Literal loopback only; no environment proxy, redirects, retries or starts."""
    def __init__(self, base):
        self.base = endpoint(base)
        self.session = None

    async def __aenter__(self):
        import aiohttp
        trace = aiohttp.TraceConfig()
        async def deny_redirect(*_args):
            raise Blocked('redirect-refused')
        trace.on_request_redirect.append(deny_redirect)
        self.session = aiohttp.ClientSession(trust_env=False, timeout=aiohttp.ClientTimeout(total=900), trace_configs=[trace])
        return self

    async def __aexit__(self, *_args):
        await self.session.close()

    async def json(self, method, path, body=None):
        require(path.startswith('/') and not path.startswith('//') and '\\' not in path, 'unsafe-http-path')
        if body is not None:
            validate_payload(body)
        async with self.session.request(method, self.base + path, json=body, allow_redirects=False) as response:
            require(response.status < 300 and response.status >= 200, 'http-rejected-or-uncertain')
            require(int(response.headers.get('Content-Length', '0')) <= 32 * 1024 * 1024, 'http-response-too-large')
            chunks, size = [], 0
            async for chunk in response.content.iter_chunked(65536):
                size += len(chunk)
                require(size <= 32 * 1024 * 1024, 'http-response-too-large')
                chunks.append(chunk)
            raw = b''.join(chunks)
            require(len(raw) <= 32 * 1024 * 1024, 'http-response-too-large')
            value = json.loads(raw)
            validate_payload(value)
            return value

    async def events(self, identity, output, ready):
        import aiohttp
        async with self.session.ws_connect(self.base + PREFIX + '/events/' + quote(identity, safe=''), max_msg_size=1024 * 1024) as websocket:
            ready.set()
            async for message in websocket:
                if message.type == aiohttp.WSMsgType.TEXT:
                    event = json.loads(message.data)
                    validate_payload(event)
                    if event.get('type') == 'eval-stream-complete' and event.get('requestId') == identity:
                        break
                    output.append(event)
                elif message.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                    break


async def dispatch_entry(http, case, slot):
    """Real business HTTP entrypoints. The boundary fixture gates final dispatch."""
    driver, payload = case['driver'], deepcopy(case['payload'])
    request_id = slot['requestId']
    if driver.startswith('native-'):
        route = '/daelab/libtv/table/' if slot['variant'] == 'baseline' else '/daelab/studio/generation/'
        item = {'requestId': request_id, 'input': payload}
        if slot['variant'] == 'baseline':
            item['forceNew'] = True  # old input-fingerprint cache must not substitute a prior execution
        else:
            item['source'] = {'documentId': slot['clientId'], 'nodeId': slot['attemptId'], 'operation': 'local-eval'}
        return await http.json('POST', route + 'submit', {'contractVersion': 1, 'jobs': [item]})
    if driver == 'polish':
        payload.update(contractVersion=1, requestId=request_id)
        if slot['variant'] == 'studio':
            payload['sourceScope'] = {'documentId': slot['clientId'], 'nodeId': slot['attemptId']}
        return await http.json('POST', '/daelab/prompt-optimization/polish', payload)
    target = {k: payload['target'][k] for k in ('documentId', 'tableId')}
    route = '/daelab/prompt-optimization/'
    async def call(action, body):
        return await http.json('POST', route + action, {'contractVersion': 1, **body})
    estimate = await call('estimate', {'model': payload['model'], 'rows': [payload]})
    require(not estimate.get('unknownRequests') and estimate.get('provider') == 'qwen'
            and estimate.get('budgetUpperCredits') == 0, 'table-estimate-not-local-or-unknown')
    lease = await call('lease', {'target': target, 'instanceId': slot['clientId']})
    shared = {'batchId': slot['batchId'], 'leaseId': lease['leaseId']}
    await call('submit', {**shared, 'quoteId': estimate['quoteId'], 'rows': [{'requestId': request_id, 'snapshot': payload}],
                         'budgetCredits': 0, 'range': {'scope': 'cell', 'fieldId': payload['target']['fieldId'], 'recordId': payload['target']['recordId']}})
    permit = await call('permit', {**shared, 'requestId': request_id, **{k: payload[k] for k in ('snapshotDigest', 'revision', 'requestSeq')}})
    return await call('advance', {**shared, 'requestId': request_id, 'permitId': permit['permitId'], 'provider': 'qwen'})


async def query_entry(http, case, slot):
    """Read original identity; never submit, advance, retry, unload or cancel."""
    if case['driver'].startswith('native-'):
        route = '/daelab/libtv/table/' if slot['variant'] == 'baseline' else '/daelab/studio/generation/'
        return await http.json('POST', route + 'status', {'contractVersion': 1, 'requestIds': [slot['requestId']]})
    if case['driver'] == 'table':
        return await http.json('POST', '/daelab/prompt-optimization/query', {'contractVersion': 1, 'batchId': slot['batchId']})
    if slot['variant'] == 'studio':
        return await http.json('POST', '/daelab/studio/generation/status', {'contractVersion': 1, 'requestIds': [slot['requestId']]})
    # The optional runtime hook persists the actual original Ollama response. It
    # is a read-only evidence endpoint, not a resubmission of the old polish API.
    return await http.json('GET', PREFIX + '/responses/' + slot['requestId'])


def check_identity(identity, configuration, approval, slot, *, resume=False):
    required = REQUIRED_HOOKS | ({'ollama-final-response'} if slot['sampleId'].startswith(('LOCAL-TEXT', 'LOCAL-VISION')) else set())
    if slot['sampleId'] in ('LOCAL-H3-002', 'LOCAL-H3-003'):
        required |= {'h3-tensor-admission'}
    require(identity.get('schemaVersion') == 1 and identity.get('variant') == slot['variant']
            and identity.get('hostCommit') == approval['hostCommit'] and identity.get('studioCommit') == approval['studioCommit']
            and identity.get('preparedSha256') == approval['preparedSha256']
            and identity.get('traceModuleSha256') == approval.get('traceModuleSha256'), 'live-host-identity-not-reviewed')
    require(identity.get('root') == configuration['environment']['root'] and identity.get('port') == configuration['port']
            and identity.get('cachePolicy') == 'none' and identity.get('offline') is True
            and identity.get('exclusiveWindow') is True and (resume or identity.get('queueEmpty') is True), 'live-isolation-or-exclusivity-unproven')
    require(identity.get('ready') is True and required <= set(identity.get('hooks', [])), 'required-live-boundary-hook-missing')


def decode_outputs(output_root, report, case, destination, *, existed_before=()):
    """Decode every returned file, not container metadata alone; retain exact bytes."""
    results = []
    if case['driver'] in ('polish', 'table'):
        text = report.get('text')
        require(isinstance(text, str) and text.strip(), 'text-output-missing')
        raw = text.encode('utf-8')
        path = destination / 'output.txt'
        with path.open('xb') as stream:
            stream.write(raw)
        return [{'path': path.name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'decodable': True, 'kind': 'text'}]
    files = report.get('outputs')
    require(isinstance(files, list) and files, 'output-receipts-missing')
    for index, item in enumerate(files):
        require(item['relativePath'] not in existed_before, 'historical-or-overwritten-output-refused')
        path = rooted(output_root, item['relativePath'])
        require(path.is_file() and file_hash(path) == item['sha256'], 'output-file-missing-or-changed')
        before = path.stat()
        expected = case['expected']['effective']
        record = {'sha256': item['sha256'], 'bytes': before.st_size, 'decodable': True}
        if case['driver'] == 'native-image':
            from PIL import Image
            with Image.open(path) as image:
                image.load()
                require(image.size == (expected['width'], expected['height']), 'image-dimensions-differ')
                record.update(kind='image', width=image.width, height=image.height)
        else:
            import av
            with av.open(str(path)) as container:
                require(len(container.streams.video) == 1, 'video-stream-count-differs')
                video = container.streams.video[0]
                frames, duration = 0, 0.0
                rate = float(video.average_rate) if video.average_rate else None
                for frame in container.decode(video):
                    require((frame.width, frame.height) == (expected['width'], expected['height']), 'video-dimensions-differ')
                    frames += 1
                    require(frame.time is not None and rate is not None, 'video-timing-missing')
                    duration = max(duration, frame.time + 1 / rate)
                require(frames == expected['frames'] and rate == expected['fps']
                        and abs(duration - frames / rate) < .001, 'video-frames-or-duration-differ')
                record.update(kind='video', width=expected['width'], height=expected['height'], frames=frames, fps=rate, durationSeconds=duration)
            # Audio, when present, must decode as well.
            with av.open(str(path)) as container:
                audio_frames = sum(1 for _ in container.decode(audio=0)) if container.streams.audio else 0
                record['decodedAudioFrames'] = audio_frames
        target = destination / ('output-' + str(index) + path.suffix)
        import shutil
        with path.open('rb') as source, target.open('xb') as dest:
            shutil.copyfileobj(source, dest)
        require(file_hash(target) == item['sha256'] and (before.st_size, before.st_mtime_ns) == (path.stat().st_size, path.stat().st_mtime_ns), 'output-changed-during-copy')
        record['path'] = target.name
        results.append(record)
    return results


def assess_observation(observed, events, case, slot, *, resumed=False):
    """Evidence completeness, not a visual/semantic or batch acceptance decision."""
    reasons = list(observed.get('blocks') or [])
    def need(value, code):
        if not value:
            reasons.append(code)
    need(observed.get('requestId') == slot['requestId'] and observed.get('dispatches') == 1, 'single-original-dispatch-unproven')
    need((observed.get('comparison') or {}).get('passed') is True and observed.get('finalRequest'), 'actual-final-request-unproven')
    if observed.get('finalRequest'):
        need(compare_requests(case['expected'], observed['finalRequest'], case.get('runtimeDifferences', []))['passed'],
             'observed-final-request-differs')
    need(observed.get('weightRehashVerified') is True, 'actual-resolved-weights-unproven')
    need(observed.get('state') == 'complete', 'original-execution-not-complete')
    network = observed.get('network') or {}
    need(network.get('externalAttempts') == 0 and network.get('complete') is True,
         'zero-external-network-unproven')
    need(observed.get('ledgerReuse') is False, 'ledger-reuse-unproven')
    need(bool(observed.get('providerTaskId')), 'provider-identity-missing')
    receipt = observed.get('serviceReceipt') or {}
    need(receipt.get('complete') is True and receipt.get('requestId') == slot['requestId']
         and receipt.get('readOnly') is True and receipt.get('value'), 'business-service-terminal-receipt-unproven')
    if case['driver'].startswith('native-'):
        need(set(observed.get('actualLoadedWeightSha256') or []) == set(case['expected']['effective']['weightSha256']),
             'actual-native-model-loads-unproven')
        relevant = [e for e in events if e.get('source') == 'PromptServer.send_sync' and e.get('data', {}).get('prompt_id') == observed.get('providerTaskId')]
        cached = [n for e in relevant if e.get('type') == 'execution_cached' for n in e['data'].get('nodes', [])]
        executed = [e['data'].get('node') for e in relevant if e.get('type') == 'executing']
        need(all(executed.count(n) == 1 for n in case['samplerNodes']), 'sampler-execution-not-exactly-once')
        need(not cached, 'native-cache-hit')
        need(sum(e.get('type') == 'execution_start' for e in relevant) == 1
             and sum(e.get('type') == 'execution_success' for e in relevant) == 1, 'native-start-finish-missing')
        if case['expected']['effective'].get('referenceOrder'):
            preprocessing = observed.get('preprocessing') or {}
            need(preprocessing.get('tokenizeSha256') == preprocessing.get('vaeSha256')
                 and preprocessing.get('tokenizeSha256') == case.get('expectedPreprocessingSha256')
                 and len(preprocessing.get('tokenizeSha256') or []) == len(case['expected']['effective']['referenceOrder']),
                 'live-h3-tensor-boundary-missing')
    else:
        inference = observed.get('ollama') or {}
        need(inference.get('done') is True and inference.get('done_reason') == 'stop'
             and type(inference.get('eval_count')) is int and inference['eval_count'] > 0
             and type(inference.get('eval_duration')) is int and inference['eval_duration'] > 0, 'ollama-inference-response-unproven')
    metrics = observed.get('metrics') or {}
    segments = metrics.get('segmentsMs')
    need(metrics.get('coldWarmState') in ('cold', 'warm') and metrics.get('coldWarmEvidence'), 'cold-warm-unmeasured')
    need(type(metrics.get('peakMemoryBytes')) is int and metrics['peakMemoryBytes'] > 0 and metrics.get('memorySource'), 'peak-memory-unmeasured')
    need(isinstance(segments, dict) and bool(segments) and all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in segments.values())
         and type(metrics.get('durationMs')) in (int, float)
         and abs(sum(segments.values()) - metrics['durationMs']) <= max(1, metrics['durationMs'] * .001), 'performance-segments-unmeasured')
    if resumed:
        need(observed.get('recoveryDispatches') == 0 and observed.get('recoveryNewExecutionEvents') == 0,
             'recovery-zero-redispatch-unproven')
    return reasons


async def execute_slot(run_directory, slot_number, *, resume=False, execute_reviewed=False, timeout=1800, poll_seconds=.25):
    require(execute_reviewed is True, 'explicit-reviewed-execution-flag-required')
    root = Path(run_directory).resolve()
    _plain_ancestors(root)
    run = read(root / 'run.json')
    require(run['owner'] == OWNER and file_hash(__file__) == run['runnerSha256'], 'run-owner-or-runner-changed')
    for item in run['inputs'].values():
        require(file_hash(item['path']) == item['sha256'], 'reviewed-input-changed')
    for item in run.get('captureInputs', []):
        require(file_hash(item['path']) == item['sha256'], 'source-capture-changed')
    prepared, approval, cases = (read(run['inputs'][k]['path']) for k in ('prepared', 'approval', 'cases'))
    require(approval.get('executionApproved') is True, 'execution-not-approved')
    configuration = verify_prepared(prepared, approval)
    require(type(slot_number) is int and 1 <= slot_number <= len(run['slots']), 'unknown-slot')
    continuation, continuation_context = verified_continuation(run)
    if continuation is not None:
        from tools.evals.local_continuation import inherited_result, require_pending_slot
        require_pending_slot(continuation, run, slot_number, context=continuation_context)
    slot = run['slots'][slot_number - 1]
    case = reviewed_runtime_case(run, cases[slot['variant']][slot['sampleId']], slot,
                                prepared['environments'][slot['variant']], approval.get('reviewer'))
    slot_dir = root / f'slot-{slot_number:02d}'
    if not resume:
        require(not slot_dir.exists(), 'slot-already-claimed-query-only')
        for earlier in run['slots'][:slot_number - 1]:
            if continuation is not None and inherited_result(continuation, run, earlier['slot'], context=continuation_context) is not None:
                continue
            previous_root = root / f"slot-{earlier['slot']:02d}"
            reports = [p for p in [previous_root / 'result.json', *previous_root.glob('recovery-*/result.json')] if p.is_file()]
            require(any(read(p).get('status') == 'captured' and read(p).get('requestId') == earlier['requestId'] for p in reports),
                    'preceding-slot-not-complete')
        slot_dir.mkdir()
        write_new(slot_dir / 'identity.json', slot)
    else:
        require(slot_dir.is_dir() and read(slot_dir / 'identity.json') == slot, 'original-slot-identity-missing')
        require((slot_dir / 'dispatch-intent.json').is_file(), 'no-original-dispatch-intent')
    report_dir = slot_dir / ('recovery-' + uuid.uuid4().hex) if resume else slot_dir
    if resume:
        report_dir.mkdir()
    summary = {'schemaVersion': 1, **slot, 'status': 'blocked', 'startedAt': utc(), 'finishedAt': None,
               'productAcceptance': False, 'qualityScores': None, 'submittedThisInvocation': False,
               'queryOnly': resume, 'outputs': None, 'metrics': None, 'blocks': [], 'traceability': run.get('traceability')}
    events, event_task, response = [], None, None
    try:
        expected = case['expected']['effective']['weightSha256']
        write_new(report_dir / 'weights.json', verify_weights(case['weights'], expected))
        environment = prepared['environments'][slot['variant']]
        port = configuration['ports'][slot['variant']]
        async with LocalHTTP('http://127.0.0.1:' + str(port)) as http:
            live = await http.json('GET', PREFIX + '/identity')
            check_identity(live, {'environment': environment, 'port': port}, approval, slot, resume=resume)
            write_new(report_dir / 'host-identity.json', live)
            if resume:
                before_query = await http.json('GET', PREFIX + '/observations/' + slot['requestId'])
                response = await query_entry(http, case, slot)
                if response.get('status') == 'blocked':
                    summary['blocks'].append(response['reason'])
                observed = await http.json('GET', PREFIX + '/observations/' + slot['requestId'])
                # Persisted original stream remains distinct from this read-only invocation.
                events = observed.get('events', [])
                require(observed.get('providerTaskId') == before_query.get('providerTaskId'), 'recovery-provider-identity-changed')
                observed['recoveryDispatches'] = (observed['dispatches'] - before_query['dispatches'])
                starts = lambda r: sum(e.get('type') == 'execution_start' for e in r.get('events', []))
                observed['recoveryNewExecutionEvents'] = starts(observed) - starts(before_query)
            else:
                output_root = Path(environment['root']) / 'output'
                existing = sorted(p.relative_to(output_root).as_posix() for p in output_root.rglob('*') if p.is_file())
                write_new(slot_dir / 'output-before.json', existing)
                await http.json('POST', PREFIX + '/arm', {'slot': slot, 'case': case})
                ready = asyncio.Event()
                event_task = asyncio.create_task(http.events(slot['requestId'], events, ready))
                await asyncio.wait_for(ready.wait(), timeout=5)
                # Persist before any entry call. Response loss never grants permission to call it again.
                write_new(slot_dir / 'dispatch-intent.json', {'requestId': slot['requestId'], 'at': utc(), 'driver': case['driver']})
                summary['submittedThisInvocation'] = True
                try:
                    response = await dispatch_entry(http, case, slot)
                except Exception:
                    summary['blocks'].append('entry-response-unknown-query-original-only')
                deadline = time.monotonic() + timeout
                while True:
                    observed = await http.json('GET', PREFIX + '/observations/' + slot['requestId'])
                    if observed.get('state') in ('complete', 'failed', 'blocked', 'unknown'):
                        break
                    require(time.monotonic() < deadline, 'observation-timeout-query-original-only')
                    await asyncio.sleep(poll_seconds)
                # The fixture flushes the original event sequence before completion.
                if observed.get('state') in ('complete', 'failed', 'unknown'):
                    await asyncio.wait_for(asyncio.shield(event_task), timeout=5)
            write_new(report_dir / 'entry-response.json', response)
            write_new(report_dir / 'observation.json', observed)
            summary['blocks'].extend(assess_observation(observed, events, case, slot, resumed=resume))
            summary['metrics'] = observed.get('metrics')
            if observed.get('state') == 'complete':
                summary['outputs'] = decode_outputs(Path(environment['root']) / 'output', observed, case, report_dir,
                                                    existed_before=read(slot_dir / 'output-before.json'))
            summary['providerTaskId'] = observed.get('providerTaskId')
            for item in [*run['inputs'].values(), *run.get('captureInputs', [])]:
                require(file_hash(item['path']) == item['sha256'], 'evaluation-input-changed-during-run')
            require(file_hash(__file__) == run['runnerSha256'], 'runner-changed-during-run')
            if continuation is not None:
                verified_continuation(run)
            summary['status'] = 'captured' if not summary['blocks'] else 'blocked'
    except Exception as error:
        summary['blocks'].append(str(error) if isinstance(error, Blocked) else 'inspection-or-transport-unavailable')
        write_new(report_dir / 'first-failure.json', {'type': type(error).__name__, 'code': summary['blocks'][-1], 'at': utc()})
    finally:
        if event_task:
            event_task.cancel()
            await asyncio.gather(event_task, return_exceptions=True)
        write_new(report_dir / 'websocket-events.json', events)
        summary['finishedAt'] = utc()
        summary['artifacts'] = [{'path': p.name, 'sha256': file_hash(p), 'bytes': p.stat().st_size}
                                for p in sorted(report_dir.iterdir()) if p.is_file()]
        write_new(report_dir / 'result.json', summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    prepare = actions.add_parser('prepare')
    for name in ('prepared', 'approval', 'cases', 'destination'):
        prepare.add_argument('--' + name, type=Path, required=True)
    prepare.add_argument('--continuation-review', type=Path)
    for action in ('run', 'resume'):
        command = actions.add_parser(action)
        command.add_argument('--directory', type=Path, required=True)
        command.add_argument('--slot', type=int, required=True)
        command.add_argument('--execute-reviewed', action='store_true')
    args = parser.parse_args()
    if args.action == 'prepare':
        result = prepare_run(args.prepared, args.approval, args.cases, args.destination,
                             continuation_review_path=args.continuation_review)
        print(json.dumps({'status': 'prepared-not-executed', 'slots': len(result['slots']), 'inferencesExecuted': 0}))
        return 0
    result = asyncio.run(execute_slot(args.directory, args.slot, resume=args.action == 'resume', execute_reviewed=args.execute_reviewed))
    print(json.dumps({'status': result['status'], 'blocks': result['blocks'], 'productAcceptance': False}))
    return 0 if result['status'] == 'captured' else 2


if __name__ == '__main__':
    raise SystemExit(main())
