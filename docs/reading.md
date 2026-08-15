# Reading

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
| `versions [appId]` | `apps/{appId}/appStoreVersions?filter[platform]=` |
| `version [versionId]` | `appStoreVersions/{id}` |
| `metadata [versionId]` | `apps/{appId}/appInfos` + `appStoreVersions/{id}/appStoreVersionLocalizations` |
| `app-info [appId]` | `apps/{appId}/appInfos?include=ageRatingDeclaration,app,primaryCategory,…&fields[apps]=isOrEverWasMadeForKids` |
| `categories [appId]` | the same request, narrowed to the six category slots |
| `age-rating [appId]` | the same request, narrowed to the age-rating questionnaire |
| `territory-ratings [appId]` | `appInfos/{id}/territoryAgeRatings?include=territory&limit=500` |
| `screenshots [versionId]` | `appStoreVersionLocalizations?filter[appStoreVersion]={id}&include=appScreenshotSets,appPreviewSets` |
| `previews <localizationId>` | `appPreviewSets?filter[appStoreVersionLocalization]={id}&include=appPreviews` |
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

A shipped app has *two* `appInfos` records — the live one and the one being prepared — and
the live one comes back first. `metadata` reads the editable one, so what it shows is what
you last edited rather than what the store currently says. Ask for `appInfos` through `get`
and you'll see both, with a `state` telling them apart.

The ids chain together, which is what makes scripting possible:

```sh
node dist/cli.js report --json          # -> submissionId, threadId, versionId
node dist/cli.js metadata               # -> localizationId per locale
node dist/cli.js screenshots            # -> every locale with its sets, in one request
```

`screenshots` uses the same call the version page does, so one request covers all locales
and both asset kinds. Giving it a version id explicitly skips the lookup that works out
which version is under review.

## App Review Information

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

## History

```sh
node dist/cli.js history                 # every state this version has passed through
node dist/cli.js history --json
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
