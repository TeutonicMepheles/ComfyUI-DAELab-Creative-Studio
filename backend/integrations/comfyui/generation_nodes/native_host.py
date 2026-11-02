"""The only owner of Comfy prompt queue and interruption APIs in generation."""
import time
import uuid

from ....providers.contracts import Observation, ProviderUnavailable, SubmissionRejected


class ComfyNativeQueue:
    def __init__(self, server, validate_prompt, *, interrupt_owned=None):
        self.server, self.validate_prompt = server, validate_prompt
        self.interrupt_owned = interrupt_owned

    def busy(self):
        running, pending = self.server.prompt_queue.get_current_queue()
        return bool(running or pending)

    async def validate(self, task_id, graph):
        valid = await self.validate_prompt(task_id, graph, None)
        if not valid[0]:
            raise SubmissionRejected('The fixed local workflow failed native validation; no task was queued.')
        return valid

    async def enqueue(self, task_id, graph, *, owner):
        queue = self.server.prompt_queue
        history = queue.get_history(task_id).get(task_id)
        running, pending = queue.get_current_queue()
        occupied = history is not None or any(item[1] == task_id for item in (*running, *pending))
        actual_task_id = f"{task_id}-reattempt-{uuid.uuid4().hex}" if occupied else task_id
        valid = await self.validate(actual_task_id, graph)
        number = self.server.number
        self.server.number += 1
        queue.put((number, actual_task_id, graph, {'create_time': int(time.time() * 1000), 'creative_studio_request_id': owner}, valid[2], {}))
        return actual_task_id

    @staticmethod
    def _owned(item, task_id, owner):
        return len(item) > 3 and item[1] == task_id and item[3].get('creative_studio_request_id') == owner

    @staticmethod
    def _progress(task_id):
        """Return a monotonic execution-unit snapshot for this prompt, never a timer estimate."""
        try:
            from comfy_execution.progress import get_progress_state
            registry = get_progress_state()
        except Exception:
            return None
        if getattr(registry, 'prompt_id', None) != task_id:
            return None
        nodes = dict(getattr(registry, 'nodes', {}) or {})
        if not nodes:
            return None
        finished = 0.0
        for state in nodes.values():
            phase = getattr(state.get('state'), 'value', state.get('state'))
            if phase in {'finished', 'error'}:
                finished += 1
            elif phase == 'running':
                maximum = float(state.get('max') or 0)
                value = float(state.get('value') or 0)
                if maximum > 0:
                    finished += max(0.0, min(1.0, value / maximum))
        # Execution completion is not successful output validation. Keep the
        # running observation below 100 until native history proves completion.
        return {'progress': min(99.9, finished / len(nodes) * 100), 'stage': 'generating'}

    async def query(self, task_id, *, owner, kind):
        queue = self.server.prompt_queue
        history = queue.get_history(task_id).get(task_id)
        if history:
            if not self._owned(history.get('prompt', ()), task_id, owner):
                raise SubmissionRejected('Native history belongs to another task; ownership was not inferred.')
            status = history.get('status', {})
            events = {event for event, _detail in status.get('messages', [])}
            if 'execution_interrupted' in events:
                return Observation('cancelled', task_id)
            if status.get('status_str') == 'error':
                return Observation('failed', task_id, error_code='native_execution_failed')
            if status.get('completed') is not True or status.get('status_str') != 'success':
                return Observation('failed', task_id, error_code='native_execution_incomplete')
            outputs = history.get('outputs', {}).get('save', {})
            files = outputs.get('images', []) or outputs.get('videos', [])
            if not files:
                return Observation('failed', task_id, error_code='native_output_missing')
            values = []
            for file in files:
                if file.get('type') != 'output':
                    return Observation('failed', task_id, error_code='native_output_root_invalid')
                values.append({'root': 'output', 'path': '/'.join(p for p in (file.get('subfolder', ''), file['filename']) if p), 'kind': kind})
            return Observation('succeeded', task_id, files=tuple(values))
        running, pending = queue.get_current_queue()
        for phase, items in [('running', running), ('submitted', pending)]:
            for item in items:
                if item[1] == task_id:
                    if not self._owned(item, task_id, owner):
                        raise SubmissionRejected('Native queue identity belongs to another request.')
                    return Observation(phase, task_id, **(self._progress(task_id) or {'stage': 'local_queued' if phase == 'submitted' else 'generating'}))
        return Observation('unknown', task_id)

    async def cancel(self, task_id, *, owner):
        queue = self.server.prompt_queue
        if queue.delete_queue_item(lambda item: self._owned(item, task_id, owner)):
            return True  # removal is a confirmed queued cancellation
        running, _pending = queue.get_current_queue()
        if not any(self._owned(item, task_id, owner) for item in running):
            return False
        if self.interrupt_owned is not None:
            self.interrupt_owned(task_id, owner)
            return False
        interrupt = getattr(queue, 'interrupt_if_running', None)
        if not callable(interrupt):
            raise ProviderUnavailable('Host has no task-scoped interruption; global interrupt was refused.')
        interrupt(task_id)
        return False  # an interrupt request is not proof that execution stopped


def owned_native_interrupt(queue, interrupt):
    """Explicit adapter for the pinned host's mutex/currently_running contract.

    The mutex prevents task_done/get from switching ownership between the check
    and interrupt flag. Multiple concurrent native runners are refused. A later
    history execution_interrupted event is still required to confirm cancellation.
    """
    def request(task_id, owner):
        mutex = getattr(queue, 'mutex', None)
        if mutex is None:
            raise ProviderUnavailable('Host has no atomic native queue ownership boundary.')
        with mutex:
            running = getattr(queue, 'currently_running', None)
            if not isinstance(running, dict):
                raise ProviderUnavailable('Host native running-task contract changed.')
            if len(running) != 1 or not ComfyNativeQueue._owned(next(iter(running.values())), task_id, owner):
                return False
            interrupt(True)
            return True
    return request


async def release_native_models():
    # Called only inside an explicitly dispatched Qwen GPU lease.
    import comfy.model_management as model_management
    model_management.unload_all_models()
    model_management.soft_empty_cache()


def install_native_admission(server, admission):
    """Call during host assembly, before aiohttp freezes middleware registration."""
    if getattr(server, '_creative_studio_native_admission', None) is admission:
        return
    from aiohttp import web
    @web.middleware
    async def guard(request, handler):
        if request.method != 'POST' or request.path not in ('/prompt', '/api/prompt'):
            return await handler(request)
        try:
            async with admission.lease('native'):
                return await handler(request)
        except ProviderUnavailable:
            return web.json_response({'error': {'type': 'local_resource_unavailable', 'message': 'Shared local GPU admission is unavailable; no native prompt was queued.'}, 'node_errors': {}}, status=409)
    server.app.middlewares.append(guard)
    server._creative_studio_native_admission = admission
