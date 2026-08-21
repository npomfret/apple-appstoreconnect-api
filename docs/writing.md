# Writing

Every write this client makes is a Resolution Center one: the draft reply to App Review, its
attachments, and sending it. That is the whole write surface, and it is documented in
[replying](replying.md). Apple has no official Resolution Center API — checked against
OpenAPI 4.4.1 on 2026-08-21, see [evidence and limits](evidence.md) — which is why these are
here rather than at Apple's own
[API reference](https://developer.apple.com/documentation/appstoreconnectapi/), where any
other write to your App Store data belongs.

Each one is named, recorded from the browser doing it, and confirmed before it goes.

**There is no raw PATCH**, and nothing here takes a write path off the command line. A
hand-written body at an arbitrary `iris/v1` path has no captured evidence behind it by
definition, and it would put every write Apple serves officially back within reach without
the boundary ever seeing it happen. The place a hand-written write belongs is Apple's
official API, which asks for a key rather than a scraped cookie. The read side has an
escape hatch, restricted to the private families — see
[anything not mapped](reading.md#anything-not-mapped).

## Confirmations

One command reaches Apple in a way this client cannot walk back — `send-reply` — and it
prints what it is about to do and asks. So do the two deletes, which destroy data rather
than publish it.

How much each of them can show you differs, and it is worth knowing which you are getting.
`delete-draft` prints the draft in full, attachments and all, exactly as `send-reply` does:
the id you typed is a thread's, and it says nothing about the words in the box, which
nothing keeps a copy of once they are gone. `delete-attachment` prints the id you passed and
no more — nothing here reads a single attachment, so there is no file name to put beside it
that didn't come off a draft you had already read. `asc draft <threadId>` is where those ids
and their names are listed together, and is worth a look first.

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

Writes send a different header set to reads: `Origin` and the `X-Connect-Team-*` pair. That
is the whole of the difference.

`Content-Type` is not part of it. Every request this client sends, read or write, carries
`application/vnd.api+json`, set in one place — which is what the recordings of the
Resolution Center endpoints show them all sending. A gap that turns out to need something
else brings a recording showing it.

The team id is only present on captured write requests, so it's also decoded from the
`itctx` cookie's `cp` field; that means a session captured from any ordinary `GET` can
still write.

Every write is recorded — see [logging and the audit trail](logging.md).
