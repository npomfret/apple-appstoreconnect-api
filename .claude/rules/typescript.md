---
paths:
  - "src/**/*.ts"
---

# TypeScript and CLI rules

- Keep modules within their credential and capability boundary. Use the ownership table in `.claude/references/architecture.md` rather than routing every operation through the private API module.
- A convenience wrapper over official calls is one module per capability, exporting the
  same three shapes `official/availability.ts` established: `fetch<Thing>()` returning a typed
  report, `format<Thing>()` rendering it for a human, and `<thing>Ready()` returning the
  boolean behind `--check`. The wrapper owns the multi-call sequence and the parsing; the
  command in `cli.ts` owns only argument validation and which of the three to print.
  Wrapping several official calls into one answer is the point — a wrapper that forwards
  a single call unchanged is not worth the module.
- Represent finite remote states with literal unions where known. Prefer `readonly` inputs
  where callers do not need mutation.
- Parse and validate external data at a boundary before relying on it. Do not make
  undocumented response fields look more certain than the evidence supports.
- Keep CLI output machine-friendly: data to stdout, diagnostics/prompts/logs to stderr;
  preserve `--json` and `--raw` contracts.
- Use named exported functions and interfaces for the library surface. Keep one-off
  presentation helpers private to their owning module.
