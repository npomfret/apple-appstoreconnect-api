# Xcode Cloud

> **Legacy official overlap:** Apple officially exposes CI products, workflows,
> repositories, build runs, actions, issues, test results and artifacts. The private
> `/ci/api` implementation on this page — including the run-detail commands — is
> pending removal under
> [remove-official-api-overlap.md](../tasks/remove-official-api-overlap.md). Do not extend
> it. This page documents the current working tree only. Use Apple's official
> [Xcode Cloud Workflows and Builds API](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds)
> instead.

The Xcode Cloud tab is a **different API**. Everything else this client talks to is
`iris/v1`: JSON:API documents, `include`, `fields[…]`, `meta.paging`. Xcode Cloud lives at
`/ci/api` on the same host and shares none of that — plain JSON objects, snake_case field
names, pages that come back as `{ "items": [...] }`. It is a separate module (`src/ci.ts`)
for that reason, and nothing in `api.ts` is reused.

What it does share is the cookie. Same session, same capture file, no extra setup.

## Commands

```sh
node dist/cli.js ci-product          # the product UUID for an app — every other command needs it
node dist/cli.js ci-workflows        # every workflow, with its full definition
node dist/cli.js ci-workflow <id>    # one workflow, and who last changed it when
node dist/cli.js ci-builds           # recent runs: state, progress, failures, the commit
node dist/cli.js ci-repos            # which git repos Xcode Cloud can reach
node dist/cli.js ci-capabilities     # what this account is allowed to change here
node dist/cli.js ci-build [buildId]  # one build and its executed stages
node dist/cli.js ci-tests [buildId]  # test cases and per-destination runs
node dist/cli.js ci-run [buildId]    # human digest; --json for structured output
```

| Command | Endpoint |
| --- | --- |
| `ci-product [appId]` | `teams/{team}/asc-products/{appId}` |
| `ci-workflows [appId]` | `teams/{team}/products/{product}/workflows-v15?limit=100&include_deleted=false` |
| `ci-workflow <id> [appId]` | `teams/{team}/products/{product}/workflows-v15/{id}` |
| `ci-builds [appId]` | `build-groups-v4?limit=10`, then `build-summaries-v2?build_group_ids=…&limit=4` |
| `ci-repos [appId]` | `teams/{team}/products/{product}/repos-v3` |
| `ci-capabilities` | `teams/{team}/user-capabilities` |
| `ci-build [buildId] [appId]` | `products/{product}/builds/{build}/details-v3` |
| `ci-tests [buildId] [appId]` | build details, then each test stage's `test-results-v4?limit=60001` |
| `ci-run [buildId] [appId]` | build details + current workflow + each test stage's results and issues |

`--raw` does nothing here: there is no envelope to unwrap and no `included` array to splice
in, so these print what Apple sent.

## Two identifiers for one app

An app has an App Store id — the number in every other command — and, if Xcode Cloud builds
it, a **product UUID**. Nothing in the review centre knows the second one. `asc-products/{appId}`
is the bridge, and it is why the product-scoped commands cost two requests: one to turn the
app id you have into the product id they need, then the real call. `asc ci-product` is that
first request on its own if you would rather hold on to the id.

The team is a UUID too — the one the browser sends as `X-Connect-Team-ID`, which the session
already carries, so it isn't an argument.

## Builds

`ci-builds` reads the ten most recent build *groups* — one per commit-and-workflow — and
then the builds inside them. A build carries:

```
number              48
state               running | succeeded | failed
progress_percentage 57                     (only while running)
finished_at                                (only once it has stopped)
metadata_summary    warnings, errors, test_failures, analyzer_warnings
commit              sha, message, author, a link to it on the host
git_ref             the branch it built
```

`state` and those counts are the whole of what "did it pass" means here; a `failed` build
with `test_failures: 2` is the useful shape.

`ci-build`, `ci-tests` and `ci-run` go one level deeper. `ci-run` compares the run with the
workflow as saved now, counts test cases per executed destination, and groups failures by
test and message rather than by device. With no build id they select the newest build.

## The signature this client cannot send

Every `/ci/api` request the browser makes carries **`x-apple-signature`** — 64 bytes,
base64 — with an **`x-apple-signed-at`** unix timestamp beside it. Recorded from the
browser, 21 calls carried 21 different signatures: the page signs each request in its own
JavaScript. This client cannot reproduce that and does not try.

Whether Apple actually *enforces* it is unknown. One recorded call went out with no
signature at all and came back `404 {"message":"Product does not exist"}` — a routed,
semantic answer rather than a refusal — which suggests the cookie is what authenticates.
That is an observation from a single request, not a guarantee. If Apple starts enforcing
the signature, every command on this page stops working and there is no fix from here.

## What is not here

**Editing a workflow.** The browser was recorded doing it —
`PUT teams/{team}/products/{product}/workflows-v15/{id}` — and the shape is fully known, so
this is a deliberate gap rather than a missing capture. Two things make it worth doing on
its own:

- It is a **full-document replace**, not a patch. The body is the entire workflow: name,
  start conditions, macOS and Xcode versions, every action, environment variables, repo.
  Anything left out is gone. A safe implementation reads the workflow, changes one field,
  and sends the rest back untouched — which is why `CiWorkflowContent` keeps an index
  signature, so fields this client has never heard of survive the round trip.
- It changes what builds on push. That deserves a confirmation showing the before and
  after, not a bare "are you sure".

Also unmapped: creating or deleting a workflow, starting a build, and the pickers behind
the edit form — `test-destinations-v3`, `configuration-options-v10`,
`product-configuration-options-v4`, `schemes`, `version-aliases-v3`, `scm-providers-v2`,
`notices-v2`, `testflight/information-v2`. They were all recorded and none is mapped; they
exist to populate a form this client does not yet render. `asc get` cannot reach them —
it is `iris/v1` only.

See [evidence](evidence.md) for how these calls are classified.
