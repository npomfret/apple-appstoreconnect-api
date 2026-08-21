# Remove functionality covered by the official App Store Connect API

## Status

Proposed. This task defines the product boundary; it does not authorize live App Store
Connect writes. It superseded `xcode-cloud-evidence.md`, which has since been deleted along
with the rest of the Xcode Cloud slice: Xcode Cloud has an official API and therefore does
not belong in this project.

The order this should be carried out in, and two corrections to the inventory below, are in
[gap-boundary-next-steps.md](gap-boundary-next-steps.md).

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

### Apps, versions, builds and App Review information

Remove these private reads/writes and their CLI/library/report helpers:

- `listApps`, `getApp` (`apps_getCollection`, `apps_getInstance`).
- `listAppVersions`, `getVersion` (`apps_appStoreVersions_getToManyRelated`,
  `appStoreVersions_getInstance`).
- `listBuilds`, `listBuildCandidates` (`builds_getCollection`).
- `updateVersion`, `setVersionBuild` (`appStoreVersions_updateInstance` and
  `appStoreVersions_build_updateToOneRelationship`).
- `getReviewDetails`, `findReviewDetails`, `redactReviewDetails`
  (`appStoreReviewDetails_getInstance`; official create/update and attachment operations
  exist too).

Commands affected: `apps`, `app`, `versions`, `version`, `builds`, `set-build`, and
`review-details`. Remove any fallback/default-ID discovery that exists only to support
these commands.

### Review submissions and items — *removed 2026-08-21*

`listReviewSubmissions`, `getReviewSubmission`, `listSubmissionItems`,
`resolveSubmissionItem`, `createReviewSubmission`, `addSubmissionItem`,
`submitReviewSubmission`, `cancelReviewSubmission`, `planSubmission`, `runSubmission`,
`SubmissionPlan`, `OPEN_SUBMISSION_STATES`, `submissionIdFromItemId` and
`findSubmissionItems` are gone from `src/api.ts`, with the `reviewSubmissions` and
`submissionItems` entries in `INCLUDES` and the `reviewSubmissions` entry in `SIDELOADS`.
`src/cli.ts` loses the six commands, `describeItem`, `describePlan`, `versionInReview` and
the `--dry-run` flag, which existed for `submit` alone. `test/submission.test.ts` is
deleted.

The audit was restated first, against the specification itself rather than the published
schema pages: re-downloaded 2026-08-21, still **4.4.1** (generated 2026-07-15), still 966
paths and 1,393 schemas. Every path is an official operation —
`apps_reviewSubmissions_getToManyRelated`, `reviewSubmissions_getInstance`,
`reviewSubmissions_createInstance`, `reviewSubmissions_updateInstance`,
`reviewSubmissions_items_getToManyRelated`, `reviewSubmissionItems_createInstance` and
`reviewSubmissionItems_updateInstance` — and every attribute is on an official schema:
`ReviewSubmission` carries `platform`, `state` and `submittedDate` with the same seven-value
state enum this client hard-coded six of, `ReviewSubmissionItem` carries `state`,
`ReviewSubmissionUpdateRequest` carries `submitted` and `canceled`, and
`ReviewSubmissionItemUpdateRequest` carries `resolved`. All thirteen `submissionItems`
includes are official relationship names.

**One include was not: `createdByActor`.** It is not on `ReviewSubmission.Relationships`
and not in the official include enum, which by this file's rule makes it a field-level keep
— unlike `post_actions` and `gracRatingClassificationNumber`, though, **nothing in this
client ever read it**. It appeared exactly once, in the include list copied from the
browser, and no code, test or document touched the value. There is no capability to narrow
to, so this is a whole removal and not a third open question.

`report` was made thread-first in step 3 of
[gap-boundary-next-steps.md](gap-boundary-next-steps.md) before any of this was deleted, so
nothing in `src/report.ts` needed changing here. `asc report --submission` stays: it reaches
the Resolution Center through `resolutionCenterThreads?filter[reviewSubmission]`, a private
filter, and reads no submission.

### Metadata, categories, age ratings and content rights — *removed 2026-08-21*

`listAppInfos`, `listAppInfoLocalizations`, `findEditableAppInfo`, `pickEditableAppInfo`,
`listAppInfoPage`, `getAppInfoCategories`, `setAppCategories`, `findAgeRatingDeclaration`,
`listTerritoryAgeRatings`, `ageRatingAnswersFrom`, `parseAgeRatingAnswers`, `setAgeRating`,
`setContentRights`, `listVersionLocalizations`, `metadataResourceFor`, `findMetadataField`
and `setMetadataField` are gone from `src/api.ts` with `LIVE_APP_INFO_STATE`,
`APP_CATEGORY_SLOTS`, `AppCategorySlot`, `AppCategoryUpdate`, `AGE_RATING_QUESTIONS`,
`AgeRatingAnswer`, `AgeRatingAnswers`, `METADATA_FIELDS`, `MetadataResource`,
`MetadataField` and the `territoryAgeRatings`, `appInfoCategories` and `appInfoPage`
entries in `INCLUDES` and `FIELDSETS`; `fetchMetadata` and `LocaleMetadata` are gone from
`src/report.ts`; `src/cli.ts` loses the `metadata`, `set-metadata`, `app-info`,
`categories`, `set-categories`, `age-rating`, `set-age-rating`, `territory-ratings` and
`set-content-rights` commands with `CATEGORY_FLAGS`, `takeCategoryOptions`, `AppInfoPage`,
`readAppInfoPage`, `withCategories`, `ageRatingOn`, `describeAgeRatingChange`,
`categoryIn`, `describeCategories`, `describeMetadataChange` and the six `--primary`/
`--secondary` flags, which existed for `set-categories` alone.

Re-audited 2026-08-21 against specification 4.4.1, re-downloaded that day and unchanged
(966 paths, 1,393 schemas). Every path and every attribute this slice used is official:
`apps_appInfos_getToManyRelated`, `appInfos_getInstance`, `appInfos_updateInstance`,
`appInfos_appInfoLocalizations_getToManyRelated`, `appInfoLocalizations_updateInstance`,
`appStoreVersions_appStoreVersionLocalizations_getToManyRelated`,
`appStoreVersionLocalizations_updateInstance`, `ageRatingDeclarations_updateInstance`,
`appInfos_territoryAgeRatings_getToManyRelated` and `apps_updateInstance`, with
`AppInfoUpdateRequest` writing to exactly the six category relationships this client wrote
to and `App.Attributes` carrying `contentRightsDeclaration`.

**One attribute is the exception, and it left anyway.**
`gracRatingClassificationNumber` — carried in the recorded age-rating body — occurs zero
times in 4.4.1 and is not on Apple's published `AgeRatingDeclaration.Attributes`, which
instead has `ageRatingOverride` that the recording lacked. Under this file's own rule that
is a keep narrowed to one field. It went with the slice because the only recorded write is
the whole questionnaire in one body, so preserving that field means continuing to send 28
official ones, and no single-attribute PATCH of a declaration has ever been recorded.
Retention is an open, evidence-led decision:
[grac-rating-classification-number-gap.md](grac-rating-classification-number-gap.md).

### Screenshots and previews — *removed 2026-08-21*

`src/screenshots.ts`, its `src/index.ts` export, `listVersionLocalizationsWithAssets`,
`listScreenshotSets`, `listPreviewSets`, `createScreenshotSet`, `reserveScreenshot`,
`completeScreenshot`, `deleteScreenshot`, `deleteScreenshotSet`, `findScreenshotSet`,
`uploadScreenshot` and `UploadScreenshotOptions` are gone, with the `versionAssets`,
`screenshotSets` and `previewSets` entries in `INCLUDES` and `SIDELOADS`, the
`screenshots`, `previews`, `screenshot-set`, `upload-screenshot` and `delete-screenshot`
commands, the `--force` flag that existed for the upload alone, and `docs/screenshots.md`.

Official operations cover screenshot/preview set creation and deletion, asset reservation,
upload commit/update, reads, and deletion: `appScreenshotSets_*`, `appScreenshots_*`,
`appPreviewSets_*`, and `appPreviews_*`. Re-checked on 2026-08-21 against Apple's published
schemas: `AppScreenshot.Attributes` carries `assetDeliveryState`, `assetToken`, `assetType`,
`fileName`, `fileSize`, `imageAsset`, `sourceFileChecksum` and `uploadOperations` — the last
being what makes the reserve/upload/commit flow official and not merely the reads —
`AppScreenshotSet.Attributes` carries `screenshotDisplayType`, `AppPreviewSet.Attributes`
carries `previewType`, `AppPreview.Attributes` carries `uploadOperations` too, and Apple's
`ScreenshotDisplayType` enum is the same 33 values this client had obtained from a 409. No
field was left to narrow to.

`uploadPart` and `UploadOperation` in `src/http.ts` **stay**: draft attachments run the same
three steps against `resolutionCenterMessageAttachments`, and that is a retained gap.

### Users and invitations — *removed 2026-08-21*

`listUserInvitations`, `inviteUser`, `UserInvite`, the `invites` and `invite` commands, the
`--role`, `--all-apps` and `--provisioning` flags, `test/invite.test.ts` and
`docs/people.md` are gone, along with the `userInvitations` entries in `INCLUDES`,
`SIDELOADS` and `FIELDSETS`.

Official operations include `userInvitations_getCollection`,
`userInvitations_createInstance`, `userInvitations_getInstance`, and
`userInvitations_deleteInstance`; the official API also supports users, role changes,
visible-app relationships, and revocation, so the private implementation was less complete.
Re-checked on 2026-08-21 against Apple's published schemas: `UserInvitation.Attributes`
carries every one of the six attributes `inviteUser` sent plus the `expirationDate` the CLI
printed back, and `UserInvitation.Relationships` carries `visibleApps`. No field was left to
narrow to.

### Xcode Cloud — *removed 2026-08-21*

`src/ci.ts`, its `src/index.ts` export, the `ci` transport base and its handling in
`src/http.ts`, all nine `ci-*` commands, the Xcode Cloud report types and formatters in
`src/report.ts`, `test/ci.test.ts`, `test/run.test.ts`, `docs/xcode-cloud.md` and the
superseded `tasks/xcode-cloud-evidence.md` are all gone. See step 4.1 of
[gap-boundary-next-steps.md](gap-boundary-next-steps.md) for what the slice actually took
and the one question it left open.

The official API exposes CI products, workflows, repositories, build runs, actions, issues,
test results, artifacts, macOS versions, and Xcode versions through `ciProducts_*`,
`ciWorkflows_*`, `scmRepositories_*`, `ciBuildRuns_*`, `ciBuildActions_*`, `ciIssues_*`,
`ciTestResults_*`, and related operations. It can also create/update workflows and start
builds.

### Generic escape hatches

- Remove `rawPatch` and the `patch` command. An unrestricted private PATCH invites the
  project to duplicate official writes again and bypasses the gap-only boundary.
- Replace `raw`/`get` with a gap-scoped diagnostic mechanism, or constrain it to an
  explicit allowlist of retained private resource families. It must not advertise access
  to official-only domains such as pricing, products, subscriptions, Game Center, users,
  Xcode Cloud, or metadata.

## Refactor order

1. Freeze new private mappings while re-downloading and diffing the latest Apple OpenAPI
   specification.
2. Add contract tests for the retained gap inventory so deletions do not remove Resolution
   Center, history, inbox, or App Privacy behavior accidentally.
3. Refactor `report` and CLI default-ID lookup so retained features no longer depend on
   official-duplicate reads.
4. Delete Xcode Cloud, screenshots/previews, invitations, metadata/app information,
   submission management, and generic PATCH support in coherent vertical slices. Remove
   commands, public exports, implementation, tests, and docs together in each slice.
5. Simplify the transport back to the private `iris/v1` host and only the methods/content
   types required by retained gaps. Preserve credential isolation, redaction,
   confirmations, and audit logs for retained private writes.
6. Rewrite the README and topic docs as a gap-only client. Do not leave compatibility
   aliases or deprecated wrappers for removed official duplicates.

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
