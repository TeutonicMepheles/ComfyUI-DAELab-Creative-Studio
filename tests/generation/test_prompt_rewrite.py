import json
import unittest

from backend.contracts.errors import InvalidInput
from backend.providers.prompt_rewrite import checked_result, instructions, options
from backend.providers.native_27b import official_nonthinking_prompt


class RewriteTests(unittest.TestCase):
    def data(self, task='text2video', strength='faithful', **kwargs):
        return {'purpose': 'image' if task in ('text2image', 'image-edit') else 'video-minimax',
                'source': 'A cat.', 'rewrite': {'version': 1, 'strength': strength, 'task': task, **kwargs}}

    def response(self, text=None, added=None):
        return json.dumps({'prompt': text or 'integrated_multimodal_description: [Shot 1] A cat.\noverall_soundscape: N/A\nnon_diegetic_music: N/A',
                           'added_details': added or [], 'warnings': []})

    def test_legacy_is_unmodified_and_new_chatml_has_no_conflicting_legacy_rule(self):
        self.assertEqual(checked_result('old plain text', {}), ('old plain text', {}))
        self.assertEqual(options({}), None)
        data = self.data('text2image', 'expand')
        prompt = official_nonthinking_prompt('cat', '', data['purpose'], data['rewrite'])
        self.assertIn('生成扩写', prompt)
        self.assertIn('added_details', prompt)
        self.assertNotIn('不添加无关情节', prompt)

    def test_faithful_rejects_added_details_and_invalid_json_without_a_replacement(self):
        for raw in ('```json\n{}\n```', '{}', self.response(added=['extra cat'])):
            with self.assertRaises(InvalidInput): checked_result(raw, self.data())
        prompt, metadata = checked_result(self.response('A softly lit cat.', ['Soft light']), self.data('text2image', 'expand'))
        self.assertEqual(prompt, 'A softly lit cat.')
        self.assertEqual(metadata['rewrite']['added_details'], ['Soft light'])

    def test_alignment_is_deterministic_for_each_mode(self):
        for task, expected in [('text2video', 'integrated_'), ('singleImage2video', 'For the target video'),
                               ('frames2video', 'How the reference pictures'), ('lastImage2video', 'How the reference pictures')]:
            data = self.data(task, duration=6.25)
            text, _ = checked_result(self.response(), data)
            self.assertTrue(text.startswith(expected))
            if task in ('frames2video', 'lastImage2video'): self.assertIn('6.25-second', text)
        for duration in (None, 0, float('nan'), True, 121):
            with self.assertRaises(InvalidInput): options(self.data('frames2video', duration=duration))

    def test_reference_order_dialogue_and_required_sections_are_checked(self):
        data = self.data('text2image');data['source'] = '⟦DAE_REF_a⟧ and ⟦DAE_REF_b⟧'
        for text in ('⟦DAE_REF_b⟧ and ⟦DAE_REF_a⟧', 'A cat.'):
            with self.assertRaises(InvalidInput): checked_result(self.response(text), data)
        data = self.data();data['source'] = '<d>[Chinese]你好！</d>'
        with self.assertRaises(InvalidInput): checked_result(self.response(), data)
        with self.assertRaises(InvalidInput): checked_result(self.response('A cat.'), self.data())
        with self.assertRaises(InvalidInput): checked_result(self.response(), self.data('reference'))
        with self.assertRaises(InvalidInput): instructions({**self.data(), 'purpose': 'video-seedance'})


class RewriteLedgerTests(unittest.IsolatedAsyncioTestCase):
    async def test_verified_text_and_review_survive_ledger_recovery_without_another_submission(self):
        import tempfile
        from pathlib import Path
        from backend.integrations.comfyui.services import CoreServices
        from backend.generation.service import GenerationService
        from backend.providers.contracts import Observation
        from test_service import FakeProvider, Admission

        class TextProvider(FakeProvider):
            id = 'local-qwen-27b-text'
            raw = json.dumps({'prompt': 'A softly lit cat.', 'added_details': ['Soft light'], 'warnings': []})
            def build(self, data, media, request_id):
                return {'kind': 'text'}
            async def create(self, request_id, snapshot):
                self.creates.append(request_id)
                return Observation('succeeded', 'native-' + request_id, text=self.raw)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('input', 'output'): (root / name).mkdir()
            core = CoreServices(root / 'user', root / 'input', root / 'output')
            provider = TextProvider()
            service = GenerationService(core.jobs, core.assets, providers={provider.id: provider}, admission=Admission(), poll_interval=0)
            data = {'model': 'qwen3.8-27b-w4a8', 'entry': 'canvas', 'mode': 'polish', 'source': 'cat',
                    'purpose': 'image', 'rewrite': {'version': 1, 'strength': 'expand', 'task': 'text2image'}}
            await service.submit([{'requestId': 'rewrite-good', 'input': data}]);await service.wait_idle()
            report = service.public('rewrite-good')
            self.assertEqual(report['result'], 'A softly lit cat.')
            self.assertEqual(report['receipt']['metadata']['rewrite']['added_details'], ['Soft light'])
            await service.recover('rewrite-good')
            self.assertEqual(provider.creates, ['rewrite-good'])
            provider.raw = 'invalid JSON'
            await service.submit([{'requestId': 'rewrite-invalid', 'input': data}]);await service.wait_idle()
            report = service.public('rewrite-invalid')
            self.assertEqual(report['state'], 'failed')
            self.assertIsNone(report.get('receipt'))
            self.assertEqual(report['error'], 'result_unverified')
