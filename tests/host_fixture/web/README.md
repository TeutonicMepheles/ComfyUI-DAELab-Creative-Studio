# tests/host_fixture/web

Browser observers and UI controls for explicitly installed test fixtures.

generation_fixture.js drives deterministic controls; performance*.js and input/IME observers record stages; viewport.html is test-only.

Instrumentation observes real host behavior and must not replace the editing path.

Focused checks, from the repository root:

```powershell
node tests/host_fixture_tests/test_generation_fixture_frontend.mjs
node --test tests/performance/*.test.mjs
```
