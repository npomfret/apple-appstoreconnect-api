# Next steps for the gap-only boundary

## Status

Steps 1–6 are done; step 0 is the owner's and is outstanding. This **sequences** [remove-official-api-overlap.md](remove-official-api-overlap.md);
it does not replace it. That task defines *what* leaves. This one records the audit that
verified it, corrects two defects found while verifying, and fixes the *order* — because
two of its slices, taken in the order written, delete something the keep list depends on.

No deletion is authorised by this file alone.

## The audit, and how it was done

Audited **2026-08-20** against Apple's official OpenAPI specification **4.4.1**, generated
2026-07-15 (966 paths, 1,393 schemas), downloaded from
`https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip`.
Cross-checked against the documentation index at
`https://developer.apple.com/tutorials/data/index/appstoreconnectapi` (9,997 entries).
Two independent sources, agreeing.

**The keep list is correct.** Zero paths and zero doc-index entries for Resolution Center
threads, messages, drafts, attachments, rejections, `dataUsages`, unread message counts, or
App Store version state history. `App` attributes carry no message count. The only state
schemas are current-state enums — `AppStoreVersionState`, `AppVersionState` — with no
history resource behind them.

**The remove list is correct, and understates itself.** In three places this client
documents a capability as *absent*, the official API has it:

| Documented here as missing | Official |
| --- | --- |
| revoking an invitation | `DELETE /v1/userInvitations/{id}` |
| app-restricted invitations | `visibleApps` on `UserInvitationCreateRequest` |
| editing a workflow | `PATCH /v1/ciWorkflows/{id}` |
| creating or deleting a workflow | `POST /v1/ciWorkflows`, `DELETE /v1/ciWorkflows/{id}` |
| starting a build | `POST /v1/ciBuildRuns` |

`userInvitations` is the plainest case: the private and official resources are **the same
JSON:API type**, and `UserInvitationCreateRequest` takes exactly the six attributes
`inviteUser` sends, with exactly the four this client validates as required. The private
endpoint is the public one behind a cookie.

`ci-run` is likewise reproducible field for field: `CiTestResult.destinationTestResults` is
`{deviceName, osVersion, status, duration, uuid}`, structurally identical to the private
`device_runs`, reached by `ciBuildRuns/{id}/actions` → `ciBuildActions/{id}/testResults`.

**Restate this audit against the current specification before doing the work**, and record
the version and date wherever a "no official equivalent" claim is written down, so the claim
ages visibly.

## Two defects in the removal inventory

Both are slice-boundary errors, not disagreements about the boundary itself.

**1. `inbox` is an `apps` read.** The inventory keeps `listAppMetrics`/`inbox` and removes
`listApps` — but `listAppMetrics` *is* a request to the `apps` collection, carrying
`fields[appStoreVersionMetrics]=messageCount`. `messageCount` appears nowhere in the
official specification and `appStoreVersionMetrics` is not a schema in it. Delete the
private `apps` read and a keep-list feature goes with it.

**2. The keep list depends on the remove list for id discovery.** `findThreadForSubmission`
filters threads by a review-submission id, and `buildReport` starts from
`listReviewSubmissions` — both officially-available reads. The inventory sees this and says
to accept explicit ids; it just has to happen *before* the deletion, not after.

The rule these two imply, and the one to work by:

> Duplication is a property of a **call**, not of a resource. A private read of an
> officially-available resource is retained only when it carries a field for which the
> official specification has no schema — and it is then narrowed to exactly that field.

## The decision that is not an agent's to make

The official API authenticates with `itc-bearer-token`: a JWT signed with a `.p8` key an
Account Holder generates. This client's premise is a pasted cookie and no login step.
Removal therefore does not relocate these capabilities for someone holding a session and no
API key — it withdraws them. Whether that is the right trade is a product call for the
repository owner, and it should be recorded in `CLAUDE.md` in the owner's own words before
any code is deleted.

## Order of work

Steps 0–3 remove nothing. Nothing in step 4 starts until step 3 is green.

0. **Record the boundary and the audit.** The rule and its date/version into `CLAUDE.md`
   and `docs/evidence.md`. No code changes. The `CLAUDE.md` rewrite currently sitting
   uncommitted in the working tree is part of this step and needs the owner's sign-off.

1. **Pin the gaps first.** *Done.* `test/gap-requests.test.ts` pins the request each
   retained gap makes — URL, query, method, body, content type, and the audit record on
   every irreversible write. `test/gap-shapes.test.ts` pins what is read back. These are
   the fence: they were written while the code still worked, and **neither has been edited
   by any slice since.**

2. **Narrow the retained duplicates.** *Done.* `listAppMetrics` is an explicitly gap-only
   read of the `apps` collection — `include` and `fields[apps]` name the two private metric
   relationships and nothing else, so the apps come back as bare ids.

3. **Break the keep list's dependency on the remove list.** *Done.* `report` starts from a
   thread rather than a submission, so no retained command reads an officially-served
   resource to find an id.

4. **Delete in vertical slices**, each one command + export + implementation + tests + docs
   together, in ascending order of entanglement:

   1. **Xcode Cloud** — *Done, 2026-08-21.*
   2. **Invitations** — *Done, 2026-08-21.*
   3. **Screenshots and previews** — *Done, 2026-08-21.*
   4. **Metadata, app information, categories, age ratings, content rights** — *Done,
      2026-08-21.* One field-level keep was found and deferred rather than taken:
      `gracRatingClassificationNumber`, in
      [grac-rating-classification-number-gap.md](grac-rating-classification-number-gap.md).
   5. **Submission management** — *Done, 2026-08-21.*
   6. **Apps, versions, builds, review details** — *Done, 2026-08-21.* `listApps`, `getApp`,
      `listAppVersions`, `getVersion`, `getReviewDetails`, `findReviewDetails`,
      `redactReviewDetails`, `listBuilds`, `listBuildCandidates`, `updateVersion`,
      `setVersionBuild`, `VersionUpdate`, `LIVE_VERSION_STATES`, `fetchBuilds`,
      `formatBuilds`, `BuildChoice` and the `apps`, `app`, `versions`, `version`, `builds`,
      `set-build` and `review-details` commands are gone, with `--reveal`.

      **`versionId` no longer defaults.** `versionUnderReview` worked it out by reading
      `apps/{id}/appStoreVersions` — the official call — so `asc history <versionId>` now
      requires the id, and `asc report --json` is where one comes from.

      Four include names and one filter had no official schema — `displayableVersions`,
      `resetRatingsRequest`, `gameCenterConfiguration`, `ageRatingDeclaration` *as a
      relationship of a version*, and `filter[isAppStoreCandidate]` — but nothing here read
      any of them, so a keep narrowed to exactly that field would narrow to nothing. The
      filter is `filter[buildAudienceType]=APP_STORE_ELIGIBLE` officially. **`resetRatingsRequest`
      is the one worth remembering**: resetting an app's ratings has no official API at all,
      so it is an unbuilt gap rather than a removed one.

      `REVIEW_DETAIL_SECRETS` stays in `src/log.ts` although the command that read the
      record has gone. Slice 4.7 closed the last route by which `demoAccountPassword` could
      arrive, and it still stays — see there.

   7. **Escape hatches** — *Done, 2026-08-21.* `rawPatch` and `asc patch` removed
      outright; `raw`/`asc get` constrained to an allowlist of the private families, with
      `..` refused. Whole families rather than the mapped routes, because each of the five
      occurs zero times in 4.4.1 — so nothing inside one duplicates an official read, and a
      new gap is still findable. The parent of a private relationship stays out of scope:
      `apps/{id}/dataUsages` is a gap, `apps/{id}` is Apple's, and one segment is the whole
      difference. `test/boundary.test.ts` pins it, asserting that a refused path **sends
      nothing** rather than merely throwing.

      Two consequences left for step 5: the `application/json` fallback in `headersFor` is
      now unreachable rather than narrow, and `REVIEW_DETAIL_SECRETS` has no arrival route
      left but stays, because a redaction keyed on a field name is a standing rule rather
      than a reaction to a caller.

5. **Simplify the transport** back to `iris/v1` and only the methods and content types the
   retained gaps need. Credential isolation, redaction, confirmations and audit records for
   retained writes are not in scope for simplification and must survive unchanged.

   *Done, 2026-08-21.* Four narrowings, each removing an option rather than changing a
   value: `API_BASES`/`Api` and `RequestOptions.api` collapse to the `BASE_URL` constant;
   `contentType` leaves `RequestOptions`, `patch()` and `post()` along with the unreachable
   `application/json` fallback, so one content type is set in one place for reads and writes
   alike; `PUT` leaves `METHODS`, since the only PUT here is an upload part that bypasses
   `request()` by design; and `TEAM_TYPE` stops being exported. `VND_API_CONTENT_TYPE` and
   its six call sites go with it — the fact now lives in the transport rather than being
   restated at every write.

   **Nothing moved on the wire**, and the proof is that `test/gap-requests.test.ts` pins
   the method, body and content type of every retained call and passed unedited. The one
   test that had to change was the transport's own assertion of the default it no longer
   has. The audit records, the redaction, the absolute-URL refusal and the confirmations
   were not touched.

6. **Rewrite the docs** as a gap-only client. No compatibility aliases, no deprecated
   wrappers, no stale claims outside this task's history.

   *Done, 2026-08-21.* There were no aliases or wrappers to remove — nothing here ever
   forwarded to Apple's API — so the work was that the docs had become a removal changelog:
   every page opened with a boundary notice about what had left, and a reader arriving fresh
   got the project's history instead of its shape. Each page now describes its own surface
   and carries the date and specification version its gap claim was checked against.

   `docs/evidence.md` was the delicate one, because its removed-call entries are not stale
   claims — they are the evidence for the removals, and several carry observations about
   Apple's *records* that outlive the code and hold for the official API too: a rejection's
   `submittedDate` is the date Apple last looked; resolving an item does not re-queue its
   submission; the first `appInfos` record is the live one and refuses writes. Those are
   kept, under one archive heading at the end, with the dead identifier lists stripped out —
   the function-by-function inventory belongs in
   [remove-official-api-overlap.md](remove-official-api-overlap.md) and is now only there.

   Two stale claims outside `docs/` went with it: `CLAUDE.md` still said the tree contained
   legacy private implementations of official capabilities, and
   `.claude/references/architecture.md` still described a closed *set* of transport bases
   and forbade handling a browser recording outright, which `CLAUDE.md`'s redaction rule now
   permits as evidence.

## What not to do

- Do not add API-key authentication or reimplement Apple's public client here. Point at the
  official API instead.
- Do not delete a private read because its *resource* is official. Check the *fields*.
- Do not start step 4 with the slices that other code depends on, however tempting the
  line-count is.
- Do not make a live write as migration verification.

## Verification

- Each slice: `rg` the removed command names, exported functions and private routes to prove
  the slice is gone whole; `npm run typecheck`, `npm test`, `npm run build`.
- `test/gap-requests.test.ts` and `test/gap-shapes.test.ts` must stay green across every
  slice, unedited. A gap test that needs changing during a deletion means the slice took
  something it should not have.
- Retained reads exercised only against a fresh browser session, read-only.
- At completion, re-download the official specification and record its version and date in
  the README and `docs/evidence.md`.

## Success

Every command and export provides something Apple's official API does not, the reason is
written down with the date and specification version it was checked against, and `report`
still works.
