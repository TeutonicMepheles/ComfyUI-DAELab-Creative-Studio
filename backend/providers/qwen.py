"""Lazy local-only Ollama provider, preserving the old wire request parameters."""
import base64
import asyncio
import io
import json

from ..contracts.errors import InvalidInput
from .contracts import Observation, ProviderUnavailable, SubmissionRejected, SubmissionUncertain
from .parameters import QWEN_MODEL
from .canvas_instructions import INSTRUCTIONS, REVERSE_INSTRUCTIONS
from .optimization_instructions import INSTRUCTIONS as TABLE_INSTRUCTIONS
from .optimization_contract import validate_snapshot, suggestion


def image_payload(raw):
    from PIL import Image, ImageOps
    if len(raw) > 8 * 1024 * 1024:
        raise InvalidInput('Reference image exceeds 8 MB.')
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ('PNG', 'JPEG', 'WEBP') or max(image.size) > 8192 or image.width * image.height > 20000000:
                raise InvalidInput('Reference image format or dimensions are unsupported.')
            image = ImageOps.exif_transpose(image).convert('RGB')
            image.thumbnail((1024, 1024))
            output = io.BytesIO()
            image.save(output, format='JPEG', quality=90)
        return base64.b64encode(output.getvalue()).decode()
    except InvalidInput:
        raise
    except Exception:
        raise InvalidInput('Reference image is not fully decodable.') from None


def qwen_request(data, image_bytes=None):
    if data.get('entry') == 'table':
        snapshot = data.get('optimization')
        try:
            validate_snapshot(snapshot)
        except (TypeError, ValueError, KeyError):
            raise InvalidInput('Frozen optimization input violates the fixed reference contract.') from None
        text, instructions, context, maximum = snapshot['inputText'], TABLE_INSTRUCTIONS, 16384, snapshot['maxOutputTokens']
        if image_bytes is not None:
            raise InvalidInput('Table optimization receives protected text, not image pixels.')
    else:
        mode = data.get('mode')
        if mode not in ('polish', 'reverse'):
            raise InvalidInput('Unknown canvas optimization mode.')
        for key, limit in [('source', 12000), ('instruction', 4000)]:
            if not isinstance(data.get(key), str) or len(data[key]) > limit:
                raise InvalidInput('Optimization text is invalid or too long.')
        if mode == 'polish' and not data['source'].strip() or mode == 'reverse' and image_bytes is None:
            raise InvalidInput('Optimization requires its text or reference image.')
        if mode == 'polish' and image_bytes is not None:
            raise InvalidInput('Text polishing does not implicitly send an attached image.')
        text = json.dumps({'prompt': '' if mode == 'reverse' else data['source'], 'requirements': data['instruction']}, ensure_ascii=False)
        instructions = REVERSE_INSTRUCTIONS if mode == 'reverse' else INSTRUCTIONS
        context, maximum = 8192, 768
    body = {'model': QWEN_MODEL, 'system': instructions, 'prompt': text, 'stream': False, 'think': False, 'keep_alive': 0,
            'options': {'num_ctx': context, 'num_predict': maximum, 'temperature': .4}}
    if image_bytes is not None:
        body['images'] = [image_payload(image_bytes)]
    return body


class LoopbackOllama:
    """Requests only the pre-existing loopback service; never starts a process."""
    def __init__(self, *, release_checks=20, release_poll_seconds=.25):
        self.release_checks, self.release_poll_seconds = release_checks, release_poll_seconds

    async def request(self, action, body=None):
        if action not in ('tags', 'ps', 'generate'):
            raise ProviderUnavailable('Unsupported local model operation.')
        import aiohttp
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=600 if action == 'generate' else 5), trust_env=False) as session:
            async with session.request('GET' if body is None else 'POST', 'http://127.0.0.1:11434/api/' + action, json=body, allow_redirects=False) as response:
                if response.status in (400, 401, 403, 404, 422, 429):
                    raise SubmissionRejected('Local Qwen service rejected the request; no provider fallback.')
                if response.status != 200:
                    raise SubmissionUncertain('Local service returned an ambiguous failure; do not replay the request.')
                return await response.json()

    async def ensure_unloaded(self):
        # Never send an unload request: /ps cannot prove which client owns a
        # resident model. Our own generate body already requests keep_alive=0.
        for attempt in range(self.release_checks):
            state = await self.request('ps')
            models = state.get('models')
            if not isinstance(models, list):
                raise ProviderUnavailable('Local model residency is unknown; no model was unloaded.')
            if not models:
                return
            if attempt + 1 < self.release_checks:
                await asyncio.sleep(self.release_poll_seconds)
        raise ProviderUnavailable('Resident local work remains; no unowned model was unloaded and admission remains quarantined.')


class QwenProvider:
    id, execution_kind, resource = 'local-qwen-text', 'local', 'ollama'
    supports_query = supports_lookup = supports_cancel = False

    def __init__(self, *, transport, read_frozen, binding=None):
        self.transport, self.read_frozen = transport, read_frozen
        self.binding = binding

    def _weights(self):
        if self.binding is None or not callable(getattr(self.binding, 'verify', None)):
            raise ProviderUnavailable('Local Qwen requires an explicitly verified manifest and blob binding.')
        return self.binding.verify()

    async def capabilities(self, model):
        if model not in (QWEN_MODEL, 'qwen'):
            raise ProviderUnavailable('Provider does not own the selected model.')
        weights = await self.preflight({})
        return {'model': QWEN_MODEL, 'provider': 'qwen', 'local': True, 'available': True, 'maxOutputTokens': 1024, 'weightBinding': weights}

    def build(self, data, media, request_id):
        if len(media) > 1:
            raise InvalidInput('Canvas optimization accepts at most one reference image.')
        image = self.read_frozen(media[0]) if media else None
        return {'kind': 'text', 'model': QWEN_MODEL, 'request': qwen_request(data, image), 'weights': self._weights()}

    async def preflight(self, snapshot):
        weights = await asyncio.to_thread(self._weights)
        if snapshot.get('prepared') and snapshot['prepared'].get('weights') != weights:
            raise ProviderUnavailable('Qwen weights differ from the task frozen binding.')
        try:
            tags = await self.transport.request('tags')
            residency = await self.transport.request('ps')
        except Exception:
            raise ProviderUnavailable('Local Qwen service is unavailable; no process or download was started.') from None
        models = tags.get('models')
        if not isinstance(models, list) or not any(m.get('name') == QWEN_MODEL and m.get('digest', '').removeprefix('sha256:') == weights['manifestSha256'] for m in models):
            raise ProviderUnavailable('Local Qwen name/digest does not match the pinned registry manifest.')
        if residency.get('models') != []:
            raise ProviderUnavailable('Local model residency is occupied or unknown; no existing work was unloaded.')
        return weights

    async def create(self, request_id, snapshot):
        await self.preflight(snapshot)
        try:
            result = await self.transport.request('generate', snapshot['prepared']['request'])
        except SubmissionRejected:
            raise
        except BaseException:
            raise SubmissionUncertain('Local Qwen response was lost; the original request will not be replayed.') from None
        text = result.get('response', '')
        if not result.get('done') or result.get('done_reason') != 'stop' or not isinstance(text, str) or not text.strip():
            return Observation('failed', 'qwen-' + request_id, error_code='incomplete_text_response')
        data = snapshot['input']
        if data.get('entry') == 'table':
            checked = suggestion({'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': text}]}]}, data['optimization'])
            if checked['status'] == 'invalid':
                return Observation('failed', 'qwen-' + request_id, error_code='protected_reference_violation')
        usage = {key: result.get(key) for key in ('prompt_eval_count', 'eval_count', 'total_duration')}
        return Observation('succeeded', 'qwen-' + request_id, text=text, metadata={'usage': usage})

    async def query(self, task_id, snapshot):
        raise ProviderUnavailable('Ollama cannot query an original completed response after it was lost.')

    async def lookup(self, request_id, snapshot):
        return None

    async def cancel(self, task_id, snapshot):
        return False  # Never unload or interrupt another process to fake cancellation.
