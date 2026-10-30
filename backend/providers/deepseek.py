"""Explicit DeepSeek text provider; credentials never enter frozen task data."""
import os
import re
from contextvars import ContextVar
from pathlib import Path

from ..contracts.errors import InvalidInput
from .contracts import Observation, ProviderUnavailable, SubmissionRejected, SubmissionUncertain
from .optimization_contract import suggestion
from .qwen import qwen_request

MODEL = 'deepseek-flash'
request_key = ContextVar('studio_deepseek_key', default='')


def configured_key(user_directory):
    value = os.environ.get('DEEPSEEK_API_KEY', '').strip()
    if value:
        return value
    path = Path(user_directory) / 'daelab/creative-studio/deepseek.env'
    if path.is_file() and path.stat().st_size <= 65536:
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            name, sep, value = line.strip().partition('=')
            if sep and name == 'DEEPSEEK_API_KEY':
                return value.strip().strip('\"\'')
    return ''


class DeepSeekTransport:
    async def create(self, body, key):
        import aiohttp
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120), trust_env=False) as session:
                async with session.post('https://api.deepseek.com/chat/completions', json=body,
                                        headers={'Authorization': 'Bearer ' + key}, allow_redirects=False) as response:
                    if response.status in (400, 401, 402, 403, 404, 422, 429):
                        raise SubmissionRejected('DeepSeek rejected the request (HTTP %s); check credentials, balance and input.' % response.status)
                    if response.status != 200:
                        raise SubmissionUncertain('DeepSeek returned an ambiguous response; do not resubmit automatically.')
                    return await response.json()
        except (SubmissionRejected, SubmissionUncertain):
            raise
        except BaseException:
            raise SubmissionUncertain('DeepSeek response was lost; do not resubmit automatically.') from None


class DeepSeekProvider:
    id, execution_kind, resource = 'deepseek-text', 'remote', 'cloud'
    supports_query = supports_lookup = supports_cancel = False

    def __init__(self, *, transport, read_frozen, key_resolver=lambda: ''):
        self.transport, self.read_frozen, self.key_resolver = transport, read_frozen, key_resolver

    def require_key(self):
        value = request_key.get() or self.key_resolver()
        if not isinstance(value, str) or not value or len(value) > 4096 or any(ord(c) < 33 or ord(c) > 126 for c in value):
            raise ProviderUnavailable('请配置服务器 DEEPSEEK_API_KEY，或在本页填写 DeepSeek API 密钥。')
        return value

    async def capabilities(self, model):
        if model not in (MODEL, 'deepseek'):
            raise ProviderUnavailable('Unsupported DeepSeek model.')
        return {'model': MODEL, 'provider': 'deepseek', 'local': False, 'available': True,
                'maxOutputTokens': 4096, 'deepseekKeyConfigured': bool(self.key_resolver())}

    def build(self, data, media, request_id):
        if data.get('entry') == 'table' and data.get('optimization', {}).get('model') != MODEL:
            raise InvalidInput('Frozen optimization model does not belong to DeepSeek.')
        if len(media) > 1:
            raise InvalidInput('Canvas optimization accepts at most one reference image.')
        source = qwen_request(data, self.read_frozen(media[0]) if media else None)
        content = source['prompt']
        if source.get('images'):
            content = [{'type': 'text', 'text': content}, {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + source['images'][0]}}]
        body = {'model': MODEL, 'messages': [{'role': 'system', 'content': source['system']}, {'role': 'user', 'content': content}],
                'thinking': {'type': 'disabled'}, 'stream': False, 'max_tokens': source['options']['num_predict'], 'temperature': .4}
        return {'kind': 'text', 'model': MODEL, 'request': body}

    async def preflight(self, snapshot):
        # Preparation is nonexecuting and may precede a page-only key at advance.
        if snapshot.get('prepared', {}).get('model', MODEL) != MODEL:
            raise ProviderUnavailable('Frozen DeepSeek model differs.')

    async def create(self, request_id, snapshot):
        try:
            key = self.require_key()
        except ProviderUnavailable:
            raise SubmissionRejected('DeepSeek credentials are missing or invalid; no request was sent.') from None
        result = await self.transport.create(snapshot['prepared']['request'], key)
        task_id = result.get('id') if isinstance(result, dict) else None
        if not isinstance(task_id, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,200}', task_id):
            raise SubmissionUncertain('DeepSeek response identity is invalid; do not replay.')
        choices = result.get('choices', [])
        choice = choices[0] if isinstance(choices, list) and len(choices) == 1 and isinstance(choices[0], dict) else {}
        message = choice.get('message') or {}
        text = message.get('content') if isinstance(message, dict) else None
        if choice.get('finish_reason') != 'stop' or not isinstance(text, str) or not text.strip() or message.get('tool_calls') or message.get('refusal'):
            return Observation('failed', task_id, error_code='incomplete_text_response')
        if snapshot['input'].get('entry') == 'table':
            checked = suggestion({'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': text}]}]}, snapshot['input']['optimization'])
            if checked['status'] == 'invalid':
                return Observation('failed', task_id, error_code='protected_reference_violation')
        raw_usage = result.get('usage') or {}
        usage = {k: raw_usage[k] for k in ('prompt_tokens', 'completion_tokens', 'total_tokens')
                 if isinstance(raw_usage, dict) and type(raw_usage.get(k)) is int and 0 <= raw_usage[k] <= 2**53 - 1}
        return Observation('succeeded', task_id, text=text, metadata={'usage': usage})

    async def query(self, task_id, snapshot):
        raise ProviderUnavailable('DeepSeek cannot retrieve a lost completion; inspect the original request.')

    async def lookup(self, request_id, snapshot):
        return None

    async def cancel(self, task_id, snapshot):
        return False
