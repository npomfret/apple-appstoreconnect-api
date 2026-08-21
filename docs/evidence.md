# Evidence and limits

This is an undocumented, private API, and the calls here are not all equally well
evidenced. This page says which is which.

It is not all unique functionality. An audit on 2026-08-20 against Apple's official
OpenAPI specification 4.4.1 found that submissions, versions/builds, metadata and App
Information, screenshots/previews, users/invitations, and all Xcode Cloud code duplicate
official operations. Xcode Cloud, the invitations and the screenshots and previews have
since been removed; the rest are pending removal, and the exact inventory and official operation mapping is in
[the removal task](../tasks/remove-official-api-overlap.md). Evidence that a
private call works is not a reason to retain it when Apple supports the capability. The
official replacements are Apple's
[App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata),
[Review Submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions),
[Users and Invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations),
and [Xcode Cloud](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds)
API collections.

## What isn't captured yet

The captured writes are the version PATCH behind `set-build`, all four App Information page
PATCHes — `set-metadata`, `set-categories`, `set-age-rating`, `set-content-rights` — the
Resolution Center draft behind `save-draft` and `delete-draft`, sending it (`send-reply`)
and resolving a submission item (`resolve-item`).

What's left uncaptured, and so the part to read about before use: the **version half of
`set-metadata`** — a description, keywords, promo text or what's new — **creating a
submission and adding a version to it** (the two POSTs inside `submit`), and
`cancel-submission`. Record any of them in the browser and they can be put on the same
footing as the rest.

The **submit PATCH itself is no longer a guess**, though it is still not a capture — see
"Confirmed by running it" below.

Recorded and **never mapped**: the Xcode Cloud workflow replace,
`PUT /ci/api/teams/{team}/products/{product}/workflows-v15/{id}`. The shape is fully known
and it was still not written, because it is a **full-document replace** on the workflow that
builds every push — the browser resent the whole workflow to change one test destination, so
anything omitted from that body is destroyed. That argument is now moot here: Apple supports
workflow updates officially and the private Xcode Cloud code has been removed.

## Confirmed by running it

Weaker than a capture and stronger than an inference: the call was made against iris and
iris did the thing. It says the request works, not that it is the one the browser sends.

- `submitReviewSubmission` — `PATCH reviewSubmissions/{id} {"submitted":true}`, run
  2026-08-19 against a submission sitting in `UNRESOLVED_ISSUES` with its only item already
  resolved. `200`, and the submission came back `state: WAITING_FOR_REVIEW` with
  `submittedDate` stamped to the second. The version moved `READY_FOR_REVIEW` →
  `WAITING_FOR_REVIEW` in its own history alongside it.

  What that run also exposed: `planSubmission` had been reading "has a `submittedDate`" as
  "is with Apple", which is wrong for a rejection — it always carries the date of the run
  that was refused. `submit` therefore refused and pointed at `resolve-item`, which refused
  in turn because the item was no longer `REJECTED`. Two commands pointing at each other,
  and the only way out was `asc patch` by hand. Fixed, and pinned by `test/submission.test.ts`.

- `listUserInvitations` and `inviteUser` — run 2026-08-19 from this client, and **that code
  has since been removed**: `userInvitations` is the same JSON:API type Apple serves
  officially, with the same six attributes, so it was never a gap. Two observations from
  that run outlive it, and both are about Apple rather than about this client, so they hold
  for the official API too.

  **Apple refuses plus-addressing on an invitation.** `POST userInvitations` with a
  plus-tagged address came back `409 ENTITY_ERROR.ATTRIBUTE.INVALID`, "Email format not
  valid.", pointing at `/data/attributes/email`; case was not the issue. The invitee's
  address becomes an Apple ID, and Apple is stricter about those than a mail server is —
  Gmail would have delivered the tag to the base inbox. Reaching per-attribute validation
  also meant iris had accepted the envelope, the type, the `application/vnd.api+json`
  content type, the session and the team headers before objecting to the one value.

  **"All apps" is stored as the list, not as the flag.** An invitation sent from the People
  page with `allAppsVisible: true` and no `visibleApps` relationship read back a moment
  later as `allAppsVisible: null` with `visibleApps` naming every app on the account. One
  observation, not a rule, and worth knowing before reading that field as a boolean.

  The read itself established nothing beyond `200` and an empty collection, and no
  invitation was ever created by this client.

## Capturing a new endpoint

Record dev tools → Network while doing the thing in the browser and export the log (a
`.har`): every request *and response* is in there, which is far more than "Copy as cURL"
gives you one at a time. Such an export contains the full session cookie in plain text, so
keep it in `tmp/` with everything else gitignored. The capture file this client reads is a
different thing — it wants a curl command or a `Cookie:` line.

## Calls confirmed against the browser

Each of these was recorded from App Store Connect doing it, and the request this client
sends matches what the browser sent.

Include lists, page sizes and fieldsets are defaults rather than fixed values — a caller can
name a different one — so what is compared below, and what you get by asking for nothing in
particular, is the browser's own. The include lists are the ones to leave alone without a
reason: an unrecognised relationship name is a `400` on the whole request, so the captured
list is the tested one and an override is not.

- `listMessages` and `getDraftMessage` — includes and the `limit[rejections]=2000` /
  `limit[resolutionCenterMessageAttachments]=1000` pair match exactly. The browser sends no
  top-level `limit` on the messages call and neither does this by default, so a thread
  longer than iris's own page comes back clipped at the end; `read.clipped` and
  `read.atLimit` in the log say when that may have happened, and `listMessages`'s `limit`
  option is how to look further. Whether iris reports a total to check against is per
  endpoint, and not something any recording here settles — the warning uses one when it is
  offered and falls back to "the page is exactly as long as we asked for" when it isn't.
- `listThreads` — the app's Resolution Center thread list, and since the thread-first
  rebuild the starting point of `report`. The include list, the seven `filter[threadType]`
  values and `limit[appStoreVersions]=2000` are the browser's own. Two things that query
  settles and this client relies on: a thread carries its `appStoreVersions` directly, so
  the version a conversation is about needs no submission read; and that relationship is
  **to-many**, which is why `report` lists every version a thread names instead of
  promoting one. What no recording here settles is a thread's own *attributes* — nothing in
  this client reads one, and `threadType` appears only as a filter value, so treat any
  attribute on a thread resource as unmapped.
- `listAppInfos` and `getReviewDetails`.
- From one attach-a-build-and-save: `listBuilds`, `listBuildCandidates` and the `set-build`
  PATCH body.
- From the History, Trust & Safety and Growth tabs: `listVersionStateChanges` (the browser
  sends no query at all; the `limit` is ours, and tested), `listAppVersions`,
  `listDataUsages` and `getDataUsagePublishState`.
- From one real send: `sendDraftMessage` — the `createFromDraftMessage` POST, its `201`,
  and the thread read back with the new message on it.
- From one real resolve: `resolveSubmissionItem` — the `{"resolved":true}` PATCH and the
  `READY_FOR_REVIEW` that comes back.
- From one Save on the App Information page:
  - the `appInfoLocalizations` PATCH behind `set-metadata`. Plain `application/json`, the
    `{"data":{type,id,attributes}}` envelope with the id repeated inside, and only the
    edited fields in it — which is what `setMetadataField` sends. The browser put `name`
    and `subtitle` in one body where this client writes one field per call; a
    single-attribute body is a subset of the recorded one, not a different shape.
  - `PATCH appInfos/{id}`, same `application/json`, setting categories through
    **relationships** rather than attributes: `primaryCategory`, `secondaryCategory`,
    `primarySubcategoryOne`, `primarySubcategoryTwo`, each a
    `{"type":"appCategories","id":"GAMES"}` linkage where the id is the category's name.
    Only the relationships being changed are sent.
    Behind `set-categories`.
  - `GET appInfos/{id}` read back with
    `include=primaryCategory,primarySubcategoryOne,primarySubcategoryTwo,secondaryCategory,secondarySubcategoryOne,secondarySubcategoryTwo`
    — verbatim what `categories` sends.
  - `PATCH apps/{appId}` setting the `contentRightsDeclaration` attribute, behind
    `set-content-rights`.
  - `PATCH ageRatingDeclarations/{id}` sending all 29 questionnaire answers in one body,
    behind `set-age-rating`. The body this client builds was replayed offline against the
    recording and is **identical to it byte for byte**, key order included — the question
    list in `AGE_RATING_QUESTIONS` is that body's own order. Note what that list is *not*:
    those 29 are one app's questionnaire on one account, and nothing seen here says every
    app is asked the same set. So they only order a body; which questions exist comes from
    the attributes of the declaration Apple returns for the app being edited — its
    attributes and not a denormalized view of it, since that would fold the record's
    relationships in among the answers.
  - the page's own two reads, behind `app-info`/`categories`/`age-rating` and
    `territory-ratings`: `GET apps/{appId}/appInfos` with the category includes plus
    `ageRatingDeclaration,app` and `fields[apps]=isOrEverWasMadeForKids`, and `GET
    appInfos/{id}/territoryAgeRatings?include=territory&limit=500`.

  Two details of `set-categories` are *not* in that recording: the browser set
  `primaryCategory`, `secondaryCategory` and both primary subcategories, so
  `secondarySubcategoryOne`/`Two` are taken on the symmetry of the include list, and
  clearing a slot borrows the `{"data":null}` form that `set-build none` was captured
  using. Both are labelled in `setAppCategories`.

  What the recording covers is the request *shapes*, not the range of answers. Every
  frequency question came back `"NONE"` and content rights came back
  `DOES_NOT_USE_THIRD_PARTY_CONTENT`, so the values on the other side of those questions —
  `INFREQUENT_OR_MILD`, `FREQUENT_OR_INTENSE`, `USES_THIRD_PARTY_CONTENT` — are Apple's
  public API documentation, not evidence from here. Both commands check the field names and
  pass the values through: a value iris won't take is a 4xx, which beats this client
  refusing a legitimate answer it has never seen. `set-age-rating` insists on a complete
  questionnaire for the same reason in reverse — no partial body was ever recorded, so
  whether an omitted answer is left alone or cleared is simply unknown.
- One invitation sent on the People page was recorded and mapped, and **that code has been
  removed** — `listUserInvitations`, `inviteUser`, `UserInvite`, the `invites` and `invite`
  commands, `test/invite.test.ts` and `docs/people.md` all went with it. It was well
  evidenced and that was never a reason to keep it: re-checked on 2026-08-21, Apple's
  `UserInvitation.Attributes` carries `email`, `firstName`, `lastName`, `roles`,
  `provisioningAllowed`, `allAppsVisible` and `expirationDate` — every attribute this client
  sent, plus the one it read back — `UserInvitation.Relationships` carries `visibleApps`, and
  `GET`, `POST` and `DELETE /v1/userInvitations` are all official. There was no field to
  narrow to. Apple's [User Invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations)
  API also covers what the recording never did: revoking an invitation, listing the people
  already on the account, and restricting an invitation to named apps.
- The screenshot and preview reads were recorded and the upload flow was run end to end,
  and **that code has been removed** — `src/screenshots.ts`, `listVersionLocalizationsWithAssets`,
  `listScreenshotSets`, `listPreviewSets`, `createScreenshotSet`, `reserveScreenshot`,
  `completeScreenshot`, `deleteScreenshot`, `deleteScreenshotSet`, `findScreenshotSet`,
  `uploadScreenshot`, the `screenshots`, `previews`, `screenshot-set`, `upload-screenshot`
  and `delete-screenshot` commands, the `--force` flag and `docs/screenshots.md` all went
  with it. Re-checked on 2026-08-21 against Apple's published schemas:
  `AppScreenshot.Attributes` carries `assetDeliveryState`, `assetToken`, `assetType`,
  `fileName`, `fileSize`, `imageAsset`, `sourceFileChecksum` and **`uploadOperations`** —
  the last being the one that makes the whole reserve → upload → commit flow official, not
  just the reads — `AppScreenshotSet.Attributes` carries `screenshotDisplayType`,
  `AppPreviewSet.Attributes` carries `previewType`, `AppPreview.Attributes` carries
  `uploadOperations` too, and creating, modifying, listing and deleting screenshots and
  screenshot sets are all documented operations. There was no field to narrow to. Apple's
  [App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata)
  API is where this went.

  **The display-type list was already Apple's.** `SCREENSHOT_DISPLAY_TYPES` held 33 values,
  obtained by POSTing an invalid `screenshotDisplayType` and reading the 409 back. Checked
  on 2026-08-21, Apple's published `ScreenshotDisplayType` enum is the same 33 values. The
  private route to that list was a shortcut to something Apple publishes.

  Three observations from the live run outlive the code, and the first two are about the
  resource rather than about this client, so they hold for the official API too.

  **The commit is what makes an asset real.** `assetDeliveryState` reads `UPLOAD_COMPLETE`
  the moment the `{"uploaded":true}` PATCH lands and `COMPLETE` once Apple has processed the
  file, at which point `sourceFileChecksum` — an MD5 — and a `downloadUrl` appear. Skip that
  PATCH and the reservation stays an invisible empty slot that never reaches the version
  page. Both attributes are on Apple's official `AppScreenshot`, so the same sequence is
  observable there.

  **iris would not serve a set by id.** `GET appScreenshotSets/{id}` answered `404` for a
  set that demonstrably existed, and `appScreenshots?filter[appScreenshotSet]=` was refused
  `403`, which is why the removed `findScreenshotSet` went via the localization instead.
  Apple documents `GET /v1/appScreenshotSets/{id}` officially, so read that as an iris
  quirk and not as a property of the resource.

  **Accepted pixel dimensions are in no API response.** The removed `SCREENSHOT_SIZES` was
  transcribed by hand from the drop-zone captions on the version page and covered three zone
  families out of the 33 display types, deliberately: an absent entry skipped the check
  rather than guessing, because a wrong entry would reject a good screenshot. Nothing was
  lost from an API by deleting it — a pre-flight size check is a client convenience, and
  Apple validates server-side either way.

  What survives is the transport underneath: `uploadPart` in `src/http.ts` still sends
  presigned parts to `object-storage.apple.com` with no cookie, because draft attachments
  reserve and upload through the same three steps and they are a retained gap.
- Two Xcode Cloud sessions were recorded and mapped, and **that code has been removed** —
  `src/ci.ts`, the nine `ci-*` commands, the `ci-run` build digest, `test/ci.test.ts` and
  `test/run.test.ts` all went with it, along with the transport's second base. Apple's
  official `ciProducts`, `ciWorkflows`, `scmRepositories`, `ciBuildRuns`, `ciBuildActions`,
  `ciTestResults` and `ciIssues` operations cover the same ground, and being well evidenced
  was never a reason to keep a duplicate. Retaining the one field that may not be covered —
  `post_actions` on a workflow — is an open question and not settled by this page.

  Two observations from that recording are worth keeping, because they would apply again to
  anything built on `/ci/api`. The browser sends **`x-apple-signature`** — 64 base64 bytes,
  with an `x-apple-signed-at` timestamp — on every call, and 21 calls carried 21 different
  values, so the page signs each request in its own JavaScript and this client never could.
  One recorded call went out *without* the pair and came back `404 "Product does not exist"`
  — routed and answered rather than refused — which is why the cookie looked like what
  authenticates. That is one request's worth of evidence, not a guarantee.
- From one draft reply with an attachment: `createDraftMessage`, `updateDraftMessage`,
  `reserveMessageAttachment` and `completeMessageAttachment` — all four bodies replayed
  offline against the recording and match the browser's byte for byte. Editing an existing
  draft, recorded separately, replays through `updateDraftMessage` and `getDraftMessage`
  with nothing new in it.

## Calls that are probe-only, and so likelier to shift

- `listVersionLocalizations` (the path form — the browser uses a filter on the collection
  instead) and `listAppInfoLocalizations`.
- `setMetadataField` is captured on its app info half (above) but **not on its version
  half**: no recording of a `appStoreVersionLocalizations` PATCH exists. That one still
  rests on the captured version PATCH's envelope, down to the `application/json`, with
  field names read off captured responses — now with the app info capture showing the same
  envelope on a localization, which is the closest thing to a witness it has. **Both halves
  have been run**: each was PATCHed with the value it already held — a real request that
  changed nothing — and both returned 200 with the record intact. The one
  thing that test flushed out is worth knowing: the *first* `appInfos` record is the live
  one, and writing to it is refused with `409
  ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_STATE`. `findEditableAppInfo` picks by state now.
- `submit` (`createReviewSubmission`, `addSubmissionItem`, `submitReviewSubmission`) and
  `cancelReviewSubmission` are **the least evidenced writes here, and among the most
  consequential**. No recording, and no way to rehearse one: the only test is a real
  submission. They rest on Apple's public App Store Connect API documenting this flow on
  these resource names, plus the fact that iris shares that model — the `resolved`
  attribute that *was* captured is the public API's own. Expect them to work; don't assume
  it. `asc submit --dry-run` prints the plan without sending, and a failed run says which
  of the three steps it reached, because a half-made submission on the account is the
  outcome worth being able to see.
- `deleteScreenshot`, `deleteScreenshotSet` and `deleteMessageAttachment` were **probed,
  not captured** — no browser request for any of them was ever copied. They work
  (`deleteMessageAttachment` returns a 204 and the attachment is gone on the next read),
  but they're the least evidenced calls here, and they destroy live data.
- `sendDraftMessage` and `resolveSubmissionItem` are certain in shape — both were recorded
  from the real thing — but **this client has never run either**. Everything up to the
  point of no return has been exercised against live data: the draft is read back, the
  confirmation renders it, declining stops before any request leaves. The request itself
  waits for a submission worth spending. Until then, treat the first run as the test.
  `sendDraftMessage` is a Resolution Center gap and stays; `resolveSubmissionItem`
  duplicates the official `reviewSubmissionItems_updateInstance` operation and is pending
  removal.
- `deleteDraftMessage` is the other way round: the request was copied from the browser's
  **Delete Draft** button, so the shape is certain, but this client has never run it — the
  one open thread's draft had already been deleted in the browser, and closed threads won't
  take a scratch draft to practise on. Its [documented
  aftermath](replying.md) is what was observed after the browser did it.

## Queries narrowed away from the capture

One query here is deliberately *not* what the browser sends.

`listAppMetrics` — the `inbox` command — is a request to `apps`, which Apple serves
officially. It is retained for two counts the official API has no schema for:
`appStoreVersionMetrics.messageCount` and `betaReviewMetrics.messageCount`. Re-checked on
2026-08-20 against the current OpenAPI specification **4.4.1** (generated 2026-07-15, 966
paths, 1,393 schemas, downloaded from
`https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip`):
`appStoreVersionMetrics`, `betaReviewMetrics` and `messageCount` occur zero times in the
whole document.

The browser's version of that request also sideloads `reviewSubmissions` with
`fields[reviewSubmissions]=state` and `limit[reviewSubmissions]=10`. Apple serves that at
`GET /v1/apps/{id}/reviewSubmissions`, `state` and its seven-value enum included, so this
client does not send it. **The shortened query has not been recorded from the browser.**
Dropping a relationship is the safe direction to differ — iris 400s an include name it does
not recognise and cannot 400 one that is no longer asked for — but it is a difference, and
if the counts ever stop arriving this is the first thing to put back.

`fields[apps]` naming only those two relationships is the rest of what makes this a gap
read: the apps come back as bare ids, with none of the attributes Apple's own `App`
resource already carries. Widening it turns the call back into a duplicate app listing.

`report`'s starting point used to be the other case here, and no longer is. All three of
its routes are private: an app id lists the app's Resolution Center threads, `--submission`
filters that list, `--thread` skips discovery altogether. The version a report names comes
off the thread rather than off `appStoreVersionForReview`, so no route reads
`apps/{id}/reviewSubmissions`. What went with the official read is the submission's state,
platform and dates: they are Apple's to serve, so they were dropped from the digest rather
than left as fields nothing fills in.

## Seen but deliberately not mapped

From the Xcode Cloud tab: the pickers behind the workflow editor —
`test-destinations-v3`, `configuration-options-v10`, `product-configuration-options-v4`,
`schemes`, `version-aliases-v3`, `scm-providers-v2`, `notices-v2`,
`testflight/information-v2`, `repos/{id}/branch`, `product-environment-variables` — all
recorded, none ever mapped: they exist to fill in a form this client does not render. Moot
now in any case, since the whole `/ci/api` surface is out of scope: Apple exposes Xcode
Cloud officially, and `asc get` cannot reach it, being `iris/v1` only.

Recordings of the Monetization, Growth & Marketing and Trust & Safety tabs turn up about 40
further endpoints. Pricing is the substantial one — `appPriceSchedules/{appId}/automaticPrices`
and `/manualPrices` (price points are base64 blobs of `{s,t,p}`: app, territory, tier),
`/baseTerritory`, `apps/{id}/supportedTerritories`, `taxCategories` — left alone as a
different domain from review, and a write surface worth respecting. The rest were empty on
this account and so unverifiable: `appCustomProductPages`, `appEvents`,
`appStoreVersionExperimentsV2`, `inAppPurchasesV2`, `subscriptionGroups`,
`customerReviewSummarizations`, `accessibilityDeclarations`, `appEncryptionDeclarations`,
`backgroundAssets`, `appClips`. `asc get` reaches all of them without a code change.

## The standing caveat

This is an undocumented, private API. It can change without warning, and automating it
is on you with respect to Apple's terms.
