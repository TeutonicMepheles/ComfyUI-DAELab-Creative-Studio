"""Retired DeepSeek compatibility names. No credentials or transport are read."""
from contextvars import ContextVar
from .contracts import ProviderUnavailable

MODEL = 'deepseek-flash'
request_key = ContextVar('studio_retired_deepseek_key', default='')

def configured_key(user_directory=None):
    return ''

class DeepSeekTransport:
    async def create(self, *args, **kwargs):
        raise ProviderUnavailable('Saved DeepSeek model is unavailable; select an available model explicitly.')

class DeepSeekProvider:
    id, execution_kind, resource = 'deepseek-text', 'remote', 'cloud'
    supports_query = supports_lookup = supports_cancel = False
    def __init__(self, **kwargs):
        pass
    async def capabilities(self, model):
        raise ProviderUnavailable('Saved DeepSeek model is unavailable; select an available model explicitly.')
    def require_key(self):
        raise ProviderUnavailable('DeepSeek credential transport has been retired.')
