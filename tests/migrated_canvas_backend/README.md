# tests/migrated_canvas_backend

Native canvas registration, media processing and material-output import checks.

test_registration.py checks node mapping; test_media.py checks media/editing; test_material_output_import.py checks rooted references.

Tests use synthetic inputs and injected services without business generation.

`test_real_host_schema.py` additionally checks `MediaUpload.GET_NODE_INFO_V1()` with
the installed Comfy V3 SDK in a CPU-only subprocess. Set
`CREATIVE_STUDIO_COMFY_ROOT` to that installation's source directory; the test is
skipped when no host installation is provided. It starts no server or model run.
The shared test host's real `/object_info/DAELAB.MediaUpload` must also pass before
browser export acceptance.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/migrated_canvas_backend -p "test_*.py" -v
```
