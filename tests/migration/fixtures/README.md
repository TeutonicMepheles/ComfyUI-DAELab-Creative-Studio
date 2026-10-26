# tests/migration/fixtures

Public legacy/nested workflows and native-schema contracts.

legacy-readonly-workflow.json and nested-readonly-workflow.json contain unsupported/unknown probes; host-1.53.10-contract.json and schema/source contracts pin behavior.

Disabled legacy nodes are preservation inputs, not executable registrations.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migration -p "test_*.py" -v
node --test tests/migration/readonly_nodes.test.mjs
```
