# backend collaboration

Follow the [repository instructions](../AGENTS.md). Local rules:

- Keep host imports at integrations/comfyui and inject dependencies into portable modules.
- No import-time service/model startup, implicit cloud call or secondary task store.
- Keep credentials, model weights, user paths and raw evidence outside tracked source.

See [README.md](README.md) for ownership and focused checks.
