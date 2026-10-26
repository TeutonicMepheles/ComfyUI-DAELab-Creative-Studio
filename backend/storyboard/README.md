# backend/storyboard

Document import, script-table inventory, stable projections and reference selection.

archive.py bounds Office archives; script_document.py inventories DOCX tables; table_adapter.py validates data; services.py injects storage/classification.

Business nodes own native registration; parsing rules are independent of host globals and provider transport.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migrated_business_backend -p "test_*.py" -v
```
