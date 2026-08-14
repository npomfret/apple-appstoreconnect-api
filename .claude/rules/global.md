# Global engineering rules

- Search broadly before writing: inspect the owning module, callers, consumers, analogous
  code, docs, and relevant compiler errors. Reuse or consolidate existing patterns.
- Grow a weak area into a coherent host for a requirement before adding the requirement.
  Do not preserve accidental structure with special cases or compatibility scaffolding.
- A new helper needs a clear owner and a demonstrated reuse case; otherwise improve the
  existing abstraction or keep logic local.
- Keep public exports intentional. `src/index.ts` is the library contract; new exports,
  commands, and output shapes require documentation in the same change.
- Use `unknown` at untrusted boundaries and narrow it. Avoid `any`, casts that hide type
  errors, non-null assertions, and catch-and-continue behaviour.
- Make the smallest *coherent* change, then remove superseded paths and dead code.
- Run `npm run typecheck` after TypeScript changes and `npm run build` before handoff when
  practical. Report checks honestly, including gaps.
