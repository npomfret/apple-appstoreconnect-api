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
    ...
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

`attachments` lists what Apple attached, one entry per file, identified by iris's own id and
carrying a download URL. Two entries can share a file name and that is not a repeat: every
recorded thread has a message with two attachments of the same name, and a reviewer attaching
`IMG_4821.png` in one round and a different `IMG_4821.png` in the next would look the same.
The id is what tells them apart, and `--json` carries it.

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
