# Migration specifications

- catalog/*.json is authoritative for feature/use-case/test records and stable IDs.
- render_catalog.mjs produces the listed Markdown/CSV views, including README; use --write for an intentional catalog update, then --check.
- Keep source-manifest.json tied to the pinned source baselines; current product changes belong in validation/provenance, not invented baseline hashes.
- A specification check does not execute a product test or close an M6 gate.
