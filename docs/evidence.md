# Evidence and limits

This is an undocumented, private API, and the calls here are not all equally well
evidenced. This page says which is which.

## What isn't captured yet

**Mostly read-only.** The captured writes are the version PATCH behind `set-build`, the
screenshot flow, and the Resolution Center draft behind `save-draft` and `delete-draft`.
Still uncaptured: **sending** a draft, editing metadata (`appInfoLocalizations`,
`appStoreVersionLocalizations`) and submitting for review. Do each once in the browser,
export the HAR, and they can be added the same way — see
[capturing new endpoints](sessions.md#capturing-new-endpoints).

## Calls confirmed against the browser

- `listMessages` and `getDraftMessage` — includes and the `limit[rejections]=2000` /
  `limit[resolutionCenterMessageAttachments]=1000` pair match exactly.
- `listAppInfos`, `getReviewDetails`, and the localizations-with-assets call behind
  `screenshots`.
- From a HAR of one attach-a-build-and-save: `listBuilds`, `listBuildCandidates`,
  `listPreviewSets` and the `set-build` PATCH body.
- From HARs of the History, Trust & Safety and Growth tabs: `listVersionStateChanges` (the
  browser sends no query at all; the `limit` is ours, and tested), `listAppVersions`,
  `listDataUsages` and `getDataUsagePublishState`.
- From a HAR of one draft reply with an attachment: `createDraftMessage`,
  `updateDraftMessage`, `reserveMessageAttachment` and `completeMessageAttachment` — all
  four bodies replayed against the HAR offline and match the browser's byte for byte. A
  second HAR of editing an existing draft replays through `updateDraftMessage` and
  `getDraftMessage` with nothing new in it.

## Calls that are probe-only, and so likelier to shift

- `listVersionLocalizations` (the path form — the browser uses a filter on the collection
  instead) and `listAppInfoLocalizations`.
- `deleteScreenshot`, `deleteScreenshotSet` and `deleteMessageAttachment` were **probed,
  not captured** — no browser request for any of them was ever copied. They work
  (`deleteMessageAttachment` returns a 204 and the attachment is gone on the next read),
  but they're the least evidenced calls here, and they destroy live data.
- `deleteDraftMessage` is the other way round: the request was copied from the browser's
  **Delete Draft** button, so the shape is certain, but this client has never run it — the
  one open thread's draft had already been deleted in the browser, and closed threads won't
  take a scratch draft to practise on. Its [documented
  aftermath](replying.md) is what was observed after the browser did it.

## Seen but deliberately not mapped

HARs of the Monetization, Growth & Marketing and Trust & Safety tabs turn up about 40
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
