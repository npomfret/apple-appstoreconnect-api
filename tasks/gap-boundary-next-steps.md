# Next steps for the gap-only boundary

## Status

Proposed. This **sequences** [remove-official-api-overlap.md](remove-official-api-overlap.md);
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

1. **Pin the gaps first.** *Done.* Contract tests over Resolution Center threads/messages/
   drafts/attachments/rejections, `inbox` counts, version state history and App Privacy —
   asserting the endpoint, query and parsed shape of each. These are the tests that make the
   later deletions safe, and they had to be written while the code still worked.

   `test/gap-requests.test.ts` pins the request: URL, query, method, body and content type,
   asserted whole rather than in pieces, plus the audit record on each irreversible write.
   `test/gap-shapes.test.ts` pins what is read back: the digest built from a thread —
   ordering, Apple's last word, guidelines, attachments, a waiting draft — and the App
   Privacy label. It deliberately asserts on the Resolution Center half of the report and
   not on how the thread was discovered, so step 3 changes its setup and none of its
   expectations.

   Coverage before this step ran the wrong way round: 472 of 1,501 test lines pinned
   `/ci/api`, which is slice 4.1, and not one retained Resolution Center, inbox, history or
   privacy call was named anywhere in `test/`. The suite protected what is leaving.

2. **Narrow the retained duplicates.** *Done.* `listAppMetrics` becomes an explicitly
   gap-only read — the `apps` collection asked for nothing but the private metric fieldset,
   documented as retained *for that field*. Thread discovery stops depending on a
   submissions read: accept an app id or thread id and say so.

   The `reviewSubmissions` sideload is gone from `listAppMetrics`: Apple serves it at
   `GET /v1/apps/{id}/reviewSubmissions` with `state` and its enum. What is left is
   `include` and `fields[apps]` naming the two private metric relationships and nothing
   else, so the apps come back as bare ids. The shortened query is not itself a recording
   and is labelled as such in `docs/evidence.md` and in the function.

   Re-checked on 2026-08-20 against specification 4.4.1 (generated 2026-07-15, 966 paths,
   1,393 schemas): `appStoreVersionMetrics`, `betaReviewMetrics`, `messageCount`,
   `resolutionCenterThread`, `dataUsages` and any state-change schema occur **zero** times
   in the document; `ReviewSubmission` is present with `platform`, `state`, `submittedDate`.
   The keep list and the remove list both hold.

   `buildReport` now takes a `ReportTarget` — `{ threadId }`, `{ submissionId }` or
   `{ appId }` — instead of an app id, and `asc report` takes `--thread` / `--submission`.
   The first two reach the Resolution Center through private routes only; `{ appId }` is
   the one route that reads an official resource, and it logs `report.viaSubmissions`
   saying so. `SubmissionReport.submissionId` and `.state` became optional, because a
   report built from a thread has neither and inventing them would mean an official read.

3. **Refactor `report` to be thread-first.** *Done.* The `{ appId }` route now starts at
   `apps/{appId}/resolutionCenterThreads` and reads no official resource. `report` stands on
   gaps alone on all three of its starting points, which was the finding this step existed
   to establish, and slice 4.5 is unblocked.

   The blocker recorded here was **sidestepped rather than resolved**, and the distinction
   matters if this is ever revisited. Whether `include=reviewSubmission` is accepted on the
   threads list is *still* not recorded, and this client still does not send it. It turned
   out not to be needed: the thread→**version** link needs no new evidence, because
   `include=appStoreVersions` is in the recorded threads query and `filter[appStoreVersion]`
   was already a `listThreads` option, and the thread→**submission** link is not needed at
   all — step 2 had already made `submissionId` and `state` optional, so the rebuilt route
   simply leaves them unsaid. Nothing was probed and no new request shape was invented.

   What replaced it was a design question, not an evidence one. A thread's
   `appStoreVersions` is **to-many** (`limit[appStoreVersions]=2000`), where the deleted
   `reportForSubmission` read the submission's to-one `appStoreVersionForReview`. Rather
   than rank them, `SubmissionReport` gained `versions: VersionRef[]` listing every version
   a thread names, and keeps the singular `version`/`versionId` for the ordinary case of
   exactly one — the same refusal-to-guess the CLI already applies to two starting points
   and `versionUnderReview` applies to two drafts.

   One gap-test expectation changed, and only one: "an app id is the one route that costs an
   official read" was the assertion that this step exists to falsify. Every digest
   expectation in `gap-shapes.test.ts` stayed green untouched, which is what says the entry
   point moved and the answer did not. The fixtures that fed the old route are gone, and the
   stubs now throw on any request outside the Resolution Center instead of quietly answering
   with submissions.

   `SubmissionReport` lost `state`, `platform`, `submittedDate` and `lastUpdatedDate`
   outright rather than keeping them as fields nothing fills in, and `formatReport` lost the
   two lines that printed them. `submissionId` survives as an echo of what the caller
   passed. That is a user-visible narrowing of `asc report`, and `README.md`,
   `docs/reading.md`, `docs/library.md` and `docs/evidence.md` all point at
   `GET /v1/apps/{id}/reviewSubmissions` for the fields that left.

   Also unrecorded, and worth not forgetting: **a thread's own attributes are unmapped.**
   Nothing in this client reads one — `threadType` appears only as a filter value — so the
   digest reads only the thread's id and its `appStoreVersions`, and `docs/evidence.md` now
   says so.

4. **Delete in vertical slices**, each one command + export + implementation + tests + docs
   together, in ascending order of entanglement:

   1. **Xcode Cloud** — newest, zero dependents, nothing else imports `src/ci.ts`. Reverting
      commits `d500e8f` and `f93cd68` is most of it; `src/report.ts` also loses its run
      digest, and `src/http.ts` loses the `ci` base and the `partial` option.
   2. **Invitations** — also standalone.
   3. **Screenshots and previews** — self-contained module, but it owns the asset-upload
      orchestration and `uploadPart`, so check what else reserves assets first: draft
      attachments do, and they are a keep.
   4. **Metadata, app information, categories, age ratings, content rights.**
   5. **Submission management** — unblocked by step 3: `report` no longer reads a
      submission, and `listReviewSubmissions` has no caller left in `src/report.ts`.
   6. **Apps, versions, builds, review details** — last of the resource slices, because
      default-id discovery across 26 call sites in `src/cli.ts` runs through them.
   7. **`patch`, and `get` narrowed to an allowlist of retained private families.**

5. **Simplify the transport** back to `iris/v1` and only the methods and content types the
   retained gaps need. Credential isolation, redaction, confirmations and audit records for
   retained writes are not in scope for simplification and must survive unchanged.

6. **Rewrite the docs** as a gap-only client. No compatibility aliases, no deprecated
   wrappers, no stale claims outside this task's history.

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
