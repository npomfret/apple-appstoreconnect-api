# As a library

What this library exports is the gap surface and nothing else: Resolution Center threads,
messages, rejections, drafts and attachments; unread review-message counts; version
state-change history; and App Privacy. Everything else App Store Connect can do, Apple
serves through its
[official API](https://developer.apple.com/documentation/appstoreconnectapi/) — with an API
key rather than the browser cookie this client reads, and there is no export here that
wraps or forwards to it.

```ts
import { loadSession, buildReport, listMessages, denormalizeAll } from './src';

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
reason that arrives without one. A rejection has no date — `reasons` is its only attribute —
so where two rejections cite the same code, the first wording is kept and there is no later
one to prefer.

`attachments: Attachment[]` is every file on the thread, from the messages *and* from the
rejections — Apple hangs them off both, on `resolutionCenterMessageAttachments` and
`rejectionAttachments`, and they are the same resource type either way. It is keyed by iris's
`id`, not by file name, and carries that id: a thread's messages can hold two attachments
under one name — every recording here has such a message — so deduplicating by name loses one
of them.

`denormalize` splices JSON:API `included` resources into their relationships, so you can
read `thread.app.name` instead of hand-joining sideloads.

`loadSession()` reads and parses the capture file — `tmp/curl.txt`, or `ASC_CURL_PATH` —
every time you call it; nothing is cached on disk. Call it once and keep the `Session`,
rather than per request. `sessionFromCapture(text)` does the same parse on a string you
already have, if the capture reaches you some other way.

`src/index.ts` re-exports everything, so any function in `src/api.ts` is importable from
the package root. Everything it returns is a JSON:API document, which is what `denormalize`
and `denormalizeAll` are for.

**The confirmation prompts are the CLI's, not the API's.** `sendDraftMessage()` and
`sendDraftReply()` called from code go straight to Apple, and neither can be undone.
`saveDraftReply()` asks nothing either, and replaces whatever text the draft box held.
`confirm()` from `src/confirm.ts` is there if you want the same guard — it asks on the
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

- The include lists in `src/api.ts` are copied verbatim from the browser, all of them, in
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
- A path is a path — `resolutionCenterThreads/{id}` — always relative to
  `https://appstoreconnect.apple.com/iris/v1`. An absolute URL is refused rather than
  fetched: everything `request()` sends carries the session cookie and the CSRF header, so a
  URL naming another host is your App Store Connect session handed to that host, and `raw()`
  takes its path from whatever called it — `asc get` from the command line. The one
  cross-origin request here, an upload part, doesn't go through `request()` at all.
- **`raw()` is confined to the private families**, and it is the library's boundary as much
  as the CLI's: `resolutionCenterThreads`, `resolutionCenterMessages`,
  `resolutionCenterDraftMessages`, `resolutionCenterMessageAttachments` and
  `reviewRejections` whole, plus `apps/{id}/{resolutionCenterThreads,dataUsages,dataUsagePublishState}`
  and `appStoreVersions/{id}/appStoreVersionStateChanges`. Anything else throws before a
  request is built. There is no write-side counterpart: an unrestricted private PATCH is how
  every official write would come back within reach, and a hand-written body belongs at
  Apple's official API, which asks for a key rather than a scraped cookie.
- The method is one of `GET`, `POST`, `PATCH` and `DELETE`, in whatever case you send it.
  Whether a request mutates decides its headers and whether it lands in the audit trail, so
  it's settled once from the normalised name; anything that isn't one of the four is refused
  rather than guessed at. `PUT` is not one of them — the only PUT here is an upload part,
  which goes to Apple's storage through `uploadPart()` and never through `request()`.
- **One base and one content type**, both module constants rather than options. `BASE_URL`
  is `https://appstoreconnect.apple.com/iris/v1`, every request sends
  `application/vnd.api+json`, and neither is something a caller passes: `RequestOptions` is
  `method`, `query` and `body`, and `patch()`/`post()` take a path and a body. A gap that
  needs something else brings a recording showing it, which is a conversation rather than an
  argument.
- **Nothing from the account the captures came from is baked in.** Every id, locale,
  platform and territory reaches a request from an argument or from the session, and the
  values in the recordings work as examples in help text and nowhere else. The constants
  that *are* hard-coded are Apple's own schema — resource and field names, state names,
  include lists, filter values — never one app's data.
- A 403 from iris doesn't always mean the session died — it's also how an unsupported
  filter is refused. `src/http.ts` tells them apart by whether the body is a JSON:API
  error document, so a bad query no longer reads as "log in again".
