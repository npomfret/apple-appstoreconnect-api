# Writing: builds and versions

Mapped: attaching a build to a version (the version page's **Save** button), [adding a
screenshot](screenshots.md), [writing and sending the reply to App Review](replying.md),
editing metadata, putting a resolved item back in the review queue, and submitting a
version.

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

## Editing metadata

```sh
node dist/cli.js metadata                                  # every locale, both halves
node dist/cli.js set-metadata en-GB subtitle "Race weekend times"
cat description.txt | node dist/cli.js set-metadata en-GB description -
node dist/cli.js set-metadata en-GB keywords "racing,schedule" <versionId>
```

One field, one locale, one call. Which record it lands on is worked out from the field
name, because the metadata you see on one page is really two resources:

| | |
| --- | --- |
| `appInfoLocalizations` | `name`, `subtitle`, `privacyPolicyUrl`, `privacyPolicyText`, `privacyChoicesUrl` — app-wide |
| `appStoreVersionLocalizations` | `description`, `keywords`, `promotionalText`, `whatsNew`, `marketingUrl`, `supportUrl` — per version |

That split is the thing to keep hold of when a 4.1 rejection names a field. A description
belongs to the version and ships when it does; a name or subtitle belongs to the app.

```
PATCH appStoreVersionLocalizations/{id}   {"attributes":{"description":"…"}}   application/json
PATCH appInfoLocalizations/{id}           {"attributes":{"subtitle":"…"}}      application/json
```

The second was recorded from a Save on the App Information page, sending this envelope
with `name` and `subtitle` in one body; one field at a time is a subset of it. The first
has never been recorded and is inferred from the captured version PATCH — see
[evidence](evidence.md).

Localization ids are per-locale and never shown in the UI, so both are found by locale. A
locale the app doesn't have is an error rather than a new one created for you.

**There are two `appInfo` records on a shipped app** — the live one and the one being
prepared — and the live one is listed first. Writing to it fails with `409
ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_STATE`, "The field 'subtitle' can not be modified in
the current state". `findEditableAppInfo` picks by state instead of position. Reading is
worth the same care: the live record still says what the store says, which is not what you
edited this morning.

Apple keeps no history of what a field used to say, so `set-metadata` prints the old value
in full next to the new one and asks before overwriting. That printout is the only copy.

## Categories

```sh
node dist/cli.js categories
node dist/cli.js set-categories --primary GAMES --primary-sub-1 GAMES_TRIVIA --secondary MUSIC
node dist/cli.js set-categories --secondary none
```

Categories sit on the app info record rather than a localization, and they are
relationships rather than attributes — the category's name *is* the resource id:

```
PATCH appInfos/{id}
{"data":{"type":"appInfos","id":"…","relationships":{
  "primaryCategory":{"data":{"type":"appCategories","id":"GAMES"}},
  "primarySubcategoryOne":{"data":{"type":"appCategories","id":"GAMES_TRIVIA"}}}}}
```

There are six slots — `--primary`, `--secondary` and two subcategory slots under each,
which only the games categories populate. Only the slots you name are sent; the rest are
left alone, and `none` clears one. Reading them back is the same record with the six
relationships included.

**This is app-wide and live at once.** Unlike a description, a category change doesn't wait
for a version to ship, which is why `set-categories` prints the before and after and asks.
The same two-`appInfo` trap applies: the write goes to the editable record, not the live
one.

The recorded Save set the primary category, the secondary category and both primary
subcategories. `--secondary-sub-1`/`-2` and clearing a slot with `none` were not in it —
see [evidence](evidence.md).

## Age rating

```sh
node dist/cli.js age-rating > answers.json     # the questionnaire, as JSON
$EDITOR answers.json
node dist/cli.js set-age-rating answers.json   # shows what changed, then asks
node dist/cli.js territory-ratings             # what Apple made of it, per country
```

The declaration hangs off the app info record, and the browser resends **every** answer on
every save whether it changed or not:

```
PATCH ageRatingDeclarations/{id}
{"data":{"type":"ageRatingDeclarations","id":"…","attributes":{
  "messagingAndChat":false,"sexualContentGraphicAndNudity":"NONE", … 29 in all}}}
```

So `set-age-rating` is read-modify-write and takes the whole object. It refuses an
incomplete one: no partial body was ever recorded, so whether an omitted answer would be
left alone or cleared is unknown, and refusing is the only reading that can't quietly
unanswer a question. It refuses names Apple didn't ask for too, since on a private API a
typo would otherwise be sent and, at best, ignored.

Which questions those are is read off the app's own declaration, not a list baked into this
client. The 29 in the recording are one app's; an app asked a different set — a question
Apple adds, one only a made-for-kids app gets — reads and writes on its own terms.

The answers are typed loosely on purpose. Every frequency question in the recording said
`NONE`, so the rest of Apple's scale (`INFREQUENT_OR_MILD`, `FREQUENT_OR_INTENSE`) is taken
from the public API docs and isn't proven here — the names are checked, the values are
passed through, and a value iris won't take comes back as a 4xx.

Apple recomputes every territory's rating from this, which is what `territory-ratings`
reads back. Like categories, it is app-wide and live at once.

## Third-party content

```sh
node dist/cli.js set-content-rights DOES_NOT_USE_THIRD_PARTY_CONTENT
```

```
PATCH apps/{appId}   {"attributes":{"contentRightsDeclaration":"…"}}   application/json
```

The one App Information answer that lives on the app rather than an app info record, so
there is no editable-versus-live record to pick between.
`DOES_NOT_USE_THIRD_PARTY_CONTENT` is the captured value; `USES_THIRD_PARTY_CONTENT` is the
public API's other one and unproven here.

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
of being submitted twice, and if it came back `UNRESOLVED_ISSUES` you want
[`resolve-item`](#putting-a-rejected-item-back-in-review), not this.

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

Three commands reach Apple in a way nothing can walk back — `send-reply`, `resolve-item`
and `submit` — and they print what they are about to do and ask. So do the three deletes
(`delete-draft`, `delete-attachment`, `delete-screenshot`), which destroy data rather than
publish it, `set-metadata`, which overwrites text Apple keeps no copy of, and
`cancel-submission`. Everything else writes without asking — `set-build` and the screenshot
upload are undone by doing them again.

`--yes` answers for you. With no terminal — cron, a pipe, CI — the answer can't be asked
for, so the command prints what it would have done and stops; add `--yes` if that's what
you meant. Declining exits 1, so a script notices.

The guard is in the CLI, not the library. `sendDraftMessage()`, `sendDraftReply()`,
`resolveSubmissionItem()` and `submitReviewSubmission()` called from code go straight to
Apple. What is *not* only in the CLI is the check that a draft is worth sending: an absent
or empty one is refused in `findSendableDraft()`, which both routes go through.

## Headers on a write

Writes send a different header set to reads — `Origin` and the `X-Connect-Team-*` pair,
plus a `Content-Type` that isn't the same for every endpoint: the version PATCH sends
`application/json`, while the asset and Resolution Center endpoints send
`application/vnd.api+json`. Both were copied from the browser. The team id is only present
on captured write requests, so it's also decoded from the `itctx` cookie's `cp` field;
that means a session captured from any ordinary `GET` can still write.

Every write is recorded — see [logging and the audit trail](logging.md).
