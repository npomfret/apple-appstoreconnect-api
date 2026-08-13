# Evidence and limits

This is an undocumented, private API, and the calls here are not all equally well
evidenced. This page says which is which.

## What isn't captured yet

The captured writes are the version PATCH behind `set-build`, the screenshot flow, the
Resolution Center draft behind `save-draft` and `delete-draft`, sending it (`send-reply`),
and resolving a submission item (`resolve-item`).

Still uncaptured: editing metadata (`appInfoLocalizations`, `appStoreVersionLocalizations`),
and **creating** a review submission — what was recorded covers resolving an item on a
submission that already exists, not making a new one or the first submit of a new version.
Do each once in the browser with the network log recording, and they can be added the same
way.

## Capturing a new endpoint

Record dev tools → Network while doing the thing in the browser and export the log (a
`.har`): every request *and response* is in there, which is far more than "Copy as cURL"
gives you one at a time. Such an export contains the full session cookie in plain text, so
keep it in `tmp/` with everything else gitignored. The capture file this client reads is a
different thing — it wants a curl command or a `Cookie:` line.

## Calls confirmed against the browser

Each of these was recorded from App Store Connect doing it, and the request this client
sends matches what the browser sent.

- `listMessages` and `getDraftMessage` — includes and the `limit[rejections]=2000` /
  `limit[resolutionCenterMessageAttachments]=1000` pair match exactly.
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
- From one draft reply with an attachment: `createDraftMessage`, `updateDraftMessage`,
  `reserveMessageAttachment` and `completeMessageAttachment` — all four bodies replayed
  offline against the recording and match the browser's byte for byte. Editing an existing
  draft, recorded separately, replays through `updateDraftMessage` and `getDraftMessage`
  with nothing new in it.

## Calls that are probe-only, and so likelier to shift

- `listVersionLocalizations` (the path form — the browser uses a filter on the collection
  instead) and `listAppInfoLocalizations`.
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
