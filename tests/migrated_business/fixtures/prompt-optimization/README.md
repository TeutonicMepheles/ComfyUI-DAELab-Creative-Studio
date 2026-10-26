# tests/migrated_business/fixtures/prompt-optimization

Fixed optimization DTOs and explicit context-copy cases.

requests.json defines expected inputs; context-copy-cases.json defines preservation/rejection examples.

Context-copy checks copied text, not semantic or factual model quality.

Focused checks, from the repository root:

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/prompt_optimization_context_copy.test.mjs
```
