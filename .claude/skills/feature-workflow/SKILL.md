---
description: Use for any non-trivial feature, bug fix, refactor, CLI behaviour change, or library API change. Enforces audit → readiness refactor → implementation → evidence-based verification. Do not use for a typo-only documentation edit.
user-invocable: true
---

# Feature workflow

1. Identify and load the relevant convention skill, especially `apple-api-safety` for any
   request, session, upload, log, confirmation, or App Store behaviour.
2. Inspect the full path: CLI/library entry point, owning abstraction, transport boundary,
   parallel functions, docs, and existing validation. State the current pattern and gaps.
3. Decide whether the area needs reshaping first. Prefer the clean design that makes the
   new behaviour ordinary; do not bolt it onto an unready structure.
4. If the design requires a new dependency, endpoint, request convention, public command,
   abstraction, or unproven Apple behaviour, stop and seek approval with the evidence and
   safer alternatives.
5. Implement the coherent change. Delete superseded code and keep docs/evidence aligned.
6. Verify proportionately: type check at minimum for TypeScript changes, build before
   handoff where possible, plus targeted tests or a dry-run/mock only when they are real.
7. Hand off with changed behaviour, evidence level, and exact verification performed.
