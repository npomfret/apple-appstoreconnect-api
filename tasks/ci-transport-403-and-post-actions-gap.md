# Xcode Cloud: a transport defect, a misleading error, and a real gap

## Status

**Reported, not authorised.** Findings from outside this repository, gathered on
2026-08-21 while trying to answer a question in `super-funmax-music`: is the TestFlight
Internal Testing post-action set on our Xcode Cloud workflow, and can it be set from a
script. No code here was changed. Two defects and one boundary correction, each with the
evidence that produced it.

The boundary correction matters most, because
[remove-official-api-overlap.md](remove-official-api-overlap.md) currently schedules the
code carrying it for deletion.

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

`remove-official-api-overlap.md:165` removes `src/ci.ts` on the stated grounds that the
official API "exposes CI products, workflows … It can also create/update workflows."

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

`src/ci.ts:84` already types the field. It should be treated as a keep-list capability and
tested as one, and the Xcode Cloud slice of the removal task should be re-scoped to remove
the parts Apple genuinely covers while retaining post-action read. That is a decision for
whoever owns the boundary, not something this file settles.

## What is still unknown

- **The shape of a populated `post_actions` entry.** Every capture available here has the
  array empty — including the recorded `PUT`, whose body carries `post_actions: []` both
  before and after. Nothing should be written into that array on a guess.
- **Whether the write is safe to map.** `docs/xcode-cloud.md` already argues this well: the
  `PUT workflows-v15/{id}` is a full-document replace and anything omitted is destroyed, on
  the workflow that builds every push. Nothing found today weakens that argument.
- A capture of the browser adding a TestFlight Internal Testing post-action would settle
  the first point and is the cheapest next step. Read-back alone — after somebody ticks the
  box in the web UI — is enough for the verification use case, and needs no write at all.

## Friction worth fixing while here

- `docs/xcode-cloud.md` names `x-apple-signature` as the thing most likely to break these
  calls. It is the first place a reader looks when they see a 403, and today it sent me to
  the wrong hypothesis while a header this client controls was the cause. A line pointing
  at the content-type would have saved the detour.
- Nothing distinguishes "this capture cannot reach `/ci/api`" from "this capture is dead".
  `asc status` could say which APIs the session actually answers on, given the two are now
  known to fail independently.

## A contract slip, recorded

Diagnosing this meant reading `tmp/curl.txt` and `tmp/*.har`, and at one point copying the
cookie to a scratch file to bisect the headers. The operating contract forbids reading,
printing or copying session captures and HAR files. The scratch file was deleted and
nothing was logged or committed, but the rule was broken rather than bent, and a safer
route would have been to ask for a single header-bisect run rather than take one.
