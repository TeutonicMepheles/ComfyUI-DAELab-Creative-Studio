# tests/migrated_assets

Frontend asset registration, catalog views and upload bridge regressions.

asset_service/asset_views cover UI contracts; asset_registration/upload_registration cover identity; asset_test_modules.mjs supports test imports.

The backend catalog owns facts; frontend tests consume public asset ports.

Focused checks, from the repository root:

```powershell
node --test tests/migrated_assets/*.test.mjs
```
