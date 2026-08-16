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
log.warn('screenshot.check', { fileName, displayType, problem, forced });
```

**Every change to live data is audited**, and audit records are emitted whatever the level
is set to — an audit trail you can turn down isn't one. They carry `"audit":true` and a
`phase` of `start`, `ok` or `error`:

```sh
node dist/cli.js upload-screenshot ... 2>&1 >/dev/null | jq -c 'select(.audit)'
```

```json
{"event":"screenshot.upload","audit":true,"phase":"start","displayType":"APP_IPHONE_65","fileName":"shot.png","dimensions":"1242 × 2688"}
{"event":"http.write","audit":true,"phase":"start","method":"POST","url":".../appScreenshots","body":{...}}
{"event":"asset.part","audit":true,"phase":"ok","host":"object-storage.apple.com/...","offset":0,"length":52384,"status":200}
{"event":"screenshot.upload","audit":true,"phase":"ok","ms":1832}
```

Records nest: the semantic action (`screenshot.upload`, `version.build.set`,
`screenshot.delete`) brackets the transport-level `http.write` entries. The transport one
is what makes coverage complete — every mutation in the client funnels through the single
`request` in `src/http.ts`, so nothing can write without being recorded. The semantic ones
add the intent.

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
than a header and can arrive through `asc patch`. That list is `REVIEW_DETAIL_SECRETS` in
`src/log.ts`, shared with the redaction that hides the same field from `review-details`
output, so the two can't drift apart.

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
