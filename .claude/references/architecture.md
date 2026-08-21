# Architecture map and durable invariants

## Product boundary

The project is an unofficial TypeScript client for App Store Connect's private Iris review
API. Everything mapped is about an app: the People page's invitations were the one
account-wide corner, and they were removed with slice 4.2. It reuses a short-lived browser
session captured locally. It is both a CLI (`asc`) and
a library. The private service may change without notice, and write evidence varies by
operation; `docs/evidence.md` is the source of truth.

## Module ownership

| Area | Canonical location | Invariant |
| --- | --- | --- |
| Session capture and expiry | `curl.ts`, `session.ts` | Capture content is a credential and is never persisted, logged, or exposed. |
| Authenticated requests and uploads | `http.ts` | All ordinary writes are audited; paths are relative to a closed set of bases on the one host — Iris only, since the Xcode Cloud slice was removed — and an absolute URL is refused, so session headers reach no other host; upload URLs never receive session headers. |
| JSON:API expansion | `jsonapi.ts` | Relationship joining happens here, not ad hoc in command code. |
| Apple resources and mutations | `api.ts` | Include/query shapes follow browser evidence and resource functions remain transport-focused. |
| CLI and confirmations | `cli.ts`, `confirm.ts` | stdout is data; destructive/irreversible actions preview and refuse without TTY or `--yes`. |
| Structured redacted logging | `log.ts` | Audit records cannot be disabled; sensitive values are scrubbed. |
| Digests and rendering | `report.ts` | Convert denormalized resources into stable useful summaries. |

## Safety invariants

- `tmp/curl.txt`, HAR files, cookies, `itctx`, CSRF values, and presigned URL queries are
  credentials. Do not read or handle them in agent work.
- Browser captures establish request evidence. Keep captured and probe-only operations
  distinct; update `docs/evidence.md` whenever that classification changes.
- `request()` is the audit choke point for mutations. Do not bypass it for Iris writes.
- Whether a request mutates is decided once, from a normalised method, and passed to both
  the headers and the audit record. Do not re-derive it from a caller's string.
- The only permitted exception is `uploadPart()`, which intentionally targets a presigned
  object-storage URL without session authentication.
- A response can reveal reviewer credentials or signed URLs. Redaction is part of every
  observability and rendering decision.

## Verification reality

The repository has TypeScript compilation and `npm test`: `node:test` over `test/`, with no
dependency and no network — `fetch` is replaced and every fixture is invented, including the
cookie-shaped strings. It asserts the pure boundaries (where a request may go, what counts
as a write, redaction, JSON:API expansion, capture parsing, date ordering), which is all a
local test can reach. Neither compilation nor a green suite says anything about remote
semantics. Never test a private live write merely to prove a code change; use browser
capture evidence, dry-run paths, a stubbed transport, and explicit human approval for live
operations.
