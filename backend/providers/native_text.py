"""Pinned native reference-image prompt enhancement; no Ollama fallback."""
import asyncio
import uuid

from .native import NativeProvider
from .contracts import ProviderUnavailable
from ..contracts.errors import InvalidInput

PE_MODEL = 'qwen-image-2.1-pe'
PE_PROVIDER = 'local-qwen-pe-text'
PE_LIMIT = 2048


def final_text(raw):
    """Keep final content only, preserving meaningful formatting."""
    if not isinstance(raw, str):
        return ''
    if '</think>' in raw:
        raw = raw.rsplit('</think>', 1)[1]
    elif '<think>' in raw:
        return ''
    for marker in ('<|im_end|>', '<|endoftext|>'):
        raw = raw.replace(marker, '')
    # Unexpected control tokens are not user-facing prompt content.
    if '<|' in raw or '<think' in raw:
        return ''
    return raw.strip()


class NativeTextProvider(NativeProvider):
    id, model, kind = PE_PROVIDER, PE_MODEL, 'text'

    def __init__(self, *, inventory, queue, media_input):
        self.inventory, self.queue, self.media_input = inventory, queue, media_input

    def build(self, data, media, request_id):
        if data.get('model') != self.model or data.get('entry') != 'canvas':
            raise InvalidInput('PE supports the standalone reference-image prompt flow only.')
        if data.get('mode') != 'reverse' or len(media) != 1 or media[0].get('kind') != 'image':
            raise InvalidInput('PE requires exactly one reference image in image-to-text mode.')
        source, instruction = data.get('source', ''), data.get('instruction', '')
        if any(not isinstance(v, str) or len(v) > limit for v, limit in ((source, 12000), (instruction, 4000))):
            raise InvalidInput('PE input text is invalid or too long.')
        models = self.inventory.descriptions(['text_encoders'])
        graph = self._graph(models, '\n\n'.join(v for v in (source, instruction) if v.strip()), self.media_input(media[0]))
        return {'kind': 'text', 'model': self.model, 'models': models, 'graph': graph,
                'native_task_id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'creative-studio:' + request_id))}

    @staticmethod
    def _graph(models, prompt, image=None):
        graph = {'clip': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': models['text_encoders']['name'], 'type': 'qwen_image', 'device': 'default'}},
                 'save': {'class_type': 'DAELAB.NativeText', 'inputs': {'clip': ['clip', 0], 'prompt': prompt, 'max_length': PE_LIMIT}}}
        if image is not None:
            graph['image'] = {'class_type': 'LoadImage', 'inputs': {'image': image}}
            graph['save']['inputs']['image'] = ['image', 0]
        return graph

    async def capabilities(self, model):
        if model != self.model:
            raise ProviderUnavailable('Provider does not own the selected model.')
        if 'TextGenerate' not in self.inventory.node_types():
            raise ProviderUnavailable('Missing native node: TextGenerate')
        models = self.inventory.descriptions(['text_encoders'])
        graph = self._graph(models, 'Capability validation only.')
        await asyncio.to_thread(self.inventory.check_available, models, graph)
        await self.queue.validate('pe-capability-probe', graph)
        return {'model': self.model, 'provider': 'local', 'kind': 'text', 'local': True, 'available': True,
                'weightBinding': models, 'maxOutputTokens': PE_LIMIT, 'modes': ['reverse'], 'requiresReference': True}
