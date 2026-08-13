# Writing: builds and versions

Mapped: attaching a build to a version (the version page's **Save** button), [adding a
screenshot](screenshots.md), [writing and sending the reply to App Review](replying.md),
and putting a resolved item back in the review queue.

```sh
node dist/cli.js builds [versionId]                 # the picker — "*" marks the current one
node dist/cli.js set-build <versionId> <buildId>    # or "none" to detach
node dist/cli.js patch appStoreVersions/<id> '{"data":{...}}'   # anything else
```

`builds` is the version page's build picker, and reads like it (`--json` for the same
thing as data):

```
  1.1.1 (6)        9ba2bc88-4458-4a75-9e29-612ddfb89a0a uploaded 2026-08-13T03:36:06-07:00
* 1.1.1 (5)        046e610d-0579-4ecf-88b2-10102a9a798c uploaded 2026-08-13T03:23:39-07:00
  1.1.0 (1)        375b687a-85a9-4546-a924-7abea47baabf uploaded 2026-08-12T07:30:27-07:00
```

Two filters, because they answer different questions.
`builds?filter[appStoreVersion]={id}` returns only the build already attached — it will
not show you the alternatives. The picker's list is
`builds?filter[app]={appId}&filter[preReleaseVersion.platform]={platform}&filter[isAppStoreCandidate]=true&filter[processingState]=VALID`,
newest first, capped at 10 as the page itself caps it. `builds` runs both and merges
them, because an attached build can age out of the candidate list and would otherwise
vanish from its own listing. The marketing version comes from the build's
`preReleaseVersion`; the number in brackets is the build's own `version`.

The PATCH body carries only what changed — omitted fields are left alone:

```json
{"data":{"type":"appStoreVersions","id":"<versionId>",
  "relationships":{"build":{"data":{"type":"builds","id":"<buildId>"}}}}}
```

## Putting a rejected item back in review

A rejected submission sits in `UNRESOLVED_ISSUES` with one item per thing under review.
Once you've fixed the problem — new build, new screenshots, [a reply](replying.md) — you
tell App Review the item is resolved, and that is what puts it back in the queue:

```sh
node dist/cli.js items <submissionId>       # item ids live here
node dist/cli.js resolve-item <itemId>
```

```
PATCH reviewSubmissionItems/{id}   {"attributes":{"resolved":true}}   application/vnd.api+json
```

The item comes straight back as `READY_FOR_REVIEW`. The parent submission's own state lags
a second or two behind — a `reviewSubmissions` read taken at the same moment still said
`UNRESOLVED_ISSUES` — so re-read it rather than believing the first answer.

**There is no un-resolve**, so `resolve-item` asks first, showing the state and version it
found. It reaches those through the parent submission: `GET reviewSubmissionItems/{id}` on
its own is refused with a 403, but an item id is base64 of
`{submissionId}|{n}|{appId}`, so the parent can be recovered from the id itself. That
decoding is a guess about Apple's format and treated as one — if it doesn't come apart
cleanly the prompt just says less.

## Confirmations

Two commands reach Apple in a way nothing can walk back: `send-reply` and `resolve-item`.
Both print what they are about to do and ask. So do the three deletes
(`delete-draft`, `delete-attachment`, `delete-screenshot`), which destroy data rather than
publish it. Everything else writes without asking — `set-build` and the screenshot upload
are undone by doing them again.

`--yes` answers for you. With no terminal — cron, a pipe, CI — the answer can't be asked
for, so the command prints what it would have done and stops; add `--yes` if that's what
you meant. Declining exits 1, so a script notices.

The guard is in the CLI, not the library. `sendDraftMessage()` and `resolveSubmissionItem()`
called from code send immediately.

## Headers on a write

Writes send a different header set to reads — `Origin` and the `X-Connect-Team-*` pair,
plus a `Content-Type` that isn't the same for every endpoint: the version PATCH sends
`application/json`, while the asset and Resolution Center endpoints send
`application/vnd.api+json`. Both were copied from the browser. The team id is only present
on captured write requests, so it's also decoded from the `itctx` cookie's `cp` field;
that means a session captured from any ordinary `GET` can still write.

Every write is recorded — see [logging and the audit trail](logging.md).
