# backend/contracts

Shared Python ports, validated JSON, public errors and the versioned SQLite schema.

database.py owns schema/application IDs; ports.py defines interfaces; errors.py and validation.py bound external data.

Contracts cannot depend on host singletons or provider execution.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/backend -p "test_*.py" -v
python -m unittest discover -s tests/review_backend -p "test_*.py" -v
```
