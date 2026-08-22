# Architecture map and durable invariants

## Product boundary

The project is an unofficial TypeScript client for the parts of App Store Connect that
Apple's official API does not serve — principally the private Iris Resolution Center
surface. Almost everything mapped is about an app or one of its Xcode Cloud products. The
exceptions are the four Xcode Cloud team reads — compute usage, the team's Developer
Program standing, what the session is permitted to do, and the infrastructure-validation
opt-in — which describe the account rather than an app. That boundary was crossed
deliberately on 2026-08-22, four times and each time on its own evidence, because an
allowance, a reset date, an unsigned Program License Agreement, a resolved permission and a
pre-release-toolchain switch have no per-app form and no official equivalent at all.

It does not follow that account-wide state is now open, and the third of those reads is the
one that shows where the remaining line is. `user-capabilities` is named for a user and is
**not** a person-scoped read: its whole response is thirteen booleans, with no name, no
email address, no user id and no role, so it says what the captured cookie may do without
saying anything about who holds it. A read that returned any of those would be a separate
decision again — the People page went with the invitations slice and has not come back, and
`olympus/v1/actors` is still declined for exactly the personal details this one does not
carry. The test for the next such call is the response, not the path it arrives on. Anything Apple
serves officially is out of scope, however convenient the private route. It reuses a
short-lived browser session captured locally, and is both a CLI (`asc`) and a library. The
private service may change without notice, and write evidence varies by operation;
`docs/evidence.md` is the source of truth.

## Module ownership

| Area | Canonical location | Invariant |
| --- | --- | --- |
| Session capture and expiry | `curl.ts`, `session.ts` | Capture content is a credential and is never persisted, logged, or exposed. |
| Authenticated requests and uploads | `http.ts` | All ordinary writes are audited; a path is checked as the URL it *resolves* to and refused unless that is under the base of the `Api` it was given (`IRIS` = `iris/v1`, or the read-only `CI` = `/ci/api`, both on the one host), so neither an absolute URL nor a path that climbs out of a base carries session headers anywhere else; a base marked `readOnly` refuses any method but `GET` before a request is built; media types, 403 classification and page shape belong to the `Api` rather than to a caller or a capture; upload URLs never receive session headers. |
| JSON:API expansion | `jsonapi.ts` | Relationship joining happens here, not ad hoc in command code. |
| Apple resources and mutations | `api.ts` | Include/query shapes follow browser evidence and resource functions remain transport-focused. |
| Xcode Cloud `post_actions`, compute usage, team standing, session capabilities and infrastructure validation | `ci.ts` | The only non-iris module and the only caller of the `CI` base: reads only, ids validated as single path segments, the team id taken from the session rather than discovered, and no lookup that would duplicate `ciProducts` or `betaGroups`. Figures Apple sends are passed through, never reconciled: the plan window and the usage window are different windows and are never summed, and `program_state` is never compared against a literal. A value Apple was expected to send and did not is an error, never a default — a missing allowance is not zero, a missing `wwdr_pla_needs_signing` is not `false`, and a missing capability is neither granted nor withheld. The capability field set is closed at the thirteen recorded and derived from a single table of wire keys, so what the response is read with and what the type declares cannot drift apart. An opt-in row Apple sends without a usable `opt_in` is refused rather than dropped, because a dropped row would read as a product that is not opted in. |
| CLI and confirmations | `cli.ts`, `confirm.ts` | stdout is data; destructive/irreversible actions preview and refuse without TTY or `--yes`. |
| Structured redacted logging | `log.ts` | Audit records cannot be disabled; sensitive values are scrubbed. |
| Digests and rendering | `report.ts` | Convert denormalized resources into stable useful summaries. |

## Safety invariants

- `tmp/curl.txt`, browser recordings, cookies, `itctx`, CSRF values, and presigned URL
  queries are credentials. A recording may be read as evidence through an extractor that
  emits methods, paths, query keys, status codes and response key structure; no credential
  or personal detail may ever leave one, and a capture is never modified. Never read a live
  cookie or `.env*` at all.
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
