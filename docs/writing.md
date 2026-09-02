# Writing

Two kinds of write, on two credentials. On the official API, with an API key: a TestFlight
group's build list, in both directions — below. On the private API, with the browser cookie:
the Resolution Center — the draft reply to App Review, its attachments, and sending it —
documented in [replying](replying.md). Apple has no official Resolution Center API — checked
against OpenAPI 4.4.1 on 2026-08-21, see [evidence and limits](evidence.md) — which is why
those are on the cookie rather than at Apple's own
[API reference](https://developer.apple.com/documentation/appstoreconnectapi/), where every
other write to your App Store data belongs, and where the two below are.

Each one is named, evidenced — a browser recording for the private ones, Apple's published
schema for the official ones — and confirmed before it goes.

## Official API: a TestFlight group's builds

```sh
asc prune-builds --app "My App" --group "Internal"            # keep the newest of each platform, remove the rest
asc prune-builds --app "My App" --group "Internal" --keep 3   # the newest three of each platform
asc prune-builds --app "My App" --group "Internal" --dry-run  # the plan, and nothing else
asc prune-builds --app "My App" --group "Internal" --check    # exit 1 while there is anything to remove
asc add-builds --app "My App" --group "Beta" --build 45 --build 46   # by build number
asc add-builds <appId> --group e4840ac3-… --build 0a1b2c3d-…        # or everything by id
```

The app is the name App Store Connect shows, a bundle ID, or an app id, as for every
official command — see [reading](reading.md#official-api-storefront-availability).

Both are the same documented route, `/v1/betaGroups/{id}/relationships/builds`, with
`DELETE` to remove and `POST` to add, and the same body: a list of `{type: "builds", id}`.
They are each other's undo. A build removed from a group is still in App Store Connect with
its expiry untouched, and adding it back is the other command; **nothing here expires or
deletes a build**, which is a different operation with no documented way back.

Which build is which is the point of the plan, so it is printed whole before the question:

```
app        1234567890
group      Internal  (internal, automatic distribution off, 0e1f…)
keep       1 newest per platform

keep (2):
  2026-09-01T18:02:11-07:00  1.4.0 (312)  IOS, valid  7c0e…
  2026-08-28T11:30:40-07:00  1.4.0 (309)  MAC_OS, valid  d81b…

remove from group (2):
  2026-08-30T09:41:56-07:00  1.4.0 (311)  IOS, valid  91aa…
  2026-08-29T22:10:03-07:00  1.3.9 (310)  IOS, valid, expired  4d27…
```

`--keep` counts **per platform**. A group often holds iOS and macOS builds side by side,
and a tester on a Mac installs only the Mac ones, so "the newest" is the newest of each.
The first live dry run on 2026-09-02 is what settled this: counted across platforms, it
kept one iOS build and would have taken the only current Mac build out of the group.

The group is given by its name or its id, told apart by uuid shape, and either is matched
exactly within the app: "Beta" does not resolve to "Beta (old)", an id from another app's
group is no group at all, and none or several is an error. Newest is by the instant
Apple stamped, not the text, since Apple stamps with an offset. Builds already expired are
still members of the group and are pruned like any other; keeping one would keep nothing
testers can install. A group Apple marks as receiving every new build automatically
(`hasAccessToAllBuilds`) is refused by both commands before any build is listed, because
the write does nothing there and Apple does not say so: the first live run, on 2026-09-02,
sent the documented `DELETE` naming twelve builds in such a group, was answered `204`, and
the read-back listed all twelve still in it. Automatic distribution *is* the membership, so
there is nothing to edit. The flag is not among the attributes the official update request
accepts, so the way through is TestFlight: turn automatic distribution off for the group,
then prune; from then on new builds join it through `add-builds` or an Xcode Cloud
post-action rather than on their own. Expiring builds is the other way to shorten what such
a group's testers see, and it is not implemented here — it has no undo.

`add-builds` names a build the way TestFlight shows it: the build number in brackets, or
Apple's own id, told apart by shape. A number that matches two builds — the same
`CFBundleVersion` under two marketing versions — is refused with both ids, so the id form
is always a way through. Builds already in the group are listed under "already in group"
and are not sent again.

The ids in the request are the plan's own, so what leaves or joins the group is exactly what
was on screen, whatever was uploaded meanwhile; there is no second read between the answer
and the write because there is nothing for one to catch. The read that matters comes
*after*: each command lists the group again and prints what Apple now says, and exits 1 if
a build asked to leave is still there, or one asked to join is not. That read-back is the
only evidence this client has that a `204` did what it says.

**The removal has been run once, and the addition never.** The one live `DELETE`, on
2026-09-02, went to a group with automatic distribution on and is the evidence for the
refusal above: `204`, nothing removed, caught by the read-back. Against a group without
that flag the request is the one Apple's specification 4.4.1 documents, byte for byte, and
is also what the TestFlight page sends when you click it — recorded from the browser on the
private spelling of the same route — but it has not been seen to take effect yet.
`--dry-run` costs nothing and shows the plan.

Adding to an *external* group is the outward-facing one: it hands the build to people
outside the team, and Apple may put it through Beta App Review first. The confirmation says
which kind of group it is.

Both reads are one page of Apple's documented maximum, 200. A group holding more is reported
in the plan — the older builds beyond the page are in neither list — and a second run after
the first reaches them. That is honest rather than complete, and `--check` stays red while a
further page exists.

**There is no raw PATCH**, and nothing here takes a write path off the command line. A
hand-written body at an arbitrary `iris/v1` path has no captured evidence behind it by
definition, and it would put every write Apple serves officially back within reach without
the boundary ever seeing it happen. The place a hand-written write belongs is Apple's
official API, which asks for a key rather than a scraped cookie. The read side has an
escape hatch, restricted to the private families — see
[anything not mapped](reading.md#anything-not-mapped).

## Confirmations

Every write here prints what it is about to act on and asks. One of them reaches Apple in a
way this client cannot walk back — `send-reply`. The private others destroy or write over
data instead of publishing it, which is the same question in a smaller way: nothing keeps a
copy of what they take. The two official ones are reversible and ask anyway: one takes a
build away from testers and the other hands one to them, and both print every build on
both sides of the plan, with its id, before asking.

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
whatever the box held, and so do `pruneBuilds()` and `addBuilds()` with the plan they are
handed. What is *not* only in the CLI is the check that a
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
