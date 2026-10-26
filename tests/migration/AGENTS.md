# tests/migration collaboration

Follow the [repository instructions](../../AGENTS.md). Local rules:

- Preserve unknown nested fields, native IDs and conflicting namespaced metadata.
- Use owned temporary roots, snapshots and interruption/repeated-operation cases.
- Keep active-profile switching atomic; optional pinned-bundle checks never authorize modifying the host.

See [README.md](README.md) for ownership and focused checks.
