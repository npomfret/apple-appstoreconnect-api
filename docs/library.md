# As a library

The package root exports three namespaces, one per credential:

| Namespace | Needs | Holds |
| --- | --- | --- |
| `official` | an API key: issuer, key id, `.p8` | Apple's documented API and the wrappers over it |
| `gap` | a browser session capture | only what Apple serves nowhere else |
| `shared` | nothing | logging, redaction, refusals, query encoding, JSON:API expansion, confirmation |

They are namespaces rather than one flat surface because the two credentials are separate
security boundaries, and an import that says `official.` or `gap.` says which one the
calling code is committing to. `official` and `gap` cannot reach each other even by
accident: they live in directories that may not import one another, enforced by
`test/module-boundary.test.ts`.

`official.officialCredentials()` reads `ASC_ISSUER_ID`, `ASC_KEY_ID` and
`ASC_PRIVATE_KEY_PATH`; `official.officialClient()` creates the host-confined bearer
transport; `findAppId()`, `fetchAvailability()`, `formatAvailability()` and
`availabilityReady()` are the reusable storefront flow:

```ts
import { official } from './src';

const { availabilityReady, fetchAvailability, officialClient, officialCredentials } = official;

const client = officialClient(officialCredentials());
const report = await fetchAvailability(client, appId);
if (!availabilityReady(report)) process.exitCode = 1;
```

One client can be reused for as long as the process runs: it mints a bearer token on demand
and re-mints before Apple's twenty-minute limit, so sweeping many apps in a loop does not
outlive its credential.

Each official capability follows the same three shapes — `fetch…` for typed data, `format…`
for a human, and `…Ready` for the boolean a CI check needs — so a new wrapper is predictable
to both call and add.

Availability also exports the pieces its report is built from: the `ContentStatus` union of
Apple's 48 documented storefront statuses, the `TerritoryState` a row is reduced to, and
`territoryState()`, which applies the worst-status-wins rule to any list of statuses.

The private exports cover Resolution Center threads,
messages, rejections, drafts and attachments; unread review-message counts; version
state-change history; App Privacy; and five Xcode Cloud reads — `post_actions`, compute
usage, the team's Developer Program standing, what the session is permitted to do, and what
builds against Apple's pre-release macOS and Xcode.
Other documented capabilities remain available through Apple's
[official API](https://developer.apple.com/documentation/appstoreconnectapi/) and can be
added to the official transport when there is a reusable command to justify them.

```ts
import { gap, shared } from './src';

const { loadSession, buildReport, listMessages } = gap;
const { denormalizeAll } = shared;

const session = loadSession();
const reports = await buildReport(session, { appId: '1234567890' });
const messages = denormalizeAll(await listMessages(session, reports[0].threadId!));
```

`buildReport` takes one of three starting points. All three are private routes — Apple's
official API has no Resolution Center in 4.4.1 — so none of them duplicates a call it
serves:

```ts
await buildReport(session, { threadId });       // no discovery at all
await buildReport(session, { submissionId });   // thread found by a private filter
await buildReport(session, { appId });          // apps/{id}/resolutionCenterThreads
```

A `SubmissionReport` carries nothing of the submission's own — no `state`, `platform`,
`submittedDate` or `lastUpdatedDate`. Those come off `reviewSubmissions`, which Apple serves
officially at
[`GET /v1/apps/{id}/reviewSubmissions`](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions),
so they are absent from the type rather than present and permanently undefined.
`submissionId` is optional and is an echo — only the `{ submissionId }` route has one, and
it is the id you passed in.

The version comes off the thread instead, through its to-many `appStoreVersions`. A report
lists every version its thread names in `versions: VersionRef[]`, and fills the singular
`version`/`versionId` only when there is exactly one — a thread about two versions is not
reduced to one of them.

`guidelines: Guideline[]` is the rules the thread's rejections cite, lowest number first and
each one once, as `{ code, description }`. `code` is Apple's own `4.1.0` and `description` is
Apple's own `Design: Copycats` — the section's name is the front of the description, not a
field of its own. Apple does send a `reasonSection`, but it is the code with its last segment
cut off (`4.1`), so it carries nothing `code` doesn't; it is read only as the code for a
reason that arrives without one. A reason naming neither, or a rejection carrying no `reasons`
list, is refused rather than skipped: the digest prints the block only when it has rows, so a
skipped reason would read as a rejection that cited nothing. A reason with no description is
listed with an empty one — the number is the half you can look up. A rejection has no date — `reasons` is its only attribute —
so where two rejections cite the same code, the first wording is kept and there is no later
one to prefer.

`attachments: Attachment[]` is every file on the thread, from the messages *and* from the
rejections — Apple hangs them off both, on `resolutionCenterMessageAttachments` and
`rejectionAttachments`, and they are the same resource type either way. It is keyed by iris's
`id`, not by file name, and carries that id: a thread's messages can hold two attachments
under one name — every recording here has such a message — so deduplicating by name loses one
of them.

`Attachment.fileName` is optional, which it became on 2026-08-22. A name is a label and the
`id` is the identity, so a file iris names nothing is still in the list and still in its
count; before that it was dropped, which made the count wrong and disagreed with `asc draft`,
which has always shown such a file. The one field that cannot be missing is `id`: an
attachment without one makes `buildReport` throw rather than be dropped or listed, because
there is nothing to deduplicate on and nothing `deleteMessageAttachment` could be given.

`denormalize` splices JSON:API `included` resources into their relationships, so you can
read `thread.app.name` instead of hand-joining sideloads. Flattening a resource that way is
safe because JSON:API forbids an attribute or relationship named `type` or `id`; **where a
resource breaks that rule, the document's identity wins and the colliding member is
dropped** — it was the other way round until 2026-08-21. Apple does break it: a `providers`
resource recorded from the browser carries an attribute named `type`. Nothing here reads that
resource, so this changes nothing any command prints; it means `type` and `id` on a
denormalized resource are always what the document said it was.

`loadSession()` reads and parses the capture file — `tmp/curl.txt`, or `ASC_CURL_PATH` —
every time you call it; nothing is cached on disk. Call it once and keep the `Session`,
rather than per request. `sessionFromCapture(text)` does the same parse on a string you
already have, if the capture reaches you some other way.

`src/index.ts` re-exports each directory whole, so any function in `src/gap/api.ts` is
reachable as `gap.…`. Everything there returns a JSON:API document, which is what
`shared.denormalize` and `shared.denormalizeAll` are for — they are in `shared` rather than
`gap` because JSON:API is the format of both of Apple's APIs, not a property of the private
one.

`src/gap/ci.ts` is the exception and the only non-iris module. `fetchPostActions(session,
productId)` answers whether an Xcode Cloud workflow hands its builds to TestFlight
automatically; `fetchPlan(session)` and `fetchUsage(session, days)` answer how much build
compute the team has left and where it went; and `fetchTeam(session)` answers where the team
stands with the Apple Developer Program, including whether the Program License Agreement is
waiting for a signature; `fetchCapabilities(session)` answers what Xcode Cloud says this
session is permitted to do; and `fetchInfrastructureValidation(session, productId?)` answers
what is opted in to building against Apple's pre-release macOS and Xcode. None of the five
has a schema in Apple's official specification.
They return plain objects rather than JSON:API — `listWorkflows` is the untouched response
if you want it — and `denormalize` has nothing to do with any of them.

`fetchPostActions` refuses what it cannot read rather than skipping it, and that is a
contract: a workflow with no id or no `content`, a workflow whose `post_actions` is missing
or is not a list, a post-action with no id, a missing `disabled`, and a response with no
`items` list are all errors. The reason is that this call has no harmless silence — every
one of those, dropped, comes back out of `formatPostActions` as "a build from this workflow
is not handed on automatically" or as a product with one workflow fewer. What it does
tolerate is the opposite direction: a key Apple has *added* to a post-action is kept by name
in `unmodelled` and shown, since an unstable private field gaining a key is expected and
says nothing false. `name` and `type` are labels rather than answers, so a missing one is
marked in place rather than refused.

`fetchPrivacy`'s `collectsNothing` is a contract of the same kind, one layer up from a
parse. It is true only when the "collects nothing" marker row is the *whole* declaration:
that row arriving beside a declared collection leaves it `false`, because an app that
declares a collection collects something whatever else it also says. `usages` always carries
every row either way, marker included, so a caller can see the contradiction rather than
being handed a summary of it. `formatPrivacy` names it and prints the rows; it does not
throw, which is the difference between this and `gap/ci.ts` — nothing is missing here, both
claims arrived, and refusing the read would withhold the evidence for the contradiction
while the only thing actually unavailable is the one-line summary.

Two things about `fetchPlan` are contracts rather than incidental. Its minutes are
**minutes**, established from the recording rather than from a field name; and its window is
not `fetchUsage`'s window, so the two are never added together. `fetchPlan` throws if Apple
sends no plan or a non-numeric total, because a missing allowance and an exhausted one are
different answers. `fetchUsage` is the one lenient reader here: unrecognised rows are
dropped, since a missing row is a gap in a breakdown rather than an unanswerable question.
It is the only place in `gap/ci.ts` where that is true.

`fetchTeam` throws on the same principle, and it is among the strictest here: a missing or
non-boolean `wwdr_pla_needs_signing` is an error rather than a `false`, because reading an
unanswered question as "nothing to sign" is the one wrong answer the call can give. It
carries five of the response's eight keys — the team uuid it was called with, an unexplained
`public_provider_id` and the page's own web links are all dropped — and `programState` is a
`string` rather than a union, passed through and never compared against a literal.

`fetchCapabilities` is stricter still: **all thirteen booleans are required**, and a missing
one is an error rather than a `false`. Apple saying nothing about a permission is not Apple
withholding it, so neither a `false` nor a `true` default is available. Its return type is
derived from one table of wire keys, so the field set and what the response is read with
cannot drift apart, and a fourteenth key is neither carried nor absorbed. `SessionCapabilities`
is a fact about the *account*, not about this library: every one of the thirteen is a write,
and the `/ci/api` base is read-only, so nothing here acts on any of them.

`fetchInfrastructureValidation` is two requests, or three when a `productId` is given, and it
parses a row the strict way rather than the lenient one: a product or workflow whose `opt_in`
is missing or is not a boolean is an error, because a dropped row would be indistinguishable
from a product that is not opted in. It never follows a second page — the response carries no
cursor, so a full page is logged as possibly clipped and left there — and the three levels
come back as three separate answers, since nothing observed says how a team switch relates to
a product's. There is no counterpart that *sets* any of it: the writes were never recorded.

**The confirmation prompts are the CLI's, not the API's.** `sendDraftMessage()` and
`sendDraftReply()` called from code go straight to Apple, and neither can be undone.
`saveDraftReply()` asks nothing either, and replaces whatever text the draft box held.
`confirm()` from `src/shared/confirm.ts` is there if you want the same guard — it asks on the
terminal even when stdin is carrying something else, and refuses when there is no terminal
to ask on. `findSendableDraft()` is the read half of `sendDraftReply()`, so you can show a
draft and ask before sending the thing you just showed; `findDeletableDraft()` is the same
half of `discardDraftReply()`, and differs in one thing — an empty draft is still one to
delete. `saveDraftReply()` has no read half of its own: `getDraftMessage()` is the whole of
it, since `{"data": null}` is the answer meaning there is nothing to ask about. That is all
`send-reply` does — plus one more `findSendableDraft()` after the answer, since the send
posts a reference to the draft rather than its text, and the box autosaves while your prompt
is on screen. `draftState()` is the comparison it makes between those two reads: a string
fingerprint of the body and the attachment set, ordered so that two reads of one untouched
draft match. `save-draft` uses it the same way over `getDraftMessage()`, since writing over
words is the same question as sending them. Worth copying if you build your own.

## Conventions worth knowing before editing

- The include lists in `src/gap/api.ts` are copied verbatim from the browser, all of them, in
  one `INCLUDES` inventory. `{ include }` replaces the list for a call and `[]` drops the
  parameter, but this is the option to be careful with: **iris rejects the whole request
  with a `400` if you name a relationship it doesn't recognise**, so an override is a
  hypothesis to test rather than a preference. The defaults are the lists observed to work.
- Page sizes are options, never fixed. The top-level one is `{ limit }`; the per-relationship
  caps on what an include drags along are `{ sideloads }`, keyed by relationship name:
  `listMessages(session, threadId, { sideloads: { rejections: 5 } })`. Both default to the
  browser's own numbers, which is what a call with no options sends. Raise one when a
  thread, an app list or a version has outgrown the number the UI was built for.
- Nothing pages. One request gets one page, and a list that came back short is reported
  rather than followed: `read.clipped` in the log when iris gives a total bigger than what
  it sent, which it does on every collection recorded from the browser. `read.atLimit` is
  the fallback for a route that reports no total — the page came back exactly as long as
  the page size iris applied, per `meta.paging.limit`. Worth knowing because a clipped list
  is not obviously one — `listMessages` and `listThreads` send no top-level limit, as the
  browser doesn't, so iris's default page of 50 applies and a long thread comes back cut off
  at the end, which is the end you wanted. Pass `{ limit }` to see past it; `listThreads`
  has no such option, since the captured query has none.
- So are the fieldsets. `{ fields }` is keyed by resource type and replaces one
  `fields[type]` list, again defaulting to the captured one. One call sends one now:
  `listAppMetrics`, where the fieldset is what keeps the read down to two private counters
  instead of a listing of the apps they hang off. Widening that one would put an official
  app read back.
- Query strings are built by hand rather than with `URLSearchParams`: Apple wants literal
  `[`, `]` and `,`, which `URLSearchParams` would percent-encode.
- A path is a path — `resolutionCenterThreads/{id}` — relative to the base of the API it is
  given, `iris/v1` unless a caller names another, and it is checked as the URL it **resolves
  to** rather than as the text you wrote. An absolute URL is refused, and so is a path that
  climbs out of that base: everything `request()` sends carries the session cookie and the
  CSRF header, so where it lands is the whole question, and `raw()` takes its path from
  whatever called it — `asc get` from the command line. Until 2026-08-21 only a literal `..`
  was refused, which is one of several ways to write the same climb: `%2e%2e` and `%2E%2E`
  are dot segments to the URL parser, and `\` separates segments on an https URL exactly as
  `/` does, so `resolutionCenterThreads/%2e%2e/%2e%2e/%2e%2e/ci/api/v1/ciBuildRuns` went out
  with the cookie on it. A query or a fragment in a path is refused too — the query is
  `query`'s to state, and what follows a `#` is never sent. The one cross-origin request
  here, an upload part, doesn't go through `request()` at all.
- **`raw()` is confined to the private families**, and it is the library's boundary as much
  as the CLI's: `resolutionCenterThreads`, `resolutionCenterMessages`,
  `resolutionCenterDraftMessages`, `resolutionCenterMessageAttachments` and
  `reviewRejections` whole, plus `apps/{id}/{resolutionCenterThreads,dataUsages,dataUsagePublishState}`
  and `appStoreVersions/{id}/appStoreVersionStateChanges`. Anything else throws before a
  request is built. There is no write-side counterpart: an unrestricted private PATCH is how
  every official write would come back within reach, and a hand-written body belongs at
  Apple's official API, which asks for a key rather than a scraped cookie. It reaches iris
  and only iris — the Xcode Cloud base has no escape hatch of its own, and `raw()` cannot
  be pointed at one.
- The method is one of `GET`, `POST`, `PATCH` and `DELETE`, in whatever case you send it.
  Whether a request mutates decides its headers and whether it lands in the audit trail, so
  it's settled once from the normalised name; anything that isn't one of the four is refused
  rather than guessed at. `PUT` is not one of them — the only PUT here is an upload part,
  which goes to Apple's storage through `uploadPart()` and never through `request()`.
  `uploadPart()` checks its own destination, since it is outside the one `request()`
  applies: a part goes over https to a host under `object-storage.apple.com` or it is not
  sent, and the refusal names the host without quoting the presigned URL.
- **Two bases, each with its own media types**, declared as `Api` values in `src/gap/http.ts`
  rather than assembled by a caller. `IRIS` is `https://appstoreconnect.apple.com/iris/v1`
  and sends `application/vnd.api+json` as both `Accept` and `Content-Type`; `CI` is
  `https://appstoreconnect.apple.com/ci/api`, sends `Accept: */*` and **no `Content-Type` at
  all**, because Xcode Cloud answers a request claiming to be JSON:API with a `403`. A
  caller picks a base — `RequestOptions.api`, defaulting to `IRIS` — and does not pick the
  media types. Nor does the capture, though it did until 2026-08-21, when its headers were
  spread over the transport's own and whichever iris request was right-clicked chose the
  `Content-Type` and `Accept` for every later one. A third base brings a recording showing
  it, which is a conversation rather than an argument.
- **`CI` is read-only, and that is enforced in the transport.** `request()` refuses any
  method but `GET` on a base marked `readOnly` before a URL is even built. The `PUT` that
  sets a workflow's `post_actions` is recorded in both directions, so this is not a gap in
  the evidence: it is a full-document replace of fourteen keys, so a client that does not
  model every one of them destroys what it fails to send back.
- **A 403 is classified per base.** iris uses one both for a dead session and for a query it
  refuses, and `Api.expiredOn403` tells them apart by whether the body is a JSON:API error
  document. Xcode Cloud never sends one — its 403 is `text/html` with no body — so a 403
  there is an `ApiError` carrying the likely cause, never a `SessionExpiredError`.
- **A short page is spotted per base too.** `Api.pageOf` is what reads a collection: iris's
  `data` with `meta.paging`, Xcode Cloud's `items` with neither a total nor an applied
  limit — which is the case `read.atLimit` exists for, comparing against the size that was
  asked for.
- **The session supplies who you are, not how to talk.** A `Session`'s `headers` carry the
  account's — the CSRF value, the referer, the team pair, the user agent — and `request()`
  writes its own media types and cookie over them. The team pair goes on reads as well as
  writes, because the browser sends it on every iris request; `Origin` is the one header
  that really is write-only.
- **Nothing from the account the captures came from is baked in.** Every id, locale,
  platform and territory reaches a request from an argument or from the session, and the
  values in the recordings work as examples in help text and nowhere else. The constants
  that *are* hard-coded are Apple's own schema — resource and field names, state names,
  include lists, filter values — never one app's data.
- A 403 from iris doesn't always mean the session died — it's also how an unsupported
  filter is refused. `src/gap/http.ts` tells them apart by whether the body is a JSON:API
  error document, so a bad query no longer reads as "log in again".
