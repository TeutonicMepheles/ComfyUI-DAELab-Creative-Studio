# backend/media collaboration

Follow the [repository instructions](../../AGENTS.md). Local rules:

- Preserve frozen inputs, native task/list-index ownership and confirmed cancellation.
- Keep codec work off the HTTP event loop; reject arbitrary caller output paths.
- Do not replace complete decode validation with file existence or metadata checks.

See [README.md](README.md) for ownership and focused checks.
