# Replying to App Review

```sh
node dist/cli.js draft <threadId>                              # what's in the box now
node dist/cli.js save-draft <threadId> "We have fixed…" --attach shot.png
cat reply.txt | node dist/cli.js save-draft <threadId> -       # "-" reads stdin
node dist/cli.js delete-attachment <attachmentId>
node dist/cli.js delete-draft <threadId>                        # bin the whole thing
```

**This does not send anything.** App Store Connect keeps one unsent message per thread and
autosaves it as you type; `save-draft` writes into that box, and the reply reaches Apple
only when someone presses **Send** in the browser. Sending is deliberately unmapped: no
capture of that button exists, and a reply to App Review is the wrong thing to reach by
guessing at an endpoint — it can't be taken back. Write it here, read it back, send it
there.

The text replaces the draft's contents rather than appending, and newlines survive the
round trip, so `-` and a here-doc are the sane way to write anything longer than a
sentence. Attachments are added to whatever the draft already carries; `delete-attachment`
takes one back off. Every attachment path is checked for existence *before* the text is
saved, so a typo can't leave the reply half-written.

Four endpoints, all `application/vnd.api+json`:

```
POST   resolutionCenterDraftMessages          {messageBody} + relationship to the thread
PATCH  resolutionCenterDraftMessages/{id}     {messageBody} — the autosave
DELETE resolutionCenterDraftMessages/{id}     no body — the Delete Draft button
POST   resolutionCenterMessageAttachments     {fileName, fileSize} + relationship to the draft
```

`save-draft` reads the thread first and POSTs or PATCHes accordingly, since the draft is
created on the first keystroke and updated forever after. Attachments are the same
reserve → PUT the parts → `{"uploaded":true}` dance as [screenshots](screenshots.md),
against `resolutionCenterMessageAttachments` instead of `appScreenshots` — the guess in
the old notes turned out right. Neither the POST nor the PATCH response mentions
attachments, so the draft is re-read at the end; that GET is what the command prints.

`delete-draft` takes a thread id rather than a draft id, because the draft id is never shown
in the UI. Attachments go with the draft: after one was deleted this way, a GET of the
attachment it carried returned 404.

Draft ids are *derived from the thread*, not random. Deleting a draft and starting another
on the same thread returned the identical UUID with a fresh `createdDate` — and both it and
the thread id are version-3 (name-based) UUIDs, so Apple is hashing something stable. Handy
to know when reading captures across sessions; not something to rely on in code.

Drafts only live on **open** threads. A closed one refuses the POST with 409
`ENTITY_ERROR.RELATIONSHIP.INVALID` — "Cannot add draft message to closed thread".

`resolutionCenterDraftMessage` returns `{"data": null}` when there's no draft, rather
than a 404 — so an empty draft box is a successful response, not an error.
