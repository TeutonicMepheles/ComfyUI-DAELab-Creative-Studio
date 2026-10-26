# tests/release

Candidate archive/extraction and packaging metadata contracts.

test_package_candidate.py uses synthetic committed trees to check content selection and wheel metadata.

A packaging pass does not authorize publication or establish M6 acceptance; tooling is owned by tools/release/.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/release -p "test_*.py" -v
```
