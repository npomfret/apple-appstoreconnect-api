# Evidence and limits

This is an undocumented, private API, and the calls here are not all equally well
evidenced. This page says which is which.

## What isn't captured yet

The captured writes are the version PATCH behind `set-build`, all four App Information page
PATCHes — `set-metadata`, `set-categories`, `set-age-rating`, `set-content-rights` — the
screenshot flow, the Resolution Center draft behind `save-draft` and `delete-draft`,
sending it (`send-reply`), resolving a submission item (`resolve-item`), and the People
page's invitation POST behind `invite`.

What's left uncaptured, and so the part to read about before use: the **version half of
`set-metadata`** — a description, keywords, promo text or what's new — **creating a
submission and adding a version to it** (the two POSTs inside `submit`), and
`cancel-submission`. Record any of them in the browser and they can be put on the same
footing as the rest.

The **submit PATCH itself is no longer a guess**, though it is still not a capture — see
"Confirmed by running it" below.

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
- `listAppInfos`, `getReviewDetails`, and the localizations-with-assets call behind
  `screenshots`.
- From one attach-a-build-and-save: `listBuilds`, `listBuildCandidates`, `listPreviewSets`
  and the `set-build` PATCH body.
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
- From one invitation sent on the People page: `listUserInvitations` — the whole query
  including `sort=lastName` and the `fields[apps]=` that names the visible apps by id — and
  the `inviteUser` POST, whose body is replayed against the recording by
  `test/invite.test.ts` and matches it byte for byte, attribute order included, on
  `application/vnd.api+json` rather than the `application/json` the App Information writes
  use. What that recording does *not* cover
  is the rest of the page: **no revoke call, no user list, and no app-restricted
  invitation** — the browser sent `allAppsVisible: true` and no `visibleApps` relationship,
  so `invite` requires `--all-apps` rather than inventing the other shape. It also only
  witnesses one role (`CUSTOMER_SUPPORT`) and `provisioningAllowed: false`; the other role
  names and `true` come from Apple's public API docs and are passed through unchecked, the
  same trade as `set-content-rights`. Note the invitation is the one write here that this
  client cannot reverse *and* that reaches a third party: Apple emails the person.
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
- `deleteDraftMessage` is the other way round: the request was copied from the browser's
  **Delete Draft** button, so the shape is certain, but this client has never run it — the
  one open thread's draft had already been deleted in the browser, and closed threads won't
  take a scratch draft to practise on. Its [documented
  aftermath](replying.md) is what was observed after the browser did it.

## Seen but deliberately not mapped

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
