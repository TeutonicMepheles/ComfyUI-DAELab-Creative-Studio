"""One explicit local resource lease; the host's native queue remains authoritative."""
import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path

from ..providers.contracts import ProviderUnavailable


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
