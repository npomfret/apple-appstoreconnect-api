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

Every write here prints what it is about to act on and asks. One of them reaches Apple in a
way this client cannot walk back — `send-reply`. The others destroy or write over data
instead of publishing it, which is the same question in a smaller way: nothing keeps a copy
of what they take.

How much each of them can show you differs, and it is worth knowing which you are getting.
`send-reply` and `delete-draft` print the draft in full, attachments and all: the id you
typed is a thread's, and it says nothing about the words in the box. `save-draft` prints
that same thing when the box already has words in it, because what it writes replaces them
outright rather than adding to them — its attachments are the exception and are kept, and a
thread with no draft is not asked at all, since creating one takes nothing.
`delete-attachment` prints the id you passed and no more — nothing here reads a single
attachment, so there is no file name to put beside it that didn't come off a draft you had
already read. `asc draft <threadId>` is where those ids and their names are listed together,
and is worth a look first — as is the draft printed by the confirmations above, which lists
the same pair. Both showed the name alone until 2026-08-21, falling back to the id only when
a file arrived without one, which left no way to name the one you meant when a draft carried
two files under a single name.

`send-reply` and `save-draft` both read the draft once more after the answer and refuse if
it changed, because App Store Connect autosaves that box as you type and a browser open on
the same thread moves it while the prompt is on screen. That shortens the window rather than
closing it — iris has no conditional write, so there is still a round trip between the check
and the change — and what it catches is an edit made while somebody was reading, which is
the one that happens.

What is about to happen is printed either way, `--yes` included. That flag says the answer
is already decided, not that there is nothing worth recording — `send-reply` prints the
whole message it is about to send, and there is no unsend.

A command reading its input from stdin would still be asked. `cat reply.txt | asc
save-draft <threadId> -` has no stdin left to answer on, so a question there goes to the
terminal itself (`/dev/tty`) rather than being refused; needing `--yes` to get through a
pipe would mean putting the flag on exactly the writes that most want a human. `save-draft`
over a box that already has text in it is the case that exercises it. Where there is no
terminal at all — cron, CI, a container without one — the answer genuinely can't be asked
for, so the command prints what it would have done and stops. Declining exits 1, so a
script notices.

The guard is in the CLI, not the library: `sendDraftMessage()`, `sendDraftReply()` and
`saveDraftReply()` called from code go straight through, the last of them writing over
whatever the box held. What is *not* only in the CLI is the check that a
draft is worth sending — an absent or empty one is refused in `findSendableDraft()`, which
both routes go through.

## Headers on a write

`Origin` is the whole of the difference. A write sends it and a read does not, which is what
the browser does: it is on all 10 writes recorded from the browser and on none of the 214
reads.

The `X-Connect-Team-*` pair is **not** a write header, though this client treated it as one
until 2026-08-21. The browser sends `X-Connect-Team-ID` and `X-Connect-Team-Type` on every
iris request it makes, reads included — 224 of 224 — so this sends them on both now. The old
behaviour was hidden by the capture: a session copied from a browser `GET` carries the pair
itself and it went out anyway, so only a capture pasted as a bare cookie jar showed the
difference, and its reads went without them.

The team id is missing from a capture only in that last case, so it is also decoded from the
`itctx` cookie's `cp` field. Either way a session captured from any ordinary `GET` can still
write.

`Content-Type` is not part of the difference either. Every request this client sends, read or
write, carries `application/vnd.api+json`, and `Accept` is likewise one value set in one
place. Neither is taken from the capture any more, and that is a fix rather than a tidy-up:
iris is served from two front-end bundles that spell both differently — 133 of the recorded
reads send `application/vnd.api+json` as each, 78 send `application/json` with a three-value
`Accept`, on the same routes — and the capture was being spread *over* the client's own
values. So whichever request you happened to right-click decided the media types on
everything afterwards, including the `POST` that sends a reply to App Review, where every
recorded `POST` sends `application/vnd.api+json`. A gap that turns out to need something else
brings a recording showing it.

Every write is recorded — see [logging and the audit trail](logging.md).
