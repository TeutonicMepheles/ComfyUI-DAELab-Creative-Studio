# backend/generation collaboration

Follow the [repository instructions](../../AGENTS.md). Local rules:

- Recover only the original request; retry requires an explicit new identity after a proven failure/stop.
- Preserve frozen inputs, submission fences, cancellation ownership and lease lifetime.
- Use canonical catalog paths for result selection; no implicit real model or cloud execution in checks.

See [README.md](README.md) for ownership and focused checks.
