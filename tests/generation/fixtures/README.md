# tests/generation/fixtures

Public baseline final-request captures for local text, vision, image and H3 cases.

LOCAL-*.json retains sourceCommit, captureKind, execution flags, normalizations and finalRequest.

Expected requests are not new successful inference receipts; sample inputs live in tests/fixtures/local-eval/.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
python -m unittest discover -s tests/evals -p "test_*.py" -v
```
