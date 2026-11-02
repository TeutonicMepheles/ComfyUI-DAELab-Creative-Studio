# backend/storyboard

Document import, script-table inventory, stable projections and reference selection.

archive.py bounds Office archives; script_document.py inventories DOCX tables; table_adapter.py validates data; services.py injects storage/classification.

Business nodes own native registration; parsing rules are independent of host globals and provider transport.

Exact DOCX header `镜头` maps to the original shot number; `镜头备注`, `运镜` and `景别` remain notes. Original numbering and cell-source mappings are retained.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migrated_business_backend -p "test_*.py" -v
```
