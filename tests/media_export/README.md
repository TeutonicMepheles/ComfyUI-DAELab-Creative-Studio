# tests/media_export

Synthetic rendering and HTTP/export-service regressions.

test_exports.py exercises frozen inputs, native ownership, codecs and validation; test_http.py checks control/read boundaries.

CPU test media is not model inference or full storyboard-to-film acceptance.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/media_export -p "test_*.py" -v
```
