# Writing

> **Boundary notice (re-audited 2026-08-21, Apple OpenAPI 4.4.1):** every mapped write that
> Apple serves officially has now been removed. Attaching a build to a version was the last
> one — `PATCH /v1/appStoreVersions/{id}` takes a `build` relationship on Apple's own
> `AppStoreVersionUpdateRequest`, so `builds` and `set-build` went with the app and version
> reads. The review submissions, submission items, metadata, categories, age ratings and
> content rights that used to be here went earlier, to Apple's
> [Review Submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions),
> [App Metadata](https://developer.apple.com/documentation/appstoreconnectapi/app-metadata)
> and [Age Ratings](https://developer.apple.com/documentation/appstoreconnectapi/age-ratings)
> APIs. See [the removal task](../tasks/remove-official-api-overlap.md).

What is left is the Resolution Center write surface, and only that: drafts, attachments
and the reply to App Review, documented in [replying](replying.md). Every write in this
client is now one of those, named, captured from the browser doing it, and confirmed before
it goes.

**There is no longer a raw PATCH.** `asc patch` took any `iris/v1` path and a
hand-written body, with no confirmation and no preview — which meant every official write
this project spent step 4 deleting was still reachable, by hand, one argument away, and the
boundary would never have seen it happen. Nothing replaces it: a private write wants
captured evidence that Apple accepts that body at that path, and the place a hand-written
one belongs is Apple's official API, which asks for a key rather than a scraped cookie.

The read-side hatch survives, restricted the same way — see
[anything not mapped](reading.md#anything-not-mapped).

## Confirmations

One command reaches Apple in a way this client cannot walk back — `send-reply` — and it
prints what it is about to do and asks. So do the two deletes (`delete-draft`,
`delete-attachment`), which destroy data rather than publish it.

What is about to happen is printed either way, `--yes` included. That flag says the answer
is already decided, not that there is nothing worth recording — `send-reply` prints the
whole message it is about to send, and there is no unsend.

A command reading its input from stdin would still be asked. `cat reply.txt | asc
save-draft <threadId> -` has no stdin left to answer on, so a question there goes to the
terminal itself (`/dev/tty`) rather than being refused; needing `--yes` to get through a
pipe would mean putting the flag on exactly the writes that most want a human. No command
that asks reads stdin as things stand, so nothing exercises that path today — it is there
for the first one that does. Where there is no terminal at all — cron, CI, a container
without one — the answer genuinely can't be asked for, so the command prints what it would
have done and stops. Declining exits 1, so a script notices.

The guard is in the CLI, not the library: `sendDraftMessage()` and `sendDraftReply()`
called from code go straight to Apple. What is *not* only in the CLI is the check that a
draft is worth sending — an absent or empty one is refused in `findSendableDraft()`, which
both routes go through.

## Headers on a write

Writes send a different header set to reads: `Origin` and the `X-Connect-Team-*` pair.
That is now the whole of the difference.

`Content-Type` used to be part of it. The captures disagreed about the value — the version
PATCH sent plain `application/json` where the Resolution Center endpoints send
`application/vnd.api+json` — so a write could name its own, and one that didn't got the
first. That PATCH left with `set-build`, and `asc patch`, the only other way to reach the
default, left with the escape hatches; the transport step then removed the value itself.
Every request this client sends, read or write, now carries `application/vnd.api+json`,
set in one place. A gap that turns out to need something else brings a capture showing it.

The team id is only present on captured write requests, so it's also decoded from the
`itctx` cookie's `cp` field; that means a session captured from any ordinary `GET` can
still write.

Every write is recorded — see [logging and the audit trail](logging.md).
