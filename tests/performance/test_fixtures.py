import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from tools.performance.prepare_fixtures import SPECS, workflow, validate
from tools.performance.prepare_observer import copy_media, prepare_package
from tools.performance.sample_host import sample

ROOT=Path(__file__).resolve().parents[2]
FIXTURES=ROOT/'tests/fixtures/performance'


class PerformancePreparationTests(unittest.TestCase):
    def test_all_fixed_workflows_reproduce_and_keep_exact_capacity(self):
        manifest=json.loads((FIXTURES/'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(len(manifest['workflows']),6)
        for entry in manifest['workflows']:
            raw=(FIXTURES/entry['file']).read_bytes(); self.assertEqual(hashlib.sha256(raw).hexdigest(),entry['sha256'])
            saved=json.loads(raw); tier=saved['extra']['syntheticPerformanceFixture']['tier']
            self.assertEqual(saved,workflow(tier,entry['mediaVariant']=='video'))
            validate(saved,tier)
            self.assertTrue(all(n['type'].startswith('DAELAB.') and not n['type'].startswith('StudioTest') for n in saved['nodes']))
            self.assertTrue(all(n['properties'].get('llmStylePreview',{}).get('model','qwen')=='qwen' for n in saved['nodes']))
            self.assertTrue(all(len(json.loads(n['widgets_values'][0])['records'])<=500 for n in saved['nodes'] if n['type']=='DAELAB.Table'))

    def test_invalid_native_links_are_rejected(self):
        original=workflow('S')
        for mutate in [lambda d:d['links'][0].__setitem__(4,99),lambda d:d['links'][0].__setitem__(5,'IMAGE'),lambda d:d['nodes'][0].__setitem__('type','StudioTest.Panel'),lambda d:d['links'].__setitem__(1,copy.deepcopy(d['links'][0]))]:
            broken=copy.deepcopy(original);mutate(broken)
            with self.assertRaises((ValueError,IndexError)):validate(broken,'S')

    def test_fake_jobs_are_only_a_deterministic_plan(self):
        plan=json.loads((FIXTURES/'fake-job-plan.json').read_text())
        self.assertEqual(len(plan['jobs']),100);self.assertEqual(len({j['request_id'] for j in plan['jobs']}),100)
        self.assertTrue(all(j['real_network'] is False and j['kind'].startswith('fake-') for j in plan['jobs']))
        self.assertEqual(plan['status'],'workload-only-not-executed')

    def test_media_decodes_and_matches_manifest(self):
        import av
        from PIL import Image
        manifest=json.loads((FIXTURES/'manifest.json').read_text(encoding='utf-8'))
        for entry in manifest['media']:
            self.assertEqual(hashlib.sha256((FIXTURES/entry['file']).read_bytes()).hexdigest(),entry['sha256'])
        with Image.open(FIXTURES/'media/pattern.png') as image:self.assertEqual(image.size,(320,180));image.load()
        with av.open(str(FIXTURES/'media/loop.mp4')) as container:
            frames=list(container.decode(video=0));self.assertEqual(len(frames),72);self.assertEqual((frames[0].width,frames[0].height),(320,180))

    def test_observer_package_has_no_fixture_or_product_nodes_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            target=Path(temporary)/'observer';result=prepare_package(target)
            self.assertEqual(result['nodeRegistrations'],0);self.assertEqual(sorted(p.name for p in (target/'web').iterdir()),['performance.js'])
            self.assertIn('NODE_CLASS_MAPPINGS = {}',(target/'__init__.py').read_text())
            with self.assertRaises(ValueError):prepare_package(target)

    def test_media_copy_requires_owned_nonproduction_isolation_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'input').mkdir();marker=root/'creative-studio-isolation.json'
            with self.assertRaises(ValueError):copy_media(root)
            marker.write_text(json.dumps({'port':8000,'environment_root':str(root)}))
            with self.assertRaises(ValueError):copy_media(root)
            marker.write_text(json.dumps({'port':8290,'environment_root':str(root)}))
            self.assertEqual(copy_media(root)['files'],2)
            copied=root/'input/DAELAB/performance-synthetic-v1/pattern.png';copied.write_bytes(b'user-original')
            with self.assertRaises(ValueError):copy_media(root)
            self.assertEqual(copied.read_bytes(),b'user-original')

    def test_host_sampler_preserves_every_readonly_sample_and_refuses_existing_evidence(self):
        clock=[0.0]
        process=SimpleNamespace(create_time=lambda:10,cpu_percent=lambda _:7.5,memory_info=lambda:SimpleNamespace(rss=1234))
        fake=SimpleNamespace(Process=lambda _:process,Error=OSError,__version__='test-only')
        with tempfile.TemporaryDirectory() as temporary,patch.dict('sys.modules',{'psutil':fake}),patch('tools.performance.sample_host.time.monotonic',side_effect=lambda:clock[0]),patch('tools.performance.sample_host.time.sleep',side_effect=lambda seconds:clock.__setitem__(0,clock[0]+seconds)):
            destination=Path(temporary)/'raw.jsonl';result=sample(123,destination,2,1)
            rows=[json.loads(line) for line in destination.read_text().splitlines()]
            self.assertEqual(result['samples'],2);self.assertEqual([r['kind'] for r in rows],['host-telemetry-start','sample','sample','complete']);self.assertEqual(rows[1]['rssBytes'],1234)
            with self.assertRaises(ValueError):sample(123,destination,2,1)

    def test_old_baseline_media_copy_checks_owner_and_rejects_ambiguous_or_production_roots(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'input').mkdir();marker=root/'old-baseline-owner.json'
            config={'owner':'creative-studio-old-baseline-v1','cpu_only':True,'port':8225,'environment_root':str(root)}
            for override in [{'owner':'unrelated'},{'cpu_only':False},{'port':8000},{'environment_root':str(root/'other')}]:
                marker.write_text(json.dumps({**config,**override}))
                with self.assertRaises(ValueError):copy_media(root)
                self.assertEqual(list((root/'input').iterdir()),[])
            marker.write_text(json.dumps(config))
            self.assertEqual(copy_media(root)['files'],2)
            (root/'creative-studio-isolation.json').write_text(json.dumps(config))
            with self.assertRaises(ValueError):copy_media(root)

    def test_host_sampler_stops_on_pid_reuse_and_keeps_failure_record(self):
        times=iter([10,11]);process=SimpleNamespace(create_time=lambda:next(times),cpu_percent=lambda _:0)
        fake=SimpleNamespace(Process=lambda _:process,Error=OSError,__version__='test-only')
        with tempfile.TemporaryDirectory() as temporary,patch.dict('sys.modules',{'psutil':fake}):
            destination=Path(temporary)/'raw.jsonl';result=sample(123,destination,2,1)
            self.assertEqual(result['status'],'incomplete');self.assertEqual(json.loads(destination.read_text().splitlines()[-1])['reason'],'RuntimeError')


if __name__=='__main__':unittest.main()
