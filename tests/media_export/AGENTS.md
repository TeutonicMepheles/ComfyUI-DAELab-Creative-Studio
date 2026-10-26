# tests/media_export collaboration

Follow the [repository instructions](../../AGENTS.md). Local rules:

- Keep idempotency, scoped cancellation, current-input identity and decode assertions.
- Use temporary roots and retain missing/invalid-output cases.
- Recovery must retain the original execution rather than render again.

See [README.md](README.md) for ownership and focused checks.
