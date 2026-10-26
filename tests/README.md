# tests

Portable regressions, public synthetic fixtures and explicitly isolated host/evaluation harnesses.

requirements.txt pins Python dependencies; .github/workflows/checks.yml lists complete CI commands. application/, migrated_*/ and generation_frontend/ cover frontend rules.

A CI pass does not establish real browser/GPU quality, latency budgets or M6 acceptance.

Focused checks, from the repository root:

```powershell
npm run check
python -m unittest discover -s tests/unit -p "test_*.py" -v
```
