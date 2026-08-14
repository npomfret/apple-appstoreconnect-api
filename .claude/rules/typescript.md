---
paths:
  - "src/**/*.ts"
---

# TypeScript and CLI rules

- Keep modules focused: transport in `http.ts`, session parsing in `session.ts`/`curl.ts`,
  Apple resource operations in `api.ts`, presentation in `cli.ts`/`report.ts`.
- Represent finite remote states with literal unions where known. Prefer `readonly` inputs
  where callers do not need mutation.
- Parse and validate external data at a boundary before relying on it. Do not make
  undocumented response fields look more certain than the evidence supports.
- Keep CLI output machine-friendly: data to stdout, diagnostics/prompts/logs to stderr;
  preserve `--json` and `--raw` contracts.
- Use named exported functions and interfaces for the library surface. Keep one-off
  presentation helpers private to their owning module.
