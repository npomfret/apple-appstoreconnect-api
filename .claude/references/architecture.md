# Architecture map and durable invariants

## Product boundary

The project is a reusable TypeScript client for App Store Connect across many apps.
Documented capabilities belong on the official API transport; undocumented gaps belong on
the private Iris or Xcode Cloud transport. The first official operation is storefront
availability. Almost everything on the private side is about an app or one of its Xcode Cloud products. The
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
serves officially is out of scope for the *private* transports, however convenient their
routes. Official calls use a `.p8`-signed JWT; private calls reuse a short-lived browser
session captured locally. The two credentials never share a transport or host. The private
service may change without notice, and write evidence varies by operation;
`docs/evidence.md` is the source of truth.

## Directory layout

`src/` is divided by credential, and a module's directory is a claim about which one it may
hold:

| Directory | Credential | Admits |
| --- | --- | --- |
| `src/official/` | JWT signed by a `.p8` | Anything Apple documents, and the convenience wrappers folding several official calls into one answer. New capabilities go here. |
| `src/gap/` | browser session cookie | Only what Apple serves nowhere else. A module here asserts a gap, checked field by field against the current specification. |
| `src/shared/` | none | What neither credential touches. Reachable from both sides at once, so a module that holds a credential or sends a request is disqualified. |
| `src/accounts.ts`, `src/cli.ts`, `src/index.ts` | — | Composition. The only modules that may import all three. `accounts.ts` is the one place both credentials are named, and it names them only: it resolves paths and never reads what is at the end of one. |

`official/` and `gap/` may not import each other in either direction, and `shared/` may
import neither. `test/module-boundary.test.ts` reads the import graph off disk and fails on
any crossing, which is what makes this a boundary rather than a convention: the guarantee
was previously a docblock in `official/client.ts` saying the transports are deliberately
separate, above an import of the other transport. `src/index.ts` exports the three as
namespaces, so a library import states which credential it commits the caller to.

A capability moves `gap/` → `official/` when Apple publishes an equivalent, never the other
way.

## Module ownership

| Area | Canonical location | Invariant |
| --- | --- | --- |
| Official API credentials and GET transport | `official/client.ts` | Issuer, key and key path are runtime inputs with no account-specific defaults. JWTs go only to `api.appstoreconnect.apple.com`; the public interface exposes GET and no write method. Tokens are minted on demand and re-minted before expiry, so lifetime never bounds a run. |
| Official storefront availability | `official/availability.ts` | App IDs are explicit or resolved from a bundle ID; all territory rows are parsed, a paged response is refused rather than under-reported, and storefront state comes from the enumerated 4.4.1 `contentStatuses` union — worst status wins, unrecognised values are reported as unknown rather than bucketed, and Apple's strings are kept verbatim. |
| Session capture and expiry | `gap/curl.ts`, `gap/session.ts` | Capture content is a credential and is never persisted, logged, or exposed. `CURL_PATH` is the built-in default only; which capture a run uses is decided in `accounts.ts` and passed in, so the precedence rule exists once. |
| Which account a command is about | `accounts.ts` | Resolves *locations*, never contents: an issuer id, a key id, a path to a `.p8`, a path to a capture. Nothing here signs, sends, or parses a credential, which is what lets one module sit above both authentication systems — asserted in `test/accounts.test.ts`. Precedence is explicit, then ambient, then configured, identically for both credentials: `--account`, then the environment, then the default account. The three official environment variables are all-or-nothing, because completing a partial set from the file would sign one account's requests with another account's key. A named account missing the field a command needs is an error naming the account and the field, never a fall-through to another account's credentials. `defaultAccount` is required once there is more than one account, since choosing would choose whose App Store data a write lands on. An unrecognised key in an account block is refused rather than ignored, being a misspelling of one of the four that matter. |
| Authenticated requests and uploads | `gap/http.ts` | All ordinary writes are audited; a path is checked as the URL it *resolves* to and refused unless that is under the base of the `Api` it was given (`IRIS` = `iris/v1`, or the read-only `CI` = `/ci/api`, both on the one host), so neither an absolute URL nor a path that climbs out of a base carries session headers anywhere else; a base marked `readOnly` refuses any method but `GET` before a request is built; media types, 403 classification and page shape belong to the `Api` rather than to a caller or a capture; upload URLs never receive session headers. |
| JSON:API expansion | `shared/jsonapi.ts` | Relationship joining happens here, not ad hoc in command code. |
| Query encoding | `shared/query.ts` | Apple's literal brackets and commas are preserved on both hosts; shared because the dialect is the same either side and nothing here knows which credential the request will carry. |
| Refusals | `shared/errors.ts` | `ApiError` scrubs the response body once, at construction, because a refusal is the one response that reaches an exception message the CLI prints. Shared so that guarantee cannot exist in two copies and drift. |
| Apple resources and mutations | `gap/api.ts` | Include/query shapes follow browser evidence and resource functions remain transport-focused. |
| Xcode Cloud `post_actions`, compute usage, team standing, session capabilities and infrastructure validation | `gap/ci.ts` | The only non-iris module and the only caller of the `CI` base: reads only, ids validated as single path segments, the team id taken from the session rather than discovered, and no lookup that would duplicate `ciProducts` or `betaGroups`. Figures Apple sends are passed through, never reconciled: the plan window and the usage window are different windows and are never summed, and `program_state` is never compared against a literal. A value Apple was expected to send and did not is an error, never a default — a missing allowance is not zero, a missing `wwdr_pla_needs_signing` is not `false`, and a missing capability is neither granted nor withheld. The capability field set is closed at the thirteen recorded and derived from a single table of wire keys, so what the response is read with and what the type declares cannot drift apart. A row is dropped only where a dropped row is a gap rather than an answer: `fetchUsage` skips a usage row it cannot read, and nothing else here skips anything. An opt-in row without a usable `opt_in`, a post-action without an id, a workflow without an id, a `content` block, a `disabled` or a `post_actions` list are all refused, because each one dropped would read back as an answer — a product that is not opted in, or a workflow that hands no build on. Additive change is tolerated where subtractive change is not: an unrecognised key on a post-action is reported by name rather than refused. |
| CLI and confirmations | `cli.ts`, `shared/confirm.ts` | stdout is data; destructive/irreversible actions preview and refuse without TTY or `--yes`. |
| Structured redacted logging | `shared/log.ts` | Audit records cannot be disabled; sensitive values are scrubbed. |
| Digests and rendering | `gap/report.ts` | Convert denormalized resources into stable useful summaries. A digest never suppresses a row it holds: an early return that prints a summary instead of the rows is only permitted where the rows cannot contradict it, which is why `formatPrivacy` prints "collects no data" alone only when the marker row is the whole declaration and reports the contradiction otherwise. A row is likewise never dropped for a missing *label*, only for a missing identity, and a missing identity is refused rather than dropped: `collectAttachments` lists a file iris gave no name and throws on one it gave no id, since either one skipped would shorten a count that is the answer, and `collectGuidelines` reads the same way over a rejection reason — a reason with no description is listed, and one naming neither a code nor a section, like a rejection carrying no `reasons` list at all, is refused rather than skipped, because the block is printed only when it has rows and a skipped reason is a rejection that reads as citing nothing. `--json` and the rendered digest are two views of one read and must not answer differently. |

## Safety invariants

- `.p8` keys, official bearer tokens, `tmp/curl.txt`, browser recordings, cookies, `itctx`, CSRF values, and presigned URL
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
  object-storage URL without session authentication. Being outside `request()` put it
  outside `apiUrl` too, so until 2026-08-22 it was the one call here that fetched whatever
  URL it was handed; `uploadTarget` now decides the destination on the parsed URL, before the
  audit record and before any bytes are read. Storage is matched as a **suffix** of
  `object-storage.apple.com`, because Apple presigns a region under it and the flat name
  three documents gave is one no recording contains.
- A response can reveal reviewer credentials or signed URLs. Redaction is part of every
  observability and rendering decision.

## Verification reality

The repository has TypeScript compilation and `npm test`: `node:test` over `test/`, with no
dependency and no network — `fetch` is replaced and every fixture is invented. It asserts
the pure boundaries, including official JWT shape and host isolation, private-session host
isolation, redaction, parsing and report logic. Neither compilation nor a green suite says
anything about remote semantics. Never test a private live write merely to prove a code
change; use official schema or browser-capture evidence, dry-run paths, a stubbed transport,
and explicit human approval for live operations.
