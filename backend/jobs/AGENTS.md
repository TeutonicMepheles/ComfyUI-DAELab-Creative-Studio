# backend/jobs collaboration

Follow the [repository instructions](../../AGENTS.md). Local rules:

- Preserve idempotency, immutable provider identity and compare-and-swap versions.
- Keep failed/unknown/cancelled attempts and events.
- Require the decoder-aware result validator before media success.

See [README.md](README.md) for ownership and focused checks.
