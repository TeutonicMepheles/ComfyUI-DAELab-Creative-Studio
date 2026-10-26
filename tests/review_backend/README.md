# tests/review_backend

Counterexamples found during storage and validation review.

test_storage_review.py covers foreign DB preservation, credential rejection, decode-before-success, redelivery and invalid manifests.

Owning modules remain contracts/assets/jobs/media/diagnostics; these are regression probes.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/review_backend -p "test_*.py" -v
```
