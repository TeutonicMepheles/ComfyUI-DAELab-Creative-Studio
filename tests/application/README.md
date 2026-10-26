# tests/application

Document transactions, async result tickets and export/UI host coordination.

business_document/prepared_document_edit/product_editing exercise controllers; media_export tests cover frontend request, host and panel contracts.

These test controlled application boundaries, not real inference or visual acceptance.

Focused checks, from the repository root:

```powershell
node --test tests/application/*.mjs
```
