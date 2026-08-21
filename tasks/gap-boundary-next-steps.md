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

   1. **Xcode Cloud** — *Done, 2026-08-21.* `src/ci.ts` (443 lines), `test/ci.test.ts`,
      `test/run.test.ts`, `docs/xcode-cloud.md` and the superseded
      `tasks/xcode-cloud-evidence.md` are deleted; `src/index.ts` loses the export,
      `src/report.ts` loses its 313-line run digest and the `ci` import, and `src/cli.ts`
      loses all nine `ci-*` commands with `requireProductId`, `latestBuildId`, `testStages`
      and `emitPlain`. `src/http.ts` loses the `ci` base, `getCi`, the `api === 'ci'` header
      branch, the `partial` option and the `items` page shape — all four existed only for
      that API. `API_BASES`, `Api` and `apiUrl` survive as a one-member closed set: the
      refusal to send the cookie anywhere but the one host is the point of them, and
      whether the indirection itself is still worth having is step 5's call, not this
      slice's.

      Verified by deletion rather than by test: `rg` finds no `ci-*` command, no `getCi`,
      no `Ci*` type and no `/ci/api` request anywhere in `src/` or `test/`. `npm run
      typecheck`, `npm test` (126 pass, 0 fail — 24 tests left with the slice) and
      `npm run build` are clean, and **`test/gap-requests.test.ts` and
      `test/gap-shapes.test.ts` were not edited**, which is what says the slice took only
      its own.

      **Left open, deliberately:** `tasks/ci-transport-403-and-post-actions-gap.md` (added
      2026-08-21) records that `CiWorkflow.post_actions` — whether a build is handed to
      TestFlight testers automatically — has no field in Apple's official
      `CiWorkflow.Attributes`, which by this file's own rule makes it a *keep* narrowed to
      that field rather than a removal. The owner's call was to take the slice out whole
      now and treat retention as its own evidence-led decision later: nothing working was
      lost, because that file also shows every `ci-*` command was already answering 403 (the
      `api === 'ci'` branch left `content-type: application/vnd.api+json` on a service that
      does not speak JSON:API), and the code is recoverable from `d500e8f` and `f93cd68`.
      That task file is untouched and still open.
   2. **Invitations** — *Done, 2026-08-21.* `listUserInvitations`, `inviteUser`, `UserInvite`
      and the People-page banner comment are gone from `src/api.ts`, with the
      `userInvitations` entries in `INCLUDES`, `SIDELOADS` and `FIELDSETS`; `src/cli.ts`
      loses the `invites` and `invite` cases, their usage text and the `--role`,
      `--all-apps` and `--provisioning` flags, which existed for `invite` alone;
      `test/invite.test.ts` and `docs/people.md` are deleted. Standalone as predicted:
      nothing else imported either function and no default-id discovery ran through them.

      The audit was restated before the deletion, as this file asks. Checked 2026-08-21
      against Apple's published schemas, `UserInvitation.Attributes` carries `email`,
      `firstName`, `lastName`, `roles`, `provisioningAllowed`, `allAppsVisible` and
      `expirationDate` — every attribute the POST sent plus the one the CLI read back —
      `UserInvitation.Relationships` carries `visibleApps`, and `GET`, `POST` and
      `DELETE /v1/userInvitations` are all official. **There was no field to narrow to**,
      which is what makes this a whole removal under this file's own rule rather than the
      `post_actions` case slice 4.1 left open.

      Being the best-evidenced write in the repository was not a reason to keep it. What
      that evidence established about *Apple* was kept instead: `docs/evidence.md` now
      records the `409 ENTITY_ERROR.ATTRIBUTE.INVALID` refusal of a plus-tagged address,
      and the observation that an invitation sent with `allAppsVisible: true` reads back as
      `allAppsVisible: null` with `visibleApps` naming every app. Both are about the
      resource, so they hold for the official API too.

      `asc` loses its one account-wide command, and the docs that were built around that
      distinction were rewritten rather than patched: `README.md`, `docs/reading.md`,
      `docs/writing.md`, `docs/library.md` and `.claude/references/architecture.md` all
      described `invite` as the write that is not about an app and cannot be reversed. The
      irreversible-write set is now three — `send-reply`, `resolve-item`, `submit`.

      `npm run typecheck`, `npm test` (119 pass, 0 fail — 7 tests left with the slice) and
      `npm run build` are clean; `rg` finds no `invit`, `--role`, `allApps` or
      `provisioning` in `src/`; `test/gap-requests.test.ts` and `test/gap-shapes.test.ts`
      were not edited.
   3. **Screenshots and previews** — *Done, 2026-08-21.* `src/screenshots.ts` (190 lines)
      and `docs/screenshots.md` are deleted; `src/index.ts` loses the export; `src/api.ts`
      loses `listVersionLocalizationsWithAssets`, `listScreenshotSets`, `listPreviewSets`,
      `createScreenshotSet`, `reserveScreenshot`, `completeScreenshot`, `deleteScreenshot`,
      `deleteScreenshotSet`, `findScreenshotSet`, `uploadScreenshot` and
      `UploadScreenshotOptions` (206 lines) with the `versionAssets`, `screenshotSets` and
      `previewSets` entries in `INCLUDES` and `SIDELOADS`; `src/cli.ts` loses `screenshots`,
      `previews`, `screenshot-set`, `upload-screenshot` and `delete-screenshot` with the
      `--force` flag, which existed for the upload alone.

      **The entanglement this slice was ordered late for did not bite.** `uploadPart` and
      `UploadOperation` live in `src/http.ts`, not in the screenshot code, and `attachToDraft`
      reserves, sends parts and commits through them against
      `resolutionCenterMessageAttachments`. So the asset-upload transport — the presigned
      `object-storage.apple.com` legs that deliberately carry no cookie — is retained by a
      gap that owns it in its own right, and only the orchestration on top of it left.
      `VND_API_CONTENT_TYPE` sat inside the deleted region and was kept, since the draft
      writes send it too.

      The audit was restated first. Checked 2026-08-21 against Apple's published schemas:
      `AppScreenshot.Attributes` carries `assetDeliveryState`, `assetToken`, `assetType`,
      `fileName`, `fileSize`, `imageAsset`, `sourceFileChecksum` and **`uploadOperations`**,
      `AppScreenshotSet.Attributes` carries `screenshotDisplayType`,
      `AppPreviewSet.Attributes` carries `previewType`, `AppPreview.Attributes` carries
      `uploadOperations` as well, and create/modify/list/delete for screenshots and their
      sets are all documented operations. `uploadOperations` is the decisive one: it means
      Apple serves the reservation *with its upload instructions*, so the whole three-step
      write is official, not just the reads. **No field to narrow to.**

      Two things worth noting for the record. `SCREENSHOT_DISPLAY_TYPES` was obtained by
      POSTing an invalid display type and reading the enum out of the 409 — a nice piece of
      work, and Apple's published `ScreenshotDisplayType` turns out to be exactly the same
      33 values, so it was a private route to something published. And `SCREENSHOT_SIZES`,
      the one thing here with no API behind it at all, was a hand transcription of the
      version page's drop-zone captions covering three zone families out of 33; a pre-flight
      size check is a client convenience, not a capability Apple's API lacks, so it is not a
      gap under this file's rule.

      Evidence rescued into `docs/evidence.md` before `docs/screenshots.md` was deleted: the
      `assetDeliveryState` progression (`UPLOAD_COMPLETE` at commit, `COMPLETE` after
      processing, when `sourceFileChecksum` and a `downloadUrl` appear) and the fact that
      skipping the commit leaves an invisible reservation — both about the resource, so both
      hold for the official API; the iris-only refusals `GET appScreenshotSets/{id}` → 404
      and `appScreenshots?filter[appScreenshotSet]=` → 403, labelled as an iris quirk since
      Apple documents the by-id read; and where `SCREENSHOT_SIZES` came from.

      `docs/logging.md` and the `audit()` comment in `src/log.ts` both used
      `upload-screenshot` as their worked example and now use the draft-attachment flow,
      which exercises the same `asset.part` records. The confirmation set in `docs/writing.md`
      loses `delete-screenshot`, leaving two deletes.

      **No test changed, because there were none.** The most involved write in the tree —
      pre-flight checks, set creation, multi-part upload, commit — had no coverage at all;
      `npm test` is 119 pass, 0 fail before and after. `npm run typecheck` and `npm run build`
      are clean, `rg` finds no screenshot or preview reference left in `src/`, and
      `test/gap-requests.test.ts` and `test/gap-shapes.test.ts` were not edited.
   4. **Metadata, app information, categories, age ratings, content rights** — *Done,
      2026-08-21.* `src/api.ts` loses `listAppInfos`, `listAppInfoLocalizations`,
      `findEditableAppInfo`, `pickEditableAppInfo`, `listAppInfoPage`,
      `getAppInfoCategories`, `setAppCategories`, `findAgeRatingDeclaration`,
      `listTerritoryAgeRatings`, `ageRatingAnswersFrom`, `parseAgeRatingAnswers`,
      `setAgeRating`, `setContentRights`, `listVersionLocalizations`, `metadataResourceFor`,
      `findMetadataField` and `setMetadataField` with their constants and types (518 lines)
      and the `territoryAgeRatings`, `appInfoCategories` and `appInfoPage` entries in
      `INCLUDES` and `FIELDSETS`; `src/report.ts` loses `fetchMetadata` and
      `LocaleMetadata`; `src/cli.ts` loses nine commands, ten helpers and the six
      `--primary`/`--secondary` flags that existed for `set-categories` alone.

      The audit was restated first, and this time the specification itself was
      re-downloaded rather than the published schema pages alone: still **4.4.1**, still
      966 paths and 1,393 schemas. Every path this slice used is an official operation and
      every attribute is on an official schema —
      `AppInfoLocalization.Attributes`, `AppStoreVersionLocalization.Attributes`,
      `App.Attributes.contentRightsDeclaration`, `TerritoryAgeRating.appStoreAgeRating`,
      and `AppInfoUpdateRequest` writing to exactly the six category relationships this
      client wrote to.

      **This is the first slice with a field to narrow to, and it went anyway.** Apple's
      `AgeRatingDeclaration.Attributes` has 29 properties and the recorded body had 29, and
      they are not the same 29: Apple has `ageRatingOverride`, the recording had
      **`gracRatingClassificationNumber`** — Korea's GRAC classification number — which
      occurs zero times in 4.4.1. By this file's rule that is a keep narrowed to one field.
      It left with the slice because the only recorded write is the whole questionnaire in
      one body, so keeping the field means going on sending 28 official ones, and no
      single-attribute PATCH of a declaration has ever been recorded — inventing one is
      exactly the guess this repository refuses. Retention is now its own evidence-led
      decision in `tasks/grac-rating-classification-number-gap.md`, the same handling
      `post_actions` got in slice 4.1. **This is the owner's call to make, not an agent's.**

      Rescued into `docs/evidence.md` before the recording's record was rewritten: that the
      *first* `appInfos` record is the live one and a write there is refused with
      `409 ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_STATE`; that the questionnaire is one
      app's rather than the questionnaire, which Apple's set differing by one attribute
      confirms; that a category is a relationship whose id is the category's name, the same
      way `AppInfoUpdateRequest` takes it; and that the recording covered request shapes
      and not the range of answers. The first three are about the records, so they hold for
      the official API too.

      Four stale comments outside the slice were caught by a post-deletion grep and
      rewritten rather than left: `requireText` and both `src/confirm.ts` doc comments used
      `set-metadata` as their worked example of a piped-in value and now use `save-draft`,
      and `versionUnderReview`'s error pointed at `asc metadata <versionId>`. Worth noting
      honestly: **no command that asks now reads its input from stdin**, so the `/dev/tty`
      fallback in `confirm.ts` is currently unexercised. It stays — the branch is one
      command away from mattering again — and the comment says so instead of implying a
      caller that no longer exists.

      **No test changed, and again there were none.** `npm test` is 119 pass, 0 fail before
      and after; `npm run typecheck` and `npm run build` are clean; `rg` finds no `appInfo`,
      age-rating, category, territory or metadata call left in `src/`; and
      `test/gap-requests.test.ts` and `test/gap-shapes.test.ts` were not edited.
   5. **Submission management** — *Done, 2026-08-21.* `src/api.ts` loses
      `listReviewSubmissions`, `getReviewSubmission`, `listSubmissionItems`,
      `resolveSubmissionItem`, `createReviewSubmission`, `addSubmissionItem`,
      `submitReviewSubmission`, `cancelReviewSubmission`, `planSubmission`, `runSubmission`,
      `SubmissionPlan`, `OPEN_SUBMISSION_STATES`, `submissionIdFromItemId` and
      `findSubmissionItems` (331 lines) with the `reviewSubmissions` and `submissionItems`
      entries in `INCLUDES` and `SIDELOADS`; `src/cli.ts` loses six commands, three helpers
      and `--dry-run`; `test/submission.test.ts` is deleted.

      Step 3 did its job: `src/report.ts` needed **no change at all**, because `report` had
      already stopped reading a submission. `asc report --submission` and `asc thread` stay
      — both reach the Resolution Center through
      `resolutionCenterThreads?filter[reviewSubmission]`, which is a private filter on a
      private resource, not a submission read.

      The audit was restated against the re-downloaded specification: still 4.4.1, 966
      paths, 1,393 schemas. All seven operations are official and every attribute is on an
      official schema, down to `resolved`, `submitted` and `canceled` being spelled exactly
      as the private writes spelled them, and `ReviewSubmissionState` carrying all six
      states this client hard-coded plus `COMPLETE`.

      **A third field-level keep appeared, and it was the first one that cost nothing.**
      `createdByActor` is in the browser's include list for `reviewSubmissions` and is not
      on Apple's `ReviewSubmission.Relationships` — but unlike `post_actions` (4.1) and
      `gracRatingClassificationNumber` (4.4), **nothing here ever read it**. One line in an
      include list, no code, no test, no document. A keep narrowed to exactly that field
      would be narrowed to nothing, so it went with the slice and needs no task file.

      The entanglement this slice was ordered for was real but small: `versionInReview`
      resolved a default version id by reading `apps/{id}/reviewSubmissions` and taking
      `appStoreVersionForReview`. That is an official read, so it went, leaving
      `versionUnderReview` with the drafts route alone. **This is a user-visible behaviour
      change and is documented as one**: on an app whose current version is in front of
      Apple *and* which has a newer draft open, `asc history` and friends now default to the
      draft rather than to the version under review. Naming the version is exact either way.

      Rescued into `docs/evidence.md` before the sections that held it were deleted, all of
      it about the records rather than about this client: that a rejection keeps the
      `submittedDate` of the run that was refused, so a submitted date is no guide to where
      a submission is, and that reading it as one deadlocked `submit` against `resolve-item`
      until `asc patch` broke the tie; that `READY_FOR_REVIEW` means unsent only when paired
      with *no* submitted date; that there is one open submission per platform and the
      platform must be read off the version, not assumed; that **resolving an item does not
      re-queue its submission** — the 2026-08-13 case sat in `UNRESOLVED_ISSUES` for five
      days and sixteen hours with the version page saying "Ready for Review"; and that an
      item id is base64 of `{submissionId}|{n}|{appId}`, which matters because
      `GET reviewSubmissionItems/{id}` is refused 403 by iris *and* has no official by-id
      read either — 4.4.1 gives that path `PATCH` and `DELETE` only.

      The irreversible-write set is now **one**: `send-reply`. `docs/writing.md`, the CLI
      usage text and `README.md` all said "three" and now say so.

      One test changed and it was not a gap test: `test/jsonapi.test.ts` built its
      denormalization fixture out of a `reviewSubmissions` document. Every assertion kept
      its shape; the invented fixture is now a `resolutionCenterThreads` one, so the suite
      stops demonstrating `denormalize` on a resource this client can no longer read.
      `npm test` is 113 pass, 0 fail (six left with `test/submission.test.ts`);
      `npm run typecheck` and `npm run build` are clean; and **`test/gap-requests.test.ts`
      and `test/gap-shapes.test.ts` were not edited**.
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
