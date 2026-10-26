# backend/integrations/comfyui/business_nodes

Native Table, StoryboardImport, ScriptParser and applied LLM result entrypoints.

__init__.py returns registrations; table_node.py, import_node.py, script_node.py and approved_result.py project service data into native slots.

Canonical parsing lives in storyboard/ and prompt/; these nodes do not schedule generation.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migrated_business_backend -p "test_*.py" -v
```
