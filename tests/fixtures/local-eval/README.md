# tests/fixtures/local-eval

Fixed local Qwen and H3 sample inputs and preprocessing/source hashes.

samples.json defines ten samples; manifest.json pins identities; images/ contains synthetic reference pictures.

Preparation manifests are not current inference receipts, outputs or blind ratings.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/evals -p "test_*.py" -v
```
