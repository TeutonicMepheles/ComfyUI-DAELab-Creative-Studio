# tests collaboration

Follow the [repository instructions](../AGENTS.md). Local rules:

- Use deterministic temporary stores and synthetic data, without implicit GPU/cloud calls or user-service access.
- Test-only nodes/routes must stay outside production registration and frontend/src.
- Treat committed fixtures as reviewed baselines; preserve initial failures and reruns separately under ignored local evidence.

See [README.md](README.md) for ownership and focused checks.
