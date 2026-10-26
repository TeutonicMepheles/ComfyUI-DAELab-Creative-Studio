# tests/fixtures/performance

Fixed small/medium/large video/no-video workflows and workload plans.

FX-PERF-*.json, manifest.json and sources.json record workloads/provenance; search-sequence.json and fake-job-plan.json fix actions.

These workflows declare executionForbidden; loading them is for interaction measurement, not model inference.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/performance -p "test_*.py" -v
node --test tests/performance/*.test.mjs
```
