# Reading

> **Boundary notice (re-audited 2026-08-21, Apple OpenAPI 4.4.1, generated 2026-07-15, 966
> paths, 1,393 schemas):** every read left on this page is one the official API has no
> equivalent for — Resolution Center threads, messages, rejections and drafts; unread
> review-message counts; version state-change history; and the App Privacy questionnaire.
> The last of the legacy overlap went with the app, version, build and review-detail slice.
> Apple's
> [App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata),
> [Age Ratings](https://developer.apple.com/documentation/appstoreconnectapi/age-ratings),
> [Review Submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions),
> [Xcode Cloud](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds),
> [User Invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations),
> [App Store Versions](https://developer.apple.com/documentation/appstoreconnectapi/app-store-versions),
> [Builds](https://developer.apple.com/documentation/appstoreconnectapi/builds) and
> [Apps](https://developer.apple.com/documentation/appstoreconnectapi/apps) APIs are where
> the removed reads went. They need an API key rather than this client's cookie. See
> [the removal task](../tasks/remove-official-api-overlap.md).

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
  last msg   2026-05-17T12:25:06.31Z (from Apple)
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

The version each conversation is about comes off the thread's own `appStoreVersions`, which
is a to-many relationship: a thread about two versions names both rather than having one
picked for it, and `--json` carries the full list as `versions` alongside the singular
`version`/`versionId`, which are filled only when there is exactly one.

What no route supplies is the submission's `state`, `platform` and dates — the digest used
to print them and no longer does. They live on `reviewSubmissions`, which Apple serves
officially at
[`GET /v1/apps/{id}/reviewSubmissions`](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions);
read them there. `--submission` echoes back the id you gave it and nothing else about the
submission. See [the sequencing task](../tasks/gap-boundary-next-steps.md).

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

Every endpoint above is `iris/v1`, and every one of them is about an app. The nine `ci-*`
commands that read Xcode Cloud over a second private API — `/ci/api`, plain JSON, no JSON:API
envelope — are **gone**, along with `asc ci-run`'s build digest, and so is `invites`, the one
read here that was account-wide rather than per-app. Apple exposes Xcode Cloud products,
workflows, repositories, build runs, actions, issues and test results
[officially](https://developer.apple.com/documentation/appstoreconnectapi/xcode-cloud-workflows-and-builds),
and pending invitations at
[`GET /v1/userInvitations`](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations).
The `screenshots` and `previews` reads have gone the same way: `appScreenshotSets`,
`appScreenshots`, `appPreviewSets` and `appPreviews` are all
[App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata)
resources, down to the `uploadOperations` the upload flow ran on. So have `metadata`,
`app-info`, `categories`, `age-rating` and `territory-ratings`: `appInfos`,
`appInfoLocalizations`, `appStoreVersionLocalizations`, the six category relationships,
`ageRatingDeclarations` and `appInfos/{id}/territoryAgeRatings` are all official, attribute
for attribute. And so have `submissions`, `submission` and `items`: `apps/{id}/reviewSubmissions`,
`reviewSubmissions/{id}` and `reviewSubmissions/{id}/items` are all
[Review Submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions)
operations, and every attribute this client read back — a submission's `platform`, `state`
and `submittedDate`, an item's `state` — is on Apple's own schema. All of them need an API
key rather than this client's cookie.

The same has now happened to the reads this page was built around. `apps`, `app`, `versions`,
`version`, `builds` and `review-details` are gone: `apps`, `apps/{id}`,
`apps/{id}/appStoreVersions`, `appStoreVersions/{id}`, `builds` and
`appStoreReviewDetails/{id}` are all official operations, and every attribute read back —
a version's `platform`, `versionString`, `appStoreState`, `appVersionState` and
`downloadable`, a build's `version`, `uploadedDate`, `processingState` and `expired`, a
review detail's contact, demo account and notes — is on Apple's own schema. The build
picker's four filters survive the move too, with one rename: Apple spells
`filter[isAppStoreCandidate]=true` as `filter[buildAudienceType]=APP_STORE_ELIGIBLE`.

`appId` still defaults to the one scraped from the captured request's `Referer`. **`versionId`
no longer defaults at all** — `asc history <versionId>` requires it. Working it out meant
reading `apps/{id}/appStoreVersions`, which is the official call above, so the convenience
went with it rather than being the one duplicate kept for its own sake. That call is where
to get the id from:
`GET /v1/apps/{id}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION`.

Two things about App Store metadata are worth carrying over to whichever client reads it,
because they are properties of the records rather than of this one. It is split across two
of them — **name** and **subtitle** hang off `appInfos`, while description, keywords,
promotional text and what's-new hang off the version — so a 4.1 metadata rejection is often
about the half the version doesn't have. And a shipped app has *two* `appInfos` records, the
live one and the one being prepared, with the live one listed first: read that one and you
get what the store says rather than what you last edited, and write to it and Apple refuses
with a `409`. `asc get appInfos` still shows both, with a `state` telling them apart.

The ids chain together, which is what makes scripting possible — and is now the way to get
a version id out of this client at all, since the command that listed versions was official
and went:

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
and resubmissions. `initiator` separates Apple's moves from your own — that's what tells a
`REJECTED` apart from a `DEVELOPER_REJECTED` you did yourself.

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

For anything not mapped yet, probe it directly:

```sh
node dist/cli.js get resolutionCenterThreads 'filter[reviewSubmission]=<id>'
```
