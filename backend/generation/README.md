# backend/generation

Shared generation/optimization dispatch, recovery, permissions and resource admission.

service.py owns task transitions; admission.py owns capacity/physical leases; optimization.py adapts review DTOs; assembly.py and http.py compose dependencies/routes.

Providers observe results, jobs stores facts, and ComfyUI executes. GPU capacity is shared and fixed at one; unrelated external applications are outside it.

Resolve incoming native/view paths through AssetCatalog before matching stored references. Windows case and separator aliases must keep the same rooted identity; never replace this with string lowercasing or a bypass of receipt ownership.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
```
