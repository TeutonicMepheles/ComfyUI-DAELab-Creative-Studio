"""Explicitly prepared CPU fixture package. Zero nodes, no UI and no automatic tasks."""
import json
import hashlib
from pathlib import Path
import sys

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


def install(server):
    from .harness import SchedulerFixture, VERSION, routes
    root = Path(__file__).resolve().parent
    marker = json.loads((root / 'performance-fixture.json').read_text('utf-8'))
    if marker.get('fixture') != VERSION or marker.get('testOnly') is not True:
        raise RuntimeError('Prepare this test package explicitly before installation.')
    if set(marker.get('files', {})) != {'__init__.py', 'harness.py', 'fake-job-plan.json'} or any(
            hashlib.sha256((root / name).read_bytes()).hexdigest() != digest for name, digest in marker['files'].items()):
        raise RuntimeError('Prepared performance fixture files changed.')
    args = sys.argv
    if '--cpu' not in args or '--offline' not in args or '--base-directory' not in args or '--port' not in args:
        raise RuntimeError('Performance fixture requires an explicitly isolated CPU/offline host.')
    environment = Path(args[args.index('--base-directory') + 1]).resolve()
    ownership = json.loads((environment / 'creative-studio-isolation.json').read_text('utf-8'))
    if (ownership.get('owner') != 'creative-studio-cpu-host-v1' or ownership.get('port') in (8000, 8224, 8225, 8226, 8227)
            or str(ownership.get('port')) != args[args.index('--port') + 1]
            or root.parent != environment / 'custom_nodes'):
        raise RuntimeError('Refusing protected or non-owned host installation.')
    core = getattr(server, '_creative_studio_services', None)
    if core is None:
        raise RuntimeError('Load the real Studio CoreServices before this fixture.')
    if not Path(core.jobs.database.path).resolve().is_relative_to(environment / 'user'):
        raise RuntimeError('The actual product ledger is not in the isolated user directory.')
    if any(not Path(path).resolve().is_relative_to(environment) for path in core.assets.roots.values()):
        raise RuntimeError('The actual product media roots are not isolated.')
    controller = SchedulerFixture(core, (root / 'fake-job-plan.json').read_bytes(), enabled=True, host_kind='isolated-comfyui')
    if controller.plan_hash != marker['planSha256']:
        raise RuntimeError('The prepared plan bytes changed.')
    existing = {(r.method, r.path) for r in server.routes if hasattr(r, 'method') and hasattr(r, 'path')}
    definitions = routes(controller)
    if any((method, path) in existing for method, path, _ in definitions):
        raise RuntimeError('Performance fixture routes already registered.')
    for method, path, handler in definitions:
        server.routes.route(method, path)(handler)
    server._creative_studio_performance_fixture = controller
    async def close(_app): await controller.close()
    server.app.on_cleanup.append(close)
    return controller


from server import PromptServer
install(PromptServer.instance)
