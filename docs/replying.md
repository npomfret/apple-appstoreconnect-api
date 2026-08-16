# Replying to App Review

```sh
node dist/cli.js draft <threadId>                              # what's in the box now
node dist/cli.js save-draft <threadId> "We have fixed…" --attach shot.png
cat reply.txt | node dist/cli.js save-draft <threadId> -       # "-" reads stdin
node dist/cli.js delete-attachment <attachmentId>
node dist/cli.js delete-draft <threadId>                        # bin the whole thing
node dist/cli.js send-reply <threadId>                          # the point of no return
```

App Store Connect keeps one unsent message per thread and autosaves it as you type.
`save-draft` writes into that box and sends nothing; `send-reply` is what reaches Apple.

The text replaces the draft's contents rather than appending, and newlines survive the
round trip, so `-` and a here-doc are the sane way to write anything longer than a
sentence. Attachments are added to whatever the draft already carries; `delete-attachment`
takes one back off. Every attachment path is checked for existence *before* the text is
saved, so a typo can't leave the reply half-written.

Five endpoints, all `application/vnd.api+json`:

```
POST   resolutionCenterDraftMessages          {messageBody} + relationship to the thread
PATCH  resolutionCenterDraftMessages/{id}     {messageBody} — the autosave
DELETE resolutionCenterDraftMessages/{id}     no body — the Delete Draft button
POST   resolutionCenterMessageAttachments     {fileName, fileSize} + relationship to the draft
POST   resolutionCenterMessages               a reference to the draft — the Send button
```

## Sending

```sh
node dist/cli.js draft <threadId>          # read it one more time
node dist/cli.js send-reply <threadId>
```

Send doesn't post the message text. It posts a *reference to the draft*, and iris copies
the body and its attachments across:

```json
{"data":{"type":"resolutionCenterMessages","relationships":{
  "createFromDraftMessage":{"data":{"type":"resolutionCenterDraftMessages","id":"<draftId>"}}}}}
```

Which means whatever is in the box at that moment is what Apple gets — there is no version
of the text in the request to check against. `send-reply` therefore reads the draft, prints
it in full, and asks before posting. `--yes` skips the question but still prints the draft;
a run with no terminal to ask on refuses rather than assuming.

It comes back `201` with the new message, its `createdDate`, and no relationships. The
draft is gone: the thread's draft box reads `{"data": null}` again, and the message is on
the thread from the next `messages` call onwards. **There is no unsend and no edit.**

An empty draft is refused before anything is sent, matching the browser, which keeps Send
disabled until there's text.

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
