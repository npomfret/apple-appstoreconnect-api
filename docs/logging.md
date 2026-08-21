# Logging and the audit trail

Logging is structured: one JSON object per line, always on **stderr**, so stdout stays
pure data and `asc report --json | jq` is unaffected.

```sh
ASC_LOG=debug|info|warn|error|off   # default info
```

No interpolated sentences — the first argument is a stable event slug and everything else
is a field, so you can filter on `.event` without matching on prose that might get
reworded later:

```ts
log.info('draft.attachment.reserved', { attachmentId, parts: operations.length });
```

**Every change to live data is audited**, and audit records are emitted whatever the level
is set to — an audit trail you can turn down isn't one. They carry `"audit":true` and a
`phase` of `start`, `ok` or `error`:

```sh
node dist/cli.js save-draft <threadId> "..." --attach shot.png 2>&1 >/dev/null | jq -c 'select(.audit)'
```

```json
{"event":"draft.attach","audit":true,"phase":"start","draftId":"...","fileName":"shot.png","fileSize":52384}
{"event":"http.write","audit":true,"phase":"start","method":"POST","url":".../resolutionCenterMessageAttachments","body":{...}}
{"event":"asset.part","audit":true,"phase":"ok","host":"object-storage.apple.com/...","offset":0,"length":52384,"status":200}
{"event":"draft.attach","audit":true,"phase":"ok","ms":1832}
```

Records nest: the semantic action (`draft.attach`, `message.send`,
`draft.attachment.delete`) brackets the transport-level `http.write` entries. The transport one
is what makes coverage complete — every mutation in the client funnels through the single
`request` in `src/http.ts`, so nothing can write without being recorded. The semantic ones
add the intent. What counts as a mutation is worked out once there, from the method with its
case normalised, and the same answer decides both the headers and the record: a `patch` that
arrived in lower case is a write, not a read that quietly slipped past the trail.

`start` is written *before* the request leaves, on purpose: if a run dies mid-write, or the
connection fails so you can't tell whether the change landed, the ambiguity is the thing
you most want a log of.

## Reads that may have come back short

Two warnings say when a list might not be the whole list. `read.clipped` is the definite
one — iris reported a total larger than the page it sent. `read.atLimit` is the suspicion:
the page came back exactly as long as the `limit` asked for, which is what a clipped page
looks like when no total is reported. Neither fetches a second page; they exist so that a
short list doesn't pass for a complete one, which is the failure that matters when the
digest picks "Apple's latest message" out of it. Raise that call's `limit` to see past it.

## What never reaches the log

Credentials are scrubbed two ways, because one of them has to catch what the other missed.

By field name: `cookie`, `x-csrf-itc`, `myacinfo`, `itctx` and friends, wherever they appear
and however deeply nested — plus `demoAccountPassword`, which is a body attribute rather
than a header. That list is `SECRET_FIELDS` in `src/log.ts`, and it is matched twice.

Once against the keys of a record built here, which is the obvious pass. Then again against
those same names quoted inside a *string*, which is the pass that matters for anything that
arrived whole from somewhere else. A response body is not a record: it reaches the log as
one opaque value, so the field names in it are never looked at, and iris quotes parts of the
request back inside a refusal. That second match is why `ApiError` scrubs the body it is
handed rather than leaving it to whatever writes it out — the body travels further than the
log does, since the CLI's top-level handler prints an error message to stderr on its own.

`demoAccountPassword` is the one worth explaining, because nothing here reads the record it
lives on: `appStoreReviewDetails` is Apple's to serve, and `asc get` cannot reach it. The
rule stays regardless. Scrubbing by field name costs a string comparison and catches
whatever turns up carrying that name — an iris error quoting a request back, a library
caller that isn't the CLI, the next gap read. Dropping a known credential from the list
because today's read set happens not to produce it is the wrong direction to reason in.

By value: the query parameters that authorise a presigned upload — `Signature`,
`AWSAccessKeyId`, `X-Amz-Signature` and the rest — are replaced in *every* string logged.
A presigned URL is a bearer credential, and it can reach a record by more routes than the
one that meant to log it: `asset.part` names the host and path only, but a failed part also
throws, and an error message ends up in the audit trail and on stderr. So the error names
the host too, and the log redacts the parameters again on the way out. Storage hosts quote
the request they refused back inside their error bodies, which is why this is applied to
whole strings rather than to things that look like URLs.

Long strings are truncated, and a body that can't be serialised degrades to a note rather
than taking the command down with it.
