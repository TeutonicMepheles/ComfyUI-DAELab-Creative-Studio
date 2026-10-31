"""Synthetic local files only: no host, HTTP, model, GPU or product acceptance."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import uuid
import zipfile
from unittest.mock import patch

from tools.evals import local_continuation as continuation


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


def pin(path):
    return {'path': str(path.resolve()), 'sha256': digest(path)}


class ContinuationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.plan = json.loads((Path(__file__).parents[2] / 'docs/validation/catalog/local-eval-plan.json').read_text('utf-8'))
        put(self.root / 'plan.json', self.plan)
        put(self.root / 'traceability.json', {'synthetic': True})
        put(self.root / 'runtime.json', {'hardware': 'synthetic', 'weights': [{'sha256': 'a' * 64}]})
        cases = {v: {} for v in self.plan['variants']}
        for variant in cases:
            for sample in self.plan['samples']:
                native = sample['id'].startswith(('LOCAL-IMAGE-', 'LOCAL-H3-'))
                cases[variant][sample['id']] = {
                    'driver': 'native-image' if native else 'polish', 'samplerNodes': ['sample'] if native else [],
                    'expected': {'sampleId': sample['id'], 'effective': {'cfg': 1, 'weightSha256': ['a' * 64]},
                                 'finalRequest': {'sample': {'inputs': {'cfg': 1}}}},
                    'weights': [{'path': 'synthetic-weight', 'bytes': 1, 'sha256': 'a' * 64}], 'runtimeDifferences': []}
        put(self.root / 'cases.json', cases)
        self.cases = cases
        self.parent_path, self.parent = self.make_run('old')
        self.next_path, self.next = self.make_run('new')
        for s in self.parent['slots'][:10]:
            self.make_result(s, captured=True)
        self.make_result(self.parent['slots'][10], captured=False)
        self.trace_root = self.root / 'old-env/baseline/evidence/failed-11'
        s = self.parent['slots'][10]
        old_prepared = self.read(Path(self.parent['inputs']['prepared']['path']))
        put(self.trace_root / 'identity.json', {'variant': s['variant'], 'hostCommit': 'b' * 40,
            'studioCommit': 'c' * 40, 'preparedSha256': self.parent['inputs']['prepared']['sha256'],
            'root': old_prepared['environments']['baseline']['root'], 'port': 29001})
        request_root = self.trace_root / s['requestId']
        put(request_root / 'armed.json', {'slot': s, 'case': cases[s['variant']][s['sampleId']]})
        observation = self.read(self.root / 'old-run/slot-11/observation.json')
        self.journal = request_root / 'journal.jsonl'
        self.journal.write_text(json.dumps({'type': 'armed', 'requestId': s['requestId']}) + '\n' +
                                json.dumps({'type': 'blocked-before-dispatch', 'report': observation}) + '\n', encoding='utf-8')
        old_files = self.read(self.root / 'old-env/prepared.json')['environments']['studio']['snapshots']['studio']['files']
        new_files = self.read(self.root / 'new-env/prepared.json')['environments']['studio']['snapshots']['studio']['files']
        before, after = ({x['path']: x['sha256'] for x in rows} for rows in (old_files, new_files))
        self.changes = [{'path': p, 'beforeSha256': before.get(p), 'afterSha256': after.get(p),
                         'reason': 'Synthetic reviewed tool-only fix'} for p in before if before[p] != after[p]]

    @staticmethod
    def read(path):
        return json.loads(path.read_text('utf-8'))

    def make_run(self, name):
        env_root = self.root / (name + '-env')
        sources = [{'key': k, 'name': k, 'repository': str(self.root / ('source-' + k)),
                    'commit': ('c' if name == 'old' else 'd') * 40 if k == 'studio' else 'e' * 40}
                   for k in ('canvas', 'business', 'ggufPlugin', 'studio')]
        tool_files = {'tools/evals/request_contract.py': name.encode(),
                      'tools/evals/run_local_evaluation.py': (name + '-runner').encode()}
        all_files = {'backend/product.py': b'unchanged product', 'web/index.js': b'unchanged frontend', **tool_files}
        snapshots = {}
        for source in sources:
            files = all_files if source['key'] == 'studio' else {'upstream.py': source['key'].encode()}
            archive = env_root / 'archives' / (source['key'] + '.zip')
            archive.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(archive, 'w') as zipped:
                for relative, content in files.items(): zipped.writestr(relative, content)
            records = [{'path': p, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                       for p, content in files.items()]
            snapshots[source['key']] = {**pin(archive), 'archive': str(archive.resolve()), 'files': records}
            snapshots[source['key']].pop('path')
        environments = {}
        for variant, keys, port in (('baseline', ('canvas', 'business', 'ggufPlugin'), 29001), ('studio', ('studio', 'ggufPlugin'), 29002)):
            eroot = env_root / variant
            for key in keys:
                with zipfile.ZipFile(snapshots[key]['archive']) as zipped:
                    zipped.extractall(eroot / 'custom_nodes' / key)
            environments[variant] = {'root': str(eroot.resolve()), 'command': ['python', '-B', '-s', 'host/main.py', '--base-directory', str(eroot.resolve()), '--port', str(port)],
                                     'snapshots': {k: snapshots[k] for k in keys}, 'cachePolicy': 'none'}
        instrument_records = []
        for p, content in tool_files.items():
            target = env_root / 'instrumentation' / p
            target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(content)
            instrument_records.append({'path': p, 'bytes': len(content), 'sha256': digest(target)})
        config = {'owner': 'creative-studio-gpu-eval-preparation-v1', 'destination': str(env_root.resolve()),
                  'host': str(self.root / 'host'), 'hostCommit': 'b' * 40, 'python': 'synthetic-python',
                  'runtimeFile': str((self.root / 'runtime.json').resolve()), 'runtimeFileSha256': digest(self.root / 'runtime.json'),
                  'modelRoot': str(self.root / 'models'), 'bindings': {'same': True}, 'ollama': {'same': True},
                  'sources': sources, 'ports': {'baseline': 29001, 'studio': 29002},
                  'instrumentation': {'enabled': True, 'files': instrument_records}}
        prepared_path = env_root / 'prepared.json'; put(prepared_path, {'configuration': config, 'environments': environments})
        runner_sha = next(x['sha256'] for x in instrument_records if x['path'].endswith('run_local_evaluation.py'))
        approval_path = self.root / (name + '-approval.json')
        put(approval_path, {'preparedSha256': digest(prepared_path), 'casesSha256': digest(self.root / 'cases.json'),
            'planSha256': digest(self.root / 'plan.json'), 'runnerSha256': runner_sha,
            'hostCommit': 'b' * 40, 'studioCommit': sources[-1]['commit'], 'executionApproved': True})
        slots = []
        for repetition in range(1, 4):
            for sample in self.plan['samples']:
                if sample['repetitionsPerVariant'] < repetition: continue
                for variant in self.plan['variants']:
                    slots.append({'slot': len(slots)+1, 'sampleId': sample['id'], 'variant': variant,
                        'repetition': repetition, 'smoke': repetition == 1,
                        **{k: str(uuid.uuid4()) for k in ('requestId','batchId','clientId','attemptId')}})
        run = {'schemaVersion': 1, 'owner': 'creative-studio-local-eval-runner-v1', 'definitionId': str(uuid.uuid4()),
               'inputs': {k: pin(p) for k,p in [('prepared', prepared_path), ('approval', approval_path),
                   ('cases', self.root/'cases.json'), ('plan',self.root/'plan.json'), ('traceability', self.root/'traceability.json')]},
               'runnerSha256': runner_sha, 'captureInputs': [], 'slots': slots, 'runtimeProjections': {},
               'productAcceptance': False, 'qualityScores': None, 'inferencesExecuted': 0}
        path = self.root / (name + '-run') / 'run.json'; put(path, run)
        return path, run

    def make_result(self, slot, *, captured):
        directory = self.root / 'old-run' / f"slot-{slot['slot']:02d}"
        task_id = 'task-' + slot['requestId'] if captured else None
        actual = deepcopy(self.cases[slot['variant']][slot['sampleId']]['expected'])
        if not captured:
            actual['effective']['cfg'] = 1.0; actual['finalRequest']['sample']['inputs']['cfg'] = 1.0
        observation = {'requestId': slot['requestId'], 'providerTaskId': task_id,
            'state': 'complete' if captured else 'blocked', 'dispatches': int(captured), 'events': [],
            'ledgerReuse': False if captured else None, 'blocks': [] if captured else ['dispatch-admission-failed'],
            'comparison': {'passed': captured, 'differences': [] if captured else [
                {'path': pointer, 'baselineSha256': hashlib.sha256(b'1').hexdigest(),
                 'studioSha256': hashlib.sha256(b'1.0').hexdigest()}
                for pointer in ('/effective/cfg','/finalRequest/sample/inputs/cfg')]},
            'finalRequest': actual, 'weightRehashVerified': captured,
            'network': {'complete': True, 'externalAttempts': 0} if captured else None,
            'ollama': {'done': True, 'done_reason':'stop','eval_count': 2,'eval_duration':1,'prompt_eval_count':1,'response':'synthetic'} if captured else None,
            'metrics': {'segmentsMs':{'actual': 1}, 'durationMs':1, 'peakMemoryBytes': 1, 'coldWarmState':'cold'} if captured else None,
            'weights': [{'sha256':'a'*64,'bytes':1,'path':'synthetic','rehashAt':'synthetic'}] if captured else None,
            'serviceReceipt': {'complete': True, 'readOnly': True, 'requestId': slot['requestId']} if captured else None}
        for name, value in [('identity.json', slot), ('observation.json', observation), ('websocket-events.json', [])]: put(directory/name, value)
        result = {**slot, 'status': 'captured' if captured else 'blocked', 'blocks': [] if captured else ['inspection-or-transport-unavailable'],
                  'providerTaskId':task_id,'submittedThisInvocation': True,'queryOnly': False,'qualityScores':None,'productAcceptance':False,
                  'outputs': [{'decodable':True}] if captured else None}
        result['artifacts'] = [{**pin(p), 'path':p.name,'bytes':p.stat().st_size} for p in directory.iterdir()]
        put(directory/'result.json', result)

    def create(self, **changes):
        args = dict(completed_prefix=10, blocked_slot=11, blocked_trace_root=self.trace_root,
                    reviewed_changes=self.changes, reviewer='synthetic-engineering-reviewer')
        args.update(changes)
        return continuation.create_continuation(self.parent_path, self.next, **args)

    def test_preserves_originals_and_maps_logical_prefix_without_relabeling_execution(self):
        original = {p: digest(p) for p in (self.root/'old-run').rglob('*') if p.is_file()}
        manifest = self.create(); continuation.verify_continuation(manifest, self.next)
        inherited = continuation.inherited_result(manifest, self.next, 1)
        self.assertEqual(inherited['requestId'], self.parent['slots'][0]['requestId'])
        self.assertNotEqual(inherited['requestId'], self.next['slots'][0]['requestId'])
        self.assertEqual(manifest['completedPrefix'][0]['parentIdentity'], self.parent['slots'][0])
        self.assertEqual(manifest['completedPrefix'][0]['pendingSlotIdentity'], self.next['slots'][0])
        self.assertEqual(manifest['pendingSlots'], list(range(11,45)))
        self.assertEqual(original, {p:digest(p) for p in original})

    def test_run_resume_and_arm_share_prefix_rejection(self):
        manifest=self.create()
        for number in (1,10):
            with self.assertRaises(continuation.ContinuationError): continuation.require_pending_slot(manifest,self.next,number)
        self.assertEqual(continuation.require_pending_slot(manifest,self.next,11),self.next['slots'][10])
        self.assertIsNone(continuation.inherited_result(manifest,self.next,11))

    def test_verified_context_reuses_one_invocation_snapshot_and_rejects_changed_binding(self):
        manifest=self.create(); context=continuation.verify_continuation(manifest,self.next)
        with patch.object(continuation,'_bytes',side_effect=AssertionError('must not hash again')):
            self.assertEqual(continuation.inherited_result(manifest,self.next,2,context=context)['requestId'],self.parent['slots'][1]['requestId'])
            continuation.require_pending_slot(manifest,self.next,11,context=context)
            changed=deepcopy(self.next);changed['slots'][10]['attemptId']=str(uuid.uuid4())
            with self.assertRaises(continuation.ContinuationError):continuation.require_pending_slot(manifest,changed,11,context=context)

    def test_runtime_arm_rejects_inherited_and_modified_pending_identities(self):
        from tools.evals.local_runtime_hooks import RuntimeHooks
        manifest = self.create()
        instance = RuntimeHooks.__new__(RuntimeHooks)
        instance.slots = {s['requestId']: s for s in self.next['slots']
                          if s['slot'] in manifest['pendingSlots']}
        pending = self.next['slots'][10]
        instance.validate_arm_slot({'slot': deepcopy(pending)})
        changed = {**pending, 'attemptId': str(uuid.uuid4())}
        for slot in (self.next['slots'][0], changed, {}):
            with self.subTest(slot=slot), self.assertRaises(ValueError):
                instance.validate_arm_slot({'slot': slot})

    def test_odd_or_noncontiguous_prefix_rejected(self):
        for prefix in (0,1,9,11,44):
            with self.subTest(prefix=prefix),self.assertRaises(continuation.ContinuationError):self.create(completed_prefix=prefix)

    def test_changed_original_artifact_is_rejected_after_freeze(self):
        manifest=self.create(); p=self.root/'old-run/slot-01/observation.json';p.write_text('{}',encoding='utf-8')
        with self.assertRaises(continuation.ContinuationError):continuation.verify_continuation(manifest,self.next)

    def test_missing_completed_result_rejected(self):
        (self.root/'old-run/slot-04/result.json').unlink()
        with self.assertRaises(continuation.ContinuationError):self.create()

    def test_claimed_success_without_single_real_dispatch_rejected(self):
        p=self.root/'old-run/slot-02/observation.json';o=self.read(p);o['dispatches']=0;put(p,o)
        rpath=p.parent/'result.json';r=self.read(rpath)
        for a in r['artifacts']:
            if a['path']==p.name:a.update(sha256=digest(p),bytes=p.stat().st_size)
        put(rpath,r)
        with self.assertRaises(continuation.ContinuationError):self.create()

    def test_failed_attempt_consumed_or_changed_journal_is_rejected(self):
        manifest=self.create(); consumed=self.journal.parent/'dispatch-consumed.json';put(consumed,{'requestId':self.parent['slots'][10]['requestId']})
        with self.assertRaises(continuation.ContinuationError):continuation.verify_continuation(manifest,self.next)

    def test_failure_identity_never_reused(self):
        self.next['slots'][10]['requestId']=self.parent['slots'][10]['requestId']
        with self.assertRaises(continuation.ContinuationError):self.create()

    def test_changed_cases_plan_or_hardware_rejected(self):
        for key in ('cases','plan'):
            original=deepcopy(self.next['inputs'][key]); path=self.root/(key+'-changed.json');put(path,{'changed':True});self.next['inputs'][key]=pin(path)
            with self.subTest(key=key),self.assertRaises(continuation.ContinuationError):self.create()
            self.next['inputs'][key]=original
        p=self.root/'new-env/prepared.json';prepared=self.read(p);prepared['configuration']['bindings']={'different':True};put(p,prepared)
        self.next['inputs']['prepared']=pin(p)
        with self.assertRaises(continuation.ContinuationError):self.create()

    def test_unreviewed_tool_change_and_product_allowlist_rejected(self):
        with self.assertRaises(continuation.ContinuationError):self.create(reviewed_changes=[])
        with self.assertRaises(continuation.ContinuationError):self.create(reviewed_changes=[*self.changes,{'path':'backend/product.py','beforeSha256':'a'*64,'afterSha256':'b'*64,'reason':'not allowed'}])

    def test_tampered_successor_schedule_or_manifest_binding_rejected(self):
        manifest=self.create(); self.next['slots'][11]['sampleId']='LOCAL-IMAGE-002'
        with self.assertRaises(continuation.ContinuationError):continuation.verify_continuation(manifest,self.next)

    def test_later_original_attempt_prevents_silent_replacement(self):
        put(self.root/'old-run/slot-12/dispatch-intent.json',{'uninspected':True})
        with self.assertRaises(continuation.ContinuationError):self.create()


if __name__ == '__main__':
    unittest.main()
