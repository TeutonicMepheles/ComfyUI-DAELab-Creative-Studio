"""GPT Image graphs use the host's official partner node and transient auth."""
import asyncio
import hashlib
import uuid

from ..contracts.errors import InvalidInput
from .comfy_video import ComfyVideoProvider
from .parameters import compile_segments


class ComfyImageProvider(ComfyVideoProvider):
    id = 'comfy-gpt-image'
    label = 'GPT Image'
    models = {'GPT Image 2': 'gpt-image-2', 'GPT Image 2.5 Flare': 'gpt-image-2.5-flare',
              'GPT Image 2.5 Sunburst': 'gpt-image-2.5-sunburst'}
    nodes = dict.fromkeys(('text2image', 'image2image'), 'OpenAIGPTImageNodeV2')

    async def capabilities(self, model):
        def inspect():
            options = self.options(model, 'text2image')
            properties = {}
            for name in ('size', 'quality', 'background', 'custom_width', 'custom_height'):
                if name not in options:
                    continue
                kind, spec = options[name]
                value = {key: spec[key] for key in ('default', 'min', 'max', 'step') if key in spec}
                value['type'] = 'integer' if kind == 'INT' else 'string'
                if isinstance(kind, list):
                    value['enum'] = kind
                    value.setdefault('default', kind[0])
                value['displayName'] = {'size': '尺寸', 'quality': '质量', 'background': '背景',
                                        'custom_width': '自定义宽度', 'custom_height': '自定义高度'}[name]
                properties[name] = value
            settings = list(properties)
            properties['modeType'] = {'items': {mode: [] for mode in self.nodes}}
            return {'provider': 'comfy', 'model': model, 'kind': 'image', 'local': False, 'available': True,
                    'schema': {'properties': properties, 'config': {'strictModes': True,
                               'settings': {mode: settings for mode in self.nodes}}}}
        return await asyncio.to_thread(inspect)

    def build(self, data, media, request_id):
        self.queue.require_auth()
        config = data['config']
        mode = config.get('mode')
        options = self.options(config.get('model'), mode)
        if config.get('kind') != 'image':
            raise InvalidInput('GPT Image 输出类型必须为图片。')
        if any(item['kind'] != 'image' for item in media) or len(media) > 16:
            raise InvalidInput('GPT Image 最多接收 16 张参考图片。')
        if (mode == 'text2image' and media) or (mode == 'image2image' and not media):
            raise InvalidInput('请按文生图／图生图模式选择参考图片。')
        prompt = compile_segments(data.get('segments', []), media)
        text = str(prompt)
        for span in reversed(prompt.reference_spans):
            text = text[:span['start']] + f"Image {span['index']}" + text[span['end']:]
        inputs = {'model': self.models[config['model']], 'prompt': text, 'n': 1,
                  'seed': int(hashlib.sha256(request_id.encode()).hexdigest()[:8], 16) % 2147483648}
        settings = config.get('settings', {})
        for name in ('size', 'quality', 'background', 'custom_width', 'custom_height'):
            if name in options:
                kind, spec = options[name]
                inputs['model.' + name] = settings.get(name, spec.get('default', kind[0] if isinstance(kind, list) else None))
        graph = {'generate': {'class_type': self.nodes[mode], 'inputs': inputs}}
        for index, item in enumerate(media):
            node = 'reference_' + str(index)
            graph[node] = {'class_type': 'LoadImage', 'inputs': {'image': self.media_input(item)}}
            inputs[f'model.images.image_{index + 1}'] = [node, 0]
        graph['save'] = {'class_type': 'SaveImage', 'inputs': {'images': ['generate', 0],
                         'filename_prefix': 'daelab/creative-studio/' + hashlib.sha256(request_id.encode()).hexdigest()[:24]}}
        return {'graph': graph, 'native_task_id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'creative-studio:' + request_id))}

    async def query(self, task_id, snapshot):
        return await self.queue.query(task_id, owner=snapshot['request_id'], kind='image')
