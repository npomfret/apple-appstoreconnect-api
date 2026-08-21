# Xcode Cloud `post_actions` — a field with no official schema

## Status

**Reported, not authorised.** Found on 2026-08-21 while trying to answer a question in
`super-funmax-music`: is the TestFlight Internal Testing post-action set on our Xcode Cloud
workflow, and can it be set from a script.

The Xcode Cloud slice went in `9d7c514` and the second transport base with it in `1e671dc`:
`src/ci.ts`, the `ci` base and every `ci-*` command are gone. So nothing here proposes
fixing an implementation in place. If `post_actions` is accepted as a gap worth retaining,
the work is to restore the smallest read-only slice that exposes that one field, without
restoring the official-API duplicates that were deliberately removed.

A browser recording of the post-actions screen was made after this task was written and is
held privately outside the repository. Its contents have **not** been read, so nothing here
is claimed from it — that is nobody having done the work, not a rule against it. See
"Reading the capture" below.

## What a restored transport must not repeat

Two things were established by hand against a healthy session on 2026-08-21, while the slice
was still there. Neither is a live defect — there is no `/ci/api` code left to be wrong — but
both are the direct evidence a restoration would otherwise have to gather again, and between
them they are why every `ci-*` command in this repository was refused for its whole life.

**`/ci/api` does not speak JSON:API, and answers a request that claims to with a 403.** Same
URL, same session, one header varied:

| Request | Result |
|---|---|
| cookie + `accept: */*` | **200** |
| … + `content-type: application/json` | **200** |
| … + `content-type: text/plain` | **200** |
| … + `content-type: application/vnd.api+json` | **403** |
| … + `x-csrf-itc` | 200 |
| … + `x-connect-team-id`, `x-connect-team-type` | 200 |
| … + iris `Referer` | 200 |

One header, and only that value. This is **not** the `x-apple-signature` enforcement the
removed `docs/xcode-cloud.md` warned about — that was the first hypothesis and it was wrong,
since the unsigned request succeeds exactly as that document predicted. Its observation
stands; a replacement document should lead with the content type and keep the signature as a
separate caveat.

**A `/ci/api` 403 cannot be classified the way an iris one is.** `src/http.ts` reads a 403 as
an expired session unless the body carries a JSON:API errors document, which works because
that is how iris refuses a query it doesn't support. `/ci/api` is not JSON:API and never
returns one: its 403 is `content-type: text/html` with a zero-length body. A restored base
needs its own rule, or every Xcode Cloud 403 reports a dead session — while `asc status`, on
the same capture, says the session is healthy and has hours left.

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
  before and after. The recording made since may settle it; nobody has read it yet.
  Nothing should be typed, interpreted or written into that array on a guess.
- **Whether the write is safe to map.** `docs/xcode-cloud.md` already argues this well: the
  `PUT workflows-v15/{id}` is a full-document replace and anything omitted is destroyed, on
  the workflow that builds every push. That document was removed with the old feature, but
  the risk remains. Capturing the browser making the change establishes shape; it does not
  by itself authorise or make a scripted full-document replace safe.
- **What the recording contains.** A useful read capture has a successful
  `GET .../workflows-v15/{workflowId}` whose response contains a populated
  `content.post_actions`. A useful write capture additionally has the initial GET, the
  browser's `PUT .../workflows-v15/{workflowId}` with populated `post_actions`, a successful
  response, and a subsequent GET showing the saved value. Until a human confirms which of
  those are present, do not describe the flow as captured.

Read-back alone — after somebody sets the option in the web UI — is enough for the
verification use case and requires no write from this client. Mapping a write is a separate,
higher-risk project.

## Reading the capture

The recording is credential material, not a repository fixture. Safari may include the full
session cookie, per-request Apple signatures, repository URLs, account identities and the
workflow's environment variables. It stays under `tmp/` and is never committed, and a
"sanitised" export deserves the same treatment, since sanitising authentication headers does
not necessarily remove workflow content.

It may be read here, through an extractor that emits methods, paths, query keys, statuses and
response key structure and lets no credential or personal detail out — the way the Usage page
recording was read for [xcode-cloud-usage-gap.md](xcode-cloud-usage-gap.md). What to take out
of it:

1. The method and `/ci/api/.../workflows-v15/{workflowId}` path, with team, product and
   workflow IDs replaced by `{TEAM}`, `{PRODUCT}` and `{WORKFLOW}`.
2. The request `content-type`; no authentication, cookie, signature, CSRF or team header
   value.
3. The populated `post_actions` structure from the GET response and, if present, from the PUT
   request. Field names and enum-like values are the point; real beta-group IDs, names and
   other account-specific identifiers become descriptive placeholders.
4. The response status and the populated `post_actions` value from the read-back GET.
5. What the browser was doing: for example, adding TestFlight Internal Testing, which group
   was selected in generic terms, and whether the workflow was restored afterwards.

Not the whole workflow body: the PUT is a full document and may carry unrelated environment
or repository configuration. Invent a small test fixture from the shape; never use the
recording itself in a test.

The write is still unrecorded, so a second capture is still wanted. Open Web Inspector before
the action, select Network's **Live Activity**, clear it, disable caches, and reload the page;
Safari keeps its export disabled until it has captured a completed main-page request. Then
make the single intended UI change, wait for all requests to finish, reload once for
read-back, and export the Network log into `tmp/`. If the setting is already populated, the
reload-only capture is safer and is enough for the retained read.

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
- update `docs/evidence.md` and user documentation with the capture's actual evidence level,
  leading with the content-type failure above rather than the signature caveat;
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
exactly: the base is gone, and the content type above is why it never worked while it was
there. If either that file or this one is acted on, the transport work is done once for
both.

