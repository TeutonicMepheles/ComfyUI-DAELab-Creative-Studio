"""Pure native request construction extracted from the fixed business baseline.

No model discovery, queue, network or seed regeneration occurs on recovery.
"""
import math
import secrets

from ..contracts.errors import InvalidInput

IMAGE_MODEL = 'Qwen-Image-2.1 Turbo（本地）'
VIDEO_MODEL = 'MiniMax H3 FL（本地）'
REFERENCE_VIDEO_MODEL = 'MiniMax H3 Ref（本地）'
QWEN_MODEL = 'qwen3.5:9b-q4_K_M'
IMAGE_FILES = {
    'diffusion_models': 'qwen_image_2.1_turbo_int8_convrot.safetensors',
    'text_encoders': 'Qwen-Image-2.1-Turbo-Abliterated-Uncensored-Q8_0.gguf',
    'mmproj': 'mmproj-Qwen-Image-2.1-Turbo-Abliterated-Uncensored-F16.gguf',
    'vae': 'qwen_image_2.1_vae_bf16.safetensors',
}
VIDEO_FILES = {
    'diffusion_models': 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    'text_encoders': 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    'video_vae': 'minimax_h3_video_vae_int8_convrot.safetensors',
    'audio_vae': 'minimax_h3_audio_vae_fp32.safetensors',
    'loras': 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',
}
MODES = {'text2video': 0, 'singleImage2video': 1, 'frames2video': 2}


class StructuredPrompt(str):
    def __new__(cls, text, spans):
        value = super().__new__(cls, text)
        value.reference_spans = spans
        return value


def compile_segments(segments, media):
    if not isinstance(segments, list) or not isinstance(media, list) or len(media) > 32:
        raise InvalidInput('Invalid structured prompt or too many media references.')
    counts, numbered = {}, []
    for item in media:
        kind = item['kind']
        counts[kind] = counts.get(kind, 0) + 1
        numbered.append((kind, counts[kind]))
    text, spans = '', []
    for segment in segments:
        if segment.get('type') == 'text' and isinstance(segment.get('text'), str):
            text += segment['text']
        elif segment.get('type') == 'asset':
            index = segment.get('index')
            if type(index) is not int or not 0 <= index < len(media):
                raise InvalidInput('Invalid structured media reference.')
            kind, number = numbered[index]
            token = f'@{kind}_{number}'
            spans.append(dict(start=len(text), end=len(text)+len(token), kind=kind, index=number))
            text += token
        else:
            raise InvalidInput('Unsupported prompt segment.')
    if not text.strip() or len(text) > 100000:
        raise InvalidInput('Prompt is empty or exceeds the request limit.')
    return StructuredPrompt(text, spans)


def _number(value, minimum, maximum, *, integer=True, multiple=1):
    if (type(value) not in (int, float) or not math.isfinite(value)
            or integer and value != int(value) or not minimum <= value <= maximum
            or integer and value % multiple):
        raise InvalidInput('A local model setting is outside its supported range.')
    return int(value) if integer else value


def settings_for(kind, mode, settings, media):
    if not isinstance(settings, dict):
        raise InvalidInput('Settings must be a JSON object.')
    if kind == 'image':
        if mode != 'text2image' or media:
            raise InvalidInput('Local Qwen supports text2image without media references.')
        allowed = {'width', 'height', 'seed'}
        values = {'width': 1024, 'height': 1024, 'seed': -1, **settings}
        for key in ['width', 'height']:
            values[key] = _number(values[key], 256, 2048, multiple=32)
        if values['width'] * values['height'] > 2097152:
            raise InvalidInput('Local Qwen image preset exceeds 2097152 pixels.')
    elif kind == 'video':
        if mode not in MODES or len(media) != MODES[mode] or any(m['kind'] != 'image' for m in media):
            raise InvalidInput('Local H3 requires exactly the selected first/last image frames.')
        allowed = {'width', 'height', 'duration', 'turbo', 'seed'}
        values = {'width': 512, 'height': 288, 'duration': 2, 'turbo': True, 'seed': -1, **settings}
        for key in ['width', 'height']:
            values[key] = _number(values[key], 32, 16384)
        values['duration'] = _number(values['duration'], .2, 15, integer=False)
        if type(values['turbo']) is not bool:
            raise InvalidInput('Turbo must be an explicit boolean.')
    else:
        raise InvalidInput('Unsupported local output kind.')
    if set(settings) - allowed:
        raise InvalidInput('Unknown local model setting; no fallback was selected.')
    values['seed'] = _number(values['seed'], -1, 9007199254740991)
    if values['seed'] == -1:
        values['seed'] = secrets.randbits(53)
    return values


def image_graph(text, values, files, prefix):
    def node(kind, **inputs):
        return dict(class_type=kind, inputs=inputs)
    return {
        'model': node('UNETLoader', unet_name=files['diffusion_models'], weight_dtype='default'),
        'clip': node('CLIPLoaderGGUF', clip_name=files['text_encoders'], type='qwen_image'),
        'condition': node('TextEncodeQwenImage21', clip=['clip', 0], prompt=str(text), negative_prompt='', resolution=1024, images={}),
        'vae': node('VAELoader', vae_name=files['vae']),
        'latent': node('EmptyLatentImage', width=values['width'], height=values['height'], batch_size=1),
        'cache': node('QwenImage21Cache', model=['model', 0], device='auto', dtype='default'),
        'sample': node('KSampler', seed=values['seed'], steps=8, cfg=1, sampler_name='euler', scheduler='simple', denoise=1,
                       model=['cache', 0], positive=['condition', 0], negative=['condition', 1], latent_image=['latent', 0]),
        'decode': node('VAEDecode', samples=['sample', 0], vae=['vae', 0]),
        'save': node('SaveImage', images=['decode', 0], filename_prefix=prefix),
    }


def video_graph(text, values, media, files, prefix, *, reference=False):
    length = max(5, round(values['duration'] * 24))
    length += (5 - length % 17) % 17
    for span in reversed(text.reference_spans):
        text = text[:span['start']] + f"<Picture {span['index']}>" + text[span['end']:]
    def node(kind, **inputs):
        return dict(class_type=kind, inputs=inputs)
    graph = {
        'model': node('UNETLoader', unet_name=files['diffusion_models'], weight_dtype='default'),
        'clip': node('CLIPLoader', clip_name=files['text_encoders'], type='minimax', device='default'),
        'video_vae': node('VAELoader', vae_name=files['video_vae']),
        'audio_vae': node('VAELoader', vae_name=files['audio_vae']),
        'condition': node('MiniMaxH3ImageToVideo', clip=['clip', 0], vae=['video_vae', 0], prompt=str(text), width=values['width'], height=values['height'], length=length),
        'noise': node('RandomNoise', noise_seed=values['seed']),
        'guider': node('BasicGuider', model=['turbo' if values['turbo'] else 'model', 0], conditioning=['condition', 0]),
        'sampler': node('KSamplerSelect', sampler_name='res_multistep'),
        'schedule': node('BasicScheduler', model=['model', 0], scheduler='simple', steps=8 if values['turbo'] else 20, denoise=1.0),
        'sample': node('SamplerCustomAdvanced', noise=['noise', 0], guider=['guider', 0], sampler=['sampler', 0], sigmas=['schedule', 0], latent_image=['condition', 1]),
        'decode_video': node('VAEDecodeTiled', samples=['sample', 0], vae=['video_vae', 0], tile_size=512, overlap=64, temporal_size=16, temporal_overlap=4),
        'decode_audio': node('VAEDecodeAudio', samples=['sample', 0], vae=['audio_vae', 0]),
        'video': node('CreateVideo', images=['decode_video', 0], audio=['decode_audio', 0], fps=24.0),
        'save': node('SaveVideo', video=['video', 0], filename_prefix=prefix, format='mp4', **{'format.codec': 'auto'}),
    }
    if values['turbo']:
        graph['turbo'] = node('LoraLoaderModelOnly', model=['model', 0], lora_name=files['loras'], strength_model=1.0)
    if reference:
        graph['condition']['class_type'] = 'MiniMaxH3ReferenceToVideo'
        graph['condition']['inputs']['ref_image_size'] = 'match'
    for index, item in enumerate(media):
        if reference:
            name = f'reference_{index}'
            graph[name] = node('LoadImage', image=item['native_input'])
            graph['condition']['inputs'][f'ref_images.ref_image_{index}'] = [name, 0]
            continue
        name = 'first_frame' if index == 0 else 'last_frame'
        graph[name] = node('LoadImage', image=item['native_input'])
        graph['condition']['inputs'][name] = [name, 0]
    return graph
