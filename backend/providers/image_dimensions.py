"""Pure local Qwen size selection, resolved once before a task is frozen."""
import math

from ..contracts.errors import InvalidInput

IMAGE_MIN = 256
IMAGE_MAX = 2048
IMAGE_STEP = 32
IMAGE_MAX_PIXELS = 2097152
IMAGE_DEFAULT = 1024
IMAGE_RATIOS = ('1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3')


def image_dimensions(ratio, reference_size=None):
    if ratio == 'auto':
        width, height = reference_size or (IMAGE_DEFAULT, IMAGE_DEFAULT)
        if not all(isinstance(value, int) and not isinstance(value, bool) and value > 0 for value in (width, height)):
            raise InvalidInput('无法读取参考图尺寸，请重新选择参考图或固定比例。')
        aspect = width / height
    elif ratio in IMAGE_RATIOS:
        width, height = (int(value) for value in ratio.split(':'))
        aspect = width / height
    else:
        raise InvalidInput('请选择自动尺寸或模型支持的图片比例。')
    if not IMAGE_MIN / IMAGE_MAX <= aspect <= IMAGE_MAX / IMAGE_MIN:
        raise InvalidInput('参考图比例超出本模型自动尺寸范围，请选择固定比例。')
    # Use exact common ratios when a 32-pixel grid can represent them near 1 MP.
    common = next((value for value in IMAGE_RATIOS if abs(aspect - int(value.split(':')[0]) / int(value.split(':')[1])) < 1e-9), None)
    if common:
        a, b = (int(value) * IMAGE_STEP for value in common.split(':'))
        candidates = [(a * factor, b * factor) for factor in range(1, IMAGE_MAX // max(a, b) + 1)
                      if min(a, b) * factor >= IMAGE_MIN and a * b * factor * factor <= IMAGE_MAX_PIXELS]
        return min(candidates, key=lambda size: abs(size[0] * size[1] - IMAGE_DEFAULT ** 2))
    scale = min(IMAGE_DEFAULT / math.sqrt(width * height), IMAGE_MAX / width, IMAGE_MAX / height)
    scale = max(scale, IMAGE_MIN / min(width, height))
    resolved = tuple(max(IMAGE_MIN, min(IMAGE_MAX, round(value * scale / IMAGE_STEP) * IMAGE_STEP)) for value in (width, height))
    if resolved[0] * resolved[1] > IMAGE_MAX_PIXELS:
        raise InvalidInput('自动图片尺寸超出本模型像素上限，请选择固定比例。')
    return resolved


def image_size_schema():
    return {'min': IMAGE_MIN, 'max': IMAGE_MAX, 'step': IMAGE_STEP, 'maxPixels': IMAGE_MAX_PIXELS,
            'defaultWidth': IMAGE_DEFAULT, 'defaultHeight': IMAGE_DEFAULT,
            'presets': [dict(ratio=ratio, width=image_dimensions(ratio)[0], height=image_dimensions(ratio)[1]) for ratio in IMAGE_RATIOS]}
