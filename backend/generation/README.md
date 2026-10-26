# backend/generation

Shared generation/optimization dispatch, recovery, permissions and resource admission.

service.py owns task transitions; admission.py owns capacity/physical leases; optimization.py adapts review DTOs; assembly.py and http.py compose dependencies/routes.

Providers observe results, jobs stores facts, and ComfyUI executes. GPU capacity is shared and fixed at one; unrelated external applications are outside it.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/generation -p "test_*.py" -v
```
