"""Shared table/canvas GPT optimization through an injected Comfy credit port."""
import re

from ..contracts.errors import InvalidInput
from .contracts import Observation, ProviderUnavailable
from .qwen import qwen_request
from .optimization_contract import suggestion

MODEL = 'gpt-6-luna'


class ComfyTextProvider:
    id, execution_kind, resource = 'comfy-gpt-text', 'remote', 'cloud'
    supports_query = True
    supports_lookup = supports_cancel = False

    def __init__(self, *, transport, read_frozen):
        self.transport, self.read_frozen = transport, read_frozen

    def require_auth(self):
        self.transport.require_auth()

    async def capabilities(self, model):
        if model != MODEL:
            raise ProviderUnavailable('Unsupported Comfy GPT optimization model.')
        await self.preflight({})
        return {'available': True, 'local': False, 'provider': 'comfy', 'model': MODEL,
                'maxOutputTokens': 4096, 'price': await self.transport.price(MODEL)}

    def build(self, data, media, request_id):
        if len(media) > 1 or data.get('entry') == 'table' and data.get('optimization', {}).get('model') != MODEL:
            raise InvalidInput('Invalid Comfy GPT model or reference count.')
        original = qwen_request(data, self.read_frozen(media[0]) if media else None)
        content = [{'type': 'input_text', 'text': original['prompt']}]
        if original.get('images'):
            content.append({'type': 'input_image', 'detail': 'auto', 'image_url': 'data:image/jpeg;base64,' + original['images'][0]})
        body = {'model': MODEL, 'input': [{'role': 'developer', 'content': [{'type': 'input_text', 'text': original['system']}]},
                                        {'role': 'user', 'content': content}],
                'max_output_tokens': original['options']['num_predict'], 'reasoning': {'effort': 'none'},
                'store': True, 'stream': False, 'truncation': 'disabled'}
        return {'kind': 'text', 'model': MODEL, 'request': body}

    async def preflight(self, snapshot):
        if MODEL not in self.transport.models():
            raise ProviderUnavailable('当前 ComfyUI 未启用 GPT-6 Luna 官方积分节点，请启用 API 节点后重启。')

    def observe(self, result, metadata, snapshot):
        remote_id = result.get('id')
        if not isinstance(remote_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', remote_id):
            raise ValueError('Missing original Comfy response identity.')
        if result.get('status') in ('queued', 'in_progress'):
            return Observation('running', remote_id)
        outputs = result.get('output') or []
        if not isinstance(outputs, list):
            return Observation('failed', remote_id, error_code='incomplete_text_response')
        content = [c for o in outputs if isinstance(o, dict) and o.get('type') == 'message' for c in o.get('content', [])]
        text = '\n'.join(c['text'] for c in content if c.get('type') == 'output_text' and isinstance(c.get('text'), str))
        if result.get('status') != 'completed' or not text.strip() or any(c.get('type') == 'refusal' for c in content):
            return Observation('failed', remote_id, error_code='incomplete_text_response')
        if snapshot['input'].get('entry') == 'table' and suggestion(result, snapshot['input']['optimization'])['status'] != 'valid':
            return Observation('failed', remote_id, error_code='protected_reference_violation')
        usage = result.get('usage') or {}
        safe_usage = {k: usage[k] for k in ('input_tokens', 'output_tokens', 'total_tokens') if isinstance(usage, dict) and type(usage.get(k)) is int and usage[k] >= 0}
        return Observation('succeeded', remote_id, text=text, metadata={'usage': safe_usage, **metadata})

    async def create(self, request_id, snapshot):
        result, meta = await self.transport.create(snapshot['prepared']['request'])
        return self.observe(result, meta, snapshot)

    async def query(self, task_id, snapshot):
        result, meta = await self.transport.query(task_id)
        if result.get('id') != task_id:
            raise ValueError('Original Comfy response identity differs.')
        return self.observe(result, meta, snapshot)

    async def lookup(self, request_id, snapshot):
        return None

    async def cancel(self, task_id, snapshot):
        return False
