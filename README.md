# Apple appstoreconnect API

An unofficial client for the App Store Connect **review centre** — the Resolution Center
threads, rejections and review submissions that Apple's public App Store Connect API does
not expose.

It talks to the same private `https://appstoreconnect.apple.com/iris/v1` service the web UI
uses, reusing a session you capture from your browser.

## Getting started

**There is no API key for this, and no way to get one.** `iris` authenticates with the
browser session cookie and nothing else, and Apple gates that behind an interactive login,
so every session starts with you copying a request out of dev tools. Sessions last a few
hours. Full instructions: [docs/sessions.md](docs/sessions.md).

```sh
npm install && npm run build
node dist/cli.js login tmp/curl.txt      # a "Copy as cURL" from any /iris/v1 request
node dist/cli.js status                  # confirms it, and how long it has left
node dist/cli.js report                  # the useful one — every open submission, digested
```

The session lands at `tmp/session.json` (mode `0600`, gitignored). Treat it as a live
credential: anyone holding that cookie is you, on your developer account, until it expires.

## What it can do

**Reading** — [docs/reading.md](docs/reading.md)

| | |
| --- | --- |
| `report` | submissions → thread → messages + rejections + draft, stitched into one digest |
| `apps`, `inbox`, `app` | the app list, with unread message counts |
| `submissions`, `submission`, `items` | review submissions and what's in them |
| `versions`, `version`, `history` | versions, and every state a version has passed through with how long it sat there |
| `metadata`, `screenshots`, `previews` | store listing text and assets, per locale |
| `review-details` | contact, demo account and notes given to the reviewer |
| `threads`, `thread`, `messages`, `draft`, `rejections` | Resolution Center |
| `privacy` | App Privacy declarations, and whether they're live |
| `get` | any endpoint at all, mapped or not |

**Writing** — three flows are captured from the browser and mapped:

| | |
| --- | --- |
| `builds`, `set-build` | attach a build to a version — [docs/writing.md](docs/writing.md) |
| `upload-screenshot`, `delete-screenshot` | the full reserve → upload → commit dance, with size checks — [docs/screenshots.md](docs/screenshots.md) |
| `save-draft`, `delete-draft`, `delete-attachment` | write the reply to App Review into the thread's draft box — [docs/replying.md](docs/replying.md) |
| `patch` | any PATCH, for anything not mapped |

**Sending a draft reply is deliberately not mapped.** `save-draft` fills the box; someone
presses **Send** in the browser. A reply to App Review can't be taken back, so it isn't
something to reach by guessing at an endpoint.

The lower-level commands print denormalized JSON, or the untouched JSON:API document with
`--raw`; the digests (`report`, `builds`, `history`, `privacy`) take `--json` instead. Ids
chain between commands, which is what makes scripting it possible.

## Docs

- [Sessions](docs/sessions.md) — capturing a cookie, and capturing new endpoints with a HAR
- [Reading](docs/reading.md) — every read command and the endpoint behind it
- [Writing](docs/writing.md) — builds, versions, and how a write differs from a read
- [Screenshots](docs/screenshots.md) — the upload flow and the pre-flight checks
- [Replying to App Review](docs/replying.md) — Resolution Center drafts and attachments
- [Logging and the audit trail](docs/logging.md) — structured logs, and why every write is recorded
- [As a library](docs/library.md) — importing it instead of shelling out
- [Evidence and limits](docs/evidence.md) — which calls are confirmed, which are guesses, what's missing

## The short version of the caveats

This is an undocumented, private API. It can change without warning, and automating it is
on you with respect to Apple's terms. The calls here vary in how well evidenced they are —
most are copied from the browser's own requests, a few were probed and never captured; see
[docs/evidence.md](docs/evidence.md) before relying on one.
