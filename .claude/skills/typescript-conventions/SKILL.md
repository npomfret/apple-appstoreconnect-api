---
description: Use when creating or changing TypeScript modules, exports, CLI parsing, JSON:API handling, errors, or output in this repository. Do not use as the main workflow for documentation-only changes.
user-invocable: true
---

# TypeScript conventions

Read `.claude/references/architecture.md` before non-trivial work. Apply the scoped
TypeScript rules, then:

- Let types make unsafe states visible rather than widening values to make compilation easy.
- Keep JSON:API relationship expansion in `shared/jsonapi.ts`; avoid reimplementing joins in
  callers.
- Preserve existing module ownership and use the transport wrapper rather than raw fetch.
- Keep API functions resource-oriented and presentation/report formatting separate.
- Use `npm run typecheck` after changes; run `npm run build` when the published CLI/library
  output is affected.
