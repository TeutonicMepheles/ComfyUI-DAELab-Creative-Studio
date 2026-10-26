# tests/fixtures/performance/media

Synthetic media for repeatable playback and image workload pressure.

loop.mp4 and pattern.png are pinned by the parent manifest and video recipe.

They are performance inputs, unrelated to model-quality outputs.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/performance -p "test_*.py" -v
```
