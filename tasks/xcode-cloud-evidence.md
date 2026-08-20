# Xcode Cloud evidence: saved intent and executed reality

> **Superseded 2026-08-20.** Do not implement or finish this task. Xcode Cloud is exposed
> by Apple's official App Store Connect API, so it is outside this project's gap-only
> boundary. Use Apple's
> [Xcode Cloud Workflows and Builds API](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds)
> instead, and see [remove-official-api-overlap.md](remove-official-api-overlap.md).

## Problem

An Xcode Cloud workflow summary can look correct while hiding the setting that
motivated the check. In `super-funmax-music`, the existing status report showed
the `main` trigger, `UnitTests` plan and archive audience, but not the test
destinations. Verifying a change from `Recommended iPhones` to one explicit
simulator therefore required raw App Store Connect queries.

Two different facts were needed and must not be collapsed:

- The currently saved workflow had one `iPhone 16` destination on `Latest from
  Selected Xcode (iOS 26.5)`.
- Build run 48 had already captured the previous configuration and executed each
  test on four destinations: iPhone 16, iPhone 16 Pro, iPhone 16 Pro Max and
  iPhone SE (3rd generation).

The run's aggregate status alone could not explain that distinction. Its test
action failed while the archive action succeeded, and the destination evidence
lived on every test result as `destinationTestResults`. The result collection is
paginated, so a useful report must follow every page before counting tests,
destinations or failures.

## Current work in progress

An uncommitted Xcode Cloud read path appeared while this task was being framed:
`src/http.ts` adds the closed `ci` base, `src/ci.ts` maps products, workflows,
repositories, build groups and build summaries, and `src/cli.ts` exposes raw
`ci-*` reads. That work already makes the saved `test_destinations` visible and
must be preserved as another writer's work.

It does not yet map a build's actions or its per-test results, so it cannot say
which destinations actually executed, whether the suite ran zero tests, or
which destination failed. This task begins after that read path lands and
extends it; it must not recreate or rewrite the in-progress product, workflow
or build-summary work.

## Goal

Add a read-only Xcode Cloud evidence path that answers both questions explicitly:

1. Render the saved destinations already exposed by the workflow read as a
   concise configuration summary.
2. Add the missing run-detail evidence: what destinations, runtime, test count
   and result did a chosen build actually execute?

The output should make a stale or pre-edit run impossible to mistake for proof
of the current workflow configuration.

## Audit first

- Preserve the uncommitted `src/http.ts`, `src/ci.ts`, `src/cli.ts` and
  `src/index.ts` Xcode Cloud work; treat it as another writer's work, not settled
  design.
- Capture the App Store Connect browser requests for:
  - product and workflow discovery;
  - one workflow's action configuration and test destinations;
  - build-run discovery and actions;
  - a test action's paginated results.
- Record response shapes and pagination from the private `/ci/api` service.
  Do not assume the public App Store Connect API resource names or JSON:API
  pagination used during the motivating investigation map onto this service.
- Inspect `src/cli.ts`, `src/api.ts`, `src/report.ts`, `src/http.ts`, their tests,
  and the reading/evidence documentation before choosing ownership.

## Design questions and approval gate

Present the command and library shape for approval before implementation. Build
on the in-progress `ci-workflow` and `ci-builds` vocabulary. A coherent candidate
is a run-oriented detail read plus stable human renderers, rather than widening
the generic Iris `get` command or mixing configuration and execution into one
ambiguous status line.

Also decide whether this belongs in this browser-session client at all. The
official App Store Connect API exposes the same Xcode Cloud resources through
API-key authentication, but adding that would introduce a second authentication
model and a third API surface. Prefer the already-started, captured browser
`ci/api` path unless the public API's stability justifies an explicitly approved
product-boundary change.

Do not add endpoints, command names, public library types or authentication
behaviour until the evidence and proposed interface are approved.

## Behaviour

The workflow view should report at least:

- product and workflow identity;
- enabled state and start condition;
- action name, type, scheme and required-to-pass state;
- test plan;
- every destination's device name and identifier;
- runtime name and identifier;
- archive distribution audience.

The run view should report at least:

- run number, commit, start/finish time and aggregate result;
- each action's type and result;
- unique executed destination/runtime pairs;
- total test cases returned after pagination;
- per-destination executed, passed and failed counts;
- failed test names and messages grouped without duplicating the same failure
  into an unreadable wall of output.

Zero returned tests is a failure of evidence and must be called out, not rendered
as a successful empty suite. If the run's destinations differ from the currently
saved workflow, say that plainly and include their timestamps so configuration
snapshot timing is visible.

Keep stdout machine-readable under `--json` and concise for people otherwise;
send pagination or incompleteness warnings to structured stderr like existing
reads. Never print session credentials, signed headers or captured URLs.

## Verification

- Invent fixtures for one saved destination and for a prior run with four.
- Cover multiple result pages and prove the last page contributes to counts.
- Cover a failed test on one destination, the same failure on several
  destinations, zero tests, a running action and a completed archive beside a
  failed test action.
- Assert that the report distinguishes saved destinations from executed ones.
- Extend transport tests for the captured `ci/api` paths and plain-JSON `items`
  pagination without weakening host isolation or redaction.
- Run `npm run typecheck`, `npm test` and `npm run build`.
- Perform only read-only live verification with a fresh browser session, naming
  the captured request evidence and any unsigned-request uncertainty.

## Success

A person changing an Xcode Cloud destination can use this client to prove that
the workflow saved the intended device immediately, then use the next build to
prove that Cloud executed a nonzero suite once on that device, without bespoke
scripts or visual inspection of every test result.
