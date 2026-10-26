# backend/contracts collaboration

Follow the [repository instructions](../../AGENTS.md). Local rules:

- Keep foreign/unversioned database rejection non-destructive.
- Use explicit versioned schema migrations; retain task and asset identity.
- Public errors must not expose credentials or request bodies.

See [README.md](README.md) for ownership and focused checks.
