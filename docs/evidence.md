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

### The Xcode Cloud read

`listWorkflows` / `fetchPostActions` — the `post-actions` command — is
`GET ci/api/teams/{teamId}/products/{productId}/workflows-v15?limit=100&include_deleted=false`,
which is the browser's own query, page size and flag. Recorded from the browser on
2026-08-21 and read on 2026-08-22 through an extractor emitting methods, redacted paths,
query keys, statuses and response *key structure*; no header, cookie, signature, CSRF value
or personal detail was read out of it, and the fixtures in the tests are invented.

**The gap is one field, not the resource.** Apple serves Xcode Cloud products, workflows,
repositories, build runs, actions, issues and test results officially, and can create and
update a workflow. Re-checked 2026-08-21 against specification **4.4.1**: `post_action`,
`postAction`, `deployment_config`, `archive_action_id` and `testFlight_internal` occur
**zero** times across its 966 paths and 1,393 schemas, and `CiWorkflow` has no post-action
attribute and no `betaGroups` relationship — its relationships are `buildRuns`,
`macOsVersion`, `product`, `repository` and `xcodeVersion`. So the official API cannot say
whether a build is handed to testers automatically, and that is the whole of what this
reads.

What the recording settles, beyond the request:

- **The document is `{id, content, metadata}`**, and the collection is `{items: […]}` with
  no continuation key. `content` holds the fourteen keys `actions`, `clean`,
  `container_file_path`, `description`, `disabled`, `environment_variables`, `locked`,
  `macos_version`, `name`, `post_actions`, `product_environment_variables`, `repo`,
  `start_conditions` and `xcode_version` — and the recorded `PUT` body is exactly that
  object, which is what makes the write a full-document replace.
- **A post-action is `{id, name, type, deployment_config}`**, with
  `deployment_config.archive_action_id` and
  `deployment_config.testflight_deployment_ids.{beta_group_ids, beta_tester_ids}`. `type` is
  `testFlight_internal` — mixed case, worth writing down because a plausible guess would
  have been wrong, and passed through rather than narrowed to a union of the one observed
  value.
- **`archive_action_id` names an action in the same workflow**, true of every post-action in
  the recording, so a post-action follows a build step rather than the workflow as a whole.
  The digest resolves it against that workflow's own `actions`, which costs no request.
- **The team id needs no discovery.** On all 34 recorded `/ci/api` requests — 22 from the
  workflow page, 12 from the Usage page, checked separately — the
  `teams/{id}` path segment is the same value as the `X-Connect-Team-ID` header, which the
  session already carries and otherwise decodes from the `itctx` cookie. So this needs
  neither a `--team` flag nor `olympus/v1/actors`, which would be a third base carrying
  names and email addresses.
- **`beta_tester_ids` was present and empty throughout.** Nothing shows what a populated one
  looks like or whether the two lists combine.
- **A workflow with no post-actions carries `post_actions: []`.** Re-read on 2026-08-22
  through a counts-only extractor over both workflow recordings: every workflow document
  carried all fourteen `content` keys, one with a one-entry `post_actions` and one with an
  empty array, and every post-action in them had a usable `id`. So an *absent* key would be
  a change in the response rather than a way of saying "none", which is why the read refuses
  it instead of reporting a workflow that hands nothing on.
- **The single-workflow route answers with the bare document, not a page.** Three of the six
  recorded `workflows-v15` reads are `{content, id, metadata}` rather than `{items: […]}`.
  This client calls the collection and never that route, and `CI.pageOf` counts a document
  with three top-level keys as not a page, so neither the read nor the short-page guard is
  affected — recorded because a future caller reaching for the single-workflow URL would
  otherwise expect the collection's shape.

Beta group ids are printed as ids and never resolved to names: that is `GET /v1/betaGroups`,
which Apple serves officially with `name` and `isInternalGroup` on it.

**This read refuses rather than drops, changed on 2026-08-22.** It previously skipped a
workflow or a post-action it could not parse, which is the posture `fetchUsage` keeps
deliberately. It is the wrong one here: `fetchUsage` losing a row loses a line from a total,
whereas a post-action skipped here prints "a build from this workflow is not handed on
automatically" — the exact claim the command exists to make — and a skipped workflow leaves
the product reported as not having it. Nothing in the recording is malformed, so this
changes no observed behaviour; it decides what happens when Apple's undocumented shape
moves. Additive change is still tolerated: an unrecognised key on a post-action is reported
by name in `unmodelled` rather than refused.

### The Xcode Cloud compute reads

`fetchPlan` and `fetchUsage` — the `usage` command — are
`GET ci/api/teams/{teamId}/usage/summary` and
`GET ci/api/teams/{teamId}/usage/days?start=YYYY-MM-DD&end=YYYY-MM-DD`. Both were recorded
from the browser's Xcode Cloud **Usage** page on 2026-08-21 and read on 2026-08-22 through
the same extractor, which for these emitted key structure, date *formats* rather than dates,
and a set of computed booleans rather than the numbers behind them.

**Apple has no compute-usage resource at all.** Re-checked against **4.4.1**:
`usage_in_minutes`, `number_of_builds`, `reset_date` and `can_view_all_products` occur zero
times, and the only official `usage` paths — `betaTesterUsages`, `betaBuildUsages`,
`publicLinkUsages` — are about TestFlight testers, not build minutes. `CiBuildRun` carries
`startedDate` and `finishedDate`, so wall-clock per run is derivable one build at a time by
walking every product's build runs; billed compute, an allowance and a reset date are not
derivable from anything official.

What the recording settles:

- **The plan is denominated in minutes, not hours.** No field name says so, and getting it
  wrong misreports the allowance sixtyfold. Three things agree: `plan.total` is exactly one
  of Apple's published compute-hour tiers multiplied by 60, `used + available === total`,
  and the per-day series beside it is labelled `minutes` and is of the same order.
- **The plan window and the day window are different windows.** `plan.used` counts the
  billing period ending at `reset_date`; `usage/days` counts the dates asked for. In the
  recording the two totals disagree, as they should, so the digest prints them as two
  separate things and never sums or reconciles them.
- **`info.current` and `info.previous` are Apple's own aggregates over a window Apple
  chose**, matching neither the day series nor the plan. They are not reported as anything,
  because nothing observed says what window they cover.
- **A product id in the breakdown may name a product that no longer exists.** The recording
  carried seven `product_usage` rows where `products-v4` returned two, and only those two
  ids matched: consumed compute outlives the product that consumed it. So rows are kept on
  their id and no name lookup is attempted — that lookup is `GET /v1/ciProducts`, which
  Apple serves officially and which would not find the other five anyway.
- **`usage_in_minutes` is `floor(usage_in_seconds / 60)`** on every row. Both are kept.
- **Neither response pages.** `usage/summary` is `{plan, links}` and `usage/days` is
  `{usage, product_usage, info}`; no continuation key appears in either, and the day series
  is contiguous and ascending across the whole window.
- **`links.csv_export` and `links.manage` are web URLs for the page's own buttons.** They
  are not read, not followed and not printed.

The window is computed in UTC so that the same command asks for the same window wherever it
runs. Apple's own page asked for 31 days; nothing observed says what a longer range does, so
no range is capped here — a cap invented from one recording would be as much a guess as no
cap.

**Activating and deactivating a workflow was captured on 2026-08-22 and deliberately not
mapped.** The two recorded `PUT`s differ in one boolean, `disabled`, on an otherwise
identical fourteen-key document. Apple serves that officially and better:
`PATCH /v1/ciWorkflows/{id}` takes `isEnabled` on its own, every attribute of
`CiWorkflowUpdateRequest` being optional, where the private route replaces the whole
document and destroys whatever is not sent back. Checked against 4.4.1 on 2026-08-22. See
`tasks/xcode-cloud-post-actions-gap.md`.

### The Xcode Cloud team read

`fetchTeam` — the `team` command — is `GET ci/api/teams/{teamId}`, with no query at all.
Recorded from the browser's Xcode Cloud **Usage** page on 2026-08-21 and read on 2026-08-22
through an extractor that emitted key structure, string *shapes* rather than strings, and
the booleans themselves, which are the subject of the call. One such request appears in the
recording, `200`, `application/json`.

**Apple has no team resource, and nothing official mentions the Program License Agreement.**
Checked against **4.4.1** on 2026-08-22: `wwdr`, `programState` and `program_state` occur
zero times; the only `team` in the whole specification is `gameCenterMatchmakingTeams`,
which is a matchmaking concept and not a developer account; and the two license-agreement
schemas, `BetaLicenseAgreement` and `EndUserLicenseAgreement`, carry nothing but
`agreementText` — the TestFlight tester agreement and the customer EULA, neither of them the
Program License Agreement. The 571 occurrences of the substring `pla` are all `platform`,
`marketplace`, `playstyle`, `plan` and the like.

What the recording settles, and what it does not:

- **The response has eight keys and five are carried.** `id`, `public_provider_id` and
  `links` are not. `id` is byte-for-byte the id that was sent, so it reports nothing;
  `public_provider_id` is a uuid nothing observed explains, and an identifier that cannot be
  explained is noise; `links` are web URLs for the page's own buttons, one of them carrying
  a person id, and they are neither read nor followed — the same rule the compute links get.
- **`wwdr_team_id` is not the team id the path is scoped by.** Ten characters of letters and
  digits against the path's 36-character uuid, and a different value. It is the shape Apple
  uses for the Developer Program team id on certificates and provisioning profiles.
- **Both booleans were `false`.** `wwdr_pla_needs_signing` and
  `wwdr_team_within_pla_grace_period` have never been observed true, so what the digest
  prints in either case has never been seen rendered against real data. The wording
  describes the fields and not their consequences: nothing here says what Apple stops when a
  PLA goes unsigned, or how long a grace period runs, and the digest does not claim to know.
- **A missing boolean is refused, not defaulted.** Reading an absent
  `wwdr_pla_needs_signing` as `false` would print "signed" over a question Apple did not
  answer, which is the one wrong answer this call can give.
- **`program_state` is passed through un-interpreted.** One lowercase value was observed;
  nothing says what the set is, so it is a string rather than a union and is never compared
  against a literal.

### The Xcode Cloud capabilities read

`fetchCapabilities` — the `capabilities` command — is
`GET ci/api/teams/{teamId}/user-capabilities`, with no query at all. It appears once in each
of **three** independent recordings — the post-actions capture, the Manage Workflows capture
and the Usage capture — and all three agree exactly: `200`, `application/json`, thirteen
keys, every one a boolean. Read on 2026-08-22 through an extractor that emitted the key
names, the value *types*, and the count of `true` against `false`, which is the subject of
the call.

**Apple serves roles, not resolved permissions.** Checked against **4.4.1** on 2026-08-22:
`canConfigure`, `canTrigger`, `canEdit`, `canRemove`, `canChange`, `canManage`, `canOnboard`,
`canRestrict`, `restrictedWorkflow`, `infrastructureValidation` and `privilege` occur zero
times. What is official is `/v1/users`, whose `User` carries `roles` — thirteen coarse
`UserRole` values from `ADMIN` to `GENERATE_INDIVIDUAL_KEYS` — beside `username`,
`firstName`, `lastName`, `allAppsVisible` and `provisioningAllowed`. A directory of people
and their job titles is not the same call as thirteen resolved booleans about one session,
and the mapping between them is something Apple publishes in prose rather than in the API;
hardcoding it here would be a guess wearing the clothes of a lookup.

The 93 occurrences of `capabilit` are all `BundleIdCapability` — App ID entitlements, an
unrelated sense of the word. The four of `notariz` are the `NOTARIZATION` release
destination and a `STAPLED_NOTARIZED_ARCHIVE` artifact type, neither a permission.
The now-deleted `tasks/xcode-cloud-usage-gap.md` recorded `notariz` as zero on 2026-08-21; the count is four
and the conclusion is unchanged, and it is corrected here rather than left to be
re-discovered.

What the recordings settle, and what they do not:

- **The response carries no identity.** Thirteen booleans, and nothing else: no name, no
  email address, no user id, no role. That is the finding the decision to build this turns
  on. `user-capabilities` reads as a person-scoped call and is not one — it says what the
  captured cookie may do, not who holds it — so it does not cross the boundary that keeps
  the People page out of this client. Reading *who is on the team* stays out of scope.
- **All thirteen were `true`, in all three recordings.** A withheld capability has never
  been observed, so what the digest prints for one has never been seen rendered against real
  data, and no `no` has ever been observed to precede a refusal. The wording is a report of
  what Apple said rather than a prediction of what Apple will do.
- **A missing capability is refused, not defaulted.** Apple saying nothing about a permission
  is not Apple withholding it. Defaulting to `false` would print "no" over a question that
  was never answered; defaulting to `true` would be worse. The same rule as the PLA booleans
  and the plan total.
- **The field set is closed.** Thirteen keys arrived every time; a fourteenth is Apple
  changing the response, which is a re-capture rather than something to absorb.
- **None of the thirteen is an operation this client performs.** Every one is a write, and
  the `CI` base is read-only. What the command answers is what the *account* may do, wherever
  it is done from — not what `asc` will let anybody do.


### The Xcode Cloud infrastructure-validation reads

`fetchInfrastructureValidation` — the `infrastructure-validation` command — is three GETs,
recorded from the browser's Xcode Cloud **Usage** page on 2026-08-21 and read on 2026-08-22
through an extractor that emitted methods, redacted paths, query keys, statuses, response key
structure with value types, and — for `opt_in` alone, which is the subject of the call —
counts of `true` against `false`:

| call | query | answer |
| --- | --- | --- |
| `GET ci/api/teams/{teamId}/infrastructure-validation` | none | `{opt_in}` |
| `…/infrastructure-validation/products` | `continuation_offset=&limit=20` | `{products[]}` of `{product_id, product_name, opt_in}` |
| `…/infrastructure-validation/products/{productId}/workflows` | `continuation_offset=&limit=20` | `{workflows[]}` of `{workflow_id, workflow_name, opt_in}` |

All `200 application/json`. The workflows call appears twice, once per product; the other two
once each.

**No official equivalent, and the near-miss is not one.** Checked against **4.4.1** on
2026-08-22: `infrastructure` occurs **zero** times. `optIn` occurs seven times and every one
is `SubscriptionGracePeriod.optIn` or `.sandboxOptIn`, which is a subscription setting.
`CiWorkflow` has fifteen attributes — `name`, `description`, the six start conditions and
their manual counterparts, `actions`, `isEnabled`, `isLockedForEditing`, `clean`,
`containerFilePath`, `lastModifiedDate` — and `CiProduct` has three: `name`, `createdDate`,
`productType`. Neither carries this, and there is no official team resource at all for the
team-level switch to hang off. The 213 occurrences of `preRelease` are `PrereleaseVersion`
and its response schemas, which are TestFlight versions of an app rather than a build
toolchain.

What the recording settles, and what it does not:

- **The read is the whole capability.** The writes that set `opt_in` were never recorded.
  `asc capabilities` reports a `can_configure_infrastructure_validation`, so they exist; what
  they are is unknown and is not invented. This reports the switches and cannot throw one,
  which is the standing `asc team` has with an unsigned Program License Agreement.
- **Every `opt_in` recorded was `true`** — the team, both products, and the one workflow on
  each. So an opted-out row has never been seen rendered against real data, the same caveat
  the team and capability digests carry.
- **A row is read strictly.** A product or workflow whose `opt_in` is missing or is not a
  boolean is an error, not a row dropped and not an opt-out. This is the opposite of
  `fetchUsage`, which drops a row it cannot read: there a missing row is one line missing
  from a total, here it would be indistinguishable from a product that is not opted in.
- **Only one page was ever reached.** Two products, one workflow each, against a limit of 20.
  The response carries no cursor, so what a later `continuation_offset` would take is
  unobserved and no second page is requested. A full page is reported as `read.atLimit` and
  left at that.
- **The page size and the empty offset are the browser's own.** Nothing raises the limit;
  a larger page is a guess about what the route accepts.

**This is why `CI.pageOf` stopped matching the key `items`.** Xcode Cloud spells a collection
three ways across the recordings — `items` on ten routes, `products` and `workflows` on these
— so the short-page guard fired for one spelling in three, and a clipped products list would
have looked like a whole one. What separates a page from a compound document on this base is
that a page has exactly one top-level key holding an array, where `usage/days`, `repos-v3`,
`test-destinations-v3` and `configuration-options-v10` carry several and are not paged. The
three routes answering with a bare top-level array — `notices-v2`, `scm-providers-v2`,
`product-environment-variables` — are deliberately not counted: this client calls none of
them and asks none of them for a limit.

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
browser making it. Traversal is refused, because a path that climbs out of the family it
names is not the family it names — and it is refused where it can be seen, which is the
transport: this list is matched against the first segment of the path as written, and
`resolutionCenterThreads/%2e%2e/%2e%2e/%2e%2e/ci/api/v1/ciBuildRuns` has a private family
in that position while resolving to the `/ci/api` base this client closed. Three spellings
of the same climb passed this check and were sent with the session cookie until
2026-08-21; `apiUrl` now compares the *resolved* URL against `BASE_URL`.

## What the transport can express

One host, two bases, four methods. A base carries its own media types, its own rule for
reading a refusal and its own page shape, because the two disagree about all three; none of
them is an option a caller picks, and each is what the recordings actually show.

| Base | What it sends | On what evidence |
| --- | --- | --- |
| `…/iris/v1` — the Resolution Center | `application/vnd.api+json` as both `Accept` and `Content-Type`, on reads and writes alike | every recorded Resolution Center call sends it. The one capture that sent plain `application/json` was the version PATCH, which is `PATCH /v1/appStoreVersions/{id}` officially. **The capture could override this until 2026-08-21** — see the header audit below |
| `…/ci/api` — Xcode Cloud, read-only | `Accept: */*` and **no `Content-Type` at all** | all 34 `/ci/api` requests recorded from the browser, across the workflow and Usage pages, send exactly this. Sending `application/vnd.api+json` instead is answered **403** — established by hand on 2026-08-21, one header varied at a time on one URL, and the reason every `ci-*` command in this repository was refused for the whole of its life |

`GET`, `POST`, `PATCH` and `DELETE`; anything else is refused. No call addressed to iris
uses `PUT`, and the upload part that does goes to `object-storage.apple.com` through
`uploadPart`, without the cookie and without `request`. On the Xcode Cloud base only `GET`
is reachable at all: the base is declared read-only and the transport refuses the other
three before a request is built, so the recorded `PUT` to `workflows-v15/{id}` — a
full-document replace — cannot be sent by anything here.

**A 403 is read per base.** iris uses one to refuse a query it does not support as well as
to reject a dead session, and tells them apart by whether the body is a JSON:API error
document. Xcode Cloud is not JSON:API and never sends one: its 403 came back as
`text/html` with a zero-length body while `asc status` on the same capture said the session
was healthy with hours left. So a 403 there is reported as the refusal it is, never as
"log in again".

A gap that turns out to need something else brings a recording showing it. Narrowing to one
base on 2026-08-21 changed no byte on the wire, and neither did reopening the second one on
2026-08-22: `test/gap-requests.test.ts` pins the method, body and content type of every
retained call, and passed unedited across both. The `http.write` audit records, the
redaction, the host check and the confirmations were not touched by either.

### Which headers the browser sends, and on what

Read across every recording on **2026-08-21**: 413 requests in all, 224 of them to
`iris/v1` — 214 `GET`, 6 `PATCH`, 4 `POST`. Presence was counted per method; only the
values of the four structural headers were read.

| Header | Reads | Writes | What this client does |
| --- | --- | --- | --- |
| `Origin` | 0/214 | 10/10 | sent on writes only. The one header that really is write-only |
| `X-Connect-Team-ID` | 214/214 | 10/10 | sent on both, since **2026-08-21**. It was a write header here until then |
| `X-Connect-Team-Type` | 214/214, all `PURPLESOFTWARE` | 10/10, all `PURPLESOFTWARE` | the same, with `PURPLESOFTWARE` as the fallback when the capture has none |
| `X-CSRF-ITC` | 211/214 | 8/10 | always sent, from the capture or as `[asc-ui]` |
| `Referer` | 214/214 | 10/10 | carried from the capture; also where the default app id is scraped from |
| `Content-Type` | 133 `application/vnd.api+json`, 78 `application/json`, 3 absent | 9 `application/vnd.api+json`, 1 `application/json` | one constant, `application/vnd.api+json`, written **over** the capture's since 2026-08-21 |
| `Accept` | 133 `application/vnd.api+json`, 78 the three-value list, 3 `*/*` | the same split | one constant, the three-value list, likewise written over the capture's |
| `X-Apple-App-Id` | 0/214 | 0/10 | **not sent, and no longer carried.** It is on none of the 413 requests, on any host |

Three findings, all of them corrections rather than confirmations:

- **The team pair is not a write header.** Sending it only when mutating went unnoticed
  because a capture taken from a browser `GET` carries it and it arrived through the spread
  anyway. A capture pasted as a bare cookie jar — which `README.md` offers as enough — has
  neither, and its reads went out without them.
- **The capture was deciding the media types.** `headersFor` set `Accept` and `Content-Type`
  and then spread `session.headers` over them, so the capture won. iris is served from two
  front-end bundles that disagree about both, and the split is per page rather than per
  route: `apps/{id}/resolutionCenterThreads`, `apps/{id}/dataUsages` and
  `resolutionCenterThreads` are each recorded under both spellings. So a capture taken from
  the `application/json` half put that content type on `POST resolutionCenterMessages` — the
  send to App Review, from which there is no return — where all four recorded `POST`s send
  `application/vnd.api+json`. Both spellings are answered by iris on the routes recorded, so
  no request is known to have failed over this; what was wrong was that the value was not the
  client's to lose.
- **`X-Apple-App-Id` was carried and never sent.** It sat in `KEEP_HEADERS` and appears on no
  recorded request at all. It was also the only header there naming one app rather than the
  account, so a session captured from one app's page would have labelled requests about
  another app with it. That question needed a capture to settle, and this is the answer: the
  browser never sends it.

This changed bytes on the wire, unlike the narrowing above: reads gained the team pair, and
both media types stopped varying with the capture. Every value now sent is one the
recordings show the browser sending on iris.

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

Four more from the same recordings were weighed against the boundary one at a time and left
out, and they are recorded here so the comparison does not have to be made twice:

- **`GET …/products-v4?limit=100`** duplicates official `ciProducts`. `id`, `name`,
  `product_type`, `created_at` and `app_id` are `CiProduct.name`, `.productType`,
  `.createdDate` and the `app` relationship. Only `modified_at` has no official field, and a
  last-modified date is not on its own worth a private call.
- **`GET …/scm-providers-v2`** is mostly official too: `provider`,
  `provider_display_name` and `is_on_premise` are exactly `ScmProviderType.kind`,
  `.displayName` and `.isOnPremise`, and `host` is `ScmProvider.url`. What is private is the
  *connection* state — `is_registered`, `is_user_connected`, `supports_registration_flow`,
  `register_type`, `install_type`, `connect_type`, `username`, `oauth_callback_base_uri` —
  which is OAuth plumbing for rendering a Connect button, not a capability a CLI needs.
- **`GET …/integrations/slack`** answers `{is_user_connected}`. No official equivalent, and
  one boolean about a chat integration is thin.
- **`asc-extension-products` and `/ci/status/system-status`** both returned empty in the
  recording — `{"items":[]}` and `{}` — so nothing can be claimed about either.

The `olympus` calls in the same recordings — `actors`, `people`, `sites`, `contractMessages`,
`providerNews` and a `providerSwitchRequests` POST — are session and account plumbing on a
third base this client does not have. `people` and `actors` carry personal data, which is the
line `user-capabilities` was checked against and found not to cross.

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
