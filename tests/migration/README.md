# tests/migration

Migration/profile switching, SQLite snapshots and lossless legacy compatibility.

HOST_COMPATIBILITY.md pins host behavior; fixture generators create public inputs; Python tests cover storage/preparation and readonly_nodes.test.mjs covers preservation.

Migration copies and read-only legacy support must not reactivate retired execution.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migration -p "test_*.py" -v
node --test tests/migration/readonly_nodes.test.mjs
```
