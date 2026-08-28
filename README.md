# App Store Connect CLI and library

A reusable client for App Store Connect across many apps. It uses Apple's official API for
documented capabilities and the private browser API only for gaps Apple does not expose.
The first official capability is storefront availability; the private side covers Resolution
Center conversations and replies, App Privacy, state-change history and Xcode Cloud gaps.

Official requests and private requests have separate transports and credentials. The
official transport is GET-only today and sends a JWT only to
`api.appstoreconnect.apple.com`. The private transport sends a browser cookie only to
`appstoreconnect.apple.com`, and its raw `asc get` remains confined to gap families.

That separation is the shape of the source, not a convention: `src/official/` holds the
documented API and the wrappers over it, `src/gap/` holds only what Apple serves nowhere
else, and `src/shared/` holds what neither credential touches. The two sides cannot import
each other in either direction, and a test fails if they ever do.

## Official API credentials

Create an App Store Connect API key under **Users and Access → Integrations**, then provide
the three account-specific values at runtime. None is built into this project:

```sh
export ASC_ISSUER_ID='your issuer UUID'
export ASC_KEY_ID='your key ID'
export ASC_PRIVATE_KEY_PATH='/absolute/path/to/AuthKey_….p8'

npm run build
node dist/cli.js availability --bundle-id com.example.app
```

The `.p8` is read to create a short-lived ES256 token and is never copied, printed or
logged. Full detail is in [docs/reading.md](docs/reading.md).

### More than one account

The variables above cover one account. For several, name them in
`~/.config/asc/accounts.json` (or wherever `ASC_CONFIG` points) and pick one per command
with `--account`:

```json
{"defaultAccount": "acme",
 "accounts": {"acme": {"issuerId": "…", "keyId": "…",
                       "privateKeyPath": "~/keys/AuthKey_ACME.p8",
                       "capturePath": "~/.config/asc/acme.curl.txt"}}}
```

```sh
node dist/cli.js accounts                        # what is configured
node dist/cli.js --account acme availability 123
```

The file holds **paths, not credentials** — the `.p8` and the browser capture stay where
they are and are read only when a command needs them. `--account` outranks the environment
variables, which outrank the file's default account. With no file, nothing changes.

## Private API credentials: you need a cookie

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

Any request will do, `GET` or otherwise, and the file can hold several curls with notes
around them — only the cookie and a handful of headers are read. If a clean curl is awkward,
the same file takes a pasted `Cookie:` line instead; account id, team id and expiry are all
decoded from the cookie itself. [docs/reading.md](docs/reading.md) has the details.

Treat that file as a live credential: anyone holding the cookie is you, on your developer
account, until it expires.

## What it can do

**Official API reads** — [docs/reading.md](docs/reading.md)

| | |
| --- | --- |
| `availability <appId>` | Every storefront as available, pending, leaving, blocked or unknown, grouped under Apple's exact status strings. `--check` exits nonzero unless all are on sale |
| `availability --bundle-id <id>` | The same report, resolving the app by bundle ID first |

**Private API gaps**

Every command below remains something Apple's official API does not serve. A private route
is never used for a capability Apple documents officially.

**Reading** — [docs/reading.md](docs/reading.md)

| | |
| --- | --- |
| `report` | private threads/messages/rejections/draft throughout. All three starting points — an app id, `--thread`, `--submission` — read only the Resolution Center; the submission's own state and dates are Apple's to serve and are left out |
| `inbox` | private unread App Review/Resolution Center message counts — an `apps` request narrowed to the two `messageCount` fieldsets and nothing else |
| `history <versionId>` | private version state-change history, including initiator and time in state |
| `threads`, `thread`, `messages`, `draft`, `rejections` | Resolution Center |
| `privacy` | App Privacy declarations, and whether they're live |
| `post-actions <productId>` | private Xcode Cloud `post_actions`: whether a workflow hands each finished build to a TestFlight group. `ciWorkflows` has no such field officially. Read-only |
| `usage [days]` | private Xcode Cloud compute: build minutes on the plan, minutes left, reset date, and optionally a per-day and per-product breakdown. Apple has no compute-usage resource at all. Read-only, and the only team-scoped command here |
| `team` | private Developer Program standing: the team name, the membership state, whether the Program License Agreement is waiting for a signature, and the Developer Program team id. The official API has no team resource and never mentions the PLA. Read-only, and team-scoped like `usage` |
| `capabilities` | private Xcode Cloud permissions: thirteen booleans saying what this session may do — restricted workflows, external deployments, notarization and the rest. The official API serves coarse roles on `/v1/users`, not resolved permissions, and none of the thirteen has an official schema. Read-only, and returns no identity at all |
| `infrastructure-validation [productId]` | private Xcode Cloud opt-in to building against Apple's pre-release macOS and Xcode: the team switch, each product's, and each workflow's for the one product named. `infrastructure` does not occur in the official specification at all. Read-only — the writes that set it were never recorded, so this reports the switches and cannot throw one |
| `get` | a raw GET at a path you give it, confined to the private families above — an officially served path is refused rather than duplicated |

**Writing** — all but one copied from a capture of the browser doing it; `delete-attachment`
was probed rather than recorded, which [docs/evidence.md](docs/evidence.md) says plainly:

| | |
| --- | --- |
| `save-draft`, `delete-draft`, `delete-attachment` | write the reply to App Review into the thread's draft box — [docs/replying.md](docs/replying.md) |
| `send-reply` | send it — [docs/replying.md](docs/replying.md) |

**There is no unconfirmed write.** Each of these takes something no second run puts back, so
each prints what it is about to do and asks first — `send-reply` re-reads the draft after you
answer, in case the browser autosaved over it. `--yes` answers for you and still prints what
it answered for. There is no way to send a hand-written body at a path of your own.
[docs/writing.md](docs/writing.md) has the rest.

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
invented, so the suite never needs a session and can't touch your account. It covers what can
be checked locally: where a request may go, what counts as a write, redaction, JSON:API
expansion, capture parsing, storefront classification, and that neither credential's modules
can reach the other's. Nothing in it says Apple will
behave as expected — that's what [docs/evidence.md](docs/evidence.md) is for.

## The short version of the caveats

Official calls follow Apple's published schema. Private calls are undocumented, can change
without warning, and vary in how well evidenced they are; see [docs/evidence.md](docs/evidence.md).


## Further official API capabilities

Documented capabilities not yet wrapped here remain available directly from Apple. They
need an API key — a JWT signed with a `.p8` from
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

By topic: [app metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata),
[uploading assets](https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect),
[review submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions),
[versions](https://developer.apple.com/documentation/appstoreconnectapi/app-store-versions)
and [builds](https://developer.apple.com/documentation/appstoreconnectapi/builds),
[age ratings](https://developer.apple.com/documentation/appstoreconnectapi/age-ratings),
[users](https://developer.apple.com/documentation/appstoreconnectapi/users) and
[invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations),
[Xcode Cloud](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds),
and [TestFlight](https://developer.apple.com/documentation/appstoreconnectapi/testflight).

What is in none of them, and is why the private side exists: Resolution Center threads,
messages, guideline rejections, draft replies and their attachments; unread review-message
counts; App Store version state-change *history*; the App Privacy `dataUsages`
questionnaire; an Xcode Cloud workflow's `post_actions`; compute usage against the plan; the
team's Developer Program standing, including whether the Program License Agreement needs
signing; what Xcode Cloud says the session may do; and the pre-release macOS and Xcode
opt-in. Checked against 4.4.1 on 2026-08-22 — the call-by-call working is in
[docs/evidence.md](docs/evidence.md).

One attribute sits on the line: `gracRatingClassificationNumber`, the Korean GRAC number,
is in none of 4.4.1's 1,393 schemas where the other 28 questions on that form all are. It is
**not** implemented, because writing it back means resending the whole questionnaire and no
single-attribute PATCH has ever been recorded — see [docs/evidence.md](docs/evidence.md).
