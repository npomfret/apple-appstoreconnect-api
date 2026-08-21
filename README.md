# Apple appstoreconnect API

An unofficial client for the parts of App Store Connect that Apple does not expose through
the official App Store Connect API: Resolution Center threads, messages, rejections, drafts
and replies, plus unread review-message counts, version state-change history and the App
Privacy questionnaire.

Everything Apple **does** expose officially is out of scope here, however convenient the
private endpoint or the cookie it already has. Nothing in this client duplicates an official
call, there is no escape hatch that reaches one — `asc get` is confined to the private
families this client is for, and there is no raw write at all — and the transport is
narrowed to match: one host, one base, one content type, four methods. The boundary was
last audited on 2026-08-21 against Apple's OpenAPI specification 4.4.1, and
[docs/evidence.md](docs/evidence.md) records what was checked and when.

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

Every command below is something [Apple's official API](https://developer.apple.com/app-store-connect/api/)
does not serve. That is the whole of what this project is: if you are looking for apps,
versions, builds, screenshots, metadata, age ratings, review submissions, invitations or
Xcode Cloud, Apple serves all of it officially and none of it is here — the pages to use
instead are [at the bottom](#apples-official-api), and what was checked against what is in
[docs/evidence.md](docs/evidence.md).

**Reading** — [docs/reading.md](docs/reading.md)

| | |
| --- | --- |
| `report` | private threads/messages/rejections/draft throughout. All three starting points — an app id, `--thread`, `--submission` — read only the Resolution Center; the submission's own state and dates are Apple's to serve and are left out |
| `inbox` | private unread App Review/Resolution Center message counts — an `apps` request narrowed to the two `messageCount` fieldsets and nothing else |
| `history <versionId>` | private version state-change history, including initiator and time in state |
| `threads`, `thread`, `messages`, `draft`, `rejections` | Resolution Center |
| `privacy` | App Privacy declarations, and whether they're live |
| `get` | a raw GET at a path you give it, confined to the private families above — an officially served path is refused rather than duplicated |

**Writing** — all but one copied from a capture of the browser doing it; `delete-attachment`
was probed rather than recorded, which [docs/evidence.md](docs/evidence.md) says plainly:

| | |
| --- | --- |
| `save-draft`, `delete-draft`, `delete-attachment` | write the reply to App Review into the thread's draft box — [docs/replying.md](docs/replying.md) |
| `send-reply` | send it — [docs/replying.md](docs/replying.md) |

**`send-reply` can't be undone**, so it prints what it is about to do and asks first — it
shows you the whole draft and reads it again after you answer, in case the browser autosaved
over it in the meantime. The rest ask too, each of them taking something no second run puts
back: `delete-draft` prints the draft it is about to throw away, and `save-draft` prints the
text it is about to write over whenever the box already has some. `--yes` answers for you,
and still prints what it answered for; a command whose own input is a pipe is asked on the terminal rather
than refused, and with no terminal at all they stop rather than assume. **There is no
unconfirmed write**, and no way to send a hand-written body at a path of your own.

The lower-level commands print denormalized JSON, or the untouched JSON:API document with
`--raw`; the digests (`report`, `history`, `privacy`) take `--json` instead. Ids chain
between commands, which is what makes scripting it possible — `report --json` is where a
`versionId` comes from.

## Docs

- [Reading](docs/reading.md) — every read command and the endpoint behind it
- [Writing](docs/writing.md) — the retained write surface, and what asks before it acts
- [Replying to App Review](docs/replying.md) — Resolution Center drafts, attachments, and sending
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


## Apple's official API

Everything this project does *not* do is Apple's to serve, and these are the pages worth
having open. All of them need an API key — a JWT signed with a `.p8` from
**Users and Access → Integrations → App Store Connect API** — rather than the browser cookie
this client uses.

- [App Store Connect API overview](https://developer.apple.com/app-store-connect/api/) —
  what the official API covers, and the starting point for any "should this be here?" question.
- [API reference](https://developer.apple.com/documentation/appstoreconnectapi/) — every
  resource and operation, and the authority the boundary in this repository is checked against.
- [OpenAPI specification](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip)
  — the machine-readable version. Last audited here: **4.4.1**, generated 2026-07-15
  (966 paths, 1,393 schemas).
- [Creating API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
  and [generating tokens](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)
  — how to authenticate against it.

By topic, for the capabilities this project deliberately does not have:

- [App metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata)
  — apps, versions, localizations, categories, age ratings, screenshots and previews.
- [Uploading assets](https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect)
  — the reserve → `uploadOperations` → `{"uploaded":true}` flow for screenshots, previews
  and review attachments.
- [Review submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions)
  — creating, reading, updating and submitting submissions and their items.
- [App Store versions](https://developer.apple.com/documentation/appstoreconnectapi/app-store-versions)
  and [builds](https://developer.apple.com/documentation/appstoreconnectapi/builds) — version
  records, build selection and processing state.
- [Age ratings](https://developer.apple.com/documentation/appstoreconnectapi/age-ratings) —
  the declaration and the per-territory ratings computed from it.
- [Users](https://developer.apple.com/documentation/appstoreconnectapi/users) and
  [user invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations)
  — team access, roles, app visibility, invitations and revocation.
- [Xcode Cloud workflows and builds](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds)
  — products, workflows, repositories, build runs, actions, issues and test results.
- [TestFlight](https://developer.apple.com/documentation/appstoreconnectapi/testflight) —
  beta groups, testers and beta app review, none of which this project touches.

What is **not** in any of the above, and is why this project exists: Resolution Center
threads, messages, guideline rejections, draft replies and their attachments; unread
review-message counts; App Store version state-change *history*; and the App Privacy
`dataUsages` questionnaire. Checked against 4.4.1 on 2026-08-21 — see
[docs/evidence.md](docs/evidence.md).

One attribute, rather than a capability, sits on the line: iris carries
`gracRatingClassificationNumber` on an age-rating declaration — the Korean GRAC
classification number — and it is in none of 4.4.1's 1,393 schemas, where the other 28
questions on that form all are. It is **not** implemented here, because writing it back
means resending the whole questionnaire and no single-attribute PATCH has ever been
recorded. Whether it should be is an open question:
[tasks/grac-rating-classification-number-gap.md](tasks/grac-rating-classification-number-gap.md).
