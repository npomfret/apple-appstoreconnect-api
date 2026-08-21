# As a library

> **Boundary notice:** the exports for apps, versions, builds and review details have now
> gone, along with the Xcode Cloud, invitation, screenshot/preview, metadata/App Information
> and review-submission ones. Use Apple's
> [Apps](https://developer.apple.com/documentation/appstoreconnectapi/apps),
> [App Store Versions](https://developer.apple.com/documentation/appstoreconnectapi/app-store-versions),
> [Builds](https://developer.apple.com/documentation/appstoreconnectapi/builds),
> [Xcode Cloud](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds),
> [User Invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations),
> [App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata),
> [Age Ratings](https://developer.apple.com/documentation/appstoreconnectapi/age-ratings)
> and [Review Submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions)
> APIs instead. What this library exports is the official gaps listed in
> [remove-official-api-overlap.md](../tasks/remove-official-api-overlap.md): Resolution
> Center, unread message counts, version state history and App Privacy.

```ts
import { loadSession, buildReport, listMessages, denormalizeAll } from './src';

const session = loadSession();
const reports = await buildReport(session, { appId: '1234567890' });
const messages = denormalizeAll(await listMessages(session, reports[0].threadId!));
```

`buildReport` takes one of three starting points. All three are private routes — Apple's
official API has no Resolution Center — so none of them duplicates a call it serves:

```ts
await buildReport(session, { threadId });       // no discovery at all
await buildReport(session, { submissionId });   // thread found by a private filter
await buildReport(session, { appId });          // apps/{id}/resolutionCenterThreads
```

A `SubmissionReport` no longer carries the submission's own `state`, `platform`,
`submittedDate` or `lastUpdatedDate`. Those fields are gone from the type rather than left
permanently undefined: they come off `reviewSubmissions`, which Apple serves officially at
[`GET /v1/apps/{id}/reviewSubmissions`](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions),
and that is where to read them. `submissionId` stays optional and is an echo — only the
`{ submissionId }` route has one, and it is the id you passed in.

The version comes off the thread instead, through its to-many `appStoreVersions`. A report
lists every version its thread names in `versions: VersionRef[]`, and fills the singular
`version`/`versionId` only when there is exactly one — a thread about two versions is not
reduced to one of them.

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
`confirm()` from `src/confirm.ts` is there if you want the same guard — it asks on the
terminal even when stdin is carrying something else, and refuses when there is no terminal
to ask on. `findSendableDraft()` is the read half of `sendDraftReply()`, so you can show a
draft and ask before sending the thing you just showed. That is all `send-reply` does —
plus one more `findSendableDraft()` after the answer, since the send posts a reference to
the draft rather than its text, and the box autosaves while your prompt is on screen. Worth
copying if you build your own.

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
  it sent, `read.atLimit` when the page is exactly as long as the limit asked for. Worth
  knowing because a clipped list is not obviously one — `listMessages` sends no top-level
  limit by default, as the browser doesn't, so a long thread comes back cut off at the end,
  which is the end you wanted. Pass `{ limit }` to see past it.
- So are the fieldsets. `{ fields }` is keyed by resource type and replaces one
  `fields[type]` list, again defaulting to the captured one. One call sends one now:
  `listAppMetrics`, where the fieldset is what keeps the read down to two private counters
  instead of a listing of the apps they hang off. Widening that one would put an official
  app read back.
- Query strings are built by hand rather than with `URLSearchParams`: Apple wants literal
  `[`, `]` and `,`, which `URLSearchParams` would percent-encode.
- A path is a path — `appStoreVersions/{id}` — always relative to
  `https://appstoreconnect.apple.com/iris/v1`. An absolute URL is refused rather than
  fetched: everything `request()` sends carries the session cookie and the CSRF header, so a
  URL naming another host is your App Store Connect session handed to that host, and `get`
  and `patch` take their path straight off the command line. The one cross-origin request
  here, an upload part, doesn't go through `request()` at all.
- The method is one of `GET`, `POST`, `PATCH`, `PUT` and `DELETE`, in whatever case you send
  it. Whether a request mutates decides its headers and whether it lands in the audit trail,
  so it's settled once from the normalised name; anything that isn't one of the five is
  refused rather than guessed at.
- **Nothing from the account the captures came from is baked in.** Every id, locale,
  platform and territory reaches a request from an argument or from the session, and the
  values in the recordings work as examples in help text and nowhere else. The constants
  that *are* hard-coded are Apple's own schema — resource and field names, state names,
  include lists, filter values — never one app's data.
- A 403 from iris doesn't always mean the session died — it's also how an unsupported
  filter is refused. `src/http.ts` tells them apart by whether the body is a JSON:API
  error document, so a bad query no longer reads as "log in again".
