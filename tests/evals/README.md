# tests/evals

Offline fixed-request preparation and evaluation runner/runtime-hook regressions.

test_h3_preparation and request-preparation tests compare inputs; runner/hooks tests inject controlled transports and native events.

The unittest suite does not run the paired inference matrix or create semantic ratings.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/evals -p "test_*.py" -v
```
