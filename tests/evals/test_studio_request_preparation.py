"""Actual pure Studio builders and rooted media; never run a model or transport."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from tools.evals.prepare_studio_inputs import (
    ROOT, compare_captures, construct, file_hash, freeze_table, native_effective,
    no_external_io, qwen_effective, save_new, sha256, verified_inputs,
)


FIXTURES = ROOT / 'tests/fixtures/local-eval'


def fixture_runtime(root):
    """Synthetic one-byte inventory, only for constructor contract tests."""
    names = ['diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors',
             'text_encoders/Qwen-Image-2.1-Turbo-Abliterated-Uncensored-Q8_0.gguf',
             'text_encoders/mmproj-Qwen-Image-2.1-Turbo-Abliterated-Uncensored-F16.gguf',
             'vae/qwen_image_2.1_vae_bf16.safetensors',
             'diffusion_models/MiniMax-H3_FL2VA-NVFP4.safetensors',
             'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
             'vae/minimax_h3_video_vae_fp16.safetensors', 'vae/minimax_h3_audio_vae_fp32.safetensors']
    weights = []
    for index, name in enumerate(names):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(bytes([index]))
        weights.append({'path': name, 'bytes': 1, 'sha256': file_hash(path)})
    return {'weightRoot': str(root), 'weights': weights,
            'ollama': {'blobsVerifiedByRehash': [{'sha256': 'a' * 64}]}}


class StudioConstructionTests(unittest.TestCase):
    def test_all_ten_use_production_builders_without_preflight_queue_or_transport(self):
        from backend.providers.native import NativeProvider, ModelInventory
        from backend.providers.qwen import QwenProvider, LoopbackOllama
        fixtures, manifest = verified_inputs(FIXTURES)
        snapshots, sources = freeze_table(fixtures)
        self.assertIn('frontend/src/features/prompt/prompt_optimization_model.mjs', sources)
        self.assertEqual(set(snapshots), {'LOCAL-TEXT-002', 'LOCAL-TEXT-003'})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = fixture_runtime(root / 'weights')
            output = root / 'capture'
            output.mkdir()
            patches = [(NativeProvider, 'preflight'), (NativeProvider, 'create'), (ModelInventory, 'verify'),
                       (QwenProvider, 'preflight'), (QwenProvider, 'create'), (LoopbackOllama, 'request')]
            from contextlib import ExitStack
            with ExitStack() as stack:
                for owner, method in patches:
                    stack.enter_context(patch.object(owner, method, side_effect=AssertionError('No execution during preparation')))
                stack.enter_context(no_external_io())
                records = construct(fixtures, manifest, snapshots, runtime, FIXTURES, output)
            self.assertEqual(len(records), 10)
            self.assertTrue(all(not r['transportSubmitted'] and not r['inferenceExecuted'] for r in records))
            table = next(r for r in records if r['sampleId'] == 'LOCAL-TEXT-002')
            self.assertEqual(table['finalRequest']['prompt'], snapshots['LOCAL-TEXT-002']['inputText'])
            self.assertEqual(table['effective']['contextTokens'], 16384)
            self.assertEqual(table['effective']['maxOutputTokens'], 1024)
            self.assertEqual([r['effective']['frames'] for r in records[-3:]], [39] * 3)
            self.assertEqual(records[-1]['effective']['referenceOrder'], ['images/motion-first.png', 'images/motion-last.png'])
            for ref in records[-1]['nativeReferences']:
                self.assertIn(ref['sha256'], ref['nativeInput'])
                self.assertEqual((output / 'input' / ref['nativeInput']).read_bytes(), (FIXTURES / ref['fixture']).read_bytes())

    def test_effective_projection_reads_new_body_and_graph_not_fixture_settings(self):
        from backend.providers.parameters import image_graph, IMAGE_MODEL
        from tools.host.prepare_gpu_evaluation import model_bindings
        from backend.providers.native import ModelInventory
        with tempfile.TemporaryDirectory() as temporary:
            runtime = fixture_runtime(Path(temporary) / 'weights')
            inventory = ModelInventory(model_bindings(runtime)['image'], lambda: ())
            models = inventory.descriptions(inventory.bindings.keys())
            graph = image_graph('independent prompt', {'width': 640, 'height': 512, 'seed': 77},
                                {k: value['name'] for k, value in models.items()}, 'synthetic/output')
            prepared = {'graph': graph, 'kind': 'image', 'model': IMAGE_MODEL, 'models': models}
            effective, refs = native_effective(prepared, runtime, Path(temporary), FIXTURES, {'media': []})
            self.assertEqual((effective['width'], effective['height'], effective['seed']), (640, 512, 77))
            self.assertEqual(effective['expandedText'], 'independent prompt')
            self.assertEqual(refs, [])
            graph['sample']['inputs']['steps'] = 9
            changed, _ = native_effective(prepared, runtime, Path(temporary), FIXTURES, {'media': []})
            self.assertEqual(changed['steps'], 9)
        body = {'model': 'test', 'system': 'actual instruction', 'prompt': 'actual prompt',
                'options': {'num_ctx': 99, 'num_predict': 37, 'temperature': .6, 'seed': 42}}
        effective = qwen_effective(body, {'ollama': {'blobsVerifiedByRehash': []}}, [])
        self.assertEqual((effective['contextTokens'], effective['maxOutputTokens'], effective['seed']), (99, 37, 42))

    def test_changed_public_image_rejects_stale_manifest_before_construction(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'fixture'
            shutil.copytree(FIXTURES, root)
            (root / 'images/motion-first.png').write_bytes(b'not-the-source')
            with self.assertRaisesRegex(ValueError, 'synthetic image changed'):
                verified_inputs(root)


class PathDifferenceReviewTests(unittest.TestCase):
    def paths(self, root):
        old, new = root / 'old', root / 'new'
        for parent in (old, new):
            (parent / 'input').mkdir(parents=True)
        data = b'synthetic reference bytes'
        digest = hashlib.sha256(data).hexdigest()
        before, after = 'old-name.png', digest + '.png'
        (old / 'input' / before).write_bytes(data)
        (new / 'input' / after).write_bytes(data)
        baseline = {'sampleId': 'LOCAL-H3-002', 'inputSha256': 'synthetic-input',
                    'finalRequest': {'first_frame': {'class_type': 'LoadImage', 'inputs': {'image': before}}},
                    'effective': {'referenceOrder': ['synthetic'], 'sourceImageSha256': [digest]}}
        record = deepcopy(baseline)
        record['finalRequest']['first_frame']['inputs']['image'] = after
        record['nativeReferences'] = [{'role': 'first_frame', 'nativeInput': after, 'fixture': 'synthetic', 'sha256': digest, 'bytes': len(data)}]
        name = 'LOCAL-H3-002.json'
        save_new(old / name, baseline)
        save_new(new / name, record)
        save_new(old / 'preparation.json', {'publicManifestSha256': file_hash(FIXTURES / 'manifest.json'),
                 'records': [{'sampleId': 'LOCAL-H3-002', 'path': name, 'sha256': file_hash(old / name)}]})
        return old, new, record

    def test_identical_bytes_explain_path_but_do_not_self_approve(self):
        with tempfile.TemporaryDirectory() as temporary:
            old, new, record = self.paths(Path(temporary))
            result = compare_captures([record], old, FIXTURES, new)[0]
            self.assertFalse(result['passed'])
            self.assertFalse(result['inferenceAcceptance'])
            self.assertEqual(result['immutableEffectiveDifferences'], [])
            self.assertEqual(result['unexplained'], ['/finalRequest/first_frame/inputs/image'])
            candidate = result['reviewCandidates'][0]
            self.assertEqual(candidate['reviewStatus'], 'pending-human-review')
            self.assertTrue(candidate['bytesEqual'])
            self.assertNotIn('reviewer', candidate)

    def test_different_bytes_cannot_explain_new_reference_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            old, new, record = self.paths(Path(temporary))
            (old / 'input/old-name.png').write_bytes(b'different input')
            with self.assertRaisesRegex(ValueError, 'identical bytes'):
                compare_captures([record], old, FIXTURES, new)

    def test_modified_old_capture_cannot_reuse_hash_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            old, new, record = self.paths(Path(temporary))
            (old / 'LOCAL-H3-002.json').write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'immutable old capture changed'):
                compare_captures([record], old, FIXTURES, new)


if __name__ == '__main__':
    unittest.main()
