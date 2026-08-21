# Remove functionality covered by the official App Store Connect API

## Status

This task defines the product boundary; it does not authorize live App Store Connect writes.

**Done, apart from step 0.** Every resource slice below has been removed; as of 2026-08-21
so have the escape hatches that could still reach them — `patch` is gone and `get` is
confined to the private families — the transport has been narrowed to the one base, the one
content type and the four methods the retained gaps use, and the README and topic docs have
been rewritten as a gap-only client. The sequencing and the record of each step are in
[gap-boundary-next-steps.md](gap-boundary-next-steps.md).

What is left is **step 0**, which is the owner's: the boundary rule and the audit
date/version are now in `CLAUDE.md`, but the trade-off that removal *withdraws* these
capabilities from anyone holding a session and no `.p8` key is a product call, and it should
be recorded there in the owner's own words.

## Decision

This project exists only for App Store Connect capabilities that Apple does **not** expose
through the official App Store Connect API. A private `iris/v1` or `/ci/api` implementation
must not be retained merely because it has a convenient response shape, uses an existing
browser cookie, combines multiple official requests, or was captured from the web UI.

Remove a capability when the official API can perform the same underlying read or write.
Do not add official API-key authentication or reimplement Apple's public client here;
direct users to the official API instead. Keep private calls only for a documented gap.

## Source of truth and audit date

Audited 2026-08-20 against Apple's official:

- [App Store Connect API overview](https://developer.apple.com/app-store-connect/api/),
  which explicitly covers app management and submission, metadata and assets, users and
  roles, and Xcode Cloud.
- [App Store Connect API documentation](https://developer.apple.com/documentation/appstoreconnectapi/).
- [OpenAPI specification](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip),
  version **4.4.1**, with its JSON archive dated 2026-07-15. Operation IDs below come
  from that file.
- Apple's topic collections for
  [App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata),
  [Review Submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions),
  [User Invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations),
  [Age Ratings](https://developer.apple.com/documentation/appstoreconnectapi/age-ratings),
  and [Xcode Cloud Workflows and Builds](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds).

Repeat this comparison against the latest OpenAPI specification immediately before doing
the work. The project and Apple's API both change over time; do not treat this inventory as
permanent.

## Keep: official gaps found in 4.4.1

The official specification has no resources or operations for these private capabilities:

- Resolution Center threads and their mapping to review submissions:
  `resolutionCenterThreads` and `findThreadForSubmission`.
- App Review messages, guideline rejections and their attachments: `listMessages`,
  `listRejections`, and the relevant report formatting.
- Resolution Center draft replies and attachments: `getDraftMessage`,
  `createDraftMessage`, `updateDraftMessage`, `deleteDraftMessage`,
  `reserveMessageAttachment`, `completeMessageAttachment`,
  `deleteMessageAttachment`, `attachToDraft`, `saveDraftReply`,
  `discardDraftReply`, and `findSendableDraft`.
- Sending a Resolution Center reply: `sendDraftMessage` and `sendDraftReply`.
- Unread App Review/Resolution Center badge counts exposed by the private app metrics
  response: `listAppMetrics` and `inbox`.
- App Store version state-change history, including initiator and timestamps:
  `listVersionStateChanges` and `history`.
- App Privacy questionnaire declarations and publication state: `listDataUsages`,
  `getDataUsagePublishState`, and `privacy`. The public API exposes privacy-policy URL/text
  fields but not the `dataUsages` questionnaire represented here.

This is an API-surface conclusion, not a promise that every private response field is
useful. Each retained function still needs captured evidence and tests.

## Remove: official duplicates

### Apps, versions, builds and App Review information — *removed 2026-08-21*

`listApps`, `getApp`, `listAppVersions`, `getVersion`, `listBuilds`, `listBuildCandidates`,
`updateVersion`, `setVersionBuild`, `getReviewDetails`, `findReviewDetails`,
`redactReviewDetails`, `fetchBuilds`, `formatBuilds`, `BuildChoice`, `LIVE_VERSION_STATES`
and the `apps`, `app`, `versions`, `version`, `builds`, `set-build` and `review-details`
commands are gone, with the `--reveal` flag and the default-id discovery that existed only
to serve them.

Re-audited against 4.4.1 on the day of removal: `apps_getCollection`, `apps_getInstance`,
`apps_appStoreVersions_getToManyRelated`, `appStoreVersions_getInstance`,
`appStoreVersions_updateInstance`, `builds_getCollection` and
`appStoreReviewDetails_getInstance` are all official, and every attribute read or written
is on Apple's own schema — including the `build` relationship on
`AppStoreVersionUpdateRequest` that `set-build` sent.

Four include names and one filter had no official schema: `displayableVersions`,
`resetRatingsRequest`, `gameCenterConfiguration`, `ageRatingDeclaration` *as a relationship
of a version* (Apple hangs it off `AppInfo`), and `filter[isAppStoreCandidate]`. Nothing in
this client read any of them, so a keep narrowed to exactly that field would have narrowed
to nothing, and the filter has an official spelling anyway
(`filter[buildAudienceType]=APP_STORE_ELIGIBLE`). **`resetRatingsRequest` is worth
remembering**: resetting an app's ratings has no official API, so it is a gap this client
never built rather than one it gave up.

`asc history` now requires an explicit `versionId`; the discovery that filled it in was a
read of `apps/{id}/appStoreVersions`.
### Review submissions and items — *removed 2026-08-21*

The whole submission read/write surface and the `submissions`, `submission`, `items`,
`resolve-item`, `submit` and `cancel-submission` commands, with `--dry-run`. Official:
`apps_reviewSubmissions_getToManyRelated`, `reviewSubmissions_getInstance`/`createInstance`/
`updateInstance`, `reviewSubmissions_items_getToManyRelated` and
`reviewSubmissionItems_createInstance`/`updateInstance` — down to `resolved`, `submitted`
and `canceled` spelled exactly as the private writes spelled them.

`createdByActor` was the one non-official include, and nothing here ever read it, so there
was no capability to narrow to. `asc report --submission` stays: it reaches the Resolution
Center through `resolutionCenterThreads?filter[reviewSubmission]`, a private filter, and
reads no submission.

### Metadata, categories, age ratings and content rights — *removed 2026-08-21*

The App Information and version-localization read/write surface and the `metadata`,
`set-metadata`, `app-info`, `categories`, `set-categories`, `age-rating`, `set-age-rating`,
`territory-ratings` and `set-content-rights` commands. Official: `appInfos`,
`appInfoLocalizations`, `appStoreVersionLocalizations`, the six category relationships,
`ageRatingDeclarations` and `appInfos/{id}/territoryAgeRatings`, attribute for attribute.

**One field-level keep was deferred, not taken:** `gracRatingClassificationNumber`, in
[grac-rating-classification-number-gap.md](grac-rating-classification-number-gap.md). The
only recorded write is the whole 29-answer questionnaire, so keeping it means resending 28
official fields.

### Screenshots and previews — *removed 2026-08-21*

`src/screenshots.ts` and the `screenshots`, `previews`, `screenshot-set`,
`upload-screenshot` and `delete-screenshot` commands. Official: `appScreenshotSets`,
`appScreenshots`, `appPreviewSets` and `appPreviews`, down to the `uploadOperations` the
private upload flow ran on.

### Users and invitations — *removed 2026-08-21*

`listUserInvitations`, `inviteUser`, `UserInvite` and the `invites`/`invite` commands.
Official: `GET`, `POST` and `DELETE /v1/userInvitations`, with `visibleApps` on the create
request. Every attribute sent and read back is on `UserInvitation.Attributes`; there was no
field to narrow to. This was also the last account-wide surface — everything retained is
about an app.

### Xcode Cloud — *removed 2026-08-21*

All `ci-*` commands, `src/ci.ts` and the `/ci/api` transport base. Official:
`ciProducts_*`, `ciWorkflows_*`, `scmRepositories_*`, `ciBuildRuns_*`, `ciBuildActions_*`,
`ciIssues_*`, `ciTestResults_*`, including workflow create/update and starting a build.

**Two field-level gaps were left behind here**, both open questions rather than settled
removals: `CiWorkflow.post_actions` in
[ci-transport-403-and-post-actions-gap.md](ci-transport-403-and-post-actions-gap.md), and
the whole Xcode Cloud usage, capabilities and infrastructure-validation surface in
[xcode-cloud-usage-gap.md](xcode-cloud-usage-gap.md). Both need the base restored to act on.

### Generic escape hatches — *removed and narrowed 2026-08-21*

`rawPatch` and the `patch` command are gone outright. There is no captured evidence for a
hand-written body at an arbitrary path, it had no confirmation and no preview, and it left
every official write the slices above deleted reachable by hand.

`raw`/`get` survives, constrained to an explicit allowlist and refusing anything else
before a request is built: `resolutionCenterThreads`, `resolutionCenterMessages`,
`resolutionCenterDraftMessages`, `resolutionCenterMessageAttachments` and
`reviewRejections` whole, plus `apps/{id}/{resolutionCenterThreads,dataUsages,dataUsagePublishState}`
and `appStoreVersions/{id}/appStoreVersionStateChanges`. Traversal is refused with them.

Two things decided the shape. **Whole families, because the type is the gap** — each of
those five occurs zero times in 4.4.1's 966 paths and 1,393 schemas, so nothing inside one
can duplicate an official read, and a new gap can still be found without the boundary
moving. **The parent of a private relationship is out of scope** — `apps/{id}/dataUsages`
is a gap and `apps/{id}` is `GET /v1/apps/{id}`, one segment apart, which is why the
sub-resources are keyed by parent rather than folded into the family list. `apps` bare is a
gap for one query only, the unread counts, and that is `inbox`.

Consequences recorded rather than acted on: `REVIEW_DETAIL_SECRETS` in `src/log.ts` now has
no route by which `demoAccountPassword` could arrive and **stays anyway** — a redaction
keyed on a field name is a standing rule, not a reaction to a caller. And the
`application/json` fallback in `headersFor` was left unreachable rather than merely narrow,
for step 5, which has since removed it.

## Refactor order

Steps 1–4 are done. What remains:

- ~~Simplify the transport back to the private `iris/v1` host and only the methods/content
  types required by retained gaps.~~ *Done, 2026-08-21.* Credential isolation, redaction,
  confirmations and the `http.write` audit records were preserved unchanged, and the gap
  request tests passed unedited, which is what shows nothing moved on the wire.
- ~~Rewrite the README and topic docs as a gap-only client. Do not leave compatibility
  aliases or deprecated wrappers for removed official duplicates.~~ *Done, 2026-08-21.*
  There were no aliases or wrappers to leave — nothing forwards to Apple's API — so what
  this took was replacing the removal narrative with a description of what the client is.
  Every user-facing page now states its own surface and its audit date; `docs/evidence.md`
  keeps the recordings' durable observations under one archive heading, since what they
  established about Apple's *records* outlives the code that made them; and the
  function-by-function inventory lives here, in this task, and nowhere else.

## Documentation acceptance criteria

- The README states that official App Store Connect API keys exist and are the required
  path for all officially supported capabilities; browser cookies are only for the private
  gaps this project retains.
- The feature list contains only retained gaps and links to Apple's official API for
  everything removed.
- `docs/reading.md`, `docs/writing.md`, `docs/library.md`, `docs/evidence.md`, and
  `CLAUDE.md` contain no removed commands, functions, endpoints, or assertions that this
  client is a general App Store Connect client.
- `docs/replying.md` remains and explicitly records that the audited official specification
  has no Resolution Center message/draft/rejection resources.
- Every “Apple has no official API” statement names the audit date and OpenAPI version so
  it can age visibly.
- A repository-wide search finds no stale Xcode Cloud, screenshot, invitation, metadata,
  app information, build-selection, or submission-management claims outside migration
  history in this task.

## Verification

- `rg` the removed command names, exported functions, private routes, and official
  operation IDs to prove each vertical slice is gone.
- Run `npm run typecheck`, `npm test`, and `npm run build`.
- Exercise retained reads only with a fresh browser session; do not make a live write as
  migration verification.
- Download the current official OpenAPI specification again at completion and record its
  version/date in the README and evidence docs.

## Success

Every public command and exported API in this repository provides a capability absent from
Apple's official App Store Connect API. When Apple adds one of those capabilities later,
the documented policy is to remove it here in favor of Apple's version.
