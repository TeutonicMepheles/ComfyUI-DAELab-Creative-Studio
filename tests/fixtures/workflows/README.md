# tests/fixtures/workflows

Native workflow baselines for compatibility checks.

old-default-table.json retains the captured three-column/three-row default; ../manifest.json records its source and hash.

Open an editable copy; loading the fixture alone is not migration acceptance.

Focused checks, from the repository root:

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/data_table.test.mjs
```
