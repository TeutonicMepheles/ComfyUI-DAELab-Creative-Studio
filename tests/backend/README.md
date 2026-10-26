# tests/backend

Temporary SQLite job/asset contracts and actual synthetic media validation.

test_jobs_assets and test_job_scope_query cover facts/discovery; test_asset_* covers roots, HTTP and freeze races; test_media_validation checks decoding.

No installed user database is needed or modified.

Focused checks, from the repository root:

```powershell
python -m unittest discover -s tests/backend -p "test_*.py" -v
```
