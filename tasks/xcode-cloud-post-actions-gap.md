# Xcode Cloud `post_actions` — the write half

## Status

The read shipped as `asc post-actions`; what the recording settles about the response is in
[evidence.md](../docs/evidence.md) rather than here. **Nothing below is authorised by this
file.**

## What remains open

**Whether the `PUT` is safe to map.** `PUT ci/api/teams/{t}/products/{p}/workflows-v15/{w}`
is recorded in both directions with read-backs — the browser removed a post-action and put
it back 23 seconds later, both `200`, and the workflow was left as it was found. So the
request shape is evidence rather than guesswork. What stops it is what that body *is*: the
whole `content` object, fourteen keys — `actions`, `clean`, `container_file_path`,
`description`, `disabled`, `environment_variables`, `locked`, `macos_version`, `name`,
`post_actions`, `product_environment_variables`, `repo`, `start_conditions`,
`xcode_version` — so what a client fails to send back is what the workflow loses, including
both environment-variable collections, on the workflow that builds every push. It is the
same body the browser uses to toggle a workflow on and off, which is *closed* rather than
open: Apple serves that properly as `PATCH /v1/ciWorkflows/{id}` with `isEnabled`.

Having watched the browser do it authorises nothing. A scripted replace needs its own
design and its own approval: read-modify-write of a document this client only partly
models, preservation of fields it does not understand, a before/after confirmation,
complete write auditing, non-TTY refusal, and a post-write read-back. **Do not make a live
write to verify one.** The `CI` base in `src/http.ts` is declared `readOnly` and the
transport refuses any method but `GET` on it, so this is a decision to take deliberately
rather than a gap to fill in passing.

**Whether the environment-variable collections are worth reaching.** `environmentVariable`
occurs **zero** times in 4.4.1 and `CiWorkflow` has no such attribute or relationship, so
`environment_variables` and `product_environment_variables` are, like `post_actions`, fields
Apple's specification has no schema for. That is a finding rather than a proposal: their
values are secrets, the only recorded route to them is the full-document replace above, and
reading them would put a workflow's secrets through this client for the first time. It is
why `asc post-actions` has no `--raw`.

## Handling the recording

The recording still on disk, and any later one, is credential material rather than a
repository fixture: it may carry the full session cookie, per-request Apple signatures,
repository URLs, account identities and the workflow's environment variables. The rules for
reading one are in [CLAUDE.md](../CLAUDE.md) and apply here without amendment. The one thing
worth repeating because it is specific to this file: never use the recording itself in a
test — the fixtures in `test/ci.test.ts` and `test/gap-*.test.ts` are invented from the
shape.
