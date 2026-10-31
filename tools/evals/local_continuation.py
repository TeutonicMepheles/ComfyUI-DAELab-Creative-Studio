"""Read-only provenance for a tool-only continuation of the fixed 44-slot Eval.

The caller writes the returned manifest with exclusive creation and pins it in
the successor run's ``continuation`` field. No previous run/result is rewritten,
copied, relabelled, submitted or granted product acceptance here. This narrowly
supports one paired completed prefix followed by one proven numeric-comparison
rejection before dispatch. It is not a retry mechanism for unknown executions.
"""
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import zipfile

from tools.evals.request_contract import canonical, compare_requests

OWNER = 'creative-studio-local-eval-continuation-v1'
RUN_OWNER = 'creative-studio-local-eval-runner-v1'
IDENTITIES = ('requestId', 'batchId', 'clientId', 'attemptId')
LOGICAL = ('slot', 'sampleId', 'variant', 'repetition', 'smoke')


class ContinuationError(ValueError):
    pass


def _need(value, code):
    if not value:
        raise ContinuationError(code)


def _hash(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def _plain(path):
    path = Path(path)
    _need(path.is_absolute(), 'continuation-path-must-be-absolute')
    for part in (path, *path.parents):
        _need(not part.is_symlink() and not getattr(part, 'is_junction', lambda: False)(),
              'continuation-linked-path-refused')
    return path


def _bytes(path):
    try:
        return _plain(path).read_bytes()
    except OSError as error:
        raise ContinuationError('continuation-file-unavailable') from error


def _read(path):
    try:
        return json.loads(_bytes(path).decode('utf-8-sig'))
    except (UnicodeError, ValueError) as error:
        raise ContinuationError('continuation-json-invalid') from error


def _pin(path):
    path = _plain(path)
    raw = _bytes(path)
    return {'path': str(path.resolve()), 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}


def _checked(record):
    actual = _pin(record['path'])
    _need(actual['sha256'] == record['sha256'] and
          ('bytes' not in record or actual['bytes'] == record['bytes']), 'continuation-file-hash-changed')
    return actual


def _relative(value):
    p = PurePosixPath(value)
    _need(isinstance(value, str) and value and '\\' not in value and not p.is_absolute()
          and ':' not in value and all(x not in ('', '.', '..') for x in value.split('/')),
          'continuation-relative-path-invalid')
    return p


def _binding(run):
    # The manifest is pinned by this one excluded field, avoiding a hash cycle.
    return deepcopy({k: v for k, v in run.items() if k != 'continuation'})


def _run_inputs(run):
    _need(run.get('schemaVersion') == 1 and run.get('owner') == RUN_OWNER
          and run.get('productAcceptance') is False and run.get('qualityScores') is None,
          'continuation-run-contract-invalid')
    for record in [*run['inputs'].values(), *run.get('captureInputs', [])]:
        _checked(record)
    prepared = _read(run['inputs']['prepared']['path'])
    approval = _read(run['inputs']['approval']['path'])
    for kind in ('prepared', 'cases', 'plan'):
        _need(approval.get(kind + 'Sha256') == run['inputs'][kind]['sha256'], 'continuation-approval-input-mismatch')
    _need(approval.get('runnerSha256') == run['runnerSha256'], 'continuation-runner-review-mismatch')
    config = prepared['configuration']
    source = next(s for s in config['sources'] if s['key'] == 'studio')
    _need(approval.get('hostCommit') == config['hostCommit'] and approval.get('studioCommit') == source['commit'],
          'continuation-source-review-mismatch')
    return prepared


def _schedule(run, plan):
    _need(plan['baseInferenceCount'] == 44 and plan['pairedSmokeInferenceCount'] == 20
          and plan['variants'] == ['baseline', 'studio'] and len(plan['samples']) == 10,
          'continuation-plan-not-standard-44')
    expected = []
    for repetition in range(1, max(s['repetitionsPerVariant'] for s in plan['samples']) + 1):
        for sample in plan['samples']:
            if sample['repetitionsPerVariant'] >= repetition:
                for variant in plan['variants']:
                    expected.append(dict(slot=len(expected) + 1, sampleId=sample['id'], variant=variant,
                                         repetition=repetition, smoke=repetition == 1))
    rows = run['slots']
    _need(len(rows) == len(expected) == 44, 'continuation-complete-schedule-required')
    for row, logical in zip(rows, expected):
        _need({k: row[k] for k in LOGICAL} == logical, 'continuation-schedule-changed')
        _need(all(re.fullmatch('[a-f0-9-]{36}', row[k]) for k in IDENTITIES), 'continuation-identity-invalid')
    for key in IDENTITIES:
        _need(len({r[key] for r in rows}) == 44, 'continuation-duplicate-identity')


def _file_records(directory, records):
    result = {}
    for record in records:
        relative = _relative(record['path']).as_posix()
        _need(relative not in result, 'continuation-duplicate-file-record')
        actual = _pin(Path(directory) / relative)
        _need(actual['bytes'] == record['bytes'] and actual['sha256'] == record['sha256'],
              'continuation-installed-source-changed')
        result[relative] = {'bytes': record['bytes'], 'sha256': record['sha256']}
    actual_names = {p.relative_to(directory).as_posix() for p in Path(directory).rglob('*') if p.is_file()}
    _need(actual_names == set(result), 'continuation-installed-file-set-changed')
    return result


def _snapshot(directory, record):
    _checked({'path': record['archive'], 'sha256': record['sha256']})
    files = _file_records(directory, record['files'])
    try:
        with zipfile.ZipFile(record['archive']) as archive:
            archived = {}
            for info in archive.infolist():
                if info.is_dir():
                    continue
                name = _relative(info.filename).as_posix()
                _need(name not in archived and (info.external_attr >> 16) & 0o170000 != 0o120000,
                      'continuation-archive-link-or-duplicate')
                raw = archive.read(info)
                archived[name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
            _need(archived == files, 'continuation-archive-manifest-changed')
    except (OSError, zipfile.BadZipFile) as error:
        raise ContinuationError('continuation-archive-unavailable') from error
    return files


def _reviewed_changes(changes):
    result = {}
    for item in changes:
        _need(set(item) == {'path', 'beforeSha256', 'afterSha256', 'reason'}, 'continuation-change-review-shape')
        name = _relative(item['path']).as_posix()
        p = PurePosixPath(name)
        allowed = (p.parent.as_posix() == 'tools/evals' and p.suffix == '.py') or name.startswith('tests/evals/') or name == 'tools/host/prepare_gpu_evaluation.py'
        _need(allowed and name not in result and isinstance(item['reason'], str) and item['reason'].strip(),
              'continuation-only-reviewed-eval-tool-changes')
        for key in ('beforeSha256', 'afterSha256'):
            _need(item[key] is None or re.fullmatch('[a-f0-9]{64}', item[key]), 'continuation-change-hash-invalid')
        _need(item['beforeSha256'] != item['afterSha256'], 'continuation-stale-change-review')
        result[name] = deepcopy(item)
    return result


def _source_compatibility(old, new, old_run, new_run, changes):
    before, after = old['configuration'], new['configuration']
    _need(before.get('owner') == after.get('owner') == 'creative-studio-gpu-eval-preparation-v1', 'continuation-foreign-preparation')
    excluded = {'destination', 'ports', 'sources', 'instrumentation'}
    _need({k: v for k, v in before.items() if k not in excluded} ==
          {k: v for k, v in after.items() if k not in excluded}, 'continuation-host-hardware-weights-or-configuration-changed')
    _checked({'path': before['runtimeFile'], 'sha256': before['runtimeFileSha256']})
    _checked({'path': after['runtimeFile'], 'sha256': after['runtimeFileSha256']})
    old_root, new_root = _plain(before['destination']), _plain(after['destination'])
    _need(old_root != new_root and not old_root.is_relative_to(new_root) and not new_root.is_relative_to(old_root),
          'continuation-new-isolated-preparation-required')
    source_maps = [{s['key']: s for s in c['sources']} for c in (before, after)]
    _need(set(source_maps[0]) == set(source_maps[1]) == {'canvas', 'business', 'ggufPlugin', 'studio'}, 'continuation-source-set-changed')
    for key in source_maps[0]:
        a, b = source_maps[0][key], source_maps[1][key]
        _need(a == b if key != 'studio' else {k: v for k, v in a.items() if k != 'commit'} ==
              {k: v for k, v in b.items() if k != 'commit'}, 'continuation-upstream-source-changed')
    manifests = []
    for prepared, run, config, sources in zip((old, new), (old_run, new_run), (before, after), source_maps):
        all_files = {}
        _need(set(prepared['environments']) == {'baseline', 'studio'}, 'continuation-paired-preparation-required')
        for variant in ('baseline', 'studio'):
            environment = prepared['environments'][variant]
            eroot = _plain(environment['root'])
            _need(eroot == Path(config['destination']) / variant, 'continuation-environment-root-invalid')
            expected_packages = {'canvas', 'business', 'ggufPlugin'} if variant == 'baseline' else {'studio', 'ggufPlugin'}
            _need(set(environment['snapshots']) == expected_packages, 'continuation-installed-package-set-changed')
            for key, record in environment['snapshots'].items():
                all_files[(variant, key)] = _snapshot(eroot / 'custom_nodes' / sources[key]['name'], record)
        instrument = config['instrumentation']
        _need(instrument.get('enabled') is True, 'continuation-instrumentation-required')
        files = _file_records(Path(config['destination']) / 'instrumentation', instrument['files'])
        _need(files['tools/evals/run_local_evaluation.py']['sha256'] == run['runnerSha256'], 'continuation-frozen-runner-mismatch')
        studio_files = all_files[('studio', 'studio')]
        _need(all(studio_files.get(p) == r for p, r in files.items()), 'continuation-instrumentation-not-in-reviewed-source')
        manifests.append(all_files)
    _need(set(manifests[0]) == set(manifests[1]), 'continuation-installed-package-set-changed')
    observed = {}
    for key in manifests[0]:
        a, b = manifests[0][key], manifests[1][key]
        if key != ('studio', 'studio'):
            _need(a == b, 'continuation-upstream-product-bytes-changed')
            continue
        for name in sorted(set(a) | set(b)):
            if a.get(name) != b.get(name):
                observed[name] = {'beforeSha256': a.get(name, {}).get('sha256'), 'afterSha256': b.get(name, {}).get('sha256')}
    _need(set(observed) == set(changes), 'continuation-unreviewed-or-stale-source-change')
    for name, values in observed.items():
        _need(all(changes[name][k] == v for k, v in values.items()), 'continuation-reviewed-source-hash-mismatch')
    # Only the isolated root and explicit port may differ in host commands.
    for variant in ('baseline', 'studio'):
        commands = []
        for prepared, config in ((old, before), (new, after)):
            env = prepared['environments'][variant]
            root = Path(env['root'])
            command = env['command']
            _need(command.count('--port') == 1 and command[command.index('--port') + 1] == str(config['ports'][variant]),
                  'continuation-host-port-mismatch')
            commands.append(['<port>' if i == command.index('--port') + 1 else
                             str(v).replace(str(root), '<environment>').replace(root.as_posix(), '<environment>')
                             for i, v in enumerate(command)])
        _need(commands[0] == commands[1], 'continuation-host-command-changed')
    return {'productFilesUnchanged': True, 'hostHardwareAndWeightConfigurationUnchanged': True,
            'reviewedSourceChanges': observed, 'oldStudioCommit': source_maps[0]['studio']['commit'],
            'newStudioCommit': source_maps[1]['studio']['commit']}


def _slot_record(parent_root, slot):
    directory = parent_root / f"slot-{slot['slot']:02d}"
    result = _read(directory / 'result.json')
    _need(all(result.get(k) == v for k, v in slot.items()) and _read(directory / 'identity.json') == slot,
          'continuation-original-identity-mismatch')
    artifacts, names = [], set()
    for a in result['artifacts']:
        relative = _relative(a['path'])
        _need(len(relative.parts) == 1 and a['path'] not in names and a['path'] != 'result.json', 'continuation-artifact-name-invalid')
        names.add(a['path'])
        artifacts.append(_checked({**a, 'path': str(directory / a['path'])}))
    _need(names | {'result.json'} == {p.name for p in directory.iterdir() if p.is_file()}, 'continuation-original-artifact-set-changed')
    _need({'identity.json', 'observation.json', 'websocket-events.json'} <= names, 'continuation-original-artifact-missing')
    return result, _read(directory / 'observation.json'), {'result': _pin(directory / 'result.json'), 'artifacts': artifacts}


def _completed(parent_root, slot, case):
    result, observed, pins = _slot_record(parent_root, slot)
    _need(result.get('status') == 'captured' and result.get('blocks') == [] and result.get('queryOnly') is False
          and result.get('submittedThisInvocation') is True and result.get('productAcceptance') is False
          and result.get('qualityScores') is None, 'continuation-prefix-not-original-captured')
    _need(observed.get('requestId') == slot['requestId'] and observed.get('state') == 'complete'
          and observed.get('blocks') == [] and observed.get('dispatches') == 1 and observed.get('ledgerReuse') is False
          and observed.get('providerTaskId') and result.get('providerTaskId') == observed['providerTaskId'],
          'continuation-prefix-single-dispatch-unproven')
    _need(observed.get('comparison', {}).get('passed') is True
          and compare_requests(case['expected'], observed['finalRequest'], case.get('runtimeDifferences', []))['passed'],
          'continuation-prefix-request-not-equivalent')
    _need(observed.get('weightRehashVerified') is True and
          [(w['sha256'], w['bytes']) for w in observed.get('weights', [])] == [(w['sha256'], w['bytes']) for w in case['weights']],
          'continuation-prefix-weight-proof-missing')
    network, receipt = observed.get('network') or {}, observed.get('serviceReceipt') or {}
    _need(network.get('complete') is True and network.get('externalAttempts') == 0
          and receipt.get('complete') is True and receipt.get('readOnly') is True and receipt.get('requestId') == slot['requestId'],
          'continuation-prefix-network-or-receipt-incomplete')
    if case['driver'].startswith('native-'):
        events = observed.get('events', [])
        _need(all(e.get('source') == 'PromptServer.send_sync' and e.get('data', {}).get('prompt_id') == observed['providerTaskId'] for e in events), 'continuation-prefix-native-event-owner')
        types = [e.get('type') for e in events]
        _need(types.count('execution_start') == types.count('execution_success') == 1
              and not any(t in types for t in ('execution_cached', 'execution_error', 'execution_interrupted')),
              'continuation-prefix-native-execution-unproven')
        for sampler in case['samplerNodes']:
            _need(sum(e['type'] == 'executing' and e['data'].get('node') == sampler for e in events) == 1,
                  'continuation-prefix-native-sampler-unproven')
    else:
        model = observed.get('ollama') or {}
        _need(model.get('done') is True and model.get('done_reason') == 'stop'
              and type(model.get('eval_count')) is int and model['eval_count'] > 0
              and type(model.get('eval_duration')) is int and model['eval_duration'] > 0,
              'continuation-prefix-ollama-execution-unproven')
    metrics = observed.get('metrics') or {}
    segments = metrics.get('segmentsMs') or {}
    _need(segments and all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in segments.values())
          and type(metrics.get('durationMs')) in (int, float)
          and abs(sum(segments.values()) - metrics['durationMs']) <= max(1, metrics['durationMs'] * .001),
          'continuation-prefix-metrics-incomplete')
    _need(result.get('outputs') and all(o.get('decodable') is True for o in result['outputs']), 'continuation-prefix-output-incomplete')
    return pins, result


def _pointer(value, pointer):
    for part in pointer.lstrip('/').split('/'):
        key = part.replace('~1', '/').replace('~0', '~')
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def _blocked(parent_root, slot, case, trace_root, prepared, prepared_sha):
    result, observed, pins = _slot_record(parent_root, slot)
    _need(result.get('status') == 'blocked' and observed.get('state') == 'blocked'
          and observed.get('requestId') == slot['requestId'] and observed.get('dispatches') == 0
          and observed.get('providerTaskId') is None and observed.get('events') == []
          and observed.get('blocks') == ['dispatch-admission-failed'], 'continuation-failure-not-proven-before-dispatch')
    comparison = observed.get('comparison') or {}
    _need(comparison.get('passed') is False and comparison.get('differences'), 'continuation-numeric-rejection-proof-missing')
    for d in comparison['differences']:
        a, b = (_pointer(x, d['path']) for x in (case['expected'], observed['finalRequest']))
        _need(type(a) in (int, float) and type(b) in (int, float) and math.isfinite(a) and math.isfinite(b)
              and a == b and canonical(a) != canonical(b) and d['baselineSha256'] == _hash(a) and d['studioSha256'] == _hash(b),
              'continuation-failure-is-not-finite-numeric-equivalence')
    _need(compare_requests(case['expected'], observed['finalRequest'], case.get('runtimeDifferences', []))['passed'],
          'continuation-replacement-would-change-model-request')
    trace_root = _plain(trace_root)
    environment = prepared['environments'][slot['variant']]
    _need(trace_root.is_relative_to(Path(environment['root']) / 'evidence'), 'continuation-failure-trace-outside-original-environment')
    identity = _read(trace_root / 'identity.json')
    source = next(s for s in prepared['configuration']['sources'] if s['key'] == 'studio')
    expected = dict(variant=slot['variant'], hostCommit=prepared['configuration']['hostCommit'], studioCommit=source['commit'],
                    preparedSha256=prepared_sha, root=environment['root'], port=prepared['configuration']['ports'][slot['variant']])
    _need(all(identity.get(k) == v for k, v in expected.items()), 'continuation-failure-trace-identity-mismatch')
    directory = trace_root / slot['requestId']
    _need(not (directory / 'dispatch-consumed.json').exists(), 'continuation-failure-already-consumed')
    _need(_read(directory / 'armed.json') == {'slot': slot, 'case': case}, 'continuation-failure-armed-case-mismatch')
    try:
        events = [json.loads(line) for line in _bytes(directory / 'journal.jsonl').decode('utf-8').splitlines() if line]
    except (ValueError, UnicodeError) as error:
        raise ContinuationError('continuation-failure-journal-invalid') from error
    _need(len(events) == 2 and events[0].get('type') == 'armed' and events[0].get('requestId') == slot['requestId']
          and events[1].get('type') == 'blocked-before-dispatch' and events[1].get('report') == observed,
          'continuation-failure-journal-not-zero-dispatch')
    _need({p.name for p in directory.iterdir()} == {'armed.json', 'journal.jsonl'}, 'continuation-failure-trace-extra-files')
    return {**pins, 'parentIdentity': deepcopy(slot), 'traceRoot': str(trace_root),
            'traceArtifacts': [_pin(p) for p in (trace_root / 'identity.json', directory / 'armed.json', directory / 'journal.jsonl')],
            'disposition': 'retained-zero-inference-tool-failure; never inherited as captured', 'dispatchConsumedAbsent': True}


def create_continuation(parent_run_path, successor_run, *, completed_prefix, blocked_slot,
                        blocked_trace_root, reviewed_changes, reviewer):
    """Validate and return a manifest; caller exclusively persists and pins it."""
    try:
        _need(isinstance(reviewer, str) and reviewer.strip(), 'continuation-reviewer-required')
        _need(type(completed_prefix) is int and 0 < completed_prefix < 44 and completed_prefix % 2 == 0
              and type(blocked_slot) is int and blocked_slot == completed_prefix + 1, 'continuation-contiguous-paired-prefix-required')
        parent_run_path = _plain(parent_run_path)
        parent, current = _read(parent_run_path), _binding(successor_run)
        _need('continuation' not in parent, 'continuation-chaining-not-supported')
        old_prepared, new_prepared = _run_inputs(parent), _run_inputs(current)
        for key in ('cases', 'plan', 'traceability'):
            _need(parent['inputs'][key]['sha256'] == current['inputs'][key]['sha256'], 'continuation-fixed-input-bytes-changed')
        _need(parent.get('captureInputs') == current.get('captureInputs'), 'continuation-source-captures-changed')
        plan = _read(parent['inputs']['plan']['path'])
        _schedule(parent, plan); _schedule(current, plan)
        for key in IDENTITIES:
            _need(not ({s[key] for s in parent['slots']} & {s[key] for s in current['slots']}), 'continuation-successor-identities-must-all-be-fresh')
        for slot in parent['slots'][blocked_slot:]:
            _need(not (parent_run_path.parent / f"slot-{slot['slot']:02d}").exists(), 'continuation-later-original-attempt-exists')
        changes = _reviewed_changes(reviewed_changes)
        compatible = _source_compatibility(old_prepared, new_prepared, parent, current, changes)
        cases = _read(parent['inputs']['cases']['path'])
        prefix = []
        for old_slot, new_slot in zip(parent['slots'][:completed_prefix], current['slots'][:completed_prefix]):
            pins, _ = _completed(parent_run_path.parent, old_slot, cases[old_slot['variant']][old_slot['sampleId']])
            prefix.append({**pins, 'logicalSlot': old_slot['slot'], 'parentIdentity': deepcopy(old_slot),
                           'pendingSlotIdentity': deepcopy(new_slot), 'disposition': 'reference-original-execution-only'})
        failed = parent['slots'][blocked_slot - 1]
        failure = _blocked(parent_run_path.parent, failed, cases[failed['variant']][failed['sampleId']],
                           blocked_trace_root, old_prepared, parent['inputs']['prepared']['sha256'])
        failure['replacementIdentity'] = deepcopy(current['slots'][blocked_slot - 1])
        return {'schemaVersion': 1, 'owner': OWNER, 'reviewer': reviewer,
                'parentRun': _pin(parent_run_path), 'parentInputs': deepcopy(parent['inputs']),
                'parentRunnerSha256': parent['runnerSha256'], 'successor': current,
                'completedPrefix': prefix, 'blockedAttempt': failure, 'pendingSlots': list(range(blocked_slot, 45)),
                'reviewedChanges': [changes[k] for k in sorted(changes)], 'compatibility': compatible,
                'productAcceptance': False, 'qualityScores': None, 'automaticExecution': False}
    except ContinuationError:
        raise
    except (KeyError, TypeError, StopIteration, IndexError, OSError, ValueError) as error:
        raise ContinuationError('continuation-contract-or-evidence-incomplete') from error


@dataclass(frozen=True)
class VerifiedContinuation:
    """One invocation's verified snapshot; reverify after execution, not globally."""
    manifest_hash: str
    successor_hash: str
    inherited_results: dict


def verify_continuation(manifest, successor_run):
    _need(manifest.get('schemaVersion') == 1 and manifest.get('owner') == OWNER, 'continuation-manifest-version-invalid')
    expected = create_continuation(manifest['parentRun']['path'], successor_run,
        completed_prefix=len(manifest['completedPrefix']), blocked_slot=manifest['blockedAttempt']['parentIdentity']['slot'],
        blocked_trace_root=manifest['blockedAttempt']['traceRoot'], reviewed_changes=manifest['reviewedChanges'], reviewer=manifest['reviewer'])
    _need(canonical(expected) == canonical(manifest), 'continuation-manifest-or-original-evidence-changed')
    return VerifiedContinuation(_hash(manifest), _hash(_binding(successor_run)),
        {x['logicalSlot']: _read(x['result']['path']) for x in manifest['completedPrefix']})


def _context(manifest, successor_run, context):
    if context is None:
        return verify_continuation(manifest, successor_run)
    _need(isinstance(context, VerifiedContinuation) and context.manifest_hash == _hash(manifest)
          and context.successor_hash == _hash(_binding(successor_run)), 'continuation-context-not-bound-to-run')
    return context


def inherited_result(manifest, successor_run, slot_number, *, context=None):
    """Return the original result identity, never a synthetic successor result."""
    context = _context(manifest, successor_run, context)
    return deepcopy(context.inherited_results.get(slot_number))


def require_pending_slot(manifest, successor_run, slot_number, *, context=None):
    """Mandatory in run AND resume, and before an owned host accepts /arm."""
    _context(manifest, successor_run, context)
    _need(type(slot_number) is int and slot_number in manifest['pendingSlots'], 'continuation-inherited-or-unknown-slot-cannot-execute')
    return deepcopy(successor_run['slots'][slot_number - 1])
