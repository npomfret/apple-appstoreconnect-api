# Reading

Every read here is one Apple's official API has no equivalent for: Resolution Center
threads, messages, rejections and drafts; unread review-message counts; version state-change
history; and the App Privacy questionnaire. Checked against Apple's OpenAPI specification
4.4.1 (generated 2026-07-15, 966 paths, 1,393 schemas) on 2026-08-21 — see
[evidence and limits](evidence.md). Anything else you might want from App Store Connect,
Apple serves officially and with an API key rather than this client's cookie; the
[API reference](https://developer.apple.com/documentation/appstoreconnectapi/) is where to
start.

```sh
node dist/cli.js report                 # the useful one — digest of every review conversation
node dist/cli.js report --json
node dist/cli.js report --thread <id>       # one thread you already have the id of
node dist/cli.js report --submission <id>   # the thread behind a submission id
```

`report` stitches threads → messages + rejections + draft into one summary:

```
thread     74533c00-b29e-3041-826a-1a221f522ecc
  version    1.0.21
  last msg   2026-05-17 12:25Z (from Apple)
  guidelines
    4.1.0   Design: Copycats
    4.2.2   Design: Minimum Functionality
  attachments (2)
    3a1f5c00-...-...  Screen Recording.mp4
    9c74e211-...-...  Screen Recording.mp4
  latest message from Apple:
    ...
```

Every route in is a private one. An app id — the default, taken from the captured request —
lists the app's Resolution Center threads; `--submission` filters that same list by
`filter[reviewSubmission]`; `--thread` skips discovery entirely. None of them reads a
resource Apple's official API serves.

Timestamps are shortened to the minute and keep the zone Apple stamped them in rather than
being moved into yours — `--json` carries them exactly as they arrived. Apple sends two
shapes, an offset on a version's state changes and `Z` on a message, and both render.

`(from Apple)` and `(from you)` come from `actorType` on the message's own actor, which the
messages response sideloads. Every actor in every recording carries it and it is `APPLE` or
`USER`; Apple's is additionally the literal id `APPLE`, which is what a message whose actor
was not sideloaded falls back to. An actor of any other kind prints `(sender not
recognised)` and leaves `lastMessageFromApple` unset in `--json` rather than defaulting to
one side. There is an `apiKeyId` field beside `actorType`, null in every capture, so a
third kind probably exists and has not been seen — and being wrong here would mean the
digest telling you the thread is waiting on Apple when it is waiting on you.

The `guidelines` block is Apple's own guideline number and Apple's own wording for it, side
by side and unedited — `Design:` is the front of the text Apple sent, not something composed
here. Each code appears once however many of the thread's rejections cite it. `--json` carries
the pair as `{ code, description }` and nothing else: the `reasonSection` Apple sends beside
them is the code with its last segment removed, so it says nothing `code` does not.

`attachments` lists what Apple attached, one entry per file, identified by iris's own id and
carrying a download URL. It covers both places Apple attaches things — the messages, and the
rejection itself, which is where the marked-up screenshots hang. In the recorded thread those
are two separate files from the three on the messages, and they are the ones the guideline
citation is about, so a list of only the message's is a list without the evidence in it.
Messages come first, newest first, then the rejections.

Two entries can share a file name and that is not a repeat: every recorded thread has a
message with two attachments of the same name, and a reviewer attaching `IMG_4821.png` in one
round and a different `IMG_4821.png` in the next would look the same. The id is what tells
them apart, so the id is what each line leads with — seven of the 21 attachment groups in the
recordings are such a pair, and in every one of them the two files share a byte count as well
as a name, so neither the name nor the size separates them. The digest printed names alone
until 2026-08-21, which showed those pairs as two identical lines. `asc draft` lists a draft's
attachments the same way, and there it is the id you need: `delete-attachment` takes one, and
that listing is the only place a draft's attachment ids are shown.

The version each conversation is about comes off the thread's own `appStoreVersions`, which
is a to-many relationship: a thread about two versions names both rather than having one
picked for it, and `--json` carries the full list as `versions` alongside the singular
`version`/`versionId`, which are filled only when there is exactly one.

What no route supplies is the submission's own `state`, `platform` and dates. Those live on
`reviewSubmissions`, which Apple serves officially at
[`GET /v1/apps/{id}/reviewSubmissions`](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions);
read them there. `--submission` echoes back the id you gave it and nothing else about the
submission.

`inbox` is a request to `apps`, which Apple also serves officially. It is kept for the two
counts hanging off it: `appStoreVersionMetrics.messageCount` and
`betaReviewMetrics.messageCount` appear in none of the 966 paths or 1,393 schemas of Apple's
OpenAPI specification 4.4.1 (generated 2026-07-15). The query asks for those and nothing
else — `fields[apps]` names only the two metric relationships, so the apps come back as bare
ids with no name or bundle id. Read those from the official `GET /v1/apps`.

Lower-level commands print denormalized JSON (add `--raw` for the untouched JSON:API
document):

| Command | Endpoint |
| --- | --- |
| `inbox` | `apps?fields[apps]=appStoreVersionMetrics,betaReviewMetrics&fields[appStoreVersionMetrics]=messageCount` |
| `threads [appId]` | `apps/{appId}/resolutionCenterThreads` |
| `thread <submissionId>` | `resolutionCenterThreads?filter[reviewSubmission]={id}` |
| `messages <threadId>` | `resolutionCenterThreads/{id}/resolutionCenterMessages` |
| `draft <threadId>` | `resolutionCenterThreads/{id}/resolutionCenterDraftMessage` |
| `rejections <threadId>` | `reviewRejections?filter[resolutionCenterMessage.resolutionCenterThread]={id}` |

Every endpoint above is `iris/v1`, and every one of them is about an app.

## Xcode Cloud: what happens when a build finishes

```sh
asc post-actions <productId>          # --json for the same thing as JSON
```

One read, on the one Xcode Cloud field Apple's official API has no schema for. A workflow
can hand every build it finishes to a TestFlight group automatically, and `ciWorkflows` has
no attribute that says so — checked against specification 4.4.1, where `post_action`,
`deployment_config`, `archive_action_id` and `testFlight_internal` occur zero times. So
"is this build going to testers, or did that stop working" is a question the official API
cannot answer and this can.

```
Nightly   workflow-0000
    Hand to internal testers   testFlight_internal
      after        archive (Release)
      beta groups  0e1f…
      testers      none

1 of 2 workflows hand a build on automatically.
```

`GET ci/api/teams/{teamId}/products/{productId}/workflows-v15`, with the browser's own
`limit=100&include_deleted=false`. The team id comes from the session — it is the same value
as the `X-Connect-Team-ID` header on every recorded Xcode Cloud request — so this costs one
request and no discovery.

**The product id is Apple's to serve.** It is not looked up from an app id, because
`ciProducts` carries the `app` relationship officially and doing it here would restore the
duplication the boundary exists to prevent. Take it from
[`GET /v1/ciProducts`](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds),
or out of the Xcode Cloud URL in the browser. Beta groups likewise print as ids: the name is
on [`GET /v1/betaGroups`](https://developer.apple.com/documentation/appstoreconnectapi/testflight).

**It stops rather than under-reports.** If Apple sends a workflow or a post-action in a
shape this client cannot read, the command fails and says which one. That is deliberate and
specific to this read: everything it could quietly skip comes back out as an answer rather
than as a gap — a skipped post-action prints the workflow as handing nothing on, and a
skipped workflow leaves the product looking as though it has one fewer. A missing
`post_actions` key is refused for the same reason, since a workflow with none carries an
empty list rather than omitting it. Contrast `asc usage`, which drops a row it cannot read:
there a lost row is a line short of a total, not an inverted answer.

There is no `--raw` on this one. The workflow document carries `environment_variables` and
`product_environment_variables` beside the field being read, nothing recorded shows whether
their values come back or only their names, and a command about one field has no reason to
print a workflow's secrets on the chance that it can.

**This is read-only, and the base it uses cannot carry a write at all.** The `PUT` that sets
`post_actions` is recorded in both directions, so what stops it is not missing evidence: it
replaces the entire fourteen-key workflow document, so a client that does not model every
key destroys whatever it fails to send back. Setting a post-action stays a job for the web
UI. See [evidence.md](evidence.md).

## Xcode Cloud: how much compute is left

```sh
asc usage                             # the plan, and what is left of it
asc usage 30                          # and where the last 30 days went
```

The one question Apple's official API cannot answer at any price: how many build minutes
this month's allowance has left. There is no compute-usage resource in 4.4.1 at all — its
only `usage` paths are TestFlight's, about testers rather than minutes — and while
`CiBuildRun` carries `startedDate` and `finishedDate`, wall-clock per run is not billed
compute and there is no allowance or reset date to compare it against.

```
plan       Pro
used       4,500 of 6,000 minutes  (75%)
left       1,500 minutes
resets     2026-09-01

2026-07-23 to 2026-08-22, counted separately from the plan above:
  minutes  1,204
  builds   47
  busiest  2026-08-14  210 minutes, 8 builds

  per product, against the window before it:
    9f2c…      820 min    31 builds   (was 610 min, 22 builds)
```

`GET ci/api/teams/{teamId}/usage/summary`, and with a day count also
`GET …/usage/days?start=&end=`. The team id comes from the session, as it does for
`post-actions`.

**Minutes, not hours** — no field name says which, and the recording settles it three ways:
the plan total is a published Xcode Cloud compute-hour tier times 60, used plus available
equals the total, and the day series beside it is labelled in minutes.

**The two figures cover two different windows**, which is why they are printed apart and
never added up. The plan counts the billing period ending on its reset date; the day
breakdown counts the dates you asked for. In the recording they disagree, as they should.
The window is the last *n* days ending today, inclusive, computed in UTC so the same command
asks for the same window wherever it runs.

**A product in the breakdown may no longer exist.** Compute outlives the product that spent
it — the recording listed seven products where the products call returned two — so ids are
printed as ids and never resolved. The name is on
[`GET /v1/ciProducts`](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds)
for the ones that are still there.

This is team-scoped rather than app-scoped: it describes the account, not one app — the one
boundary this command and `asc team` cross that the rest of the client does not.

## Xcode Cloud: where the team stands with the Developer Program

```sh
asc team
```

```
team       Acme Widgets
program    active
PLA        signed
dev team   AB12CD34EF
```

`GET ci/api/teams/{teamId}`, no query. Apple's official API has **no team resource** — the
only `team` in 4.4.1 is `gameCenterMatchmakingTeams`, which is a matchmaking concept — and
nothing official mentions the Program License Agreement at all. The two license-agreement
schemas it does have, `BetaLicenseAgreement` and `EndUserLicenseAgreement`, are the
TestFlight tester agreement and the customer EULA.

`PLA` is the one worth having: an unsigned Program License Agreement is an account-level
thing that no release-level API will warn you about, and when Apple says the team is inside
the grace period the digest adds a line saying so.

Both of those flags were `false` in the recording, so **what this prints when either is true
has never been seen against real data.** The wording describes the fields rather than their
consequences on purpose — what Apple actually stops when a PLA goes unsigned, and how long a
grace period runs, are Apple's to state, not this client's to infer from one capture. A
missing flag is an error rather than a `false`, for the same reason: "Apple did not say" and
"nothing to sign" are different answers.

`program` is passed through exactly as Apple sends it and is never compared against a
literal — one value has been observed and nothing says what the set is.

`dev team` is the ten-character Developer Program team id, the one on certificates and
provisioning profiles. It is not the uuid the `/ci/api` paths are scoped by. Three keys on
the response are deliberately not printed: the team uuid, which is just the id that was
sent; `public_provider_id`, a uuid nothing observed explains; and the page's own button
links, one of which carries a person id.

## Xcode Cloud: what this session is allowed to do

```sh
asc capabilities
asc capabilities --json
```

```
Xcode Cloud says this session may:
  yes  edit restricted workflows
  yes  restrict a workflow to fewer people
  yes  remove products
  yes  change a product's next build number
  yes  manage the Xcode Cloud subscription
  yes  configure external deployments
  yes  trigger an external deployment
  yes  configure notarization
  yes  trigger notarization
  yes  configure locked version aliases
  yes  configure locked product environment variables
  yes  configure infrastructure validation
  yes  onboard the team to distribution
```

`GET ci/api/teams/{teamId}/user-capabilities`, no query. Thirteen booleans, and **that is
the entire response** — no name, no email address, no user id, no role. Despite the path,
this does not read a person: it reads what the captured cookie is permitted to do. That is
why it is here when the People page is not, and reading who is on the team stays out of
scope.

Apple has no official equivalent. `/v1/users` serves `roles` — thirteen coarse `UserRole`
values, `ADMIN` through `GENERATE_INDIVIDUAL_KEYS` — next to people's usernames and real
names. Coarse roles beside a directory of humans are a different call from resolved
per-capability booleans for one session, and the mapping from one to the other is something
Apple documents in prose rather than serving; none of `canConfigure`, `canTrigger`,
`canRestrict` or `infrastructureValidation` occurs anywhere in 4.4.1.

**None of the thirteen is something `asc` does.** Every one of them is a write, and the
`/ci/api` base this client speaks is read-only. What the command answers is what the account
may do — in the browser, in Xcode, or through the official API — not what this tool will let
you do.

All thirteen were `yes` in all three recordings, so **a `no` has never been seen against
real data.** A `no` is a report of what Apple said, not a prediction that something will be
refused; nothing observed here connects the two. And a capability Apple simply omits is an
error rather than a `no`, for the reason the PLA flags are: "Apple did not say" and "you may
not" are different answers. A fourteenth key would be Apple changing the response, and is
neither carried nor absorbed silently.

## Xcode Cloud: what builds against pre-release macOS and Xcode

```sh
asc infrastructure-validation
asc infrastructure-validation <productId>
asc infrastructure-validation --json
```

```
team       opted in to pre-release macOS and Xcode

products:
  yes  Storefront
   no  Widget

workflows of Storefront:
  yes  Release
   no  Nightly
```

Apple keeps three switches, not one: the team, each product, and each workflow. Bare, this
reads the first two — `GET ci/api/teams/{teamId}/infrastructure-validation` and
`…/products`. Name a product and it also reads `…/products/{productId}/workflows`. The
product id is explicit rather than looked up, because asking every listed product for its
workflows is a fan-out, and the products list above is where the ids to ask about come from.

**The three levels are reported, not reconciled.** Nothing observed says how they relate —
whether the team switch overrides a product's, defaults it, or gates it — so a team line
saying "opted in" above a product saying "no" is what Apple sent, and this does not decide
which of them wins.

Apple has no official equivalent: `infrastructure` does not occur in 4.4.1 at all, the seven
occurrences of `optIn` are a subscription grace-period setting, `CiWorkflow`'s fifteen
attributes and `CiProduct`'s three carry nothing like it, and there is no official team
resource for the team-level switch to live on.

**This reads the switches and cannot throw one.** The writes that set them were never
recorded — `asc capabilities` reports a `configure infrastructure validation` permission, so
they exist, but what they look like is unknown and is not guessed at. The standing is `asc
team`'s: it will tell you the Program License Agreement is unsigned and will not sign it.

Every `opt_in` in the recording was `yes`, so **a `no` has never been seen against real
data**, and a row Apple sends without one is an error rather than a `no`. Only one page was
ever reached — two products, one workflow each, against a page of 20 — and the response
carries no cursor, so a full page is reported as possibly clipped rather than followed.

## Ids, and the two halves of a metadata rejection

`appId` defaults to the one scraped from the captured request's `Referer`. **`versionId` has
no default** — `asc history <versionId>` requires it, because working one out means reading
`apps/{id}/appStoreVersions`, which is Apple's own
[`GET /v1/apps/{id}/appStoreVersions`](https://developer.apple.com/documentation/appstoreconnectapi/app-store-versions).
That is one place to get the id; `asc report --json` is the other, and needs no API key.

When a thread quotes a **4.1 metadata rejection**, the text Apple is objecting to is spread
across two records rather than one, and neither is served here. **Name** and **subtitle**
hang off `appInfos`; description, keywords, promotional text and what's-new hang off the
version — so the offending line is often on the half you weren't looking at. A shipped app
also has *two* `appInfos` records, the live one and the one being prepared, with the live one
listed first: read that one and you get what the store says rather than what you last edited,
and a write to it comes back `409`. Both are `GET /v1/apps/{id}/appInfos` officially, with a
`state` telling them apart.

The ids chain together, which is what makes scripting possible:

```sh
node dist/cli.js report --json          # -> threadId, versionId
node dist/cli.js draft <threadId>       # -> the unsent reply and its attachment ids
node dist/cli.js history <versionId>    # -> how long each state actually lasted
```

## History

```sh
node dist/cli.js history <versionId>     # every state this version has passed through
node dist/cli.js history <versionId> --json
```

```
2026-04-25 05:46-07:00  PREPARE_FOR_SUBMISSION  nick@example.com   1h 48m
2026-04-25 07:34-07:00  WAITING_FOR_REVIEW      nick@example.com   2d 8h
2026-04-27 15:40-07:00  IN_REVIEW               Apple              11m
2026-04-27 15:51-07:00  REJECTED                Apple              13d 16h
...
Reviewed 3 times, rejected 3 times.
```

The last column is how long the version sat in that state, which is the part worth having:
it's the only record of how long a past review actually took, and it survives rejections
and resubmissions. `initiator` says who made each move: "Apple", or the Apple ID of whoever
on your side did it. It is not what tells a rejection from your own withdrawal — those are
separate states, `REJECTED` and `DEVELOPER_REJECTED`, in Apple's own vocabulary.

The tally underneath counts a rejection as `REJECTED` **or** `METADATA_REJECTED`, which are
two of the three rejection states in Apple's `AppStoreVersionState`; the third is your own
`DEVELOPER_REJECTED` and is not a rejection of yours to answer. A 4.1 metadata rejection —
the kind most of the Resolution Center reads here are about — is the second, so counting
only the first read "rejected once" under a timeline showing three. Only `REJECTED` appears
in any recording; the other spellings come from Apple's enum for the same field.

Note the offsets in those timestamps: Apple stamps them in local time, so the text and the
moment it names don't sort alike. Ordering is by the instant — across a daylight-saving
change, comparing the text would put two states in the wrong order and show one of them
held for a negative length of time. The same applies to picking Apple's latest message in
`report`.

## Privacy

```sh
node dist/cli.js privacy                 # the App Privacy declarations, and if they're live
```

Apple stores "collects nothing" as a single row with no category and a `DATA_NOT_COLLECTED`
protection — *not* as an empty list. An empty list means the questionnaire was never
answered, which is a different problem, so the digest distinguishes them. Note these are
declarations, not measurements: they go stale silently when a dependency starts collecting
something new.

**"Collects no data" is only printed when it is the whole declaration.** If that row ever
arrives beside a declared collection, the label contradicts itself, and the digest says so
and prints every row it holds — including the "collects nothing" row — rather than picking
one of the two claims. Until 2026-08-22 it printed the claim and stopped, which suppressed
the rows that disproved it; `--json` on the same read showed them, so the two outputs
disagreed. Every recorded declaration is that row on its own, so this decides what happens
to a shape Apple has not been seen to send.

## Anything not mapped

`asc get` sends a GET at a path you give it, for a query none of the commands above sends —
a different include list, a filter nothing here uses, a relationship no command reads yet:

```sh
node dist/cli.js get resolutionCenterThreads 'filter[reviewSubmission]=<id>'
node dist/cli.js get resolutionCenterThreads/<id>/resolutionCenterMessages 'limit=500'
```

**It is confined to the private families this client is for**, and refuses anything else
before a request is built:

```
resolutionCenterThreads, resolutionCenterMessages, resolutionCenterDraftMessages,
resolutionCenterMessageAttachments, reviewRejections
apps/{id}/{resolutionCenterThreads,dataUsages,dataUsagePublishState}
appStoreVersions/{id}/appStoreVersionStateChanges
```

So `asc get apps/123`, `asc get builds` and `asc get appInfos/<id>` are refused, with a
pointer to the official API instead. That is the whole point of the restriction: those reads
all still sit in iris behind the same cookie, so an unrestricted private GET puts every one
of them a command-line argument away, and the boundary never sees it happen. `apps` bare is
refused too — the one query it is a gap for is the pair of unread counts, and that is
`asc inbox`.

Whole families are open rather than only the routes mapped above, because a type Apple's
API has never heard of has no official read to duplicate anywhere inside it, so a *new* gap
can still be found here. Being in scope says a path is this project's business, not that it
works: what comes back from an unmapped one is undocumented, and the evidence for a call is
still a recording of the browser making it.
