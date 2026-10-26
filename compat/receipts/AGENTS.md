# Receipt readers

- Keep database inspection read-only and bounded; never mutate historical task facts during inspection.
- Do not reinterpret legacy IDs as current provider ownership or allow reads to resume retired execution.
- Preserve unrecognized structures for reporting; redact credential values from public diagnostics.
