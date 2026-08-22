# Xcode Cloud `post_actions` — the write half

## Status

The read shipped as `asc post-actions`. **Nothing below is authorised by this file.**

## What remains open

**Whether the `PUT` is safe to map.** `PUT ci/api/teams/{t}/products/{p}/workflows-v15/{w}`
is recorded in both directions with read-backs — the browser removed a post-action and put
it back 23 seconds later, both `200`, and the workflow was left as it was found. So the
request shape is evidence rather than guesswork. What stops it is what that body *is*: the
whole `content` object, fourteen keys — `actions`, `clean`, `container_file_path`,
`description`, `disabled`, `environment_variables`, `locked`, `macos_version`, `name`,
`post_actions`, `product_environment_variables`, `repo`, `start_conditions`,
`xcode_version` — so what a client fails to send back is what the workflow loses, including
both environment-variable collections, on the workflow that builds every push.

Having watched the browser do it authorises nothing. A scripted replace needs its own
design and its own approval: read-modify-write of a document this client only partly
models, preservation of fields it does not understand, a before/after confirmation,
complete write auditing, non-TTY refusal, and a post-write read-back. **Do not make a live
write to verify one.** The `CI` base in `src/http.ts` is declared `readOnly` and the
transport refuses any method but `GET` on it, so this is a decision to take deliberately
rather than a gap to fill in passing.

The same body is how the browser toggles a workflow on and off — one boolean, `disabled`,
in an otherwise byte-identical fourteen-key `PUT`. That one is **closed, not open**: Apple
serves it properly as `PATCH /v1/ciWorkflows/{id}` with `isEnabled`, so the private route is
a strictly worse duplicate. Recorded in [evidence.md](../docs/evidence.md) and the
[README](../README.md); it is not a decision waiting here.

**Whether the environment-variable collections are worth reaching.** `environmentVariable`
occurs **zero** times in 4.4.1 and `CiWorkflow` has no such attribute or relationship, so
`environment_variables` and `product_environment_variables` are, like `post_actions`, fields
Apple's specification has no schema for. That is a finding rather than a proposal: their
values are secrets, the only recorded route to them is the full-document replace above, and
reading them would put a workflow's secrets through this client for the first time. It is
why `asc post-actions` has no `--raw`.

**Whether any other `type` exists.** Only `testFlight_internal` was observed. The name
implies an external counterpart, but implying is not observing, and nothing should accept
or emit a second value on the strength of the first one's spelling. `PostAction.type` is a
passed-through string for that reason, not a union.

**Whether `beta_tester_ids` behaves like `beta_group_ids`.** Present and empty throughout
the recording. Nothing shows what a populated one looks like or whether the two combine.

## Handling the recording

This governs the recording still on disk, and any later one. It is credential material, not
a repository fixture: it may carry the full session cookie, per-request Apple signatures,
repository URLs, account identities and the workflow's environment variables. It stays under
`tmp/`, is never committed, and a "sanitised" export deserves the same treatment, since
sanitising authentication headers does not necessarily remove workflow content.

Reading it means an extractor that emits methods, redacted paths, query keys, statuses and
response key structure, and lets no credential or personal detail out. Never use the
recording itself in a test; the fixtures in `test/ci.test.ts` and `test/gap-*.test.ts` are
invented from the shape.

## The other `/ci/api` surface

Nothing is left open on it. The infrastructure-validation reads shipped as
`asc infrastructure-validation` on 2026-08-22, and the calls from those recordings that were
weighed and left out — `products-v4`, `scm-providers-v2`, `integrations/slack`, the empty
`asc-extension-products`, and the `olympus` account plumbing — are recorded under "Seen but
deliberately not mapped" in [evidence.md](../docs/evidence.md) rather than kept as tasks.
