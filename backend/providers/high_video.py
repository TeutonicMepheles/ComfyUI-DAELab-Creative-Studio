"""Separate BF16/Flex profiles following the official Pika native graph."""
import hashlib
from pathlib import PureWindowsPath
import uuid

from .native import NativeProvider
from .parameters import VIDEO_FILES, compile_segments, settings_for, video_graph
from .contracts import ProviderUnavailable

HIGH_VIDEO_MODEL = 'MiniMax H3 FL 高配（本地）'
HIGH_REFERENCE_VIDEO_MODEL = 'MiniMax H3 Ref 高配（本地）'
FLEX_SIGMAS = '1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0'


class HighVideoProvider(NativeProvider):
    def __init__(self, *, reference=False, **ports):
        super().__init__('video', reference=reference, **ports)
        self.id = 'local-h3-reference-high' if reference else 'local-h3-high'
        self.model = HIGH_REFERENCE_VIDEO_MODEL if reference else HIGH_VIDEO_MODEL

    def build(self, data, media, request_id):
        # This profile's required Flex adapter is not a legacy Turbo option.
        config = data.get('config', {})
        return super().build({**data, 'config': {**config, 'settings': {**config.get('settings', {}), 'turbo': False}}}, media, request_id)

    def _prepare(self, data, media, request_id):
        config = data['config']
        values = settings_for('video', 'text2video' if self.reference else config.get('mode'),
                              {**config.get('settings', {}), 'turbo': False}, [] if self.reference else media)
        models = self.inventory.descriptions(VIDEO_FILES)
        variant = 'ref2va' if self.reference else 'fl2va'
        required = {'diffusion_models': f'minimax_h3_{variant}_pruned_bf16.safetensors',
                    'loras': f'pika_h3_flex_{variant}_v1_bf16.safetensors',
                    'video_vae': 'minimax_h3_video_vae_fp16.safetensors',
                    'text_encoders': 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
                    'audio_vae': 'minimax_h3_audio_vae_fp32.safetensors'}
        for key, name in required.items():
            if PureWindowsPath(models[key]['name']).name != name:
                raise ProviderUnavailable('High profile requires its matching BF16/Flex component: ' + name)
        names = {key: info['name'] for key, info in models.items()}
        staged = [{**item, 'native_input': self.media_input(item)} for item in media]
        prefix = 'daelab/creative-studio/' + hashlib.sha256(request_id.encode()).hexdigest()[:24]
        graph = video_graph(compile_segments(data.get('segments', []), media), values, staged, names, prefix, reference=self.reference)
        graph['flex'] = {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['model', 0], 'lora_name': names['loras'], 'strength_model': 1.0}}
        graph['guider']['inputs']['model'] = ['flex', 0]
        graph['sampler']['inputs']['sampler_name'] = 'lcm'
        graph['schedule'] = {'class_type': 'ManualSigmas', 'inputs': {'sigmas': FLEX_SIGMAS}}
        graph['decode_video'] = {'class_type': 'VAEDecode', 'inputs': {'samples': ['sample', 0], 'vae': ['video_vae', 0]}}
        if self.reference:
            graph['condition']['inputs']['audio_vae'] = ['audio_vae', 0]
        return {'kind': 'video', 'model': self.model, 'models': models, 'settings': values, 'graph': graph,
                'native_task_id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'creative-studio:' + request_id))}

    async def capabilities(self, model):
        result = await super().capabilities(model)
        schema = result['schema']
        schema['properties'].pop('turbo', None)
        schema['config']['settings'] = [key for key in schema['config']['settings'] if key != 'turbo']
        result['sampling'] = {'sampler': 'lcm', 'steps': 6}
        result['profile'] = {'precision': 'bf16', 'adapter': 'pika_h3_flex', 'strength': 1.0,
                             'sampler': 'lcm', 'sigmas': FLEX_SIGMAS, 'nfe': 6, 'fps': 24}
        return result
