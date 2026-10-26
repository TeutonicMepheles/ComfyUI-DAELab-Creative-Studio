# tests/contract

Catalog and traceability relationships across features, acceptance, use cases, tests and evaluations.

test_eval_traceability.mjs checks authoritative catalog/evaluation links.

Valid references and declared cases do not mean acceptance was executed.

Focused checks, from the repository root:

```powershell
node --test tests/contract/*.mjs
node tools/evals/traceability.mjs --check
```
