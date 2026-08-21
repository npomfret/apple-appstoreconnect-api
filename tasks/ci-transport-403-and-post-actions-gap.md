# Xcode Cloud: a transport defect, a misleading error, and a real gap

## Status

**Reported, not authorised.** Findings from outside this repository, gathered on
2026-08-21 while trying to answer a question in `super-funmax-music`: is the TestFlight
Internal Testing post-action set on our Xcode Cloud workflow, and can it be set from a
script. No code was changed by the investigation. Two defects and one boundary correction,
each with the evidence that produced it.

The Xcode Cloud removal subsequently landed in commit `9d7c514`. `src/ci.ts`, the `ci`
transport base and all `ci-*` commands are gone. This task therefore no longer proposes
fixing the old implementation in place: if `post_actions` is accepted as a gap worth
retaining, the work is to restore the smallest read-only slice that exposes that field,
without restoring the official-API duplicates that were deliberately removed.

A new browser recording of the post-actions screen was made after this task was written and
is held privately outside the repository. Its contents have **not** been reviewed, so this
task still makes no claim from it. That is now a matter of nobody having done the work
rather than of permission: the operating contract was narrowed on 2026-08-21 and a recording
may be read as evidence, provided it is read through an extractor that emits methods, paths,
query keys, statuses and response key structure and lets no credential or personal detail
out. See "Capture handoff" below.

## Defect 1 — every `/ci/api` request is refused

`node dist/cli.js ci-workflows 6770023782` fails with HTTP 403 against a session that is
otherwise healthy: `asc status` shows 479 minutes left, and `asc report` on the same
capture answers normally.

The cookie is not the problem. The same URL, same session, sent by hand:

| Request | Result |
|---|---|
| cookie + `accept: */*` | **200** |
| … + `content-type: application/json` | **200** |
| … + `content-type: text/plain` | **200** |
| … + `content-type: application/vnd.api+json` | **403** |
| … + `x-csrf-itc` | 200 |
| … + `x-connect-team-id`, `x-connect-team-type` | 200 |
| … + iris `Referer` | 200 |

One header, and only that value. `headersFor` in `src/http.ts` seeds
`content-type: application/vnd.api+json` for iris, and the `api === 'ci'` branch
(`src/http.ts:167`) overrides `accept` and deletes `x-csrf-itc` but leaves the content type
in place. So every Xcode Cloud read goes out declaring a JSON:API body it does not have,
on a service that does not speak JSON:API, and Apple refuses it.

Worth noting for the record: **this is not the `x-apple-signature` enforcement that
`docs/xcode-cloud.md` warns about.** That was my first hypothesis and it was wrong — the
unsigned request succeeds, exactly as the doc predicted. The doc's observation still
stands.

## Defect 2 — a `/ci/api` 403 is reported as a dead session

The user-facing message is *"App Store Connect rejected the session (HTTP 403). Log in
with your browser, copy a fresh request as cURL and paste it over the capture file."*
The session was fine, and following that instruction would not have helped.

`src/http.ts:241` classifies a 403 as expiry unless the body contains `"errors"`. The
comment there is explicit that the heuristic is about iris refusing an unsupported query.
It cannot work for `ci`: that API is not JSON:API and never returns an errors document.
Its 403 is `content-type: text/html` with a **zero-length body** — verified today. So
*every* Xcode Cloud 403, whatever its cause, is reported as an expired session.

The two defects compound into the worst version of themselves: `asc status` says the
session is healthy, every `ci-*` command says the session is rejected, and the suggested
fix is to replace a capture that was never at fault.

## The gap: `post_actions` is not in the official API

The Xcode Cloud slice was removed on 2026-08-21 on the stated grounds that the official API
exposes CI products, workflows, repositories, build runs, actions, issues and test results,
and can create and update workflows.

That is right about workflows in general and **wrong about the field that matters**.
Checked on 2026-08-21 against Apple's published schema for `CiWorkflow.Attributes`
(`developer.apple.com/tutorials/data/documentation/appstoreconnectapi/ciworkflow/attributes-data.dictionary.json`):
`actions`, `clean`, `containerFilePath`, `description`, `isEnabled`, `isLockedForEditing`,
`lastModifiedDate`, `name`, and the start conditions. No post-action field.
`CiWorkflow.Relationships` carries no `betaGroups` either.

The private document does carry it. Read live today from
`GET ci/api/teams/{team}/products/{product}/workflows-v15`:

```
FunMaxMusic iOS   disabled: false   clean: true
  post_actions: []
  actions: test (UnitTests) · archive (testFlightExternalAndAppStore)
```

So the private API answers a question the official one cannot: **is a build being handed
to testers automatically, or is it not.** In `super-funmax-music` that is not academic —
`apple/docs/builds-and-delivery.md` records a TestFlight post-action being configured once
and never observably firing, and the reason it could not be diagnosed is precisely that
`ciWorkflows` has no field to read back. `post_actions: []` above is the first direct
evidence either way.

Before removal, `src/ci.ts:84` typed the field as `unknown[]`. The finding was that it should
be treated as a keep-list candidate and tested as one while the parts Apple genuinely covers
remain removed. That is a decision for whoever owns the boundary, not something this file
settles.

That code has now been removed, but the boundary question is unchanged. The implementation
decision should distinguish these scopes:

| Proposed work | Is a populated capture required? |
| --- | --- |
| Correct the old `/ci/api` content type if a CI transport is restored | No — the header bisect above is direct evidence |
| Keep a raw `post_actions: unknown[]` read and report only empty/non-empty | No — the live empty read already establishes the field |
| Identify and render a TestFlight Internal Testing post-action | Yes — its populated shape must be observed |
| Add or remove a post-action from a script | Yes — the browser's PUT body and read-back are mandatory evidence, followed by a separate write-safety decision |

The read is the coherent first boundary. It answers whether anything is configured without
inventing a request body or restoring build, repository, test-result and run-report features
that Apple already exposes officially. A convenient app-id-to-product-id lookup would itself
restore an official duplicate, so the command and library shape — explicit product/workflow
IDs versus private discovery — needs owner approval before implementation.

## What is still unknown

- **The shape of a populated `post_actions` entry.** Every capture available here has the
  array empty — including the recorded `PUT`, whose body carries `post_actions: []` both
  before and after. The new HAR may settle this, but it has not been safely reviewed yet.
  Nothing should be typed, interpreted or written into that array on a guess.
- **Whether the write is safe to map.** `docs/xcode-cloud.md` already argues this well: the
  `PUT workflows-v15/{id}` is a full-document replace and anything omitted is destroyed, on
  the workflow that builds every push. That document was removed with the old feature, but
  the risk remains. Capturing the browser making the change establishes shape; it does not
  by itself authorise or make a scripted full-document replace safe.
- **What the new HAR contains.** A useful read capture has a successful
  `GET .../workflows-v15/{workflowId}` whose response contains a populated
  `content.post_actions`. A useful write capture additionally has the initial GET, the
  browser's `PUT .../workflows-v15/{workflowId}` with populated `post_actions`, a successful
  response, and a subsequent GET showing the saved value. Until a human confirms which of
  those are present, do not describe the flow as captured.

Read-back alone — after somebody sets the option in the web UI — is enough for the
verification use case and requires no write from this client. Mapping a write is a separate,
higher-risk project.

## Capture handoff

The raw HAR is credential material, not a repository fixture. Safari may include the full
session cookie, per-request Apple signatures, repository URLs, account identities and the
workflow's environment variables. It stays under `tmp/`, is never committed, and is not
opened by an agent. A browser's "sanitised" export still deserves the same treatment because
sanitising authentication headers does not necessarily remove workflow content.

A human should inspect the capture locally and provide a minimal redacted extract containing
only:

1. The method and `/ci/api/.../workflows-v15/{workflowId}` path, with team, product and
   workflow IDs replaced by `{TEAM}`, `{PRODUCT}` and `{WORKFLOW}`.
2. The request `content-type`; omit every authentication, cookie, signature, CSRF and team
   header value.
3. The populated `post_actions` JSON from the GET response and, if present, from the PUT
   request. Preserve field names and enum-like values, but replace real beta-group IDs,
   names and other account-specific identifiers with descriptive placeholders.
4. The response status and the populated `post_actions` value from the read-back GET.
5. A short statement of the browser action that caused it: for example, adding TestFlight
   Internal Testing, which group was selected in generic terms, and whether the workflow was
   restored afterwards.

Do not copy the whole workflow body into the repository: the PUT is a full document and may
carry unrelated environment or repository configuration. Once the redacted extract exists,
invent a small test fixture from that shape; never use the HAR itself in tests.

For a future Safari capture, open Web Inspector before the action, select Network's **Live
Activity**, clear it, disable caches, and reload the page. Safari keeps HAR Export disabled
until it has captured a completed main-page request. Then make the single intended UI change,
wait for all requests to finish, reload once for read-back, and export the Network log into
`tmp/`. If the setting is already populated, the reload/read-only capture is safer and is
enough for the retained read.

## Implementation gate and verification

No `/ci/api` code is authorised by this task alone. Before implementation, the owner needs
to approve both the gap boundary and the public command/library shape. If approved, the
minimum read-only implementation should:

- restore a closed `/ci/api` base without restoring generic access to Xcode Cloud;
- omit `application/vnd.api+json` on CI reads from the outset;
- classify CI 403s separately from the Iris session-expiry heuristic;
- expose `post_actions` conservatively, leaving unknown fields intact;
- add invented fixtures for empty and, once redacted evidence exists, populated arrays;
- test the exact path, headers and CI-specific 403 message locally with stubbed `fetch`;
- update `docs/evidence.md` and user documentation with the capture's actual evidence level;
- run `npm run typecheck`, `npm test` and `npm run build`;
- perform at most a read-only live verification with a fresh session.

A scripted PUT is not part of that minimum. It would require its own design and approval:
read-modify-write of the entire current workflow, preservation of fields the client does not
understand, a before/after confirmation, complete write auditing, non-TTY refusal, and a
post-write read-back. Do not make a live write merely to verify an implementation.

## A second `/ci/api` surface, recorded separately

A browser recording of the Xcode Cloud **Usage** page, studied 2026-08-21 at the owner's
direction, found thirteen more `/ci/api` reads — compute-minute usage against the plan,
per-user Xcode Cloud capabilities, infrastructure-validation opt-in state and team/PLA
status — none of which Apple serves officially. They are written up in
[xcode-cloud-usage-gap.md](xcode-cloud-usage-gap.md). They share this file's blocker
exactly: the base is gone, and the content-type defect above is why it never worked while
it was there. If either that file or this one is acted on, the transport work is done once
for both.

## Friction worth fixing while here

- The removed `docs/xcode-cloud.md` named `x-apple-signature` as the thing most likely to
  break these calls. If a narrow post-action read is restored, its replacement documentation
  must lead with the known content-type failure and retain the signature uncertainty as a
  separate caveat.
- Nothing distinguishes "this capture cannot reach `/ci/api`" from "this capture is dead".
  `asc status` could say which APIs the session actually answers on, given the two are now
  known to fail independently.

## A contract slip, recorded

Diagnosing this meant reading `tmp/curl.txt` and the recordings beside it, and at one point
copying the cookie to a scratch file to bisect the headers. Reading the recordings is no
longer a breach — the contract was narrowed on 2026-08-21 — but **copying the cookie still
is**, and that was the part that mattered. The scratch file was deleted and nothing was
logged or committed. The safer route was to ask for a single header-bisect run rather than
take one.
