# appstoreconnect-bot

An unofficial client for the App Store Connect **review centre** — the Resolution Center
threads, rejections and review submissions that Apple's public App Store Connect API does
not expose.

It talks to the same private `https://appstoreconnect.apple.com/iris/v1` service the web UI
uses, reusing a session you capture from your browser.

## First: you need a cookie

**There is no API key for this, and no way to get one.** `iris` authenticates with the
browser session cookie and nothing else. Apple gates that behind an interactive login —
passkey, 2FA — so every session starts with you in a browser. It's clunky. There's no
alternative.

Sessions last a few hours. When one lapses you do this again.

1. Log in to <https://appstoreconnect.apple.com> as normal, and open any page of the app
   you care about (a review submission or the version page).
2. Dev tools → **Network**, filter to Fetch/XHR, click any request to `/iris/v1/...`.
3. Right-click it → **Copy** → **Copy as cURL**.
4. Paste it into a scratch file - save it to somewhere (eg `tmp/curl.txt`) **that is gitignored**, keep it there.
5. Hand it over:

   ```sh
   npm install && npm run build
   node dist/cli.js login tmp/curl.txt      # or: pbpaste | node dist/cli.js login
   node dist/cli.js status                  # confirms it, and how long it has left
   ```

Any request will do, `GET` or otherwise — the team id that writes need is decoded from the
cookie rather than read off the headers, so a session captured from a plain read can still
write. The file can contain several curls with notes around them; the first is used, and
only the cookie plus a handful of headers are kept.

The result lands at `tmp/session.json` (mode `0600`, gitignored, `ASC_SESSION_PATH` to
move it). Treat both files as live credentials: anyone holding that cookie is you, on your
developer account, until it expires.

### Or paste the cookie on its own

If getting a clean curl is awkward, `login` takes ordinary text instead — one item per
line, any order, `#` comments and blank lines ignored:

```
# grabbed 13 Aug
Cookie: myacinfo=...; itctx=...; dqsid=...
https://appstoreconnect.apple.com/apps/6761343835/distribution/ios/version/inflight
```

Only the cookie is required, and the `Cookie:` prefix is optional. Account id, team id and
expiry are all decoded from it. The URL line just supplies the default app id, which you
can otherwise pass per command (`asc report <appId>`). Everything else is ignored, so an
HTTP/2 header block pasted straight out of dev tools (`:authority:`, `sec-fetch-*` and
all) works unedited.

## Usage

```sh
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
| `screenshots [versionId]` | `appStoreVersionLocalizations?filter[appStoreVersion]={id}&include=appScreenshotSets,appPreviewSets` |
| `review-details [versionId]` | `appStoreVersions/{id}` → `appStoreReviewDetails/{id}` |
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
node dist/cli.js screenshots            # -> every locale with its sets, in one request
```

`screenshots` uses the same call the version page does, so one request covers all locales
and both asset kinds. Giving it a version id explicitly skips the lookup that works out
which version is under review.

### App Review Information

```sh
node dist/cli.js review-details          # contact, demo account, notes to the reviewer
node dist/cli.js review-details --reveal # including the demo account password
```

Worth reading on any rejection: "we were unable to sign in" and "we couldn't locate the
feature" are complaints about this record rather than about the build. It also lists the
`appStoreReviewAttachments` given to the reviewer.

The demo account password is blanked unless you ask for it. Everything here prints to
stdout, and a live credential left in terminal scrollback is a worse problem than having
to pass a flag. The account *name* is shown — it's the pair that's the credential, and
knowing which account Apple was given is usually the point.

For anything not mapped yet, probe it directly:

```sh
node dist/cli.js get resolutionCenterThreads 'filter[reviewSubmission]=<id>'
```

## Writing

Two things are mapped: attaching a build to a version (the version page's **Save**
button) and adding a screenshot.

```sh
node dist/cli.js builds <versionId>                 # pick an id
node dist/cli.js set-build <versionId> <buildId>    # or "none" to detach
node dist/cli.js patch appStoreVersions/<id> '{"data":{...}}'   # anything else
```

Writes send a different header set to reads — `Origin` and the `X-Connect-Team-*` pair,
plus a `Content-Type` that isn't the same for every endpoint: the version PATCH sends
`application/json`, the asset endpoints `application/vnd.api+json`. Both were copied from
the browser. The team id is only present on captured write requests, so it's also decoded
from the `itctx` cookie's `cp` field; that means a session captured from any ordinary
`GET` can still write.

### Adding a screenshot

```sh
node dist/cli.js screenshots                         # -> localizationIds, sets, display types
node dist/cli.js upload-screenshot <locId> APP_IPHONE_65 shot.png
node dist/cli.js delete-screenshot <screenshotId>
```

`upload-screenshot` does the whole dance, creating the set if that device size doesn't
have one yet: `POST appScreenshots` reserves a slot for a file of that name and size, the
response comes back with an `uploadOperations` array of presigned URLs, the bytes are PUT
to each in turn, and `PATCH appScreenshots/{id}` with `{"uploaded":true}` commits it. Skip
that last step and the screenshot stays an empty reservation that never appears on the
version page.

The upload legs go to `object-storage.apple.com`, not `appstoreconnect.apple.com`, and
carry **no cookie** — the presigned query string is the entire authentication. `uploadPart`
in `src/http.ts` bypasses the normal request path for exactly that reason, so the session
never follows the bytes to another host. Apple splits large files into several parts, so
the operations are replayed in order rather than assumed to be one PUT.

Verified end to end against a live app: create set, upload, `assetDeliveryState` goes to
`COMPLETE` with the dimensions Apple read back, then delete.

#### Checks before uploading

Dimensions and the ten-per-set limit are checked before any bytes move, and a failure
stops the upload rather than warning past it — `--force` overrides. Failing early matters
because the alternative is a half-made asset on a live version.

```
$ node dist/cli.js upload-screenshot <locId> APP_IPHONE_65 wrong-size.png
Not uploading wrong-size.png: 800 × 600 is not a size APP_IPHONE_65 accepts — it takes
1242 × 2688, 2688 × 1242, 1284 × 2778, 2778 × 1284. Pass --force to upload anyway.
```

`SCREENSHOT_DISPLAY_TYPES` in `src/screenshots.ts` is complete and authoritative — iris
hands over the whole enum if you POST an invalid one, which is how it was obtained.

`SCREENSHOT_SIZES` is **not** complete, on purpose. Accepted dimensions aren't in any API
response; they're only in the drop-zone captions on the version page, so the table holds
just the zones actually read off the screen — 6.5" iPhone, 12.9"/13" iPad, and Apple
Watch. Any display type not in the table skips the dimension check instead of guessing at
it, since a wrong entry would reject a good screenshot. To add one, read its caption in
the browser and transcribe it.

A caption covers several device generations at once and takes any of their sizes, so each
entry is the union of what its caption lists. The watch zone is the awkward case: it names
five generations (Ultra 3, Series 11, 9, 6, 3) with five different sizes but doesn't say
which display type each maps to, so all five `APP_WATCH_*` types accept the union and the
server makes the final call.

The PATCH body carries only what changed — omitted fields are left alone:

```json
{"data":{"type":"appStoreVersions","id":"<versionId>",
  "relationships":{"build":{"data":{"type":"builds","id":"<buildId>"}}}}}
```

## Logging and the audit trail

Logging is structured: one JSON object per line, always on **stderr**, so stdout stays
pure data and `asc report --json | jq` is unaffected.

```sh
ASC_LOG=debug|info|warn|error|off   # default info
```

No interpolated sentences — the first argument is a stable event slug and everything else
is a field, so you can filter on `.event` without matching on prose that might get
reworded later:

```ts
log.warn('screenshot.check', { fileName, displayType, problem, forced });
```

**Every change to live data is audited**, and audit records are emitted whatever the level
is set to — an audit trail you can turn down isn't one. They carry `"audit":true` and a
`phase` of `start`, `ok` or `error`:

```sh
node dist/cli.js upload-screenshot ... 2>&1 >/dev/null | jq -c 'select(.audit)'
```

```json
{"event":"screenshot.upload","audit":true,"phase":"start","displayType":"APP_IPHONE_65","fileName":"shot.png","dimensions":"1242 × 2688"}
{"event":"http.write","audit":true,"phase":"start","method":"POST","url":".../appScreenshots","body":{...}}
{"event":"asset.part","audit":true,"phase":"ok","host":"object-storage.apple.com/...","offset":0,"length":52384,"status":200}
{"event":"screenshot.upload","audit":true,"phase":"ok","ms":1832}
```

Records nest: the semantic action (`screenshot.upload`, `version.build.set`,
`screenshot.delete`) brackets the transport-level `http.write` entries. The transport one
is what makes coverage complete — every mutation in the client funnels through the single
`request` in `src/http.ts`, so nothing can write without being recorded. The semantic ones
add the intent.

`start` is written *before* the request leaves, on purpose: if a run dies mid-write, or the
connection fails so you can't tell whether the change landed, the ambiguity is the thing
you most want a log of.

Cookies never reach the log. `src/log.ts` scrubs `cookie`, `x-csrf-itc`, `myacinfo`,
`itctx` and friends wherever they appear, however deeply nested, and the presigned upload
URLs are logged as host plus path only — their query string *is* the credential. Long
strings are truncated, and a body that can't be serialised degrades to a note rather than
taking the command down with it.

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

- **Mostly read-only.** The captured writes are the version PATCH behind `set-build` and
  the screenshot flow. Replying to Apple, saving a draft and editing metadata are all
  writes too (`POST`/`PATCH` to `resolutionCenterDraftMessage`, `appInfoLocalizations`,
  `appStoreVersionLocalizations`) and none have been captured. Do each once in the browser,
  copy the curl, and they can be added the same way. The Resolution Center's own attachment
  upload is likely the same reserve/PUT/commit shape as screenshots, but that's a guess.
- `deleteScreenshot` and `deleteScreenshotSet` were **probed, not captured** — no browser
  request for either was ever copied. They work, but they're the least evidenced calls
  here, and they destroy live data.
- Screenshot sets are readable only through the collection filtered by localization.
  `GET appScreenshotSets/{id}` 404s for a set that demonstrably exists, and
  `appScreenshots?filter[appScreenshotSet]=` is refused with a 403. That's why
  `findScreenshotSet` takes a localization id rather than a set id.
- A 403 from iris doesn't always mean the session died — it's also how an unsupported
  filter is refused. `src/http.ts` tells them apart by whether the body is a JSON:API
  error document, so a bad query no longer reads as "log in again".
- Evidence varies by call, and it's worth knowing which is which. Confirmed against the
  browser's own requests: `listMessages` and `getDraftMessage` (includes and the
  `limit[rejections]=2000` / `limit[resolutionCenterMessageAttachments]=1000` pair match
  exactly), `listAppInfos`, `getReviewDetails`, and the localizations-with-assets call
  behind `screenshots`. Still probe-only, and so likelier to shift:
  `listVersionLocalizations` (the path form — the browser uses a filter on the collection
  instead) and `listAppInfoLocalizations`.
- `resolutionCenterDraftMessage` returns `{"data": null}` when there's no draft, rather
  than a 404 — so an empty draft box is a successful response, not an error.
- A **HAR export** is the best way to capture new endpoints. Record dev tools → Network
  while doing the thing in the browser, export, and every request *and response* is in
  there — far more than "Copy as cURL" gives you one at a time. Note that a HAR contains
  the full session cookie in plain text, so it belongs in `tmp/` with everything else
  gitignored. `asc login` doesn't parse HAR yet; it wants a curl or a `Cookie:` line.
- The include lists in `src/api.ts` are copied verbatim from the browser. `iris` rejects
  the whole request with a `400` if you ask for an include it doesn't recognise, so don't
  edit them without testing.
- Query strings are built by hand rather than with `URLSearchParams`: Apple wants literal
  `[`, `]` and `,`, which `URLSearchParams` would percent-encode.
- This is an undocumented, private API. It can change without warning, and automating it
  is on you with respect to Apple's terms.
