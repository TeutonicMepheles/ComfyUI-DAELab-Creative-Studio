"""Transient Comfy account credentials belong to the native queue, never the ledger."""
from contextvars import ContextVar
from io import BytesIO
from math import ceil
import time

from PIL import Image, ImageOps

from ...generation.media import read_frozen, stage_native_input, stage_prepared_image
from ...providers.contracts import Observation, ProviderUnavailable
from .generation_nodes.native_host import ComfyNativeQueue

_submission_auth = ContextVar('creative_studio_comfy_auth', default=None)


def stage_seedance_input(assets, item):
    if item['kind'] != 'image':
        return stage_native_input(assets, item)
    content = read_frozen(assets, item)
    with Image.open(BytesIO(content)) as source:
        image = ImageOps.exif_transpose(source)
        width, height = image.size
        # Limits of the installed official Seedance image preparation path.
        if 300 <= min(width, height) and max(width, height) <= 6000 and 0.4 <= width / height <= 2.5:
            return stage_native_input(assets, item)
        padded_width, padded_height = max(width, ceil(height * 0.4)), max(height, ceil(width * 0.4))
        scale = min(6000 / max(padded_width, padded_height), max(1, 300 / min(padded_width, padded_height)))
        target_width, target_height = max(300, round(padded_width * scale)), max(300, round(padded_height * scale))
        target_width, target_height = max(target_width, ceil(target_height * 0.4)), max(target_height, ceil(target_width * 0.4))
        resized = image.convert('RGBA').resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.Resampling.LANCZOS)
        prepared = Image.new('RGB', (target_width, target_height), 'black')
        prepared.paste(resized, ((target_width - resized.width) // 2, (target_height - resized.height) // 2), resized)
        output = BytesIO()
        prepared.save(output, format='PNG')
    return stage_prepared_image(assets, item, output.getvalue())


def authenticated_submission(handler):
    async def submit(request):
        credentials = {key: request.headers[header] for key, header in (
            ('auth_token_comfy_org', 'X-DAELAB-Comfy-Token'), ('api_key_comfy_org', 'X-DAELAB-Comfy-Key'))
            if request.headers.get(header)}
        token = _submission_auth.set(credentials)
        try:
            return await handler(request)
        finally:
            _submission_auth.reset(token)
    return submit


class ComfyVideoQueue(ComfyNativeQueue):
    @staticmethod
    def require_auth():
        if not _submission_auth.get():
            raise ProviderUnavailable('请先登录 ComfyUI 账户或在 ComfyUI 中配置 API Key，再提交云端视频任务。')

    async def enqueue(self, task_id, graph, *, owner):
        self.require_auth()
        valid = await self.validate(task_id, graph)
        number = self.server.number
        self.server.number += 1
        self.server.prompt_queue.put((number, task_id, graph,
            {'create_time': int(time.time() * 1000), 'creative_studio_request_id': owner},
            valid[2], dict(_submission_auth.get())))

    async def query(self, task_id, *, owner, kind):
        observation = await super().query(task_id, owner=owner, kind=kind)
        if observation.state in {'failed', 'cancelled'}:
            # A host interruption/transport error does not prove a billed remote job stopped.
            return Observation('unknown', task_id, error_code='remote_video_outcome_unknown')
        return observation

    async def cancel(self, task_id, *, owner):
        # Only a task still in the native waiting queue is provably unsubmitted.
        return self.server.prompt_queue.delete_queue_item(lambda item: self._owned(item, task_id, owner))
