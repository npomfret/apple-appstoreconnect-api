# Evidence and limits

This is an undocumented, private API, and the calls here are not all equally well
evidenced. This page says which is which: what was recorded from App Store Connect doing
it, what was only probed, and what has never been run from here at all.

Everything on it is part of the gap this client is for — Resolution Center threads,
messages, rejections, drafts and their attachments; unread review-message counts; App Store
version state-change history; and the App Privacy questionnaire.

## How that is checked, and when

Against two independent sources, agreeing. Apple's official OpenAPI specification **4.4.1**,
generated 2026-07-15 — 966 paths, 1,393 schemas — downloaded from
`https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip`;
and the documentation index at
`https://developer.apple.com/tutorials/data/index/appstoreconnectapi`, 9,997 entries.
Audited 2026-08-20 and re-checked 2026-08-21. Every "Apple has no official API for this"
claim in these docs carries that date and version, so it ages visibly; **repeat the
comparison against the current specification before acting on one**, because both this
project and Apple's API move.

The rule the audit applies is that **duplication is a property of a call, not of a
resource**: a private read of an officially-available resource is retained only when it
carries a field the official specification has no schema for, and is then narrowed to
exactly that field. `inbox` is the one call that survives on those terms, and
[why it looks like a duplicate](#queries-narrowed-away-from-the-capture) is set out below.

Evidence that a private call works was never a reason to keep one Apple serves officially,
and the calls that turned out to be duplicates have gone. What those recordings established
about Apple's *records*, rather than about this client, outlives them and is kept at the end
of this page.

## What isn't captured yet

One write on the retained surface was never recorded: `delete-attachment`, which was probed
rather than captured, and which destroys live data. Everything else here — the draft behind
`save-draft` and `delete-draft`, and the send behind `send-reply` — was copied from the
browser doing it.

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
  longer than iris's own page comes back clipped at the end; `read.clipped` in the log says
  when that may have happened, and `listMessages`'s `limit` option is how to look further.
  What iris reports about a page was read across every recording on 2026-08-21: **161
  collection responses, every one carrying both `meta.paging.total` and
  `meta.paging.limit`**. So a total is there to check against — the doubt recorded here
  until that day, that whether one is offered might be per endpoint, is settled for every
  route any recording covers. `meta.paging.limit` is the page size iris applied: the number
  asked for in all 84 requests that named one, and `50` — its own default — in all 77 that
  named none, which is the page `listMessages` and `listThreads` are held to. `read.atLimit`
  is now the fallback for a route reporting no total, and reads that applied page size
  rather than the outgoing query; before that it could not fire for either of those two
  calls, and did fire on a complete list whose total equalled its limit.
  The `fromActor` include is what tells Apple's messages from your own, and the responses
  were re-read for it on 2026-08-21: every actor carries an `actorType`, it is `APPLE` or
  `USER` across 29 actors in five recordings, Apple's own actor has the literal id `APPLE`
  and no name or email against it, and yours is an opaque 41-character id. That is a
  *sample*, not a schema. The same actors carry an `apiKeyId`, null in all 29, so a third
  kind is likely to exist unseen, and `report` prints "sender not recognised" for anything
  that is neither rather than assuming. The digest read the id and not the type until that
  day, matching on the prefix `APPLE`, which no recording ever supported.

  What an attachment carries was read the same day: `fileName`, `fileSize`, `downloadUrl`,
  `assetToken`, `sourceFileChecksum`, `uploadOperations` and `assetDeliveryState`, the same
  seven on all 34 in four recordings, with the last four null on everything Apple sent. Every
  messages response there carries **three attachments under two names** — two of them on one
  message, same name, same byte count, different ids and different download URLs. So a file
  name is not an identity, and `report` keys the digest's attachment list by the id: keying it
  by name reported two files where iris had listed three, and dropped one of the two download
  URLs. Whether those two are the same bytes twice or two files that happen to match is not
  something a recording can settle, and the digest does not have to guess to list them.

  Apple hangs files off two records, not one. `listRejections` sends
  `include=rejectionAttachments` with `limit[rejectionAttachments]=1000`, both the browser's
  own, and in the two recordings that send it a rejection comes back carrying **two files
  that hang off no message at all** — same resource type as a message's, 60 KB and 56 KB
  against the messages' 2 MB, which is a screenshot beside a screen recording. The digest
  fetched them and read none of them until 2026-08-21. The two sets are disjoint in both
  recordings; whether they can overlap is not settled, and the list is keyed by id either
  way.

  What a rejection itself carries was read on 2026-08-21, across 64 reasons on four
  rejections in four recordings: **`reasons` is its only attribute** — no date, no state, no
  round — and `appStoreVersion` is the only relationship that ever arrives populated, of the
  sixteen the browser's include list asks for. All four rejections on the recorded thread
  name the same version, so nothing there shows a thread's rejections spanning versions. A
  reason carries exactly `reasonCode`, `reasonSection` and `reasonDescription`, all strings
  and none null. `reasonSection` is **`reasonCode` with its last segment removed** — `4.1`
  against `4.1.0`, digits and dots in both — and the section's readable name is instead the
  first word of `reasonDescription`, ahead of a colon: `Design: Copycats`. `Guideline`
  carried a `section` field holding the numeric prefix until that day, which no output
  printed. Because rejections are undated, a code cited by two of them has no "latest"
  wording to prefer, and `report` keeps the first.
- `listThreads` — the app's Resolution Center thread list, and since the thread-first
  rebuild the starting point of `report`. The include list, the seven `filter[threadType]`
  values and `limit[appStoreVersions]=2000` are the browser's own. Two things that query
  settles and this client relies on: a thread carries its `appStoreVersions` directly, so
  the version a conversation is about needs no submission read; and that relationship is
  **to-many**, which is why `report` lists every version a thread names instead of
  promoting one. What no recording here settles is a thread's own *attributes* — nothing in
  this client reads one, and `threadType` appears only as a filter value, so treat any
  attribute on a thread resource as unmapped.
- From the History, Trust & Safety and Growth tabs: `listVersionStateChanges` (the browser
  sends no query at all; the `limit` is ours, and tested), `listDataUsages` and
  `getDataUsagePublishState`.

  What a state change carries was re-read on 2026-08-21: `appStoreState`, `appVersionState`,
  `date` and `initiator`, no relationships, and `initiator` is either the literal "Apple" or
  an email address — 15 resources, one recording, and the only one that has them. Five states
  occur (`PREPARE_FOR_SUBMISSION`, `READY_FOR_REVIEW`, `WAITING_FOR_REVIEW`, `IN_REVIEW`,
  `REJECTED`), each spelled exactly as `AppStoreVersionState` spells it in 4.4.1, and the two
  state fields agree on all fifteen. That is a *sample*: Apple's enums carry twenty and
  fifteen values respectively, including two further rejection states, and they diverge from
  each other once a version ships, so nothing here should treat five observed values as the
  vocabulary. `report`'s rejection tally counts `REJECTED` and `METADATA_REJECTED`, the second
  of which appears in no recording and is read off Apple's enum for the same field. Apple has
  no official state-change resource at all — zero schemas and zero paths in 4.4.1 — so the
  read itself is unambiguously a gap.
- From one real send: `sendDraftMessage` — the `createFromDraftMessage` POST, its `201`,
  and the thread read back with the new message on it.
- From one draft reply with an attachment: `createDraftMessage`, `updateDraftMessage`,
  `reserveMessageAttachment` and `completeMessageAttachment` — all four bodies replayed
  offline against the recording and match the browser's byte for byte. Editing an existing
  draft, recorded separately, replays through `updateDraftMessage` and `getDraftMessage`
  with nothing new in it.

## Calls that are probe-only, and so likelier to shift

- `deleteMessageAttachment` was **probed, not captured** — no browser request for it was
  ever copied. It works (a 204, and the attachment is gone on the next read), but it is the
  least evidenced call here, and it destroys live data.
- `sendDraftMessage` is certain in shape — it was recorded from the real thing — but
  **this client has never run it**. Everything up to the point of no return has been
  exercised against live data: the draft is read back, the confirmation renders it,
  declining stops before any request leaves. The request itself waits for a reply worth
  spending. Until then, treat the first run as the test.
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

`report` is not a second case, though it reads like one. All three of its routes are
private — an app id lists the app's Resolution Center threads, `--submission` filters that
list, `--thread` skips discovery altogether — and the version a report names comes off the
thread's own `appStoreVersions` rather than off `appStoreVersionForReview`, so no route
reads `apps/{id}/reviewSubmissions`. The digest says nothing about the submission's state,
platform or dates for the same reason: they are Apple's to serve.

## The escape hatch, and what it can reach

`asc get` is the one command that takes a path off the command line, which makes it the one
place the whole boundary could be walked round: every read this project deleted is still
sitting in iris, one argument away. It is confined to the private families and refuses
anything else before a request is built. There is no write-side equivalent — a hand-written
body at an arbitrary path has no captured evidence behind it by definition, and nothing here
should write without a confirmation and a preview.

The list is a claim about the official specification, so it carries the same date as the
rest of this page. Checked against **4.4.1** (generated 2026-07-15, 966 paths, 1,393
schemas) on 2026-08-21: `resolutionCenter`, `reviewRejection`, `dataUsage`,
`appStoreVersionStateChange` and `messageCount` each occur **zero** times in the whole
document.

| In scope | |
| --- | --- |
| `resolutionCenterThreads`, `resolutionCenterMessages`, `resolutionCenterDraftMessages`, `resolutionCenterMessageAttachments`, `reviewRejections` | whole families — the type itself is absent from the official API, so nothing inside one duplicates an official read |
| `apps/{id}/resolutionCenterThreads`, `apps/{id}/dataUsages`, `apps/{id}/dataUsagePublishState` | private relationships of an official record |
| `appStoreVersions/{id}/appStoreVersionStateChanges` | the same, for a version |

The parent is not in scope: `apps/{id}` and `appStoreVersions/{id}` are
`GET /v1/apps/{id}` and `GET /v1/appStoreVersions/{id}`, and one segment is the whole
difference. `apps` bare is a gap for exactly one query — the two unread counts above — and
that is a mapped call rather than something to hand a free-form path to.

**Being in scope is not evidence.** The families are open whole so a *new* gap can still be
found without the boundary moving, but an unmapped route inside one is still an unproven
route: what it returns is undocumented, and the evidence for a call is a recording of the
browser making it. Traversal (`..`) is refused, because a path that climbs out of the
family it names is not the family it names.

## What the transport can express

One host, one base, one content type, four methods. Each is a module constant rather than
an option a caller picks, and each is what the recordings actually show — narrowed to that
on 2026-08-21, once the boundary was closed.

| What it sends | On what evidence |
| --- | --- |
| `https://appstoreconnect.apple.com/iris/v1`, and no other base | the only other one this client ever had was `/ci/api`, for Xcode Cloud, which Apple serves officially |
| `application/vnd.api+json` on every request, read or write | every recorded Resolution Center call sends it, on reads and writes alike. The one capture that sent plain `application/json` was the version PATCH, which is `PATCH /v1/appStoreVersions/{id}` officially |
| `GET`, `POST`, `PATCH`, `DELETE`, and refuses anything else | no call addressed to iris uses `PUT`. The upload part that does goes to `object-storage.apple.com` through `uploadPart`, without the cookie and without `request` |

A gap that turns out to need something else brings a recording showing it. That narrowing
changed no byte on the wire: `test/gap-requests.test.ts` pins the method, body and content
type of every retained call, and passed unedited across it. The `http.write` audit records,
the redaction, the host check and the confirmations were not touched.

## Capturing a new endpoint

Record dev tools → Network while doing the thing in the browser and export the log (a
`.har`): every request *and response* is in there, which is far more than "Copy as cURL"
gives you one at a time. Such an export contains the full session cookie in plain text, so
keep it in `tmp/` with everything else gitignored. The capture file this client reads is a
different thing — it wants a curl command or a `Cookie:` line.

## What the removed code established

The private implementations of capabilities Apple serves officially have gone. These are
kept because what they established is mostly about Apple's records rather than about this
client, and so holds for the official API too — the point being that none of it was a
reason to keep the duplicate. What each one was, function by function, is in the git
history of the slice that removed it; none of those identifiers exists to be looked up now,
which is why they are not listed here.

### Run against iris, not recorded

- `submitReviewSubmission` — `PATCH reviewSubmissions/{id} {"submitted":true}`, run
  2026-08-19 against a submission sitting in `UNRESOLVED_ISSUES` with its only item already
  resolved. `200`, and the submission came back `state: WAITING_FOR_REVIEW` with
  `submittedDate` stamped to the second. The version moved `READY_FOR_REVIEW` →
  `WAITING_FOR_REVIEW` in its own history alongside it. Apple serves
  `reviewSubmissions_updateInstance` officially and `ReviewSubmissionUpdateRequest` carries
  `submitted` and `canceled` by those names, so the call was a duplicate however well it
  worked.

  Three things that run established outlive it, and all three are about the records rather
  than about this client, so they hold for the official API too.

  **A rejection carries the submitted date of the run that was refused.** `UNRESOLVED_ISSUES`
  always has a `submittedDate`, and it is the date Apple last looked, not evidence that the
  submission is with Apple now. Reading "has a submitted date" as "is in flight" strands it:
  the client of the day refused to submit for that reason, and refused to resolve the item
  because it was no longer `REJECTED` — two commands pointing at each other, with a
  hand-written PATCH the only way out. That PATCH is `reviewSubmissions_updateInstance` on
  the official API. A returned submission is reusable, and `{"submitted":true}` is what
  moves it on.

  **`READY_FOR_REVIEW` alone does not mean unsent either.** It is the pair — that state and
  no `submittedDate` — that means never handed over.

  **One open submission per platform.** A second `POST reviewSubmissions` for a platform
  that already has one is not a way to start again, and the platform has to be read off the
  version rather than assumed: a submission is per-platform, and a guessed `IOS` would put a
  Mac or tvOS version into the wrong one.

- `listUserInvitations` and `inviteUser` — run 2026-08-19 from this client. `userInvitations`
  is the same JSON:API type Apple serves officially, with the same six attributes, so it was
  never a gap. Two observations from that run outlive it, and both are about Apple rather
  than about this client, so they hold for the official API too.

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

### Recorded from the browser

- The version page, its build picker and one attach-a-build-and-save were all recorded, and
  the slice went whole. Re-checked 2026-08-21 against 4.4.1: `GET /v1/apps`,
  `GET /v1/apps/{id}`, `GET /v1/apps/{id}/appStoreVersions`, `GET /v1/appStoreVersions/{id}`,
  `GET /v1/builds`, `GET /v1/appStoreReviewDetails/{id}` and `PATCH /v1/appStoreVersions/{id}`
  are all official, and `AppStoreVersionUpdateRequest` carries the `build` relationship the
  recorded PATCH body sent. Four include names and one filter had no official schema —
  `displayableVersions`, `resetRatingsRequest`, `gameCenterConfiguration`,
  `ageRatingDeclaration` *as a relationship of a version* (officially it hangs off
  `AppInfo`), and `filter[isAppStoreCandidate]` — but nothing here read any of them, so
  narrowing to them would have narrowed to nothing. The filter has an official spelling in
  any case: `filter[buildAudienceType]=APP_STORE_ELIGIBLE`.

  **`resetRatingsRequest` is the one worth remembering.** Resetting an app's ratings has no
  official API at all, which makes it a gap this client never built rather than one it gave
  up. Anything built on it starts where every gap here started: a recording of the browser
  doing it.

  **Where the reviewer's complaints actually point.** "We were unable to sign in" and "we
  couldn't locate the feature" are complaints about the App Review Information record — the
  contact, the demo account and the notes — rather than about the build. That record also
  lists the `appStoreReviewAttachments` the reviewer was given. It is worth reading on any
  rejection, and now reads officially.

  **The demo account password is a live credential in a read.** It comes back on the record
  and this client blanked it unless asked, because everything printed goes to stdout and a
  password left in terminal scrollback is a worse problem than a flag. The account *name*
  was shown: it is the pair that is the credential, and which account Apple was given is
  usually the point. Whatever reads this record next has the same problem. `log.ts` still
  scrubs `demoAccountPassword`, though nothing here can reach the record that carries it any
  more: a redaction keyed on a field name is a standing rule, not a reaction to a caller, and
  it costs a string comparison.
- From one real resolve: `resolveSubmissionItem` — the `{"resolved":true}` PATCH and the
  `READY_FOR_REVIEW` that comes back. `resolved` is an attribute of Apple's own
  `ReviewSubmissionItemUpdateRequest`, spelled the same way. Two observations from it are
  about the records rather than about this client, and outlive it.

  **Resolving an item does not re-queue its submission.** The button in App Store Connect
  gives the opposite impression and getting it wrong is silent. On 2026-08-13 a resolve
  landed `200`, the item went `READY_FOR_REVIEW`, the version page said "Ready for Review" —
  and the submission sat in `UNRESOLVED_ISSUES` for five days and sixteen hours without ever
  reaching Apple, with nothing anywhere saying it was waiting. Resolve clears the item;
  `{"submitted":true}` on the parent is what hands it over. A `reviewSubmissions` read taken
  straight after a resolve that still says `UNRESOLVED_ISSUES` is the truth, not a stale
  read.

  **An item id decodes to its parent.** `GET reviewSubmissionItems/{id}` is refused by iris
  with a 403, and Apple has no by-id read of one either — 4.4.1 gives that path `PATCH` and
  `DELETE` only, so `reviewSubmissions/{id}/items` is the way in officially as well. An item
  id is base64 of `{submissionId}|{n}|{appId}`, so the parent can be recovered from the id
  itself. Apple never promised that format; it was a guess, and anything that did not come
  apart as a leading UUID was treated as undecodable rather than answered wrongly.
- One Save on the App Information page was recorded, both of its reads with it, and the
  slice went whole. Re-checked on 2026-08-21 against specification 4.4.1, re-downloaded that day and still
  4.4.1 with the same 966 paths and 1,393 schemas: `GET /v1/apps/{id}/appInfos`,
  `GET` and `PATCH /v1/appInfos/{id}`, `GET /v1/appInfos/{id}/appInfoLocalizations`,
  `PATCH /v1/appInfoLocalizations/{id}`,
  `GET /v1/appStoreVersions/{id}/appStoreVersionLocalizations`,
  `PATCH /v1/appStoreVersionLocalizations/{id}`, `PATCH /v1/ageRatingDeclarations/{id}`,
  `GET /v1/appInfos/{id}/territoryAgeRatings` and `PATCH /v1/apps/{id}` are all official.
  Field for field: `AppInfoLocalization.Attributes` is `locale`, `name`, `subtitle`,
  `privacyPolicyUrl`, `privacyPolicyText`, `privacyChoicesUrl`;
  `AppStoreVersionLocalization.Attributes` is `locale`, `description`, `keywords`,
  `promotionalText`, `whatsNew`, `marketingUrl`, `supportUrl`; `AppInfo.Relationships`
  carries all six category slots and `AppInfoUpdateRequest` writes to exactly those six;
  `App.Attributes` carries `contentRightsDeclaration` and `isOrEverWasMadeForKids`; and
  `TerritoryAgeRating` is `appStoreAgeRating` with a `territory`. Every command here was a
  private route to a published one.

  **One attribute was not.** `AgeRatingDeclaration.Attributes` has 29 properties and so did
  the recorded body, but they are not the same 29: Apple has `ageRatingOverride`, which the
  recording did not carry, and the recording had **`gracRatingClassificationNumber`** — the
  Korean GRAC classification number — which occurs nowhere in 4.4.1 (its only `grac` tokens
  are subscription *grace* periods) and is absent from the published
  `AgeRatingDeclaration.Attributes`. By this repository's own rule that is a keep narrowed
  to one field, and it left with the rest anyway: the only recorded write is the whole
  questionnaire in one body, so writing that field back means resending 28 fields Apple
  serves officially. Retention is an open question and is not settled by this page — see
  [tasks/grac-rating-classification-number-gap.md](../tasks/grac-rating-classification-number-gap.md).

  Four observations outlive the code, and the first three are about the records rather than
  about this client, so they hold for the official API too.

  **The first `appInfos` record is the live one, and it refuses writes.** A shipped app has
  two — the live one and the one being prepared — and the live one is listed first. A PATCH
  aimed there comes back `409 ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_STATE`, "The field
  'subtitle' can not be modified in the current state". Picking by position is picking the
  wrong record; the removed code picked by `state` instead, and any client reading or
  writing these records has the same choice to make.

  **The questionnaire is one app's, not the questionnaire.** The 29 recorded questions came
  off a single app on a single account, and nothing observed says every app is asked the same
  set — which is why the removed code read the question list off the declaration Apple
  returned rather than off a list of its own. Apple's published set differing by one attribute
  from the recorded one is that argument being right about something.

  **Categories are relationships whose id is the category's name.** `{"type":"appCategories",
  "id":"GAMES"}`, six slots, only the games categories using the subcategory ones — and
  `AppInfoUpdateRequest` takes them the same way, so this reads across unchanged.

  **The recording covered shapes, not the range of answers.** Every frequency question came
  back `"NONE"` and content rights `DOES_NOT_USE_THIRD_PARTY_CONTENT`, so
  `INFREQUENT_OR_MILD`, `FREQUENT_OR_INTENSE` and `USES_THIRD_PARTY_CONTENT` were always
  Apple's public documentation rather than evidence from here. Nothing was ever recorded
  about a *partial* age-rating body either, which is why the removed command insisted on a
  complete one.
- One invitation sent on the People page was recorded and mapped, and the slice went whole.
  It was well evidenced and that was never a reason to keep it: re-checked on 2026-08-21, Apple's
  `UserInvitation.Attributes` carries `email`, `firstName`, `lastName`, `roles`,
  `provisioningAllowed`, `allAppsVisible` and `expirationDate` — every attribute this client
  sent, plus the one it read back — `UserInvitation.Relationships` carries `visibleApps`, and
  `GET`, `POST` and `DELETE /v1/userInvitations` are all official. There was no field to
  narrow to. Apple's [User Invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations)
  API also covers what the recording never did: revoking an invitation, listing the people
  already on the account, and restricting an invitation to named apps.
- The screenshot and preview reads were recorded and the upload flow was run end to end,
  and the slice went whole. Re-checked on 2026-08-21 against Apple's published schemas:
  `AppScreenshot.Attributes` carries `assetDeliveryState`, `assetToken`, `assetType`,
  `fileName`, `fileSize`, `imageAsset`, `sourceFileChecksum` and **`uploadOperations`** —
  the last being the one that makes the whole reserve → upload → commit flow official, not
  just the reads — `AppScreenshotSet.Attributes` carries `screenshotDisplayType`,
  `AppPreviewSet.Attributes` carries `previewType`, `AppPreview.Attributes` carries
  `uploadOperations` too, and creating, modifying, listing and deleting screenshots and
  screenshot sets are all documented operations. There was no field to narrow to. Apple's
  [App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata)
  API is where this went.

  **The display-type list was already Apple's.** The removed code held 33 display types,
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
  `403`, which is why the removed code went via the localization instead.
  Apple documents `GET /v1/appScreenshotSets/{id}` officially, so read that as an iris
  quirk and not as a property of the resource.

  **Accepted pixel dimensions are in no API response.** The size table the removed code
  checked against was transcribed by hand from the drop-zone captions on the version page,
  and covered three zone families out of the 33 display types deliberately: an absent entry skipped the check
  rather than guessing, because a wrong entry would reject a good screenshot. Nothing was
  lost from an API by deleting it — a pre-flight size check is a client convenience, and
  Apple validates server-side either way.

  What survives is the transport underneath: `uploadPart` in `src/http.ts` still sends
  presigned parts to `object-storage.apple.com` with no cookie, because draft attachments
  reserve and upload through the same three steps and they are a retained gap.
- Two Xcode Cloud sessions were recorded and mapped, and the slice went whole, taking the
  transport's second base with it. Apple's
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

## Seen but deliberately not mapped

From the Xcode Cloud tab: the pickers behind the workflow editor —
`test-destinations-v3`, `configuration-options-v10`, `product-configuration-options-v4`,
`schemes`, `version-aliases-v3`, `scm-providers-v2`, `notices-v2`,
`testflight/information-v2`, `repos/{id}/branch`, `product-environment-variables` — all
recorded, none ever mapped: they exist to fill in a form this client does not render. Out of
scope twice over now, since Apple exposes Xcode Cloud officially and `asc get` speaks
`iris/v1` only — `/ci/api` is not a base this client has, and `ciWorkflows` is not one of
the private families the hatch is confined to.

Recordings of the Monetization, Growth & Marketing and Trust & Safety tabs turn up about 40
further endpoints. Pricing is the substantial one — `appPriceSchedules/{appId}/automaticPrices`
and `/manualPrices` (price points are base64 blobs of `{s,t,p}`: app, territory, tier),
`/baseTerritory`, `apps/{id}/supportedTerritories`, `taxCategories` — left alone as a
different domain from review, and a write surface worth respecting. The rest were empty on
this account and so unverifiable: `appCustomProductPages`, `appEvents`,
`appStoreVersionExperimentsV2`, `inAppPurchasesV2`, `subscriptionGroups`,
`customerReviewSummarizations`, `accessibilityDeclarations`, `appEncryptionDeclarations`,
`backgroundAssets`, `appClips`. **`asc get` reaches none of them**: they are official
families, and the hatch is confined to the private ones. That is deliberate rather than a
loss — an unrestricted private GET is how a boundary stops meaning anything — but it does
mean the next probe of one of these starts in the browser, which is where the evidence for a
new gap has to come from in any case. If one of them turns out to carry a
field the official API has no schema for, the way in is a mapped call and a family on the
list, both with a recording behind them.

## The standing caveat

This is an undocumented, private API. It can change without warning, and automating it
is on you with respect to Apple's terms.
