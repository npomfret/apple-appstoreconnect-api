---
paths:
  - "src/gap/api.ts"
  - "src/gap/http.ts"
  - "src/gap/session.ts"
  - "src/gap/curl.ts"
  - "src/shared/log.ts"
  - "src/shared/errors.ts"
  - "src/shared/confirm.ts"
  - "src/accounts.ts"
  - "src/cli.ts"
  - "docs/**/*.md"
---

# Apple API, credentials, and audit boundaries

- Do not change an endpoint, include list, filter, fieldset, headers, content type, or
  JSON:API envelope without a browser capture or explicitly approved probe. Record the
  evidence level in `docs/evidence.md` and in nearby code comments.
- All normal mutations go through `request()` so `http.write` auditing stays complete.
  Presigned upload parts may use `uploadPart()` only; never send cookies to storage hosts.
- Emit audit `start` before a mutation and preserve audit `ok`/`error` outcomes. Scrub
  cookies, CSRF values, signed query strings, credentials, and response secrets from logs.
- Irreversible, destructive, or overwriting operations must retain CLI confirmation,
  clear previews, non-TTY refusal, and explicit `--yes` opt-in.
- Update `README.md` and the relevant document under `docs/` when command behaviour,
  evidence, safety, output, or operational assumptions change.
