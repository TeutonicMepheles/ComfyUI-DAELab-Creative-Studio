# tests/performance

Portable checks of workload fixtures, observers and scheduler measurements.

test_fixtures.py checks input identity; test_scheduler_* checks service behavior; *.test.mjs checks observers and staged input persistence.

Actual ComfyUI latency requires the registered environment/workload protocol and all raw samples.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/performance -p "test_*.py" -v
node --test tests/performance/*.test.mjs
```
