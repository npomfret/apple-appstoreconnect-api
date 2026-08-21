# Writing: builds and versions

> **Legacy official overlap:** Apple officially supports build selection, so the one write
> left on this page is scheduled for removal; see
> [the audited removal task](../tasks/remove-official-api-overlap.md). The review
> submissions, submission items, metadata, categories, age ratings and content rights that
> used to be here have already been removed — Apple's
> [Review Submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions),
> [App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata)
> and [Age Ratings](https://developer.apple.com/documentation/appstoreconnectapi/age-ratings)
> APIs are where they went. The retained private write surface is Resolution Center drafts,
> attachments and replies, documented in [replying](replying.md).

Mapped: attaching a build to a version (the version page's **Save** button), and [writing
and sending the reply to App Review](replying.md).

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

## Confirmations

One command reaches Apple in a way this client cannot walk back — `send-reply` — and it
prints what it is about to do and asks. So do the two deletes (`delete-draft`,
`delete-attachment`), which destroy data rather than publish it. Everything else writes
without asking — `set-build` is undone by doing it again.

What is about to happen is printed either way, `--yes` included. That flag says the answer
is already decided, not that there is nothing worth recording — `send-reply` prints the
whole message it is about to send, and there is no unsend.

A command reading its input from stdin would still be asked. `cat reply.txt | asc
save-draft <threadId> -` has no stdin left to answer on, so a question there goes to the
terminal itself (`/dev/tty`) rather than being refused; needing `--yes` to get through a
pipe would mean putting the flag on exactly the writes that most want a human. No command
that asks reads stdin as things stand, so nothing exercises that path today — it is there
for the first one that does. Where there is no terminal at all — cron, CI, a container without one — the answer genuinely
can't be asked for, so the command prints what it would have done and stops. Declining
exits 1, so a script notices.

The guard is in the CLI, not the library: `sendDraftMessage()` and `sendDraftReply()`
called from code go straight to Apple. What is *not* only in the CLI is the check that a
draft is worth sending — an absent or empty one is refused in `findSendableDraft()`, which
both routes go through.

## Headers on a write

Writes send a different header set to reads — `Origin` and the `X-Connect-Team-*` pair,
plus a `Content-Type` that isn't the same for every endpoint: the version PATCH sends
`application/json`, while the asset and Resolution Center endpoints send
`application/vnd.api+json`. Both were copied from the browser. The team id is only present
on captured write requests, so it's also decoded from the `itctx` cookie's `cp` field;
that means a session captured from any ordinary `GET` can still write.

Every write is recorded — see [logging and the audit trail](logging.md).
