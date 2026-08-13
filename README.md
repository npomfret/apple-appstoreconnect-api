# appstoreconnect-bot

An unofficial client for the App Store Connect **review centre** — the Resolution Center
threads, rejections and review submissions that Apple's public App Store Connect API does
not expose.

It talks to the same private `https://appstoreconnect.apple.com/iris/v1` service the web UI
uses, reusing a session you capture from your browser.

## How auth works

There is no API key for this. You log in with your browser and passkey, then hand the tool
a request copied out of dev tools:

1. Log in to App Store Connect and open a review submission page.
2. Open dev tools → Network, right-click any `/iris/v1/...` request → **Copy as cURL**.
3. Feed it in:

   ```sh
   pbpaste | npx asc login
   # or
   npx asc login some-file-with-the-curl.txt
   ```

The cookie jar and CSRF header are stored at `tmp/session.json` (mode `0600`, gitignored;
override with `ASC_SESSION_PATH`). Apple stamps an expiry into the `itctx` cookie — usually
a few hours — and `asc status` shows how long is left. When it lapses, repeat the capture.

The input can be a whole file of several curl commands with notes around them; the first
one found is used. Only the cookie and a handful of headers are kept.

Any request will do, `GET` or otherwise — the team id writes need is decoded from the
cookie rather than taken from the headers, so a read request still yields a session that
can write.

### Or plain text

If a curl is awkward to get, `login` takes an ordinary text file instead. One item per
line, in any order — headers, the page URL, `#` comments, blank lines:

```
# grabbed 13 Aug
Cookie: myacinfo=...; itctx=...; dqsid=...
https://appstoreconnect.apple.com/apps/6761343835/distribution/ios/version/inflight
```

The cookie is the only part that's required, and it can be pasted bare without the
`Cookie:` prefix. Account id, team id and expiry are all decoded from it. The URL line is
optional and only supplies the default app id, which you can otherwise pass per command
(`asc report <appId>`).

Anything else in the file is ignored, so an HTTP/2 header block copied straight out of
dev tools (`:authority:`, `:path:`, `sec-fetch-*` and all) works unedited.

## Usage

```sh
npm install && npm run build

node dist/cli.js status
node dist/cli.js report                 # the useful one — digest of every open submission
node dist/cli.js report --json
```

`report` stitches submissions → thread → messages + rejections + draft into one summary:

```
submission 7ecf0154-9ddc-40f5-9b7c-15d67fb3a88d
  state      UNRESOLVED_ISSUES  (version 1.0.21)
  submitted  2026-05-15T17:16:17.429Z
  thread     74533c00-b29e-3041-826a-1a221f522ecc
  last msg   2026-05-17T12:25:06.31Z (from Apple)
  guidelines
    4.1.0   Design: Copycats
    4.2.2   Design: Minimum Functionality
  attachments (2)
    ...
  latest message from Apple:
    ...
```

Lower-level commands print denormalized JSON (add `--raw` for the untouched JSON:API
document):

| Command | Endpoint |
| --- | --- |
| `apps` | `apps` |
| `inbox` | `apps?fields[appStoreVersionMetrics]=messageCount` |
| `app [appId]` | `apps/{appId}` |
| `submissions [appId]` | `apps/{appId}/reviewSubmissions` |
| `submission <id>` | `reviewSubmissions/{id}` |
| `items <submissionId>` | `reviewSubmissions/{id}/items` |
| `version [versionId]` | `appStoreVersions/{id}` |
| `builds <versionId>` | `builds?filter[appStoreVersion]={id}` |
| `metadata [versionId]` | `apps/{appId}/appInfos` + `appStoreVersions/{id}/appStoreVersionLocalizations` |
| `screenshots <locId>` | `appScreenshotSets?filter[appStoreVersionLocalization]={id}` |
| `threads [appId]` | `apps/{appId}/resolutionCenterThreads` |
| `thread <submissionId>` | `resolutionCenterThreads?filter[reviewSubmission]={id}` |
| `messages <threadId>` | `resolutionCenterThreads/{id}/resolutionCenterMessages` |
| `draft <threadId>` | `resolutionCenterThreads/{id}/resolutionCenterDraftMessage` |
| `rejections <threadId>` | `reviewRejections?filter[resolutionCenterMessage.resolutionCenterThread]={id}` |

`appId` defaults to the one scraped from the captured request's `Referer`; `versionId`
defaults to the version attached to the first open submission.

App Store metadata is split across two records and `metadata` merges them per locale:
**name** and **subtitle** hang off `appInfos`, while description, keywords, promotional
text and what's-new hang off the version. For a metadata rejection the name and subtitle
are usually the point, so don't read only the version half.

The ids chain together, which is what makes scripting possible:

```sh
node dist/cli.js report --json          # -> submissionId, threadId, versionId
node dist/cli.js metadata               # -> localizationId per locale
node dist/cli.js screenshots <locId>
```

For anything not mapped yet, probe it directly:

```sh
node dist/cli.js get resolutionCenterThreads 'filter[reviewSubmission]=<id>'
```

## Writing

One write is mapped: attaching a build to a version, which is what the version page's
**Save** button does.

```sh
node dist/cli.js builds <versionId>                 # pick an id
node dist/cli.js set-build <versionId> <buildId>    # or "none" to detach
node dist/cli.js patch appStoreVersions/<id> '{"data":{...}}'   # anything else
```

Writes send a different header set to reads — `Content-Type: application/json` instead of
`application/vnd.api+json`, plus `Origin` and the `X-Connect-Team-*` pair. The team id is
only present on captured write requests, so it's also decoded from the `itctx` cookie's
`cp` field; that means a session captured from any ordinary `GET` can still write.

The PATCH body carries only what changed — omitted fields are left alone:

```json
{"data":{"type":"appStoreVersions","id":"<versionId>",
  "relationships":{"build":{"data":{"type":"builds","id":"<buildId>"}}}}}
```

## As a library

```ts
import { loadSession, buildReport, listMessages, denormalizeAll } from './src';

const session = loadSession();
const reports = await buildReport(session, '6761343835');
const messages = denormalizeAll(await listMessages(session, reports[0].threadId!));
```

`denormalize` splices JSON:API `included` resources into their relationships, so you can
read `submission.appStoreVersionForReview.versionString` instead of hand-joining sideloads.

## Notes and limits

- **Mostly read-only.** The only captured write is the version PATCH behind `set-build`.
  Replying to Apple, saving a draft, editing metadata and uploading evidence are all
  writes too (`POST`/`PATCH` to `resolutionCenterDraftMessage`, `appInfoLocalizations`,
  `appStoreVersionLocalizations` and the attachment upload flow) and none have been
  captured. Do each once in the browser, copy the curl, and they can be added the same way.
- Deleting a screenshot is **not** the same save. The version page removes it with its own
  request at the moment you click the X, not when you press Save, so it isn't in the
  captured `saveReview` PATCH and isn't mapped.
- `metadata` and `listVersionLocalizations` / `listAppInfoLocalizations` were found by
  probing, not copied from the browser — they aren't in the captured requests, so they're
  slightly more likely to shift than the rest.
- The include lists in `src/api.ts` are copied verbatim from the browser. `iris` rejects
  the whole request with a `400` if you ask for an include it doesn't recognise, so don't
  edit them without testing.
- Query strings are built by hand rather than with `URLSearchParams`: Apple wants literal
  `[`, `]` and `,`, which `URLSearchParams` would percent-encode.
- This is an undocumented, private API. It can change without warning, and automating it
  is on you with respect to Apple's terms.
