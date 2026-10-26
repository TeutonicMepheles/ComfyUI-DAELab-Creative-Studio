# tests/host_fixture_tests

Verification that isolated fixture imports and execution remain explicit.

test_generation_fixture.py checks Python behavior; test_generation_fixture_frontend.mjs checks browser entry imports.

Harness correctness is distinct from product generation acceptance.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/host_fixture_tests -p "test_*.py" -v
node tests/host_fixture_tests/test_generation_fixture_frontend.mjs
```
