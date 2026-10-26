# backend/jobs

Durable task facts, atomic submission claims, versions and bounded recovery.

ledger.py owns transitions, attempts, events and scoped discovery over contracts/database.py.

The ledger records truth; admission schedules capacity and the native host executes. UI undo cannot rewind facts.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/backend -p "test_*.py" -v
python -m unittest discover -s tests/generation -p "test_*.py" -v
```
