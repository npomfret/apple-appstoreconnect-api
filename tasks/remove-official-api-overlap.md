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

### Review submissions and items

Remove:

- `listReviewSubmissions`, `getReviewSubmission`, `listSubmissionItems`.
- `resolveSubmissionItem`.
- `createReviewSubmission`, `addSubmissionItem`, `submitReviewSubmission`,
  `cancelReviewSubmission`, `planSubmission`, and `runSubmission`.
- Helpers used only by those flows, including `submissionIdFromItemId` and
  `findSubmissionItems`.

Official equivalents include `reviewSubmissions_getCollection`,
`reviewSubmissions_getInstance`, `reviewSubmissions_createInstance`,
`reviewSubmissions_updateInstance`, `reviewSubmissions_items_getToManyRelated`,
`reviewSubmissionItems_createInstance`, and `reviewSubmissionItems_updateInstance`.

Commands affected: `submissions`, `submission`, `items`, `resolve-item`, `submit`, and
`cancel-submission`.

Refactor `report` before deleting these dependencies. Make it thread-centric and use only
private Resolution Center resources, accepting an explicit app, submission, or thread ID
where the private API cannot discover one without duplicating an official read. Do not add
official authentication just to preserve the current report UX.

### Metadata, categories, age ratings and content rights

Remove:

- `listAppInfos`, `listAppInfoLocalizations`, `findEditableAppInfo`,
  `pickEditableAppInfo`, `listVersionLocalizations`, `findMetadataField`,
  `setMetadataField`, and metadata-only helpers.
- `getAppInfoCategories`, `setAppCategories`, and `listAppInfoPage`.
- `findAgeRatingDeclaration`, `listTerritoryAgeRatings`, `setAgeRating`, and
  questionnaire-only parsing/helpers.
- `setContentRights`.

Official equivalents include `apps_appInfos_getToManyRelated`,
`appInfos_getInstance`, `appInfos_updateInstance`,
`appInfos_appInfoLocalizations_getToManyRelated`,
`appInfoLocalizations_updateInstance`,
`appStoreVersions_appStoreVersionLocalizations_getToManyRelated`,
`appStoreVersionLocalizations_updateInstance`,
`appInfos_ageRatingDeclaration_getToOneRelated`,
`ageRatingDeclarations_updateInstance`, and
`appInfos_territoryAgeRatings_getToManyRelated`. `apps_updateInstance` covers the app
attributes currently changed by `set-content-rights`.

Commands affected: `metadata`, `set-metadata`, `app-info`, `categories`,
`set-categories`, `age-rating`, `set-age-rating`, `territory-ratings`, and
`set-content-rights`.

### Screenshots and previews

Remove the entire screenshot implementation, including `src/screenshots.ts`, its exports,
upload validation/constants, the asset upload orchestration in `src/api.ts`, and related
tests and audit examples that no longer describe retained behavior.

Official operations cover screenshot/preview set creation and deletion, asset reservation,
upload commit/update, reads, and deletion: `appScreenshotSets_*`, `appScreenshots_*`,
`appPreviewSets_*`, and `appPreviews_*`.

Commands affected: `screenshots`, `previews`, `screenshot-set`, `upload-screenshot`, and
`delete-screenshot`. Remove `docs/screenshots.md` after the commands are removed and link
users to Apple's app-metadata API documentation.

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
