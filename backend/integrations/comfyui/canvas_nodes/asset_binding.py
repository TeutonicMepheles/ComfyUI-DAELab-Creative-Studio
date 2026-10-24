"""Explicit service binding; importing nodes never opens a database."""
from ....contracts.errors import StorageError

_catalog = None


def bind_asset_catalog(catalog):
    global _catalog
    _catalog = catalog


def asset_catalog():
    if _catalog is None:
        raise StorageError('资产目录不可用；请修复持久化服务后消费素材，工作流原文已保留')
    return _catalog


def consume_source(operation):
    source = {'operation': operation}
    try:
        from comfy_execution.utils import get_executing_context
    except ImportError:
        return source  # Inert IO contract tests have no host worker context.
    context = get_executing_context()
    for name, key in (('node_id', 'nodeId'), ('prompt_id', 'requestId')):
        value = getattr(context, name, None)
        if value is not None: source[key] = str(value)
    return source
