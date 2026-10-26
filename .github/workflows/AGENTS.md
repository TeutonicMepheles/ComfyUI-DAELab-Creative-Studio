# Workflow ownership

- This directory owns CI orchestration, not acceptance conclusions.
- Keep push and pull_request validation aligned; do not use privileged execution of untrusted PR code on the user's local host.
- Report failed step, head SHA and follow-up result; never remove a failing check solely to obtain green status.
