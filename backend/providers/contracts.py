"""Provider boundaries distinguish a proven rejection from a possibly sent request."""
from dataclasses import dataclass, field
from typing import Protocol

from ..contracts.errors import ContractError


class ProviderUnavailable(ContractError):
    code = 'provider_unavailable'
    action = 'configure_exact_local_capability'


class SubmissionRejected(ContractError):
    code = 'submission_rejected'
    action = 'repair_input_then_explicit_new_request'


class SubmissionUncertain(ContractError):
    code = 'submission_unknown'
    action = 'query_original_identity_do_not_resubmit'

    def __init__(self, message='Submission outcome is unknown; do not resubmit.', *, task_id=None):
        super().__init__(message)
        self.task_id = task_id


@dataclass(frozen=True)
class Observation:
    state: str
    task_id: str
    text: str | None = None
    files: tuple[dict, ...] = ()
    error_code: str | None = None
    metadata: dict = field(default_factory=dict)


class Provider(Protocol):
    id: str
    execution_kind: str
    supports_query: bool
    supports_lookup: bool
    supports_cancel: bool

    async def capabilities(self, model: str) -> dict: ...
    def build(self, data: dict, media: list[dict], request_id: str) -> dict: ...
    async def preflight(self, snapshot: dict) -> None: ...
    async def create(self, request_id: str, snapshot: dict) -> Observation: ...
    async def query(self, task_id: str, snapshot: dict) -> Observation: ...
    async def lookup(self, request_id: str, snapshot: dict) -> Observation | None: ...
    async def cancel(self, task_id: str, snapshot: dict) -> bool: ...
