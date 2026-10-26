# tests/fixtures/asset-library

Synthetic favorites for pagination, search and catalog-size boundaries.

two-pages.json contains 50 entries; search-2000.json covers the catalog limit; ../manifest.json records hashes.

These are immutable inputs, not an actual favorite database.

Focused checks, from the repository root:

```powershell
node --test tests/migrated_canvas/asset_library.test.mjs
python -m unittest discover -s tests/backend -p "test_*.py" -v
```
