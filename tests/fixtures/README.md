# tests/fixtures

Public synthetic fixture inputs and their identity manifests.

manifest.json indexes the original default table and asset-library data; local-eval/ and performance/ have separate manifests.

Generated outputs and raw acceptance logs are separate from these inputs.

Focused checks, from the repository root:

```powershell
node --test tests/migrated_canvas/asset_library.test.mjs
python -m unittest discover -s tests/performance -p "test_*.py" -v
```
