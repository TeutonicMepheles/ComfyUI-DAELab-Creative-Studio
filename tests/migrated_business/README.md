# tests/migrated_business

Business frontend rules for tables, prompts, optimization, generation panels and host lifecycle.

register.mjs resolves source TypeScript; generation_entrypoints.test.mjs checks actual entry discovery; fixtures/ holds inputs and evidence/ retains historical results.

Controlled DOM/host tests do not replace actual two-instance ComfyUI inspection.

Focused checks, from the repository root:

```powershell
npm run test:business
```
