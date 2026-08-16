# As a library

```ts
import { loadSession, buildReport, listMessages, denormalizeAll } from './src';

const session = loadSession();
const reports = await buildReport(session, '1234567890');
const messages = denormalizeAll(await listMessages(session, reports[0].threadId!));
```

`denormalize` splices JSON:API `included` resources into their relationships, so you can
read `submission.appStoreVersionForReview.versionString` instead of hand-joining sideloads.

`loadSession()` reads and parses the capture file — `tmp/curl.txt`, or `ASC_CURL_PATH` —
every time you call it; nothing is cached on disk. Call it once and keep the `Session`,
rather than per request. `sessionFromCapture(text)` does the same parse on a string you
already have, if the capture reaches you some other way.

`src/index.ts` re-exports everything, so any function in `src/api.ts` is importable from
the package root.

**The confirmation prompts are the CLI's, not the API's.** `sendDraftMessage()`,
`sendDraftReply()`, `resolveSubmissionItem()` and `submitReviewSubmission()` called from
code go straight to Apple, and none of them can be undone. `confirm()` from
`src/confirm.ts` is there if you want the same guard. `planSubmission()` works out what
`submit` would do and writes nothing, so it's a safe thing to call first — and
`findSendableDraft()` is the read half of `sendDraftReply()`, so you can show a draft and
ask before sending the thing you just showed. That is all `send-reply` does.

## Conventions worth knowing before editing

- The include lists in `src/api.ts` are copied verbatim from the browser, all of them, in
  one `INCLUDES` inventory. `{ include }` replaces the list for a call and `[]` drops the
  parameter, but this is the option to be careful with: **iris rejects the whole request
  with a `400` if you name a relationship it doesn't recognise**, so an override is a
  hypothesis to test rather than a preference. The defaults are the lists observed to work.
- Page sizes are options, never fixed. The top-level one is `{ limit }`; the per-relationship
  caps on what an include drags along are `{ sideloads }`, keyed by relationship name:
  `listMessages(session, threadId, { sideloads: { rejections: 5 } })`. Both default to the
  browser's own numbers, which is what a call with no options sends — including
  `limit[items]=0`, which asks for a submission's items to be identified rather than
  expanded. Raise one when a thread, an app list or a version has outgrown the number the
  UI was built for.
- So are the fieldsets. `{ fields }` is keyed by resource type and replaces one
  `fields[type]` list, again defaulting to the captured one:
  `getVersion(session, versionId, { fields: { appStoreReviewDetails: ['contactEmail'] } })`
  expands a record the version page asks for by id alone. Widening is the safe direction;
  narrowing past the browser's list will start removing attributes `report.ts` reads, so
  check what formats a call before trimming it.
- Query strings are built by hand rather than with `URLSearchParams`: Apple wants literal
  `[`, `]` and `,`, which `URLSearchParams` would percent-encode.
- **Nothing from the account the captures came from is baked in.** Every id, category,
  locale, platform and territory reaches a request from an argument or from the session,
  and the values in the recordings work as examples in help text and nowhere else. The
  constants that *are* hard-coded are Apple's own schema — resource and field names, state
  names, include lists, screenshot display types — never one app's data. The age-rating
  questionnaire is the case worth remembering: the recorded 29 questions order a body,
  while which questions exist is read back off the app being edited.
- A 403 from iris doesn't always mean the session died — it's also how an unsupported
  filter is refused. `src/http.ts` tells them apart by whether the body is a JSON:API
  error document, so a bad query no longer reads as "log in again".
