"""Local native provider. It builds a prompt; the injected host owns execution."""
import hashlib
import asyncio
from pathlib import Path
import uuid

from ..contracts.errors import InvalidInput
from .contracts import Observation, ProviderUnavailable, SubmissionRejected, SubmissionUncertain
from .parameters import IMAGE_MODEL, VIDEO_MODEL, IMAGE_FILES, VIDEO_FILES, compile_segments, settings_for, image_graph, video_graph


class ModelInventory:
    """An explicit fixed model stack; never discover an alternative or download it."""
    def __init__(self, bindings, node_types, resolve_model=None):
        self.bindings = dict(bindings)
        self.node_types = node_types
        self.resolve_model = resolve_model
        self._verified = {}

    def descriptions(self, keys):
        missing = sorted(set(keys) - self.bindings.keys())
        if missing:
            raise ProviderUnavailable('Missing fixed model bindings: ' + ', '.join(missing))
        if any(not isinstance(self.bindings[key], dict) or not all(self.bindings[key].get(k) for k in ('name', 'sha256', 'path')) for key in keys):
            raise ProviderUnavailable('Fixed model bindings require a name, path and content hash.')
        return {key: {k: self.bindings[key][k] for k in ('name', 'sha256')} for key in keys}

    def verify(self, models, graph):
        missing = sorted({n['class_type'] for n in graph.values()} - set(self.node_types()))
        if missing:
            raise ProviderUnavailable('Missing native nodes: ' + ', '.join(missing))
        for key, expected in models.items():
            binding = self.bindings.get(key)
            if not binding or expected != {k: binding.get(k) for k in ('name', 'sha256')}:
                raise ProviderUnavailable('Pinned model binding changed: ' + key)
            path = Path(binding['path'])
            if not path.is_file():
                raise ProviderUnavailable('Missing local model: ' + expected['name'])
            if self.resolve_model is not None:
                category = {'mmproj': 'text_encoders', 'video_vae': 'vae', 'audio_vae': 'vae'}.get(key, key)
                resolved = self.resolve_model(category, expected['name'])
                if not resolved or Path(resolved).resolve() != path.resolve():
                    raise ProviderUnavailable('Native model resolution differs from the pinned file: ' + key)
            stat = path.stat()
            stamp = (str(path.resolve()), stat.st_size, stat.st_mtime_ns, expected['sha256'])
            if self._verified.get(key) == stamp:
                continue
            h = hashlib.sha256()
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    h.update(block)
            after = path.stat()
            if h.hexdigest() != expected['sha256'] or (stat.st_size, stat.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ProviderUnavailable('Local model hash differs from the fixed stack: ' + expected['name'])
            self._verified[key] = stamp


class NativeProvider:
    execution_kind = 'local'
    supports_query = supports_lookup = supports_cancel = True
    resource = 'native'

    def __init__(self, kind, *, inventory, queue, media_input):
        if kind not in ('image', 'video'):
            raise InvalidInput('Unknown native output kind.')
        self.kind, self.inventory, self.queue, self.media_input = kind, inventory, queue, media_input
        self.id = 'local-qwen-image' if kind == 'image' else 'local-h3'
        self.model = IMAGE_MODEL if kind == 'image' else VIDEO_MODEL

    async def capabilities(self, model):
        if model != self.model:
            raise ProviderUnavailable('Provider does not own the selected model.')
        kind = self.kind
        settings = {'width': 1024, 'height': 1024} if kind == 'image' else {'width': 512, 'height': 288, 'duration': 2, 'turbo': False}
        data = {'config': {'model': model, 'kind': kind, 'mode': 'text2image' if kind == 'image' else 'text2video', 'settings': settings}, 'segments': [{'type': 'text', 'text': 'Capability validation only; no execution.'}]}
        prepared = await asyncio.to_thread(self.build, data, [], 'capability-probe')
        await self.preflight({'prepared': prepared, 'media': []})
        props = {'width': {'type': 'integer', 'displayName': '宽度', 'default': settings['width'], 'min': 256 if kind == 'image' else 32, 'max': 2048 if kind == 'image' else 16384, 'step': 32},
                 'height': {'type': 'integer', 'displayName': '高度', 'default': settings['height'], 'min': 256 if kind == 'image' else 32, 'max': 2048 if kind == 'image' else 16384, 'step': 32},
                 'seed': {'type': 'integer', 'displayName': '种子（-1 为随机）', 'default': -1, 'min': -1, 'max': 9007199254740991},
                 'modeType': {'items': {'text2image': [0, 0]} if kind == 'image' else {'text2video': [0, 0], 'singleImage2video': [1, 1], 'frames2video': [2, 2]}}}
        if kind == 'video':
            turbo = 'loras' in self.inventory.bindings
            if turbo:
                await asyncio.to_thread(self.inventory.verify, self.inventory.descriptions(['loras']), {'turbo': {'class_type': 'LoraLoaderModelOnly'}})
            props.update(duration={'type': 'number', 'displayName': '时长（秒）', 'default': 2, 'min': .2, 'max': 15}, turbo={'type': 'boolean', 'displayName': '启用 8 步加速', 'default': turbo})
        return {'model': model, 'kind': kind, 'local': True, 'available': True, 'schema': {'properties': props, 'config': {'strictModes': True, 'settings': ['width', 'height'] + (['duration', 'turbo'] if kind == 'video' else []), 'advancedSettings': ['seed']}}}

    def build(self, data, media, request_id):
        config = data['config']
        if config.get('model') != self.model or config.get('kind') != self.kind:
            raise InvalidInput('Local model identity or output kind does not match.')
        prompt = compile_segments(data.get('segments', []), media)
        values = settings_for(self.kind, config.get('mode'), config.get('settings', {}), media)
        keys = set(IMAGE_FILES if self.kind == 'image' else VIDEO_FILES)
        if self.kind == 'video' and not values['turbo']:
            keys.discard('loras')
        models = self.inventory.descriptions(keys)
        names = {key: info['name'] for key, info in models.items()}
        prepared_media = [{**item, 'native_input': self.media_input(item)} for item in media]
        prefix = 'daelab/creative-studio/' + hashlib.sha256(request_id.encode()).hexdigest()[:24]
        graph = image_graph(prompt, values, names, prefix) if self.kind == 'image' else video_graph(prompt, values, prepared_media, names, prefix)
        return {'kind': self.kind, 'model': self.model, 'models': models, 'settings': values, 'graph': graph,
                'native_task_id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'creative-studio:' + request_id))}

    async def preflight(self, snapshot):
        await asyncio.to_thread(self.inventory.verify, snapshot['prepared']['models'], snapshot['prepared']['graph'])
        for media in snapshot['media']:
            await asyncio.to_thread(self.media_input, media)
        await self.queue.validate(snapshot['prepared']['native_task_id'], snapshot['prepared']['graph'])

    async def create(self, request_id, snapshot):
        task_id = snapshot['prepared']['native_task_id']
        try:
            await self.queue.enqueue(task_id, snapshot['prepared']['graph'], owner=request_id)
        except (SubmissionRejected, ProviderUnavailable):
            raise
        except BaseException:
            raise SubmissionUncertain(task_id=task_id) from None
        return Observation('submitted', task_id)

    async def query(self, task_id, snapshot):
        return await self.queue.query(task_id, owner=snapshot['request_id'], kind=self.kind)

    async def lookup(self, request_id, snapshot):
        return await self.query(snapshot['prepared']['native_task_id'], snapshot)

    async def cancel(self, task_id, snapshot):
        return await self.queue.cancel(task_id, owner=snapshot['request_id'])
