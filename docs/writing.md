# Writing: builds and versions

> **Legacy official overlap:** Apple officially supports build selection, review
> submissions and submission-item updates. These private implementations are scheduled for
> removal; see [the audited removal task](../tasks/remove-official-api-overlap.md), and use
> [Review Submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions)
> for the overlapping writes. The metadata, category, age-rating and content-rights writes
> that used to be on this page have already been removed — Apple's
> [App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata)
> and [Age Ratings](https://developer.apple.com/documentation/appstoreconnectapi/age-ratings)
> APIs are where they went. The retained private write surface is Resolution Center drafts,
> attachments and replies, documented in [replying](replying.md).

Mapped: attaching a build to a version (the version page's **Save** button), [writing and
sending the reply to App Review](replying.md), putting a resolved item back in the review
queue, and submitting a version.

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
Once you've fixed the problem — a new build, [a reply](replying.md) — you
tell App Review each refused item is resolved:

```sh
node dist/cli.js items <submissionId>       # item ids live here
node dist/cli.js resolve-item <itemId>
node dist/cli.js submit                     # and this is what re-queues it
```

**Resolving the item does not re-queue the submission.** That is worth saying plainly
because the button in App Store Connect gives the opposite impression, and because getting
it wrong is silent: on 2026-08-13 a resolve landed `200`, the item went `READY_FOR_REVIEW`,
the version page said "Ready for Review" — and the submission sat in `UNRESOLVED_ISSUES`
for five days and sixteen hours without ever reaching Apple. Nothing anywhere said it was
waiting. Resolve clears the item; `submit` hands the submission over.

```
PATCH reviewSubmissionItems/{id}   {"attributes":{"resolved":true}}   application/vnd.api+json
```

The item comes straight back as `READY_FOR_REVIEW`. The parent submission does not follow:
it stays `UNRESOLVED_ISSUES` until `submit` hands it over. A `reviewSubmissions` read taken
straight afterwards showing `UNRESOLVED_ISSUES` is the truth, not a stale read.

**There is no un-resolve**, so `resolve-item` asks first, showing the state and version it
found. It reaches those through the parent submission: `GET reviewSubmissionItems/{id}` on
its own is refused with a 403, but an item id is base64 of
`{submissionId}|{n}|{appId}`, so the parent can be recovered from the id itself. That
decoding is a guess about Apple's format and treated as one — if it doesn't come apart
cleanly the prompt just says less.

## Submitting a version for review

```sh
node dist/cli.js submit --dry-run        # what it would do, sending nothing
node dist/cli.js submit [versionId]
node dist/cli.js cancel-submission <submissionId>
```

Three steps, and the CLI works out which are needed before doing any of them:

```
POST  reviewSubmissions          {platform} + relationship to the app
POST  reviewSubmissionItems      relationships to the submission and the version
PATCH reviewSubmissions/{id}     {"submitted":true}     ← the irreversible one
```

An unsubmitted submission is reused rather than duplicated — App Store Connect carries one
open submission per platform. One that has already gone to Apple stops the command instead
of being submitted twice.

A submission in `UNRESOLVED_ISSUES` counts as reusable, not as gone: Apple looked at it,
refused it, and sent it back. It keeps the `submittedDate` of the run that was rejected, so
that date is no guide to where it is. If any item on it is still `REJECTED` the command
stops and prints the [`resolve-item`](#putting-a-rejected-item-back-in-review) line for
each; once they are resolved it submits.

`cancel-submission` is the nearest thing to an undo, and only while Apple hasn't started
looking: `PATCH reviewSubmissions/{id} {"canceled":true}`.

**None of this is captured**, unlike everything else on this page — no recording of the
Submit button exists. What it's built on is that Apple's *public* App Store Connect API
documents this flow on these resource names, and iris demonstrably shares that model: the
`resolved` attribute that was captured is the public API's own, spelled the same way. Good
grounds to expect it to work; not the same as knowing. `--dry-run` prints the plan without
sending anything, and `runSubmission` stops at the first error and says how far it got —
the state to avoid is a half-made submission left on the account. See
[evidence](evidence.md).

## Confirmations

Three commands reach Apple in a way this client cannot walk back — `send-reply`,
`resolve-item` and `submit` — and they print what they are about to do and ask. So do the
two deletes (`delete-draft`, `delete-attachment`), which destroy data rather than publish
it, and `cancel-submission`. Everything else writes without asking — `set-build` is undone
by doing it again.

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

The guard is in the CLI, not the library. `sendDraftMessage()`, `sendDraftReply()`,
`resolveSubmissionItem()` and `submitReviewSubmission()` called from code go
straight to Apple. What is *not* only in the CLI is the check that a draft is worth sending: an absent
or empty one is refused in `findSendableDraft()`, which both routes go through.

## Headers on a write

Writes send a different header set to reads — `Origin` and the `X-Connect-Team-*` pair,
plus a `Content-Type` that isn't the same for every endpoint: the version PATCH sends
`application/json`, while the asset and Resolution Center endpoints send
`application/vnd.api+json`. Both were copied from the browser. The team id is only present
on captured write requests, so it's also decoded from the `itctx` cookie's `cp` field;
that means a session captured from any ordinary `GET` can still write.

Every write is recorded — see [logging and the audit trail](logging.md).
