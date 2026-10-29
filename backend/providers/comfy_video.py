"""Video graphs executed by the host's installed Comfy API nodes."""
import asyncio
import hashlib
import uuid

from ..contracts.errors import InvalidInput
from .contracts import Observation, ProviderUnavailable, SubmissionRejected, SubmissionUncertain
from .parameters import compile_segments

SEEDANCE_MODELS = ('Seedance 2.5', 'Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini')
SEEDANCE_NODES = {'text2video': 'ByteDance2TextToVideoNode', 'singleImage2video': 'ByteDance2FirstLastFrameNode',
         'frames2video': 'ByteDance2FirstLastFrameNode', 'mixed2video': 'ByteDance2ReferenceNodeV2'}
SETTING_NAMES = {'generate_audio': 'enableSound'}


class ComfyVideoProvider:
    execution_kind = 'remote'
    resource = 'cloud'
    supports_query = supports_lookup = supports_cancel = True

    def __init__(self, *, schema, queue, media_input):
        self.schema, self.queue, self.media_input = schema, queue, media_input

    def options(self, model, mode):
        if model not in self.models or mode not in self.nodes:
            raise InvalidInput(f'请选择已接入的 {self.label} 模型和生成方式。')
        definition = self.schema(self.nodes[mode])
        if definition is None:
            raise ProviderUnavailable(f'缺少 ComfyUI 官方 {self.label} 节点，请启用 API 节点并重启。')
        choices = definition['required']['model'][1]['options']
        option = next((value for value in choices if value['key'] == self.models[model]), None)
        if option is None:
            raise ProviderUnavailable(f'当前 ComfyUI 的 {self.label} 节点不支持此模型版本。')
        inputs = {**option['inputs'].get('required', {}), **option['inputs'].get('optional', {})}
        return {name: (spec['options'] if kind == 'COMBO' else kind, spec) for name, (kind, spec) in inputs.items()}

    async def capabilities(self, model):
        def inspect():
            properties, modes, settings = {}, {}, {}
            for mode in self.nodes:
                try:
                    inputs = self.options(model, mode)
                except ProviderUnavailable:
                    continue
                modes[mode] = []
                settings[mode] = []
                for name in ('ratio', 'resolution', 'duration', 'generate_audio'):
                    if name not in inputs:
                        continue
                    kind, spec = inputs[name]
                    key = SETTING_NAMES.get(name, name)
                    value = {k: spec[k] for k in ('default', 'min', 'max', 'step') if k in spec}
                    value['type'] = 'integer' if kind == 'INT' else 'boolean' if kind == 'BOOLEAN' else 'string'
                    if isinstance(kind, list):
                        value['enum'] = kind
                        value.setdefault('default', kind[0])
                    value['displayName'] = {'ratio': '比例', 'resolution': '清晰度', 'duration': '时长', 'enableSound': '生成音频'}[key]
                    # Mode-specific schemas prevent first-frame settings leaking into reference mode.
                    property_key = mode + '_' + key
                    properties[property_key] = {**value, 'originalField': key}
                    settings[mode].append(property_key)
            if not modes:
                raise ProviderUnavailable(f'当前 ComfyUI 未加载此版本的官方 {self.label} 节点。')
            properties['modeType'] = {'items': modes}
            return {'provider': 'comfy', 'model': model, 'kind': 'video', 'local': False, 'available': True,
                    'schema': {'properties': properties, 'config': {'strictModes': True, 'settings': settings}}}
        return await asyncio.to_thread(inspect)

    def build(self, data, media, request_id):
        self.queue.require_auth()
        config = data['config']
        mode = config.get('mode')
        if mode == 'image2video':
            mode = 'mixed2video'
        if config.get('kind') != 'video':
            raise InvalidInput(f'{self.label} 输出类型必须为视频。')
        options = self.options(config.get('model'), mode)
        expected = {'text2video': 0, 'singleImage2video': 1, 'frames2video': 2}.get(mode)
        if expected is not None and (len(media) != expected or any(m['kind'] != 'image' for m in media)):
            raise InvalidInput('此生成方式只接收对应数量的首帧／尾帧图片。')
        if mode == 'mixed2video' and (not media or any(m['kind'] not in {'image', 'video'} for m in media)):
            raise InvalidInput('全能参考需要图片或视频素材。')
        if mode in ('singleImage2video', 'frames2video') and any(segment.get('type') == 'asset' for segment in data.get('segments', [])):
            raise InvalidInput('首帧／首尾帧模式不能在提示词中 @ 素材，请通过帧选择入口填入图片。')
        prompt = compile_segments(data.get('segments', []), media)
        text = str(prompt)
        for span in reversed(prompt.reference_spans):
            text = text[:span['start']] + f"{span['kind'].title()} {span['index']}" + text[span['end']:]
        supplied = config.get('settings', {})
        seed = int(hashlib.sha256(request_id.encode()).hexdigest()[:8], 16) % 2147483648
        inputs = {'model': self.models[config['model']], 'model.prompt': text, 'seed': seed, 'watermark': False}
        for name in ('ratio', 'resolution', 'duration', 'generate_audio', 'output_format', 'task_type', 'auto_downscale', 'auto_upscale'):
            if name not in options:
                continue
            kind, spec = options[name]
            key = SETTING_NAMES.get(name, name)
            value = supplied.get(key, spec.get('default', kind[0] if isinstance(kind, list) else None))
            if name == 'generate_audio' and value in ('on', 'off'):
                value = value == 'on'
            if value is not None:
                inputs['model.' + name] = value
        graph = {'generate': {'class_type': self.nodes[mode], 'inputs': inputs}}
        counts = {'image': 0, 'video': 0}
        for index, item in enumerate(media):
            kind = item['kind']
            counts[kind] += 1
            node_id = 'reference_' + str(index)
            path = self.media_input(item)
            graph[node_id] = {'class_type': 'LoadImage' if kind == 'image' else 'LoadVideo',
                              'inputs': {'image' if kind == 'image' else 'file': path}}
            target = ('first_frame' if index == 0 else 'last_frame') if mode != 'mixed2video' else f'model.reference_{kind}s.{kind}_{counts[kind]}'
            inputs[target] = [node_id, 0]
        prefix = 'daelab/creative-studio/' + hashlib.sha256(request_id.encode()).hexdigest()[:24]
        graph['save'] = {'class_type': 'SaveVideo', 'inputs': {'video': ['generate', 0], 'filename_prefix': prefix,
                                                              'format': 'mp4', 'format.codec': 'auto'}}
        return {'graph': graph, 'native_task_id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'creative-studio:' + request_id))}

    async def preflight(self, snapshot):
        self.queue.require_auth()
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
        return await self.queue.query(task_id, owner=snapshot['request_id'], kind='video')

    async def lookup(self, request_id, snapshot):
        return await self.query(snapshot['prepared']['native_task_id'], snapshot)

    async def cancel(self, task_id, snapshot):
        return await self.queue.cancel(task_id, owner=snapshot['request_id'])


class SeedanceProvider(ComfyVideoProvider):
    id = 'comfy-seedance'
    label = 'Seedance'
    models = {model: model for model in SEEDANCE_MODELS}
    nodes = SEEDANCE_NODES


class MinimaxProvider(ComfyVideoProvider):
    id = 'comfy-minimax'
    label = 'MiniMax H3'
    models = {'Minimax H3': 'MiniMax H3'}
    nodes = {'text2video': 'MinimaxHailuo03TextToVideoNode', 'singleImage2video': 'MinimaxHailuo03FirstLastFrameNode',
             'frames2video': 'MinimaxHailuo03FirstLastFrameNode', 'mixed2video': 'MinimaxHailuo03ReferenceNode'}
