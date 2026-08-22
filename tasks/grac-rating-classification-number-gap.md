# `gracRatingClassificationNumber` — one age-rating field with no official schema

## Status

**Open, and blocked on a capture that does not exist.** Nothing is being asked for; this
records a finding so it does not have to be found again.

## The finding

The recorded App Information Save sent a `PATCH ageRatingDeclarations/{id}` carrying 29
questionnaire attributes. Apple's `AgeRatingDeclaration.Attributes` also has 29 — but not
the same 29:

| | |
| --- | --- |
| in both | the other 28, `messagingAndChat` through `sexualContentOrNudity` |
| Apple only | `ageRatingOverride` |
| iris only | **`gracRatingClassificationNumber`** |

`gracRatingClassificationNumber` is the classification number issued by Korea's Game Rating
and Administration Committee. Checked 2026-08-21 against specification **4.4.1** (generated
2026-07-15, 966 paths, 1,393 schemas, re-downloaded that day and unchanged): the string
`grac` occurs 135 times and every one of them is a subscription *grace* period. It is on no
official schema, and Apple's published `AgeRatingDeclaration.Attributes` page does not list
it.

By the rule in [CLAUDE.md](../CLAUDE.md) — duplication is a
property of a call, and a private read of an official resource is retained only when it
carries a field the official specification has no schema for, narrowed to exactly that
field — this is a keep.

## Why it was removed anyway

Narrowing to that field is not free here, and the cost is the thing to weigh before
reversing this.

- **The only recorded write is the whole questionnaire.** The browser resends all 29
  answers on every Save. Keeping the GRAC number therefore means continuing to send 28
  attributes Apple serves officially, which is the duplication the boundary exists to end.
- **A single-attribute PATCH has never been recorded**, and inventing one would be a
  request shape with no evidence behind it. Whether iris leaves the omitted answers alone
  or clears them is unknown, and clearing an age-rating answer is not a failure anyone
  would notice quickly.
- **The read is not narrow either.** The declaration was reached through
  `GET apps/{appId}/appInfos` with eight includes and a fieldset — the App Information
  page's own request — and then picked out of `included`. A gap-only read would be a new
  call, not a subset of a recorded one.
- Nothing observed here says this field is *writable* at all. It may be a number Apple
  fills in from GRAC's own decision, in which case there is no capability to retain, only a
  read.

So the whole slice went on 2026-08-21, and this stayed a question. The code is recoverable
from the commit before that removal.

## What would settle it

1. Whether the field is writable, or is output from Apple's Korean rating process.
2. Whether `PATCH ageRatingDeclarations/{id}` accepts a body containing only
   `gracRatingClassificationNumber`, or whether an omitted answer is cleared. **Recorded
   from the browser**, not probed against a live app — an age rating is published data.
3. Whether Apple exposes it anywhere else: it is absent from `AppInfo.Attributes`, which
   does carry `koreaAgeRating`, so a later specification adding it would close this
   outright. Re-check on the next audit.

Until 1 and 2 are answered from a capture, a retained narrow read is the most that could
honestly be built, and it would be a read of a field nothing else in this client uses.

## Precedent

The method to copy is `CiWorkflow.post_actions` in
[xcode-cloud-post-actions-gap.md](xcode-cloud-post-actions-gap.md): take the slice out,
record the field, decide on retention on its own evidence rather than in the middle of a
deletion. It came back as a read-only command over the single field.

The contrast is what matters here. `post_actions` had a recorded read that returns the
field on its own; this one does not. The GRAC number arrives inside an eight-include App
Information page request, and the only recorded write is all 29 answers at once.
