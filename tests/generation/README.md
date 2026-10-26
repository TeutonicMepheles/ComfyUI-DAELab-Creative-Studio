# tests/generation

Deterministic generation, optimization, admission and original-task recovery regressions.

test_service.py covers durable dispatch/results; cancellation/fence tests cover races; test_parameters.py compares frozen requests; qwen_test_binding.py is test-owned.

Temporary SQLite and real synthetic media validation exercise product boundaries without live models.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
```
