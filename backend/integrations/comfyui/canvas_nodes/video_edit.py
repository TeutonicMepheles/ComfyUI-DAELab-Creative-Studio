import asyncio
import json
import threading
from urllib.parse import urlencode

from aiohttp import web
from av.error import FFmpegError
import folder_paths
from comfy_api.latest import io, InputImpl
from comfy import model_management
from comfy.utils import ProgressBar

from ....media.video_edit_media import media_info, preview
from ....providers.contracts import ProviderUnavailable
from ....generation.admission import complete_task, complete_blocking


_export_service = None
_export_api = None


def export_routes(service, *, bind=True):
    """Explicit host assembly; never create another ledger or catalog here."""
    global _export_service, _export_api
    if _export_service is not None and _export_service is not service:
        raise RuntimeError('VideoEdit already belongs to a different injected export service')
    api = getattr(service, '_canvas_export_api', None)
    if api is None:
        from ....media.export_api import ExportAPI
        api = ExportAPI(service)
        service._canvas_export_api = api
    if bind:
        _export_api = api
        _export_service = service
    return api.routes


def native_execution_context():
    # Pinned host contextvars identify this prompt/node/list item on its worker.
    from comfy_execution.utils import get_executing_context
    return get_executing_context()


def media_roots():
    return {
        'input': folder_paths.get_input_directory(),
        'output': folder_paths.get_output_directory(),
        'temp': folder_paths.get_temp_directory(),
    }


class VideoEdit(io.ComfyNode):
    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        # NOT_IDEMPOTENT includes the node ID in the pinned host's cache key;
        # NaN is also needed so a new explicit native prompt actually executes.
        return float('nan')

    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='DAELAB.VideoEdit', display_name='剪辑', category='DAELab/剪辑',
            inputs=[io.String.Input('edit_data', default='{"version":1,"clips":[],"fit":"contain"}', multiline=True),
                    io.Custom('DAELAB_ASSETS').Input('assets', optional=True),
                    io.Autogrow.Input('videos', template=io.Autogrow.TemplatePrefix(io.Custom('COMFYTV_VIDEO').Input('video'), prefix='video', min=0, max=100), optional=True),
                    io.Autogrow.Input('images', template=io.Autogrow.TemplatePrefix(io.Custom('COMFYTV_IMAGE').Input('image'), prefix='image', min=0, max=100), optional=True),
                    io.Autogrow.Input('groups', template=io.Autogrow.TemplatePrefix(io.Custom('DAELAB_ASSETS').Input('group'), prefix='group', min=0, max=100), optional=True)],
            outputs=[io.Video.Output('video', display_name='剪辑成片', tooltip='按时间轴剪辑并拼接后的视频'),
                     io.Custom('COMFYTV_VIDEO').Output('video_ref', display_name='剪辑成片引用', tooltip='同一成片的本地视频引用')], is_output_node=True, not_idempotent=True)

    @classmethod
    async def execute(cls, edit_data, assets=None, videos=None, images=None, groups=None):
        if _export_service is None:
            raise ProviderUnavailable('Video export requires the shared Studio job ledger and asset service.')
        bar = ProgressBar(100)
        # The pinned host awaits async V3 methods inside CurrentNodeContext.
        # Capture ownership there, then run the synchronous codec on a worker.
        context = native_execution_context()
        result = await complete_blocking(_export_service.execute, edit_data, context=context,
            connections=dict(assets=assets, videos=videos, images=images, groups=groups),
            check=model_management.throw_exception_if_processing_interrupted,
            progress=lambda done, total: bar.update_absolute(round(done/total*100), 100))
        ref = result['ref']
        return io.NodeOutput(InputImpl.VideoFromFile(result['path']), '/view?' + urlencode(ref),
            ui={'videos': [ref], 'edit_data': [edit_data], 'creative_studio_export': [result['job']]})



async def inspect_media(request):
    try:
        data = await request.json()
        return web.json_response(await asyncio.to_thread(media_info, data['asset'], roots=media_roots()))
    except (ValueError, KeyError, TypeError, OSError, FFmpegError) as e:
        return web.json_response({'error': str(e)}, status=400)


async def make_preview(request):
    stopped = threading.Event()
    def check():
        if stopped.is_set():
            raise InterruptedError('预览已取消')
    try:
        data = await request.json()
        if _export_service is None:
            raise ProviderUnavailable('Preview requires the shared Studio resource admission service.')
        async with _export_service.resources.lease('transcode'):
            check()
            if request.transport is None or request.transport.is_closing():
                raise InterruptedError('预览已取消')
            task = asyncio.create_task(asyncio.to_thread(preview, data['asset'], float(data['scale']), check, roots=media_roots()))
            try:
                while not task.done():
                    await asyncio.wait({task}, timeout=0.2)
                    if request.transport is None or request.transport.is_closing():
                        stopped.set()
                return web.json_response(await task)
            finally:
                stopped.set()
                if not task.done():
                    await complete_task(asyncio.gather(task, return_exceptions=True))
    except (ValueError, KeyError, TypeError, OSError, FFmpegError) as e:
        return web.json_response({'error': str(e)}, status=400)


ROUTES = (
    ("POST", "/daelab/edit/media", inspect_media),
    ("POST", "/daelab/edit/preview", make_preview),
)
