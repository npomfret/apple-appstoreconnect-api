# Architecture map and durable invariants

## Product boundary

The project is an unofficial TypeScript client for App Store Connect's private Iris review
API. It reuses a short-lived browser session captured locally. It is both a CLI (`asc`) and
a library. The private service may change without notice, and write evidence varies by
operation; `docs/evidence.md` is the source of truth.

## Module ownership

| Area | Canonical location | Invariant |
| --- | --- | --- |
| Session capture and expiry | `curl.ts`, `session.ts` | Capture content is a credential and is never persisted, logged, or exposed. |
| Authenticated requests and uploads | `http.ts` | All ordinary writes are audited; upload URLs never receive session headers. |
| JSON:API expansion | `jsonapi.ts` | Relationship joining happens here, not ad hoc in command code. |
| Apple resources and mutations | `api.ts` | Include/query shapes follow browser evidence and resource functions remain transport-focused. |
| CLI and confirmations | `cli.ts`, `confirm.ts` | stdout is data; destructive/irreversible actions preview and refuse without TTY or `--yes`. |
| Structured redacted logging | `log.ts` | Audit records cannot be disabled; sensitive values are scrubbed. |
| Digests and rendering | `report.ts` | Convert denormalized resources into stable useful summaries. |
| Screenshot local checks | `screenshots.ts` | Incomplete display-size knowledge must not reject a valid asset by guessing. |

## Safety invariants

- `tmp/curl.txt`, HAR files, cookies, `itctx`, CSRF values, and presigned URL queries are
  credentials. Do not read or handle them in agent work.
- Browser captures establish request evidence. Keep captured and probe-only operations
  distinct; update `docs/evidence.md` whenever that classification changes.
- `request()` is the audit choke point for mutations. Do not bypass it for Iris writes.
- The only permitted exception is `uploadPart()`, which intentionally targets a presigned
  object-storage URL without session authentication.
- A response can reveal reviewer credentials or signed URLs. Redaction is part of every
  observability and rendering decision.

## Verification reality

The repository currently has TypeScript compilation but no automated tests. Compile checks
cover types, not remote semantics. Never test a private live write merely to prove a code
change; use browser capture evidence, dry-run paths, pure-function tests once a test
framework is approved, and explicit human approval for live operations.
