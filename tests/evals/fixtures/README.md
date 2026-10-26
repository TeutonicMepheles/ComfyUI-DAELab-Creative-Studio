# tests/evals/fixtures

Pinned reference implementation used by evaluation media-snapshot tests.

pinned_media_snapshot.py is an extracted source fixture consumed by the surrounding suite.

It is reference data, not an installed provider or backend module.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/evals -p "test_*.py" -v
```
