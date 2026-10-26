# backend/integrations/comfyui/generation_nodes collaboration

Follow the [repository instructions](../../../../AGENTS.md). Local rules:

- Match both application request and native task IDs before reading/cancelling.
- A sent interrupt is not a confirmed stop; do not use unscoped global interruption.
- Missing native history is unavailable, never permission to fabricate or substitute it.

See [README.md](README.md) for ownership and focused checks.
