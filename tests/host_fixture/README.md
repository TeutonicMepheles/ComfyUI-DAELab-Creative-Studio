# tests/host_fixture

Explicit test-only ComfyUI extension for controlled generation and instrumentation.

generation_fixture.py/generation_fixture_nodes.py define fixture endpoints/nodes; local_eval_trace.py records facts; asset_cache.py scopes caching; web/ contains observers.

Install only through isolated preparation tools, never as a production dependency.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/host_fixture_tests -p "test_*.py" -v
```
