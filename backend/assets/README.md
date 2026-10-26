# backend/assets

Content-based asset identity, rooted references, frozen inputs and favorites.

catalog.py owns resolution, hashing, registration, result receipts, freezing and search.

Generation/export consume asset identities through this catalog rather than arbitrary paths.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/backend -p "test_*.py" -v
```
