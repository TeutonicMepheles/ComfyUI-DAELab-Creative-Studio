# Traceability and evidence schemas

- traceability.json maps task -> feature/AC -> use case -> test -> evaluation; preserve stable cross-references.
- local-eval-plan.json and schemas define fixed batch/evidence structure. Do not reduce required samples or loosen failure rules to obtain a pass.
- Validate with node tools/evals/traceability.mjs --check and relevant tests/evals; keep raw model outputs outside this directory.
