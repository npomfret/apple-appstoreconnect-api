# App Store Connect Bot — Operating Contract

This is a TypeScript CLI and library for reusable App Store Connect operations across many
apps. Documented capabilities use Apple's official API with API-key authentication;
capabilities Apple does not expose officially use the undocumented `iris/v1` Resolution
Center surface with a browser-derived live session. It can change or publish real App Store data.
Correctness, evidence, auditability, and credential safety are more important than the
smallest diff.

Tech: TypeScript on Node >=22, no runtime dependencies, tests on `node:test`. Lifecycle: not
evidenced (status unknown); it can change real App Store data, so treat every write as live.

## The boundary

The private side is gap-only: no private implementation of an officially served
capability remains, `asc get` is confined to the private families and reaches iris only,
there is no raw write, and the transport speaks two hosts, four methods, and five bases:
`iris/v1`, and four **read-only** ones (`/ci/api`, `WebObjects/iTunesConnect.woa/ra/v1`,
`/ppm`, and `developer.apple.com/services-account/v1`, on a separate developer-portal
capture that no other host is sent), each carrying only reads that no official schema
covers. `docs/evidence.md` ("The private boundary inventory") records what each base
carries and when it was added. Keep it that way. Using another base, or writing to any but the
first, needs a captured recording as evidence first; prefer the safest path and record the
decision in your report.

The rule for deciding is that **duplication is a property of a call, not of a resource**. A
private read of an officially-available resource is retained only when it carries a field
the official specification has no schema for, and is then narrowed to exactly that field.
So do not delete a private read because its *resource* is official, and do not keep one
because the resource has a private *route*: check the fields. `docs/evidence.md` records which Apple
OpenAPI specification version was checked, what was checked, how, and when.

The two authentication systems are separate security boundaries. The official API uses a
short-lived JWT signed by a `.p8`; the private API uses a pasted browser cookie. Never use a
private route to avoid an official key, and never send either credential to the other's
host. When Apple adds an official equivalent for a private capability, move the capability
to the official transport and remove the private call after re-auditing the current schema.

That boundary is the shape of `src/`, so a module's directory is a claim about which
credential it may hold:

- `src/official/` — Apple's documented API on a `.p8`-signed JWT, and the convenience
  wrappers over it. This is where new capabilities go.
- `src/gap/` — only what Apple serves nowhere else, on a browser session cookie. Adding a
  module here asserts a gap and needs the field-level check above behind it.
- `src/shared/` — what neither credential touches: logging and redaction, the query
  encoder, the refusal, JSON:API expansion, the confirmation prompt. A module here is
  reachable from both sides at once, so nothing that holds a credential or sends a request
  may live in it.
- `src/accounts.ts`, `src/cli.ts` and `src/index.ts` compose all three; nothing else does.
  `accounts.ts` decides which account a command is about. It resolves *where* credentials
  live — a `.p8` path, a capture path — and never reads one; that is what lets a single
  module sit above both authentication systems, and it is asserted, not assumed.

`official/` and `gap/` may not import each other in either direction, and
`test/module-boundary.test.ts` fails if they ever do. `src/index.ts` exports the three as
namespaces rather than one flat surface, so an import says which credential it commits the
caller to.

## Non-negotiables

- Always check the [official App Store Connect API](https://developer.apple.com/app-store-connect/api/)
  and its [API reference](https://developer.apple.com/documentation/appstoreconnectapi/)
  before implementing something. We don't want to duplicate existing working implementations.
- If Apple exposes the underlying capability officially, implement it only against the
  official API, never the private route. Keep official operations reusable across apps and
  require every account, key, team, app and bundle identifier as input or configuration.
- Do not add a dependency, new API convention, abstraction, command shape, request body,
  include list, or endpoint without recording the evidence in the task file or your report.
- Treat the private Apple API as unstable. Browser-captured requests are evidence; guesses
  must be labelled in code, docs, and CLI behaviour. Never present an uncaptured write as proven.
- A browser recording under `tmp/` is evidence and may be read as evidence. What it must
  never do is leave: never print, copy, log, commit, or quote a cookie, `itctx`, CSRF value,
  bearer token, presigned upload URL, or anyone's personal details out of one, and never
  modify a capture. Read one through an extractor that emits methods, paths, query keys,
  status codes and response *key structure*, not raw entries.
- Keep all mutating HTTP calls routed through `request()` on the private side and
  `OfficialClient.write()` on the official side, and preserve semantic plus transport audit
  records. Never weaken a confirmation or make `--yes` the default.
- Preserve stdout as data and stderr for logs/prompts. Logs are structured events with
  fields, and must not contain credentials or signed query strings.
- For broad, risky, or externally observable changes, state the plan before editing.

## Canonical commands

- Install: `npm ci`
- Type check: `npm run typecheck`
- Test: `npm test`
- Build: `npm run build`
- Full gate (typecheck, build, tests): `npm run verify`
- Live CLI: `npm run asc -- <command>` (requires the credentials documented for that command)
- Apple's current OpenAPI specification and documentation index, for the "does Apple serve
  this officially?" check: `npm run spec:fetch` → `tmp/openapi/openapi.json` and `index.json`

`npm test` runs `test/` on `node:test` — no dependency, and no network: `fetch` is replaced
and every fixture is invented. It covers the pure boundaries only — the transport's rules
about where a request may go and what counts as a write, redaction, JSON:API expansion,
capture parsing, date ordering, and the import graph that keeps `official/` and `gap/` out
of each other — and says nothing about remote semantics. A green suite is
not evidence that a call Apple has never been sent works. Never make a live write to
prove a change.

`test/gap-*.test.ts` is the fence around the capabilities Apple has no official equivalent
for: the request each one makes, and what this client reads back. **A test in those files
that needs editing while removing official-API overlap means the removal took something it
should not have.** Read a failure that way before reaching for the test.

## Routing

The project skills in `.claude/skills/` (`typescript-conventions`, `feature-workflow`,
`apple-api-safety`) load from their descriptions. Detailed architecture and invariants:
`.claude/references/architecture.md`.

## Sensitive paths

- Never modify `session.json`, `*.session.json`, browser recordings, `.p8` keys, or `.env*`, and
  never read `.env*` or a live cookie at all. A recording may be read for evidence under the
  redaction rule above.
- Do not edit `dist/`; it is generated by TypeScript.
- `src/gap/http.ts`, `src/gap/session.ts`, `src/gap/curl.ts`, `src/official/client.ts`,
  `src/accounts.ts`, `src/shared/log.ts`, `src/shared/errors.ts`, and `src/shared/confirm.ts`
  are security boundaries. Follow their scoped rules and require evidence for changes.
- The accounts file (`~/.config/asc/accounts.json`, or `ASC_CONFIG`) holds paths, not
  credentials. Never write a key, a cookie or a token into it, never print an `issuerId` or
  `keyId` from it, and never read the `.p8` or capture it points at anywhere but
  `official/client.ts` and `gap/session.ts`.

<!-- agent-standards:begin -->
## Operating contract

*Managed by `npomfret/agent-standards`; detailed workflows are skills.*

- Skills come first: your first action on any task is to invoke, with the Skill tool, every skill whose description matches the request, before reading code or running commands. A task usually matches several (code design, tests, SQL, UI, scripts, logging, CI, commits); load them all, and again when the work moves to a new kind of task. Starting work without them is a mistake, even when the change looks small.
- Scope: do what was asked plus the callers, tests and migrations it needs. Leave unrelated refactors, renames, cleanup, dependency bumps and docs for separate work; suggest them at the end. Never invent commands, paths, field names or APIs; check the source first. Add failure handling only for observed evidence. When readings differ materially, choose the most plausible, state the assumption in your report and proceed. Done means the behaviour works, verification passes, and you report evidence and blockers.
- Gates: only substantive failures block (types, broken behaviour, agreed rules). Cosmetics are autoformatted and never block commits, CI or reviews. Run tests, builds and type checks yourself; no test or lint hooks, and formatting hooks only when targeted at changed files.
- Machine load: one build or test command at a time per machine, across all agents and sessions (wait for any running xcodebuild). Lean on CI for full suites; locally run only the tests your change needs. No load, stress, performance or other CPU-saturating tests without the user's explicit authorisation.
- Other agents share the checkout. Stage only your files; never stash, discard, revert or commit their changes. The shared checkout stays on the default branch; isolate with `git worktree add --detach tmp/worktrees/<name> <default-branch>`.
- Git: work is complete only when verified, reviewed commits are on the default branch and pushed (`git pull --rebase`, land with `git merge --ff-only`). Force-pushing is permitted; prefer `--force-with-lease`. Commit, land and push without asking. Repositories stay private.
- Significant work (behaviour, refactor, tests, config, tooling) is reviewed independently before commit: spawn a project reviewer or `change-reviewer` subagent (`spawn_agent` in Codex, the Agent tool in Claude Code), never report a review you did not delegate; resolve every finding. Tests and review do not replace each other.
- Substantial work needs a committed task file under `tasks/`.
- Run commands yourself unless they need the user's login, password, sudo, device or install. Reuse the project's scripts and `tmp/ad-hoc-scripts/`; put multi-step or quoted shell in a named script there. Hand the user one short command, else a script run as `! tmp/ad-hoc-scripts/<purpose>.sh`. Send long output to `tmp/logs/`; read it with `rg` and bounded excerpts; never paste whole logs.
- Secrets never go in source, arguments, output or logs, or the repo; they live in iCloud Drive, reached through gitignored `secrets/` links. Configuration comes only from explicitly supplied files, never environment, dotenv or ambient login.
- Code: construct dependencies at the entry point and inject them; no globals, singletons or hidden construction; immutable by default; structured logs with fixed labels that preserve error causes and stacks; no sleeps in tests. Raise a test timeout or limit only on measured evidence, recorded beside the operation.

- Be concise: lead with the outcome; give only the detail needed to act or decide.
- Do the work properly and verify it; never trade correctness for speed or cost.
- When options exist, recommend the best technical solution first, even if costlier; state cheaper alternatives separately with their trade-offs.
- Fail fast: surface errors with their cause; never swallow, mask or silently fall back from them.
- Keep one canonical implementation: migrate callers and delete superseded code instead of adding shims or compatibility layers.
- Question unclear or unsound requests before acting on them; do not comply silently.
Also read these always-on project rules before work: [global](.claude/rules/global.md).
In Codex, use native skills and specialists for equivalent Claude invocations; referenced `.claude/` files remain canonical project knowledge.

*Managed by `npomfret/agent-standards`; edit the shared sources there.*
<!-- agent-standards:end -->
