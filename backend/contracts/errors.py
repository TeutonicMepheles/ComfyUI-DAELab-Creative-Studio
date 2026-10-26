"""Public errors contain codes/actions, never request bodies or credentials."""


class ContractError(Exception):
    code = "contract_error"
    action = "review_input"

    def public(self):
        return {"code": self.code, "message": str(self), "action": self.action}


class InvalidInput(ContractError):
    code = "invalid_input"


class Conflict(ContractError):
    code = "identity_or_revision_conflict"
    action = "reload_original_record"


class InvalidTransition(ContractError):
    code = "invalid_state_transition"
    action = "inspect_original_task"


class MissingRecord(ContractError):
    code = "record_not_found"


class StorageError(ContractError):
    code = "storage_unavailable"
    action = "repair_storage_then_reconcile_original_identity"
