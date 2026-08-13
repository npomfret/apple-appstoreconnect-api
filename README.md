# Apple appstoreconnect API

An unofficial client for the App Store Connect **review centre** — the Resolution Center
threads, rejections and review submissions that Apple's public App Store Connect API does
not expose. Use this project to bring automation to your Apple App Store submissions.

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
4. Paste it into **`tmp/curl.txt`** — which is gitignored, and stays there.
5. Go:

   ```sh
   npm install && npm run build
   node dist/cli.js status                  # confirms it, and how long it has left
   node dist/cli.js report                  # the useful one — every open submission, digested
   ```

There is no login step and nothing derived on disk. Every command re-reads `tmp/curl.txt`
and parses it on the spot, so pasting a fresh curl over that file *is* logging in again.
`ASC_CURL_PATH` moves it, and `asc status <file>` reads one somewhere else.

Any request will do, `GET` or otherwise — the team id that writes need is decoded from the
cookie rather than read off the headers, so a session captured from a plain read can still
write. The file can hold several curls with notes around them; the first is used, and only
the cookie plus a handful of headers are kept.

Treat that file as a live credential: anyone holding the cookie is you, on your developer
account, until it expires.

### Or paste the cookie on its own

If getting a clean curl is awkward, the same file takes ordinary text instead — one item
per line, any order, `#` comments and blank lines ignored:

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

**Writing** — most of these are copied from a capture of the browser doing it:

| | |
| --- | --- |
| `builds`, `set-build` | attach a build to a version — [docs/writing.md](docs/writing.md) |
| `upload-screenshot`, `delete-screenshot` | the full reserve → upload → commit dance, with size checks — [docs/screenshots.md](docs/screenshots.md) |
| `save-draft`, `delete-draft`, `delete-attachment` | write the reply to App Review into the thread's draft box — [docs/replying.md](docs/replying.md) |
| `send-reply` | send it — [docs/replying.md](docs/replying.md) |
| `set-metadata` | one field, one locale: description, keywords, name, subtitle… — [docs/writing.md](docs/writing.md) |
| `resolve-item` | tell App Review an issue is fixed and put it back in the queue — [docs/writing.md](docs/writing.md) |
| `submit`, `cancel-submission` | submit a version for review, or withdraw it — [docs/writing.md](docs/writing.md) |
| `patch` | any PATCH, for anything not mapped |

**`send-reply`, `resolve-item` and `submit` can't be undone**, so they print what they are
about to do and ask first — `send-reply` shows you the whole draft, `submit --dry-run`
prints the steps and sends nothing. `set-metadata`, `cancel-submission` and the three
deletes ask too. `--yes` answers for you; with no terminal to ask on, they stop rather than
assume. Nothing else asks: a bad `set-build` is one more `set-build` away from being right.

The `submit` flow is the one thing here **not** taken from a capture — see
[docs/evidence.md](docs/evidence.md) before the first real run.

The lower-level commands print denormalized JSON, or the untouched JSON:API document with
`--raw`; the digests (`report`, `builds`, `history`, `privacy`) take `--json` instead. Ids
chain between commands, which is what makes scripting it possible.

## Docs

- [Reading](docs/reading.md) — every read command and the endpoint behind it
- [Writing](docs/writing.md) — builds, versions, resolving an item, and what asks before it acts
- [Screenshots](docs/screenshots.md) — the upload flow and the pre-flight checks
- [Replying to App Review](docs/replying.md) — Resolution Center drafts, attachments, and sending
- [Logging and the audit trail](docs/logging.md) — structured logs, and why every write is recorded
- [As a library](docs/library.md) — importing it instead of shelling out
- [Evidence and limits](docs/evidence.md) — which calls are confirmed, which are guesses,
  what's missing, and how to capture a new endpoint

## The short version of the caveats

This is an undocumented, private API. It can change without warning, and automating it is
on you with respect to Apple's terms. The calls here vary in how well evidenced they are —
most are copied from the browser's own requests, a few were probed and never captured; see
[docs/evidence.md](docs/evidence.md) before relying on one.
