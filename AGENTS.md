# App Store Connect Bot — Operating Contract

This is a TypeScript CLI and library for reusable App Store Connect operations across many
apps. Documented capabilities use Apple's official API with API-key authentication;
capabilities Apple does not expose officially use the undocumented `iris/v1` Resolution
Center surface with a browser-derived live session. It can change or publish real App Store data.
Correctness, evidence, auditability, and credential safety are more important than the
smallest diff.

## The boundary

The private side is gap-only: no private implementation of an officially served
capability remains, `asc get` is confined to the private families and reaches iris only,
there is no raw write, and the transport speaks two hosts, four methods, and five bases —
`iris/v1`; a **read-only** `/ci/api` carrying the five Xcode Cloud capabilities in none
of 4.4.1's schemas — a workflow's `post_actions`, compute usage against the plan, the
team's Developer Program standing including whether the PLA needs signing, the thirteen
booleans saying what the session is permitted to do, and the infrastructure-validation
opt-in to building against pre-release macOS and Xcode; and, since 2026-10-27, a
**read-only** `WebObjects/iTunesConnect.woa/ra/v1` and a **read-only** `/ppm` carrying the
three Business-pane reads in none of 4.5.1's schemas — the state of each agreement, the
warnings shown on the account, and the compliance forms Apple wants. Since 2026-11-06 there
is one more host and base: a **read-only** `developer.apple.com/services-account/v1`, on a
separate developer-portal capture that no other host is sent, carrying the one read in none
of 4.5.1's schemas — the catalogue of capabilities and services a bundle ID can have. Keep
it that way. Another base, or a write on any but the first, is an owner decision with a
recording behind it, not an implementation detail.

The rule for deciding is that **duplication is a property of a call, not of a resource**. A
private read of an officially-available resource is retained only when it carries a field
the official specification has no schema for, and is then narrowed to exactly that field.
So do not delete a private read because its *resource* is official, and do not keep one
because the resource has a private *route*: check the fields. Last audited against Apple's
OpenAPI specification **4.4.1** (generated 2026-07-15, 966 paths, 1,393 schemas) on
2026-08-22. `docs/evidence.md` records what was checked, how, and when.

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
- Before a non-trivial change: inspect callers, implementations, analogous functions,
  tests and user-facing CLI/docs. Refactor only where the requested change needs it, then verify.
- Do not add a dependency, new API convention, abstraction, command shape, request body,
  include list, or endpoint without explaining the evidence and getting approval.
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
- Prefer precise TypeScript types and fail-fast errors. Do not use `any`, silent catches,
  speculative compatibility branches, or duplicate helper logic to evade a design problem.
- For broad, risky, or externally observable changes, state the plan before editing.

## Canonical commands

- Install: `npm ci`
- Type check: `npm run typecheck`
- Test: `npm test`
- Build: `npm run build`
- Live CLI: `npm run asc -- <command>` (requires the credentials documented for that command)
- Apple's current OpenAPI specification and documentation index, for the "does Apple serve
  this officially?" check: `npm run spec:fetch` → `tmp/openapi/openapi.json` and `index.json`

`npm test` runs `test/` on `node:test` — no dependency, and no network: `fetch` is replaced
and every fixture is invented. It covers the pure boundaries only — the transport's rules
about where a request may go and what counts as a write, redaction, JSON:API expansion,
capture parsing, date ordering, and the import graph that keeps `official/` and `gap/` out
of each other — and says nothing about remote semantics. A green suite is
not evidence that a call Apple has never been sent works. Report the verification that
actually ran, and never make a live write to prove a change.

`test/gap-*.test.ts` is the fence around the capabilities Apple has no official equivalent
for: the request each one makes, and what this client reads back. **A test in those files
that needs editing while removing official-API overlap means the removal took something it
should not have.** Read a failure that way before reaching for the test.

## Routing

- General TypeScript and module-boundary conventions: `.claude/skills/typescript-conventions/`
- Any feature or bug fix: `.claude/skills/feature-workflow/`
- Apple API, writes, uploads, sessions, logging, or evidence: `.claude/skills/apple-api-safety/`
- Detailed architecture and invariants: `.claude/references/architecture.md`

## Sensitive paths

- Never edit `tmp/`, `session.json`, `*.session.json`, browser recordings, `.p8` keys, or `.env*`, and
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

## Scope

Complete the requested work and verify it. Include the dependent changes needed to make it work, such as affected callers, tests or migrations.

- Use the request and existing project requirements as the boundary. Leave unrelated refactors, renames, cleanup, dependency bumps and documentation changes for separate work.
- Add special handling or tests for a failure scenario when there is evidence for it: observed data, an incident or a reproducible failure.
- Suggest adjacent work briefly at the end of the report; continue the current task. An unanswered suggestion is not approval.
- Ask when different interpretations would lead to materially different work. If a necessary change exceeds the authorized scope, explain the concrete dependency and wait for a decision.
- Finish when the requested behavior works and its verification passes. Report what changed, the evidence, and any remaining blocker.

*Generated from `npomfret/agent-standards`. Edit the standard there, not this copy.*

## Running commands

Run commands yourself unless they require the user's login, password, sudo, device or installation action. Load the `scripting` skill before writing a script the project keeps.

- When the user must run a command, give them one short command. For anything multiline, chained or longer than about 80 characters, write an executable `tmp/<purpose>.sh` with `#!/usr/bin/env bash`, `set -euo pipefail`, a purpose comment and logging under `tmp/logs/`. Show it, ask them to run `! tmp/<purpose>.sh`, then read its log.
- Keep lengthy build, test, install and data output in `tmp/logs/`. Read relevant portions and report the useful lines with the log path. Do not enable verbose/debug output merely to watch a run.

*Generated from `npomfret/agent-standards`. Edit the standard there, not this copy.*

## State and dependencies

Construct dependencies at the program's entry point and pass each consumer the specific collaborators and configuration it uses. Static application state is not allowed.

### Prefer

- Required constructor parameters for classes and explicit parameters for functions. Constructed objects are ready to use; per-call data belongs in method arguments.
- Narrow, application-owned interfaces for external capabilities such as network, storage, time, randomness and scheduling. Put unavoidable platform globals behind injected adapters.
- Runtime-owned instances with a defined lifetime, shared by passing references. Use an injected narrow factory when construction depends on later request/session data.
- Immutable values and fields, including owned collections and nested data. Use `const` in JavaScript/TypeScript, `let` in Swift, or the language's equivalent; an immutable reference alone does not protect its contents.
- Minimal private mutable state with a behavioral reason, one owner and a validity/invalidation policy. Keep transitions consistent across failure, cancellation and asynchronous work; prevent stale work from overwriting newer state.

### Avoid

- Singletons, module/static service instances or configuration, global accessors, service locators and global configure/reset lifecycles.
- Hidden construction through default dependencies or property injection, and passing a general dependency container inward.
- Reading configuration in behavior code or at module import time. The entry point reads and validates its supplied environment/files once into typed immutable configuration, then passes only the needed settings inward.
- Copying an existing global-state pattern into new code. Removing existing state is separate work unless requested or necessary for the task.

Immutable constants, stateless functions and deterministic value construction are allowed; service instances and runtime configuration are not constants. If a change would require new static application state, explain the missing construction boundary instead of adding a stopgap.

Tests construct units with in-memory configuration and fakes. Independent instances must coexist without interference. Exercise meaningful state transitions through behavior; do not supply dependencies by patching modules, changing the environment or resetting globals.

*Generated from `npomfret/agent-standards`. Edit the standard there, not this copy.*

## Test timeouts

Use short, explicit limits so slow or stalled work fails promptly. Run local builds and tests one at a time across agents, with one test worker; wait for any test run you control to finish before starting another.

- Set budgets for tests, setup/teardown, driver waits, suites and CI jobs. Use an outer watchdog when the framework cannot express the required limit. In-memory unit tests should take well under a second; UI waits should match an acceptable user response time.
- A timeout stops the stalled work and reports the phase, elapsed time, limit and observed state.
- Calibrate against measured timings on the slowest environment, usually a busy CI agent, with a proportionate margin. Investigate unexpected slowness rather than masking it.
- Increasing any limit requires the user's approval. Give the measured timings, proposed limit and user impact; record the approved exception beside that operation. Keep shared defaults unchanged.

*Generated from `npomfret/agent-standards`. Edit the standard there, not this copy.*

## Review before commit

Have significant work independently reviewed by an agent before committing. This includes behavior, refactors, tests, configuration and tooling; trivial wording, formatting and task-file edits need no review.

- Use an appropriate project reviewer, or a general reviewer. Give it the success criteria, file list/revision range and the actual diff.
- Ask for substantive problems with evidence: bugs, broken contracts, missed requirements, rule violations and ineffective tests. Skip style preferences and nits.
- Resolve each finding or explain why it is incorrect before committing. Report the review result and how findings were handled.

Passing tests do not replace review, and agent review does not replace any required user approval.

*Generated from `npomfret/agent-standards`. Edit the standard there, not this copy.*

## Git

Work is complete only when its verified, reviewed commits have landed on `main` and been pushed to its remote. Use the existing default branch where it has another name, such as `master`. A local commit, worktree result or open PR is not completion; report any landing or push blocker explicitly.

Keep history linear and protect other agents' work. The shared checkout stays on its default branch; isolated work uses detached worktrees instead of feature branches.

- Update the shared checkout with `git pull --ff-only`. If branches have diverged, use `git pull --rebase`. Rebase worktrees onto the default branch and resolve conflicts commit by commit.
- Use `git merge --ff-only` to land work that is already rebased. Do not create merge commits or replace a failed rebase with a merge.
- Do not stash, discard or commit someone else's changes. If their work blocks an operation, use a worktree, wait or report the blocker.
- Commit and push scoped, verified work after independent review without asking again, unless the user requests otherwise for the task.
- Do not force-push the default branch.

### Worktrees

Use a worktree when the checkout contains others' changes or the work needs more than one commit. Otherwise work directly on the default branch and stage only your files.

Create detached worktrees with `git worktree add --detach .claude/worktrees/<name> <default-branch>`. Do not create feature branches or switch branches in the shared checkout.

Build, test and commit inside the worktree. A subagent commits there and returns the commit ID; its parent remains responsible for landing and pushing it.

### Landing

1. Commit the worktree's changes.
2. Confirm the shared checkout is on the default branch; otherwise stop and report it. Update it with `git pull --ff-only`.
3. Rebase the worktree onto the updated default branch. Get its new commit ID with `git rev-parse HEAD`, then land that ID from the shared checkout with `git merge --ff-only <commit-id>`. Rebase again if the default branch moved.
4. Push the default branch and confirm the remote contains the landed commits. If the push is rejected, reconcile with the remote using rebase and retry; do not report completion while delivery is blocked.
5. Leave and remove the worktree once its commits have landed and been pushed, or have been deliberately dropped. Remove only worktrees you created; report other apparently stale worktrees without removing them.

*Generated from `npomfret/agent-standards`. Edit the standard there, not this copy.*
