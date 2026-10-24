"""One explicit local resource lease; the host's native queue remains authoritative."""
import asyncio
from collections import deque
from contextlib import asynccontextmanager, contextmanager
import os
from pathlib import Path
import threading
import uuid

from ..providers.contracts import ProviderUnavailable
from ..contracts.errors import Conflict, InvalidInput, InvalidTransition


async def complete_task(task):
    """Delay caller cancellation until an already-started operation really ends.

    shield alone only handles one cancel(). Repeated cancellation must not detach
    a SQLite writer/codec thread and let its resource owner exit prematurely.
    Cancellation remains visible to the caller after the operation has settled.
    """
    cancelled = None
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError as error:
            if task.cancelled():
                raise
            cancelled = error
        except BaseException:
            if cancelled is not None:
                raise cancelled from None
            raise
    if cancelled is not None:
        raise cancelled
    return result


async def complete_blocking(function, *args, **kwargs):
    return await complete_task(asyncio.create_task(asyncio.to_thread(function, *args, **kwargs)))


class ResourcePermit:
    """Ephemeral capacity ownership, never a replacement for a ledger fact."""
    def __init__(self, owner, resource, request_id, *, retained=False):
        self.owner, self.resource, self.request_id = owner, resource, request_id
        self.retained, self.released = retained, False

    def retain(self):
        with self.owner._mutex:
            if not self.released:
                self.retained = True

    def release(self):
        self.owner._release_permit(self)


class ResourceAdmission:
    """Shared FIFO capacity gates for HTTP tasks and existing native worker threads.

    Waiters are capabilities, not jobs. No worker, executor or task database is
    created here. Async waiters never occupy the default thread pool while idle.
    """
    DEFAULT_LIMITS = {'gpu': 1, 'cloud': 3, 'transcode': 2}
    ALIASES = {'native': 'gpu', 'ollama': 'gpu', 'gpu': 'gpu', 'cloud': 'cloud', 'transcode': 'transcode'}

    def __init__(self, *, limits=None, jobs=None):
        self.limits = dict(self.DEFAULT_LIMITS if limits is None else limits)
        if set(self.limits) != set(self.DEFAULT_LIMITS) or any(type(n) is not int or not 1 <= n <= 64 for n in self.limits.values()) or self.limits['gpu'] != 1:
            raise InvalidInput('Resource limits require GPU=1 and positive bounded cloud/transcode capacities.')
        self.jobs = jobs
        self._mutex = threading.RLock()
        self._queues = {key: deque() for key in self.limits}
        self._active = {key: {} for key in self.limits}
        self._loaded = jobs is None
        # A terminal recovery may finish while the restart scan is in a worker.
        # Serialize its release with the scan commit, rather than resurrecting
        # a stale nonterminal row. Discard these markers after initialization.
        self._released_while_loading = set()
        self._load_mutex = threading.Lock()
        self._load_async = asyncio.Lock()

    def check_available(self, resource):
        if resource not in self.ALIASES:
            raise ProviderUnavailable('The provider has no supported resource admission class.')

    def _resource(self, resource):
        self.check_available(resource)
        return self.ALIASES[resource]

    def _restore(self):
        with self._load_mutex:
            if self._loaded:
                return
            reservations = []
            for job in self.jobs.list_resource_reservations():
                # Native GPU ownership is checked against the host queue and
                # physical lock. A queued native export is not yet a render.
                kind = job['execution_kind']
                if job['provider'] == 'native-video-edit' and job['state'] in {'submitting', 'submitted'}:
                    continue
                resource = self._resource(job['snapshot'].get('resource', 'cloud' if kind == 'remote' else 'transcode'))
                reservations.append((resource, job['request_id']))
            with self._mutex:
                for resource, request_id in reservations:
                    if request_id in self._released_while_loading:
                        continue
                    self._active[resource].setdefault(request_id, ResourcePermit(self, resource, request_id, retained=True))
                self._loaded = True
                self._released_while_loading.clear()

    async def _ready(self):
        if not self._loaded:
            async with self._load_async:
                if not self._loaded:
                    await complete_blocking(self._restore)

    def snapshot(self):
        with self._mutex:
            return {'loaded': self._loaded, 'resources': {key: {'limit': self.limits[key], 'active': len(self._active[key]),
                    'queued': len(self._queues[key]), 'retained': sum(p.retained for p in self._active[key].values())} for key in self.limits}}

    def _enqueue(self, resource, request_id, *, loop=None, resume_retained=False):
        waiter = {'request_id': request_id or 'lease:' + uuid.uuid4().hex, 'resource': resource,
                  'loop': loop, 'signal': loop.create_future() if loop else threading.Event(), 'permit': None, 'cancelled': False}
        with self._mutex:
            existing = self._active[resource].get(waiter['request_id'])
            if resume_retained and existing is not None and existing.retained:
                # Only a validated original native execution can adopt its own
                # conservative restart reservation. No provider create is allowed.
                existing.retained = False
                waiter['permit'] = existing
                waiter['signal'].set()
                return waiter
            if waiter['request_id'] in self._active[resource] or any(w['request_id'] == waiter['request_id'] for w in self._queues[resource]):
                raise Conflict('This request already owns or is awaiting resource capacity; recover its original execution.')
            self._queues[resource].append(waiter)
            self._drain(resource)
        return waiter

    def _drain(self, resource):
        while self._queues[resource] and len(self._active[resource]) < self.limits[resource]:
            waiter = self._queues[resource].popleft()
            if waiter['cancelled']:
                continue
            permit = ResourcePermit(self, resource, waiter['request_id'])
            waiter['permit'] = permit
            self._active[resource][permit.request_id] = permit
            if waiter['loop'] is None:
                waiter['signal'].set()
            else:
                def deliver(w=waiter):
                    if w['signal'].done():
                        self._cancel_waiter(w)
                    else:
                        w['signal'].set_result(w['permit'])
                try:
                    waiter['loop'].call_soon_threadsafe(deliver)
                except RuntimeError:
                    waiter['cancelled'] = True
                    self._active[resource].pop(permit.request_id, None)
                    permit.released = True

    def _cancel_waiter(self, waiter):
        with self._mutex:
            waiter['cancelled'] = True
            queue = self._queues[waiter['resource']]
            if waiter in queue:
                queue.remove(waiter)
            if waiter['permit'] is not None:
                self._release_permit(waiter['permit'])
            self._drain(waiter['resource'])

    def _release_permit(self, permit):
        with self._mutex:
            if permit.released:
                return
            permit.released = True
            permit.retained = False
            if self._active[permit.resource].get(permit.request_id) is permit:
                self._active[permit.resource].pop(permit.request_id)
            self._drain(permit.resource)

    def release(self, request_id):
        """Called only after the owning service has observed a durable terminal fact."""
        with self._mutex:
            if not self._loaded:
                self._released_while_loading.add(request_id)
            for queue in self._queues.values():
                for waiter in list(queue):
                    if waiter['request_id'] != request_id:
                        continue
                    self._cancel_waiter(waiter)
                    if waiter['loop'] is None:
                        waiter['signal'].set()
                    else:
                        def reject(w=waiter):
                            if not w['signal'].done():
                                w['signal'].set_exception(InvalidTransition('The queued request has a terminal ledger fact.'))
                        try:
                            waiter['loop'].call_soon_threadsafe(reject)
                        except RuntimeError:
                            pass
            for active in self._active.values():
                permit = active.get(request_id)
                if permit is not None:
                    self._release_permit(permit)

    @asynccontextmanager
    async def lease(self, resource, *, request_id=None):
        resource = self._resource(resource)
        await self._ready()
        waiter = self._enqueue(resource, request_id, loop=asyncio.get_running_loop())
        try:
            permit = await waiter['signal']
        except BaseException:
            self._cancel_waiter(waiter)
            raise
        try:
            yield permit
        finally:
            if not permit.retained:
                permit.release()

    @contextmanager
    def lease_sync(self, resource, *, request_id=None, check=lambda: None, resume_retained=False):
        """Only an existing native worker may block here, never an HTTP loop."""
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            raise RuntimeError('Synchronous resource waiting cannot run on an event loop.')
        resource = self._resource(resource)
        self._restore()
        check()
        waiter = self._enqueue(resource, request_id, resume_retained=resume_retained)
        try:
            while not waiter['signal'].wait(.05):
                check()
            check()
            if waiter['cancelled']:
                raise InvalidTransition('The queued request has a terminal ledger fact.')
        except BaseException:
            self._cancel_waiter(waiter)
            raise
        permit = waiter['permit']
        try:
            yield permit
        finally:
            if not permit.retained:
                permit.release()


class LocalAdmission:
    def __init__(self, lock_path, *, native_busy, ensure_unloaded=None, release_native_models=None):
        self.path = Path(lock_path)
        self.native_busy = native_busy
        self.ensure_unloaded = ensure_unloaded
        self.release_native_models = release_native_models
        self._lock = asyncio.Lock()

    def check_available(self, resource):
        """Read-only capability check; does not clear quarantine or unload models."""
        if self.path.with_suffix('.quarantine').exists():
            raise ProviderUnavailable('GPU admission is quarantined; explicitly reconcile resource release first.')
        if resource == 'ollama':
            if self.ensure_unloaded is None or self.release_native_models is None:
                raise ProviderUnavailable('Local Qwen requires explicit model release capabilities.')
            if self.native_busy():
                raise ProviderUnavailable('The native queue is busy; local text inference was not submitted.')

    async def reconcile(self):
        """Explicit resource recovery only; never called by import, health or status."""
        async with self.lease('native'):
            pass

    @asynccontextmanager
    async def lease(self, resource):
        async with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            handle = self.path.open('a+b')
            marker = self.path.with_suffix('.quarantine')
            try:
                if self.path.stat().st_size == 0:
                    handle.write(b'0'); handle.flush()
                handle.seek(0)
                try:
                    if os.name == 'nt':
                        import msvcrt
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError:
                    raise ProviderUnavailable('Another local model process owns the GPU admission lease.') from None
                if self.native_busy() and (resource == 'ollama' or marker.exists()):
                    raise ProviderUnavailable('The native Comfy queue contains work; this task was not submitted.')
                if marker.exists():
                    if self.ensure_unloaded is None:
                        raise ProviderUnavailable('GPU admission is quarantined; explicit unload capability is missing.')
                    await self.ensure_unloaded()
                    marker.unlink(missing_ok=True)
                if resource == 'ollama':
                    if self.ensure_unloaded is None or self.release_native_models is None:
                        raise ProviderUnavailable('Local Qwen requires explicit model release capabilities.')
                    await self.release_native_models()
                    marker.touch()
                    try:
                        yield
                    finally:
                        await self.ensure_unloaded()
                        marker.unlink(missing_ok=True)
                else:
                    yield
            finally:
                handle.close()
