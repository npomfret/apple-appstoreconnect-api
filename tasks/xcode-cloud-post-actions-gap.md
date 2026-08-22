# Xcode Cloud `post_actions` — the write half

## Status

The read shipped on 2026-08-22 — `asc post-actions <productId>`, `fetchPostActions()` in
`src/ci.ts`, evidence in `docs/evidence.md`. Nothing below is authorised by this file.

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

**Whether any other `type` exists.** Only `testFlight_internal` was observed. The name
implies an external counterpart, but implying is not observing, and nothing should accept
or emit a second value on the strength of the first one's spelling. `PostAction.type` is a
passed-through string for that reason, not a union.

**Whether `beta_tester_ids` behaves like `beta_group_ids`.** Present and empty throughout
the recording. Nothing shows what a populated one looks like or whether the two combine.

## Activating and deactivating a workflow is Apple's, not this repository's

A capture of the Xcode Cloud **activate/deactivate** toggle was added on 2026-08-22
(`tmp/workflow activate and deactivate.txt`, two curls). Read through the extractor, the two
`PUT`s carry byte-identical fourteen-key bodies differing in exactly one boolean:
`disabled: true` → `disabled: false`. So the private route to enabling a workflow is the
same full-document replace described above.

**It is out of scope, and not marginally.** Checked against 4.4.1 on 2026-08-22:
`PATCH /v1/ciWorkflows/{id}` exists, `CiWorkflowUpdateRequest` declares every attribute
optional, and `isEnabled` is one of them. So the officially supported way to deactivate a
workflow is a partial update of a single attribute:

```
PATCH /v1/ciWorkflows/{id}
{"data": {"id": "…", "type": "ciWorkflows", "attributes": {"isEnabled": false}}}
```

The private route is not merely a duplicate of that — it is a strictly worse one. Apple's
version changes one attribute. This one replaces the whole document, so anything the client
fails to send back is destroyed, on the workflow that builds every push. Mapping it would
mean adding a write to a base declared read-only in order to do badly what Apple already
does well, and by the rule in [CLAUDE.md](../CLAUDE.md) — duplication is a property of a
call — it is a duplicate whichever way the route is spelled. Use the official API.

The same check disposes of most of the fourteen keys: `name`, `description`, `clean`,
`containerFilePath`, `isLockedForEditing`, `actions` and the start conditions are all
`CiWorkflowUpdateRequest` attributes, and `macos_version`, `xcode_version` and `repo` are
official relationships.

**One thing in that body is a genuine gap and is recorded here rather than acted on.**
`environmentVariable` occurs **zero** times in the whole of 4.4.1, and `CiWorkflow` has no
environment-variable attribute and no such relationship — so `environment_variables` and
`product_environment_variables` are, like `post_actions`, fields Apple's specification has no
schema for. That is a finding, not a proposal: their values are secrets, the only route to
them is the full-document replace, and reading them would put a workflow's secrets through
this client for the first time. It is why `asc post-actions` has no `--raw`.

## Handling the recording

This governs the recording still on disk, and any later one. It is credential material, not
a repository fixture: it may carry the full session cookie, per-request Apple signatures,
repository URLs, account identities and the workflow's environment variables. It stays under
`tmp/`, is never committed, and a "sanitised" export deserves the same treatment, since
sanitising authentication headers does not necessarily remove workflow content.

Reading it means an extractor that emits methods, redacted paths, query keys, statuses and
response key structure, and lets no credential or personal detail out — the way it was read
on 2026-08-21 and again on 2026-08-22, and the way the Usage page recording was read for
[xcode-cloud-usage-gap.md](xcode-cloud-usage-gap.md). Never use the recording itself in a
test; the fixtures in `test/ci.test.ts` and `test/gap-*.test.ts` are invented from the shape.

## The other `/ci/api` surface

Two reads from the Usage page recording are still unbuilt and unauthorised —
`user-capabilities` and infrastructure validation — in
[xcode-cloud-usage-gap.md](xcode-cloud-usage-gap.md). Team/PLA state left that file on
2026-08-22 as `asc team`.
