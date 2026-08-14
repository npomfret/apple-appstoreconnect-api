---
description: Use for any App Store Connect endpoint, request, response, session, cookie, cURL capture, upload, draft, submission, metadata, screenshot, logging, audit, confirmation, or live CLI operation. Enforces evidence, credential safety, and write safeguards. Do not use for isolated prose-only changes that do not alter those contracts.
user-invocable: true
---

# Apple API safety workflow

Read `.claude/references/architecture.md` and the relevant existing `docs/*.md` document.

1. Classify the change: read-only, reversible write, destructive/overwriting write, or
   irreversible publication. Identify exactly what live data could change.
2. Locate evidence. A browser capture is strongest; a tested probe is weaker; public API
   analogy is a hypothesis, not proof. Never fabricate evidence or inspect credentials.
3. For an unproven endpoint/body/flow, stop and request approval before implementation.
   Propose a safe capture or dry-run path instead of live experimentation.
4. Preserve the transport, audit, redaction, host-isolation, confirmation, and non-TTY
   guarantees. A CLI confirmation is mandatory but does not authorise invoking the live
   client during development.
5. Update `docs/evidence.md`, user docs, and code comments together when evidence or risk
   changes. State residual uncertainty in the handoff.
