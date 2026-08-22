# App Store Connect Bot — Operating Contract

This is a TypeScript CLI and library for capabilities missing from Apple's official App
Store Connect API, principally the undocumented `iris/v1` Resolution Center surface. It
handles a browser-derived live session and can change or publish real App Store data.
Correctness, evidence, auditability, and credential safety are more important than the
smallest diff.

## The boundary

The tree is gap-only as of 2026-08-22: no private implementation of an officially served
capability remains, `asc get` is confined to the private families and reaches iris only,
there is no raw write, and the transport speaks one host, four methods, and two bases —
`iris/v1`, and a **read-only** `/ci/api` carrying the four Xcode Cloud capabilities in none
of 4.4.1's schemas — a workflow's `post_actions`, compute usage against the plan, the
team's Developer Program standing including whether the PLA needs signing, and the thirteen
booleans saying what the session is permitted to do. Keep it that way. A third base, or a write on the
second, is an owner decision with a recording behind it, not an implementation detail.

The rule for deciding is that **duplication is a property of a call, not of a resource**. A
private read of an officially-available resource is retained only when it carries a field
the official specification has no schema for, and is then narrowed to exactly that field.
So do not delete a private read because its *resource* is official, and do not keep one
because the resource has a private *route*: check the fields. Last audited against Apple's
OpenAPI specification **4.4.1** (generated 2026-07-15, 966 paths, 1,393 schemas) on
2026-08-22. `docs/evidence.md` records what was checked, how, and when.

**The trade this makes, and why it is the intended one.** The official API authenticates
with a JWT signed by a `.p8` key an Account Holder generates. This client's premise is a
pasted cookie and no login step, so removing a capability Apple serves officially does not
relocate it for someone holding a session and no key — it withdraws it. That is deliberate.
A private route to a write Apple supports properly is unstable, unevidenced and unaudited
by Apple, and a client offering one becomes a way to avoid getting a key. The cookie is for
what no key can reach. When Apple later adds one of the capabilities still here, the
policy is to remove it here in favour of Apple's version — and to re-audit against the
current specification before acting, rather than trusting a comparison this file records.

## Non-negotiables

- Always check the [official App Store Connect API](https://developer.apple.com/app-store-connect/api/)
  and its [API reference](https://developer.apple.com/documentation/appstoreconnectapi/)
  before implementing something. We don't want to duplicate existing working implementations.
- If Apple exposes the underlying capability officially, it is out of scope here even when
  the private endpoint is more convenient or uses the existing cookie. Never add API-key
  authentication or reimplement Apple's public client here; point at the official API.
- Before a non-trivial change: inspect callers, implementations, analogous functions,
  tests, and user-facing CLI/docs; then audit → refactor for readiness → implement → verify.
- Do not add a dependency, new API convention, abstraction, command shape, request body,
  include list, or endpoint without explaining the evidence and getting approval.
- Treat the private Apple API as unstable. Browser-captured requests are evidence; guesses
  must be labelled in code, docs, and CLI behaviour. Never present an uncaptured write as proven.
- A browser recording under `tmp/` is evidence and may be read as evidence. What it must
  never do is leave: never print, copy, log, commit, or quote a cookie, `itctx`, CSRF value,
  bearer token, presigned upload URL, or anyone's personal details out of one, and never
  modify a capture. Read one through an extractor that emits methods, paths, query keys,
  status codes and response *key structure*, not raw entries.
- Keep all mutating HTTP calls routed through `request()` and preserve semantic plus
  transport audit records. Never weaken a confirmation or make `--yes` the default.
- Preserve stdout as data and stderr for logs/prompts. Logs are structured events with
  fields, and must not contain credentials or signed query strings.
- Prefer precise TypeScript types and fail-fast errors. Do not use `any`, silent catches,
  speculative compatibility branches, or duplicate helper logic to evade a design problem.
- For broad, risky, or externally observable changes, state the plan before editing.

## Canonical commands

- Install: `npm ci`
- Type check: `npm run typecheck`
- Test: `npm test`
- Build: `npm run build`
- Live CLI: `npm run asc -- <command>` (requires explicit human approval and a fresh local capture)

`npm test` runs `test/` on `node:test` — no dependency, and no network: `fetch` is replaced
and every fixture is invented. It covers the pure boundaries only — the transport's rules
about where a request may go and what counts as a write, redaction, JSON:API expansion,
capture parsing, date ordering — and says nothing about remote semantics. A green suite is
not evidence that a call Apple has never been sent works. Report the verification that
actually ran, and never make a live write to prove a change.

`test/gap-*.test.ts` is the fence around the capabilities Apple has no official equivalent
for: the request each one makes, and what this client reads back. **A test in those files
that needs editing while removing official-API overlap means the removal took something it
should not have.** Read a failure that way before reaching for the test.

## Routing

- General TypeScript and module-boundary conventions: `.claude/skills/typescript-conventions/`
- Any feature or bug fix: `.claude/skills/feature-workflow/`
- Apple API, writes, uploads, sessions, logging, or evidence: `.claude/skills/apple-api-safety/`
- Claude configuration work: `.claude/skills/claude-config-maintenance/`
- Detailed architecture and invariants: `.claude/references/architecture.md`

## Sensitive paths

- Never edit `tmp/`, `session.json`, `*.session.json`, browser recordings, or `.env*`, and
  never read `.env*` or a live cookie at all. A recording may be read for evidence under the
  redaction rule above.
- Do not edit `dist/`; it is generated by TypeScript.
- `src/http.ts`, `src/session.ts`, `src/curl.ts`, `src/log.ts`, and `src/confirm.ts` are
  security boundaries. Follow their scoped rules and require evidence for changes.
