"""Independent pinned 27B text profile; existing Ollama stays unchanged."""
import json
import uuid

from .native_text import NativeTextProvider
from .canvas_instructions import INSTRUCTIONS, purpose_instruction
from ..contracts.errors import InvalidInput

QWEN_27B_MODEL = 'qwen3.8-27b-w4a8'
QWEN_27B_PROVIDER = 'local-qwen-27b-text'
QWEN_27B_LIMIT = 1024


def official_nonthinking_prompt(source, instruction, purpose=None):
    # Qwen's official single-turn ChatML rendering, enable_thinking=false.
    # Keep the two newlines in the explicit non-thinking assistant prefix.
    body = json.dumps({'prompt': source, 'requirements': instruction}, ensure_ascii=False)
    body = body.replace('<', '\\u003c').replace('>', '\\u003e')
    system = '\n'.join(filter(None, (INSTRUCTIONS, purpose_instruction(purpose))))
    return ('<|im_start|>system\n' + system + '<|im_end|>\n'
            '<|im_start|>user\n' + body + '<|im_end|>\n'
            '<|im_start|>assistant\n<think>\n\n</think>\n\n')


class Native27BProvider(NativeTextProvider):
    id, model = QWEN_27B_PROVIDER, QWEN_27B_MODEL

    def build(self, data, media, request_id):
        if data.get('model') != self.model or data.get('entry') != 'canvas' or data.get('mode') != 'polish' or media:
            raise InvalidInput('Native 27B supports standalone text polishing without image references.')
        source, instruction = data.get('source'), data.get('instruction', '')
        if not isinstance(source, str) or not source.strip() or len(source) > 12000 or not isinstance(instruction, str) or len(instruction) > 4000:
            raise InvalidInput('Native 27B text or instruction is invalid or too long.')
        models = self.inventory.descriptions(['text_encoders'])
        return {'kind': 'text', 'model': self.model, 'models': models,
                'graph': self._graph(models, official_nonthinking_prompt(source, instruction, data.get('purpose'))),
                'native_task_id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'creative-studio:' + request_id))}

    @staticmethod
    def _graph(models, prompt, image=None):
        return {'clip': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': models['text_encoders']['name'], 'type': 'qwen_image', 'device': 'default'}},
                'save': {'class_type': 'DAELAB.NativeText', 'inputs': {'clip': ['clip', 0], 'prompt': prompt,
                         'max_length': QWEN_27B_LIMIT, 'profile': 'qwen27b'}}}

    async def capabilities(self, model):
        result = await super().capabilities(model)
        return {**result, 'maxOutputTokens': QWEN_27B_LIMIT, 'modes': ['polish'], 'requiresReference': False}
