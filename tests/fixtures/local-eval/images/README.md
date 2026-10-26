# tests/fixtures/local-eval/images

Synthetic picture bytes for vision cases and H3 first/last-frame references.

vision-counts.png and vision-relations.png cover vision inputs; motion-first.png and motion-last.png are ordered H3 frames.

The parent manifest owns hashes/preprocessing expectations; these images do not prove generated video quality.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/evals -p "test_*.py" -v
```
