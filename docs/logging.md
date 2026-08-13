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

Cookies never reach the log. `src/log.ts` scrubs `cookie`, `x-csrf-itc`, `myacinfo`,
`itctx` and friends wherever they appear, however deeply nested, and the presigned upload
URLs are logged as host plus path only — their query string *is* the credential. Long
strings are truncated, and a body that can't be serialised degrades to a note rather than
taking the command down with it.
