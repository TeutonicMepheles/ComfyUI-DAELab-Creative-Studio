"""Ten pinned old wire constructions; no inference, model weight or network load."""
import copy
import hashlib
import json
from pathlib import Path
import unittest

from backend.providers.parameters import compile_segments, settings_for, image_graph, video_graph, QWEN_MODEL
from backend.providers.qwen import qwen_request
from backend.providers.optimization_instructions import INSTRUCTION_VERSION, INSTRUCTION_DIGEST, INPUT_VERSION
from backend.contracts.errors import InvalidInput

ROOT = Path(__file__).resolve().parents[2]


class ParameterTests(unittest.TestCase):
    def test_all_ten_final_requests_match_old_capture_except_declared_storage_paths(self):
        samples = json.loads((ROOT / 'tests/fixtures/local-eval/samples.json').read_text('utf8'))['samples']
        for sample in samples:
            with self.subTest(sample=sample['id']):
                expected = json.loads((Path(__file__).parent / 'fixtures' / (sample['id'] + '.json')).read_text('utf8'))['finalRequest']
                if sample['entry'] in ('canvas-polish', 'canvas-reverse'):
                    image = (ROOT / 'tests/fixtures/local-eval' / sample['image']).read_bytes() if sample.get('image') else None
                    actual = qwen_request({'mode': 'reverse' if image else 'polish', 'source': sample.get('source', ''), 'instruction': sample['instruction']}, image)
                elif sample['entry'] == 'table-row':
                    text = expected['prompt']
                    frozen = {'contractVersion': 1, 'target': {'documentId': 'fixture', 'tableId': 'table', 'recordId': sample['recordId'], 'fieldId': sample['fieldId']},
                              'revision': 0, 'requestSeq': 0, 'snapshotDigest': hashlib.sha256(text.encode()).hexdigest(), 'model': QWEN_MODEL,
                              'requirements': sample['requirements'], 'purpose': json.loads(text)['purpose'], 'instructionVersion': INSTRUCTION_VERSION,
                              'instructionDigest': INSTRUCTION_DIGEST, 'inputVersion': INPUT_VERSION, 'maxOutputTokens': sample['maxOutputTokens'],
                              'input': json.loads(text), 'inputText': text}
                    actual = qwen_request({'entry': 'table', 'optimization': frozen})
                elif sample['entry'] == 'local-image':
                    files = {'diffusion_models': expected['model']['inputs']['unet_name'], 'text_encoders': expected['clip']['inputs']['clip_name'], 'vae': expected['vae']['inputs']['vae_name']}
                    actual = image_graph(sample['text'], settings_for('image', 'text2image', sample['settings'], []), files, '<allowed-output-prefix>')
                else:
                    media = [{'kind': 'image', 'native_input': f'fixture/reference-{i}.png'} for i, _ in enumerate(sample['references'])]
                    files = {'diffusion_models': expected['model']['inputs']['unet_name'], 'text_encoders': expected['clip']['inputs']['clip_name'],
                             'video_vae': expected['video_vae']['inputs']['vae_name'], 'audio_vae': expected['audio_vae']['inputs']['vae_name']}
                    actual = video_graph(compile_segments(sample['segments'], media), settings_for('video', sample['mode'], sample['settings'], media), media, files, '<allowed-output-prefix>')
                    self.assertEqual(actual['condition']['inputs']['length'], 39)
                    self.assertEqual(actual['video']['inputs']['fps'], 24)
                self.assertEqual(actual, expected)

    def test_literal_reference_like_text_is_not_rewritten_and_frame_order_is_stable(self):
        media = [{'kind': 'image', 'native_input': 'first.png'}, {'kind': 'image', 'native_input': 'last.png'}]
        text = compile_segments([{'type': 'text', 'text': 'literal @image_1 '}, {'type': 'asset', 'index': 1}, {'type': 'asset', 'index': 0}], media)
        graph = video_graph(text, settings_for('video', 'frames2video', {'duration': 1.5, 'turbo': False, 'seed': 5}, media), media,
                            {'diffusion_models': 'm', 'text_encoders': 'c', 'video_vae': 'v', 'audio_vae': 'a'}, 'output')
        self.assertEqual(graph['condition']['inputs']['prompt'], 'literal @image_1 <Picture 2><Picture 1>')
        self.assertEqual(graph['first_frame']['inputs']['image'], 'first.png')
        self.assertEqual(graph['last_frame']['inputs']['image'], 'last.png')

    def test_local_parameters_reject_unknown_fields_cloud_names_and_wrong_frame_count(self):
        for kind, mode, settings, media in [('image', 'text2image', {'steps': 20}, []), ('image', 'text2image', {'width': 1025}, []),
                                            ('video', 'frames2video', {}, []), ('video', 'text2video', {'turbo': 'false'}, [])]:
            with self.subTest(kind=kind, settings=settings):
                with self.assertRaises(InvalidInput):
                    settings_for(kind, mode, settings, media)


if __name__ == '__main__':
    unittest.main()
