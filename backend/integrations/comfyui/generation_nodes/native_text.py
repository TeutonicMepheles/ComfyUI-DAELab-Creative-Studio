"""Owned text output node records completion from generated token IDs."""
from ....providers.native_text import final_text


class _RecordingClip:
    def __init__(self, clip):
        self.clip, self.count, self.raw = clip, None, None

    def __getattr__(self, key):
        return getattr(self.clip, key)

    def generate(self, *args, **kwargs):
        ids = self.clip.generate(*args, **kwargs)
        # Native CLIP.generate returns the generated sequence, without input IDs.
        self.count = len(ids)
        return ids

    def decode(self, *args, **kwargs):
        self.raw = self.clip.decode(*args, **kwargs)
        return self.raw


class NativeText:
    CATEGORY = 'DAELAB/internal'
    FUNCTION = 'execute'
    RETURN_TYPES = ()
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'clip': ('CLIP',), 'prompt': ('STRING', {'multiline': True}),
                             'max_length': ('INT', {'default': 2048, 'min': 1, 'max': 2048})},
                'optional': {'image': ('IMAGE',)}}

    def execute(self, clip, prompt, max_length, image=None):
        from comfy_extras.nodes_textgen import TextGenerate
        recording = _RecordingClip(clip)
        output = TextGenerate.execute(recording, prompt, max_length, {'sampling_mode': 'off'},
                                      image=image, thinking=False, use_default_template=True, mtp='auto')
        raw = recording.raw if recording.raw is not None else output.result[0]
        text = final_text(raw)
        count = recording.count
        complete = isinstance(count, int) and count < max_length and bool(text)
        return {'ui': {'creative_studio_text': [{'text': text if complete else '', 'raw': raw,
                    'complete': complete, 'maxOutputTokens': max_length, 'outputTokens': count,
                    'limitReached': count is not None and count >= max_length,
                    'template': 'native-qwen-image-default', 'thinking': False}]}}
