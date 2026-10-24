"""Prepare/run the explicit PERF-06 HTTP fixture. Never starts or changes a host."""
import argparse
import asyncio
from collections import Counter
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import platform
import sys
import time
from urllib.parse import urlsplit
import uuid

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'tests/performance_fixture'
PLAN = ROOT / 'tests/fixtures/performance/fake-job-plan.json'
PREFIX = '/studio-test/performance-scheduler'
VERSION = 'studio-perf06-fixture-v1'
PROTECTED_PORTS = {8000, 8224, 8225, 8226, 8227, 11434}
LIMITS = {'fake-local': 1, 'fake-cloud': 3, 'fake-transcode': 2}
TERMINAL = {'succeeded', 'failed', 'cancelled'}


def harness_module():
    spec = importlib.util.spec_from_file_location('studio_performance_fixture_harness', FIXTURE / 'harness.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def new_path(value, *, owned=False):
    path = Path(value).absolute()
    for ancestor in (path, *path.parents):
        if ancestor.is_symlink() or getattr(ancestor, 'is_junction', lambda: False)():
            raise ValueError('Evidence/package paths may not traverse links.')
    path = path.resolve()
    if path.exists() or owned and not path.is_relative_to(ROOT / '.local'):
        raise ValueError('Use a new output under repository .local for owned artifacts.')
    return path


def prepare_package(destination):
    destination = new_path(destination, owned=True)
    _, plan_hash = harness_module().validate_plan(PLAN.read_bytes())
    files = {'__init__.py': (FIXTURE / '__init__.py').read_bytes(), 'harness.py': (FIXTURE / 'harness.py').read_bytes(),
             'fake-job-plan.json': PLAN.read_bytes()}
    manifest = {'fixture': VERSION, 'testOnly': True, 'status': 'prepared-not-executed', 'planSha256': plan_hash,
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    destination.mkdir(parents=True)
    for name, data in files.items():
        with (destination / name).open('xb') as output:
            output.write(data)
    with (destination / 'performance-fixture.json').open('x', encoding='utf-8') as output:
        json.dump(manifest, output, indent=2)
    return {'package': str(destination), **manifest}


def endpoint(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1')
            or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment
            or parsed.port is None or parsed.port in PROTECTED_PORTS or not 1024 <= parsed.port <= 65535):
        raise ValueError('Choose a new explicitly installed loopback CPU host, never an existing protected service.')
    return value.rstrip('/')


def percentile(values, quantile):
    return sorted(values)[max(0, math.ceil(len(values) * quantile) - 1)] if values else None


def analyze_run(evidence, plan, health):
    run_id = evidence['runId']
    expected = {run_id + '.' + row['request_id']: row for row in plan['jobs']}
    jobs = evidence.get('jobs', [])
    observations = evidence.get('observations', [])
    rows = {job['request_id']: job for job in jobs}
    creates = Counter(event['requestId'] for event in observations if event['event'] == 'provider_create')
    active, peaks, acquired, lease_peak, waiting, dispatches = {k: set() for k in LIMITS}, {k: 0 for k in LIMITS}, {}, 0, {k: [] for k in LIMITS}, {}
    diagnostics, resource_peaks, resource_samples = [], {'gpu': 0, 'cloud': 0, 'transcode': 0}, 0
    for event in observations:
        name, request_id = event['event'], event.get('requestId')
        if name == 'dispatch_requested': dispatches[request_id] = event['elapsedMs']
        if name == 'provider_create' and request_id in dispatches:
            waiting[event['kind']].append(event['elapsedMs'] - dispatches[request_id])
        if name == 'provider_active':
            if request_id in active[event['kind']]: diagnostics.append('duplicate-active:' + request_id)
            active[event['kind']].add(request_id)
            peaks[event['kind']] = max(peaks[event['kind']], len(active[event['kind']]))
        if name == 'provider_finished':
            if request_id not in active[event['kind']]: diagnostics.append('finish-without-active:' + request_id)
            active[event['kind']].discard(request_id)
        if name == 'lease_acquired':
            if request_id in acquired: diagnostics.append('duplicate-lease:' + str(request_id))
            acquired[request_id] = event['resource']
        if name == 'lease_released':
            if request_id not in acquired: diagnostics.append('release-without-lease:' + str(request_id))
            acquired.pop(request_id, None)
        if name == 'resource_snapshot':
            resource_samples += 1
            for resource in resource_peaks:
                resource_peaks[resource] = max(resource_peaks[resource], event['snapshot']['resources'][resource]['active'])
            lease_peak = resource_peaks['gpu']
    queued_cancels = {e['requestId'] for e in observations if e['event'] == 'control_cancel' and e['beforeState'] == 'pending' and e.get('waitingResource')}
    queued_by_kind = {kind: sorted(key for key in queued_cancels if expected[key]['kind'] == kind) for kind in LIMITS}
    phases = {}
    for event in observations:
        if event['event'] in ('product_phase', 'provider_phase', 'file_phase'):
            label = event['event'] + ':' + event['phase'] + ':' + event.get('thread', event.get('kind', 'worker'))
            phases.setdefault(label, []).append(event['durationMs'])
    recovered = {e['requestId'] for e in observations if e['event'] == 'control_recover' and e['beforeState'] in ('unknown', 'needs_recovery')}
    retained = {e['requestId']: e['sequence'] for e in observations if e['event'] == 'lease_scope_exiting' and e.get('retained') and not e.get('released')}
    released = {e['requestId']: e['sequence'] for e in observations if e['event'] == 'lease_released'}
    resources = evidence.get('resourceSnapshot', {}).get('resources', {})
    success_times = [s['durationMs'] for s in health if s.get('status') == 200]
    busy_times = [s['durationMs'] for s in health if s.get('status') == 200 and s['phase'] == 'busy']
    checks = {
        'exact100Identities': len(jobs) == 100 and len(rows) == 100 and set(rows) == set(expected),
        'allTerminal': len(jobs) == 100 and all(j['state'] in TERMINAL for j in jobs),
        'fixedOutcomes': set(rows) == set(expected) and all(rows[key]['state'] == ('cancelled' if key in queued_cancels else row['outcome']) for key, row in expected.items()),
        'noDuplicateCreate': all(count == 1 for count in creates.values()) and all(j['attempt'] <= 1 for j in jobs),
        'everyUncancelledSubmittedOnce': set(creates) == set(expected) - queued_cancels,
        'queuedCancellationNoExecution': len(queued_cancels) >= 3 and all(not creates[key] and rows.get(key, {}).get('state') == 'cancelled' for key in queued_cancels),
        'allClassesQueuedCancellationObserved': all(queued_by_kind.values()),
        'uncertainRecoveryObserved': len(recovered) == 2 and all(creates[key] == 1 for key in recovered),
        'uncertainCapacityRetainedUntilRecovery': set(retained) == recovered and all(released.get(key, -1) > sequence for key, sequence in retained.items()),
        'localGpuMutualExclusion': resource_samples > 0 and lease_peak <= 1 and peaks['fake-local'] <= 1,
        'cloudWithin3': resource_samples > 0 and peaks['fake-cloud'] <= 3 and resource_peaks['cloud'] <= 3,
        'transcodeWithin2': resource_samples > 0 and peaks['fake-transcode'] <= 2 and resource_peaks['transcode'] <= 2,
        'transcodeInputsActuallyFrozen': all(len(j.get('frozenInputHashes', [])) == 1 and len(j['frozenInputHashes'][0]) == 64 for j in jobs if j['kind'] == 'fake-transcode'),
        'allResourceClassesProgressed': all(peaks[k] > 0 and any(j['kind'] == k and j['state'] in ('succeeded', 'failed') for j in jobs) for k in LIMITS),
        'noLeakedObservedResources': not acquired and not any(active.values()) and evidence.get('workers') == 0 and not diagnostics
            and set(resources) == {'gpu', 'cloud', 'transcode'} and all(row['active'] == row['queued'] == row['retained'] == 0 for row in resources.values()),
        'healthAllSuccessful': bool(health) and all(s.get('status') == 200 for s in health),
        'healthP95Within200ms': bool(success_times) and percentile(success_times, .95) <= 200,
        'busyHealthP95Within200ms': bool(busy_times) and percentile(busy_times, .95) <= 200,
    }
    return {'checks': checks, 'failedChecks': [key for key, ok in checks.items() if not ok], 'productAcceptance': False,
            'observedProviderPeaks': peaks, 'observedGpuLeasePeak': lease_peak, 'traceDiagnostics': diagnostics,
            'observedResourcePeaks': resource_peaks,
            'atomicResourceSnapshotCount': resource_samples,
            'queuedCancellationByKind': queued_by_kind,
            'phaseDurationMs': {key: {'count': len(values), 'p50': percentile(values, .5), 'p95': percentile(values, .95), 'max': max(values)} for key, values in phases.items()},
            'queueWaitMs': {kind: {'samples': values, 'p50': percentile(values, .5), 'p95': percentile(values, .95), 'max': max(values) if values else None} for kind, values in waiting.items()},
            'healthMs': {'samples': len(success_times), 'p50': percentile(success_times, .5), 'p95': percentile(success_times, .95), 'max': max(success_times) if success_times else None,
                         'busySamples': len(busy_times), 'busyP95': percentile(busy_times, .95)},
            'queuedCancelledIds': sorted(queued_cancels), 'queryRecoveredIds': sorted(recovered)}


async def run_plan(base_url, *, run_prefix=None, repeats=5, warmup_seconds=10, round_seconds=30,
                   timeout_seconds=120, health_interval=.05, regression=False):
    import aiohttp
    base_url = endpoint(base_url)
    if type(repeats) is not int or not 1 <= repeats <= 5 or min(warmup_seconds, round_seconds) < 0 or timeout_seconds <= 0 or not .01 <= health_interval <= 1:
        raise ValueError('Invalid bounded measurement configuration.')
    if not regression and (repeats != 5 or warmup_seconds < 10 or round_seconds < 30):
        raise ValueError('Actual PERF-06 collection needs 10 seconds warmup and five rounds of at least 30 seconds.')
    plan, plan_hash = harness_module().validate_plan(PLAN.read_bytes())
    prefix = run_prefix or 'perf-' + uuid.uuid4().hex
    result = {'schemaVersion': 1, 'scenario': 'PERF-06', 'productAcceptance': False, 'startedAtUnix': time.time(),
              'client': {'python': sys.version, 'platform': platform.platform(), 'processor': platform.processor()},
              'driverSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'planSha256': plan_hash,
              'protocol': {'repeats': repeats, 'warmupSeconds': warmup_seconds, 'roundSeconds': round_seconds, 'healthInterval': health_interval},
              'measurementKind': 'loopback-regression' if regression else 'isolated-comfyui-http', 'rounds': [], 'warmupHealth': []}
    timeout = aiohttp.ClientTimeout(total=timeout_seconds)
    async with aiohttp.ClientSession(timeout=timeout, trust_env=False) as session:
        async def call(path, data=None):
            async with session.request('GET' if data is None else 'POST', base_url + path,
                                       json=data, headers={'Origin': base_url} if data is not None else {}) as response:
                value = await response.json()
                if response.status != 200: raise RuntimeError(f'HTTP {response.status} at {path}: {value.get("error", "request failed")}')
                return value
        manifest = await call(PREFIX + '/manifest')
        if manifest.get('fixture') != VERSION or manifest.get('testOnly') is not True or manifest.get('planSha256') != plan_hash or manifest.get('jobCount') != 100:
            raise ValueError('The explicitly selected host does not expose the prepared fixed fixture.')
        if manifest.get('hostKind') != ('loopback-regression' if regression else 'isolated-comfyui'):
            raise ValueError('Regression mode and isolated-host mode must not be confused.')
        result['fixture'] = manifest
        result['healthBefore'] = await call('/daelab/studio/health')
        if not regression:
            result['systemStats'] = await call('/system_stats')
        async def sample(samples, phase, stop):
            while not stop.is_set():
                start = time.perf_counter(); row = {'atUnix': time.time(), 'phase': phase()}
                try:
                    async with session.get(base_url + '/daelab/studio/health', timeout=aiohttp.ClientTimeout(total=5)) as response:
                        await response.read(); row['status'] = response.status
                except (aiohttp.ClientError, asyncio.TimeoutError) as error:
                    row['error'] = type(error).__name__
                row['durationMs'] = (time.perf_counter() - start) * 1000; samples.append(row)
                try: await asyncio.wait_for(stop.wait(), timeout=health_interval)
                except asyncio.TimeoutError: pass
        stop = asyncio.Event(); warmup = asyncio.create_task(sample(result['warmupHealth'], lambda: 'warmup', stop))
        await asyncio.sleep(warmup_seconds); stop.set(); await warmup
        for index in range(repeats):
            run_id = prefix + '-' + str(index + 1)
            round_result = {'runId': run_id, 'health': [], 'control': [], 'timedOut': False}
            result['rounds'].append(round_result)
            busy, stop = True, asyncio.Event()
            sampling = asyncio.create_task(sample(round_result['health'], lambda: 'busy' if busy else 'after-terminal', stop))
            start = time.perf_counter()
            try:
                begun = await call(PREFIX + '/run', {'runId': run_id, 'planSha256': plan_hash})
                waiting = await call(PREFIX + '/status')
                pending = {j['request_id'] for j in waiting['jobs'] if j['state'] == 'pending'}
                cancel_ids = []
                for kind in LIMITS:
                    candidates = [run_id + '.' + row['request_id'] for row in plan['jobs'] if row['kind'] == kind]
                    cancel_ids.extend([key for key in candidates if key in pending and key in waiting['resourceWaiting']][-3:])
                round_result['control'].append(await call(PREFIX + '/control', {'action': 'cancel', 'requestIds': cancel_ids}))
                recovered = set()
                while True:
                    status = await call(PREFIX + '/status')
                    uncertain = [j['request_id'] for j in status['jobs'] if j['state'] in ('unknown', 'needs_recovery')]
                    if uncertain:
                        round_result['control'].append(await call(PREFIX + '/control', {'action': 'recover', 'requestIds': uncertain}))
                        recovered.update(uncertain)
                    # Recovered nonterminal transports have no dispatch worker; query original identities only.
                    still_running = [j['request_id'] for j in status['jobs'] if j['request_id'] in recovered and j['state'] not in TERMINAL]
                    if still_running:
                        await call(PREFIX + '/control', {'action': 'recover', 'requestIds': still_running})
                    if len(status['jobs']) == 100 and all(j['state'] in TERMINAL for j in status['jobs']) and status['workers'] == 0:
                        break
                    if time.perf_counter() - start >= timeout_seconds:
                        round_result['timedOut'] = True; break
                    await asyncio.sleep(.05)
                busy = False
                if not round_result['timedOut']:
                    before = status['providerCreateCounts']
                    await call(PREFIX + '/reconstruct', {})
                    await call(PREFIX + '/control', {'action': 'recover', 'requestIds': begun['requestIds']})
                    after = await call(PREFIX + '/status')
                    round_result['reconstructionQueryOnly'] = before == after['providerCreateCounts']
                remaining = round_seconds - (time.perf_counter() - start)
                if remaining > 0: await asyncio.sleep(remaining)
                round_result['evidence'] = await call(PREFIX + '/evidence')
            except Exception as error:
                round_result['collectionError'] = type(error).__name__ + ': ' + str(error)
                try: round_result['evidence'] = await call(PREFIX + '/evidence')
                except Exception: pass
            finally:
                stop.set(); await sampling
                round_result['durationSeconds'] = time.perf_counter() - start
            if 'evidence' in round_result:
                round_result['analysis'] = analyze_run(round_result['evidence'], plan, round_result['health'])
                round_result['analysis']['checks']['serviceReconstructionNoCreate'] = round_result.get('reconstructionQueryOnly') is True
                if round_result.get('reconstructionQueryOnly') is not True:
                    round_result['analysis']['failedChecks'].append('serviceReconstructionNoCreate')
            if round_result.get('collectionError') or round_result['timedOut']: break
        result['healthAfter'] = await call('/daelab/studio/health')
    failures = [item for round_result in result['rounds'] for item in round_result.get('analysis', {}).get('failedChecks', [])]
    result['healthBuildStable'] = result['healthBefore'] == result['healthAfter']
    if not result['healthBuildStable']: failures.append('healthBuildChangedDuringMeasurement')
    complete = len(result['rounds']) == repeats and all('analysis' in r and not r.get('collectionError') and not r['timedOut'] for r in result['rounds'])
    result['status'] = 'failed' if failures else 'requires_review' if complete and not regression else 'insufficient_evidence'
    result['failedChecks'] = sorted(set(failures))
    result['finishedAtUnix'] = time.time()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-package', type=Path)
    parser.add_argument('--base-url')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--run-prefix')
    args = parser.parse_args()
    if args.prepare_package:
        if args.base_url or args.output: parser.error('Preparation and execution are separate explicit operations.')
        print(json.dumps(prepare_package(args.prepare_package), indent=2)); return
    if not args.base_url or not args.output: parser.error('Execution requires --base-url and a new --output.')
    output = new_path(args.output, owned=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Reserve before any task submission; never overwrite previous evidence.
    with output.open('x', encoding='utf-8') as stream:
        try: result = asyncio.run(run_plan(args.base_url, run_prefix=args.run_prefix))
        except Exception as error: result = {'status': 'collection_failed', 'error': type(error).__name__ + ': ' + str(error), 'productAcceptance': False}
        json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({'output': str(output), 'status': result['status'], 'productAcceptance': False}))


if __name__ == '__main__':
    main()
