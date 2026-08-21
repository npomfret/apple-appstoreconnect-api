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

A browser recording of the post-actions screen was made after this task was written, is held
privately outside the repository, and **was read here on 2026-08-21** through an extractor.
It turned out to be a write capture, in both directions, with read-backs. What it establishes
is in "What the recording settled" below.

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

That is right about workflows in general and **wrong about the field that matters**. The
check that settles it is against the 4.4.1 document itself and is under "What the recording
settled" below. The weaker check this file originally carried — against Apple's published
`CiWorkflow.Attributes` page — has been superseded by it and is not repeated here.

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

That code has now been removed, but the boundary question is unchanged. This table used to
sort the scopes by whether a populated capture was needed; the recording answered that for
every row, so the column now says what each would still have to settle:

| Proposed work | What it still waits on |
| --- | --- |
| Correct the old `/ci/api` content type if a CI transport is restored | Owner approval |
| Keep a raw `post_actions: unknown[]` read and report only empty/non-empty | Owner approval |
| Identify and render a TestFlight Internal Testing post-action | Owner approval |
| Add or remove a post-action from a script | A write design of its own, on top of that |

The read is the coherent first boundary. It answers whether anything is configured without
inventing a request body or restoring build, repository, test-result and run-report features
that Apple already exposes officially. A convenient app-id-to-product-id lookup would itself
restore an official duplicate, so the command and library shape — explicit product/workflow
IDs versus private discovery — needs owner approval before implementation.

## What the recording settled

Read on 2026-08-21 through an extractor emitting methods, redacted paths, query keys, statuses
and response key structure. No header, cookie, signature or CSRF value was read or printed.
Identifiers, the post-action's own display name and the beta group's name were reduced to their
types inside the extractor and never came out of it. 43 entries, of which 22 are `/ci/api`.

**A populated `post_actions` entry**, identical in the `PUT` request body and in the GET that
read it back:

```
post_actions: [
  {
    id:    <uuid>,
    name:  <display string, author-supplied>,
    type:  "testFlight_internal",
    deployment_config: {
      archive_action_id: <uuid of an action in this workflow's own actions>,
      testflight_deployment_ids: {
        beta_group_ids:  [<uuid>],
        beta_tester_ids: []
      }
    }
  }
]
```

`type` is `testFlight_internal` exactly — mixed case, which is worth writing down because it
is not the convention the surrounding document uses and a plausible guess would have been
wrong. `archive_action_id` refers to the archive action in the same workflow, so a
post-action hangs off a build step rather than off the workflow as a whole. Groups and
individual testers are separate lists; this capture populated only the first.

**Both directions of the write are recorded**, and neither is inferred. The workflow already
had the post-action; the browser took it off and put it back 23 seconds later:

| | request | response |
| --- | --- | --- |
| GET | — | populated |
| `PUT` | `post_actions: []` | empty |
| `PUT` | one entry | populated |
| GET | — | populated |

Both `PUT`s answered **200** and the workflow was left as it was found. So removal and
addition each have a request body and a read-back behind them, which is what the two table
rows above were waiting for.

**The `PUT` is a full-document replace, confirmed rather than assumed.** Its body carries
fourteen top-level keys — `actions`, `clean`, `container_file_path`, `description`,
`disabled`, `environment_variables`, `locked`, `macos_version`, `name`, `post_actions`,
`product_environment_variables`, `repo`, `start_conditions`, `xcode_version` — so what a
client fails to send back is what the workflow loses, including both environment-variable
collections. Its request content type is `application/json`, which is the finding above
holding on a write.

**Resolving a beta group is not a gap.** The browser turned the chosen group into the uuid in
`beta_group_ids` with `GET /ci/api/teams/{TEAM}/testflight/groups` and
`POST .../testflight/groups/search`, both returning `items[] {id, name, count, html_url,
is_internal_group}`. Apple serves that officially: `/v1/betaGroups` in 4.4.1 carries `name`
and `isInternalGroup`, so anything needing the id has an official way to get it and this pair
stays out.

**The field-level gap holds.** Re-checked the same day against the 4.4.1 document itself
rather than the published attributes page: `post_action`, `postAction`, `deployment_config`,
`archive_action_id` and `testFlight_internal` occur **zero** times across its 966 paths and
1,393 schemas, and `CiWorkflow` has no post-action attribute and no `betaGroups`
relationship — its relationships are `buildRuns`, `macOsVersion`, `product`, `repository` and
`xcodeVersion`.

## What is still unknown

- **Whether the write is safe to map.** The one question here that no further recording can
  answer, and this one makes it sharper rather than settling it: the removed
  `docs/xcode-cloud.md` argued that `PUT workflows-v15/{id}` destroys anything omitted, and
  the fourteen-key body above is that argument in evidence, on the workflow that builds every
  push. Having watched the browser do it authorises nothing. A scripted replace still needs
  its own design, and read-modify-write of a document this client only partly understands is
  the whole difficulty.
- **Whether any other `type` exists.** Only `testFlight_internal` was observed. The name of
  the value implies at least an external counterpart, but implying is not observing, and
  nothing should accept or emit a second value on the strength of the first one's spelling.
- **Whether `beta_tester_ids` behaves like `beta_group_ids`.** It was present and empty
  throughout. Nothing here shows what a populated one looks like or whether the two combine.

Read-back alone — after somebody sets the option in the web UI — is enough for the
verification use case and requires no write from this client. Mapping a write is a separate,
higher-risk project.

## Handling the recording

Kept because it governs the recording that is still on disk, and any later one.

It is credential material, not a repository fixture. Safari may include the full session
cookie, per-request Apple signatures, repository URLs, account identities and the workflow's
environment variables. It stays under `tmp/` and is never committed, and a "sanitised" export
deserves the same treatment, since sanitising authentication headers does not necessarily
remove workflow content.

Reading it here means an extractor that emits methods, redacted paths, query keys, statuses
and response key structure, and lets no credential or personal detail out — the way it was
read above, and the way the Usage page recording was read for
[xcode-cloud-usage-gap.md](xcode-cloud-usage-gap.md). Not the whole workflow body: the `PUT`
is a full document carrying unrelated environment and repository configuration. Invent a
small test fixture from the shape above; never use the recording itself in a test.

## Implementation gate and verification

No `/ci/api` code is authorised by this task alone. Before implementation, the owner needs
to approve both the gap boundary and the public command/library shape. If approved, the
minimum read-only implementation should:

- restore a closed `/ci/api` base without restoring generic access to Xcode Cloud;
- omit `application/vnd.api+json` on CI reads from the outset;
- classify CI 403s separately from the Iris session-expiry heuristic;
- expose `post_actions` conservatively, leaving unknown fields intact;
- add invented fixtures for both the empty and the populated array, from the shape above;
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

