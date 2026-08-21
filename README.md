# Apple appstoreconnect API

An unofficial client for the parts of App Store Connect that Apple does not expose through
the official App Store Connect API: Resolution Center threads, messages, rejections, drafts
and replies, plus unread review-message counts, version state-change history and the App
Privacy questionnaire.

The repository currently also contains older private implementations of capabilities that
Apple **does** officially expose, including review submissions, metadata, screenshots,
users and invitations, and Xcode Cloud. Those are legacy overlap, not the intended product
surface, and are scheduled for removal in
[tasks/remove-official-api-overlap.md](tasks/remove-official-api-overlap.md). The boundary
was last audited on 2026-08-20 against Apple's OpenAPI specification 4.4.1.

It talks to the same private `https://appstoreconnect.apple.com/iris/v1` service the web UI
uses, reusing a session you capture from your browser.

## First: you need a cookie

Apple's official API supports API-key authentication and should be used wherever it covers
the job. There is no API key for the private `iris` Resolution Center endpoints used by
this client: they authenticate with a browser session cookie. Apple gates that session
behind an interactive login — passkey, 2FA — so every private-API session starts in a
browser.

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
   node dist/cli.js report                  # the useful one — every review conversation, digested
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
https://appstoreconnect.apple.com/apps/1234567890/distribution/ios/version/inflight
```

Only the cookie is required, and the `Cookie:` prefix is optional. Account id, team id and
expiry are all decoded from it. The URL line just supplies the default app id, which you
can otherwise pass per command (`asc report <appId>`). Everything else is ignored, so an
HTTP/2 header block pasted straight out of dev tools (`:authority:`, `sec-fetch-*` and
all) works unedited.

## What it can do

The tables below describe the code as it exists today, not the desired boundary. Commands
for official capabilities are marked **legacy official overlap** and should not be used as
the basis for new work; use [Apple's official API](https://developer.apple.com/app-store-connect/api/)
instead. The removal task has the function-by-function mapping.

Official replacements:

- [Apps and app metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata)
  — apps, versions, localizations, categories, age ratings, screenshots and previews.
- [Review submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions)
  — creating, reading, updating and submitting review submissions and their items.
- [Users](https://developer.apple.com/documentation/appstoreconnectapi/users) and
  [user invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations)
  — team access, roles, app visibility, invitations and revocation.
- [Xcode Cloud workflows and builds](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds)
  — products, workflows, repositories, builds, actions, issues and test results.

**Reading** — [docs/reading.md](docs/reading.md)

| | |
| --- | --- |
| `report` | private threads/messages/rejections/draft throughout. All three starting points — an app id, `--thread`, `--submission` — read only the Resolution Center; the submission's own state and dates are Apple's to serve and are left out |
| `apps`, `app` | **legacy official overlap** — app records |
| `inbox` | private unread App Review/Resolution Center message counts — an `apps` request narrowed to the two `messageCount` fieldsets and nothing else |
| `submissions`, `submission`, `items` | **legacy official overlap** — review submissions and their items |
| `versions`, `version` | **legacy official overlap** — app versions |
| `history` | private version state-change history, including initiator and time in state |
| `metadata`, `screenshots`, `previews` | **legacy official overlap** — store listing text and assets |
| `app-info`, `categories`, `age-rating`, `territory-ratings` | **legacy official overlap** — App Information |
| `review-details` | **legacy official overlap** — App Review Information |
| `threads`, `thread`, `messages`, `draft`, `rejections` | Resolution Center |
| `privacy` | App Privacy declarations, and whether they're live |
| `invites` | **legacy official overlap** — pending invitations — [docs/people.md](docs/people.md) |
| `ci-*` | **legacy official overlap** — Xcode Cloud — [docs/xcode-cloud.md](docs/xcode-cloud.md) |
| `get` | any endpoint at all, mapped or not |

**Writing** — most of these are copied from a capture of the browser doing it:

Only the Resolution Center draft/attachment/reply commands below are within the intended
gap-only boundary. The other writes duplicate official operations and are pending removal.

| | |
| --- | --- |
| `builds`, `set-build` | attach a build to a version — [docs/writing.md](docs/writing.md) |
| `upload-screenshot`, `delete-screenshot` | the full reserve → upload → commit dance, with size checks — [docs/screenshots.md](docs/screenshots.md) |
| `save-draft`, `delete-draft`, `delete-attachment` | write the reply to App Review into the thread's draft box — [docs/replying.md](docs/replying.md) |
| `send-reply` | send it — [docs/replying.md](docs/replying.md) |
| `set-metadata` | one field, one locale: description, keywords, name, subtitle… — [docs/writing.md](docs/writing.md) |
| `set-categories`, `set-age-rating`, `set-content-rights` | the rest of the App Information page — all app-wide and live at once — [docs/writing.md](docs/writing.md) |
| `resolve-item` | tell App Review an issue is fixed and put it back in the queue — [docs/writing.md](docs/writing.md) |
| `submit`, `cancel-submission` | submit a version for review, or withdraw it — [docs/writing.md](docs/writing.md) |
| `invite` | invite someone to the developer account — [docs/people.md](docs/people.md) |
| `patch` | any PATCH, for anything not mapped |

**`send-reply`, `resolve-item`, `submit` and `invite` can't be undone**, so they print what they are
about to do and ask first — `send-reply` shows you the whole draft and reads it again after
you answer, in case the browser autosaved over it in the meantime, `submit --dry-run`
prints the steps and sends nothing. `set-metadata`, the three App Information writes,
`cancel-submission` and the three deletes ask too. (`invite` can be undone in the browser,
from the People page — just not from here, since no revoke call has been recorded.) `--yes` answers for you, and still prints
what it answered for; a command whose own input is a pipe is asked on the terminal rather
than refused, and with no terminal at all they stop rather than assume. Nothing else asks: a
bad `set-build` is one more `set-build` away from being right.

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
- [People](docs/people.md) — inviting someone to the developer account, and what isn't mapped
- [Xcode Cloud](docs/xcode-cloud.md) — workflows and builds, on a second API with its own rules
- [Logging and the audit trail](docs/logging.md) — structured logs, and why every write is recorded
- [As a library](docs/library.md) — importing it instead of shelling out
- [Evidence and limits](docs/evidence.md) — which calls are confirmed, which are guesses,
  what's missing, and how to capture a new endpoint

## Tests

```sh
npm test
```

`node:test`, no dependencies and no network — `fetch` is replaced and every fixture is
invented, so the suite never needs a session and can't touch your account. It covers the
parts that can be checked locally: where a request is allowed to go, what counts as a write
and therefore gets audited, redaction, JSON:API expansion, capture parsing, and the date
handling behind `history`. Nothing in it says Apple will behave as expected — that's what
[docs/evidence.md](docs/evidence.md) is for.

## The short version of the caveats

This is an undocumented, private API. It can change without warning, and automating it is
on you with respect to Apple's terms. The calls here vary in how well evidenced they are —
most are copied from the browser's own requests, a few were probed and never captured; see
[docs/evidence.md](docs/evidence.md) before relying on one.
