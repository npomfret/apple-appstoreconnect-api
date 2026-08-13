# Sessions: capturing a cookie

**There is no API key for this, and no way to get one.** `iris` authenticates with the
browser session cookie and nothing else. Apple gates that behind an interactive login —
passkey, 2FA — so every session starts with you in a browser. It's clunky. There's no
alternative.

Sessions last a few hours. When one lapses you do this again.

1. Log in to <https://appstoreconnect.apple.com> as normal, and open any page of the app
   you care about (a review submission or the version page).
2. Dev tools → **Network**, filter to Fetch/XHR, click any request to `/iris/v1/...`.
3. Right-click it → **Copy** → **Copy as cURL**.
4. Paste it into a scratch file - save it to somewhere (eg `tmp/curl.txt`) **that is gitignored**, keep it there.
5. Hand it over:

   ```sh
   npm install && npm run build
   node dist/cli.js login tmp/curl.txt      # or: pbpaste | node dist/cli.js login
   node dist/cli.js status                  # confirms it, and how long it has left
   ```

Any request will do, `GET` or otherwise — the team id that writes need is decoded from the
cookie rather than read off the headers, so a session captured from a plain read can still
write. The file can contain several curls with notes around them; the first is used, and
only the cookie plus a handful of headers are kept.

The result lands at `tmp/session.json` (mode `0600`, gitignored, `ASC_SESSION_PATH` to
move it). Treat both files as live credentials: anyone holding that cookie is you, on your
developer account, until it expires.

## Or paste the cookie on its own

If getting a clean curl is awkward, `login` takes ordinary text instead — one item per
line, any order, `#` comments and blank lines ignored:

```
# grabbed 13 Aug
Cookie: myacinfo=...; itctx=...; dqsid=...
https://appstoreconnect.apple.com/apps/6761343835/distribution/ios/version/inflight
```

Only the cookie is required, and the `Cookie:` prefix is optional. Account id, team id and
expiry are all decoded from it. The URL line just supplies the default app id, which you
can otherwise pass per command (`asc report <appId>`). Everything else is ignored, so an
HTTP/2 header block pasted straight out of dev tools (`:authority:`, `sec-fetch-*` and
all) works unedited.

## Capturing new endpoints

A **HAR export** is the best way to capture new endpoints. Record dev tools → Network
while doing the thing in the browser, export, and every request *and response* is in
there — far more than "Copy as cURL" gives you one at a time. Note that a HAR contains
the full session cookie in plain text, so it belongs in `tmp/` with everything else
gitignored. `asc login` doesn't parse HAR yet; it wants a curl or a `Cookie:` line.
