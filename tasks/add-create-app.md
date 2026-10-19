# Add `create-app`: create an iOS app record on the private API

## Issue

The browser recording `tmp/appstoreconnect.apple.com- new project.har` (2026-10-19) shows App
Store Connect's New App form posting `iris/v1/apps`. Apple's official API cannot create an
app: `/v1/apps` is GET-only in specification 4.5.1 (1,001 paths), checked 2026-10-19. The
user approved adding it as a gap capability, iOS-only.

## Plan

- `createApp(session, app)` in `src/gap/api.ts`: the recorded compound body, audited as
  `app.create`, platform fixed to `IOS`.
- `asc create-app` with `--name`, `--bundle-id`, `--sku`, `--locale`, `--app-version`, all
  required, confirmation printing every field.
- Request test in `test/gap-requests.test.ts`; docs in README, `docs/writing.md`,
  `docs/evidence.md`, `docs/library.md`.
- Not mapped: `userAppPermissions` (409 in the recording; official `visibleApps` exists),
  `ascBundleIds`, `users`, `userInvitations` (all official).

## Tracking

- Done: implementation, tests, docs. `npm run typecheck`, `npm test` (379/379) and
  `npm run build` pass.
- The body was compared offline with both recorded bodies, typed values masked: identical.
- Agent review (evidence-reviewer): no bugs. Fixed: the audit test now asserts the
  `http.write` pair, the recorded 409 has a test, the docs separate the 4.5.1 check from
  the 4.4.1 audit, the same-locale claim is stated as one recording, README marks it
  never sent, `app.create` is listed in `docs/logging.md`, and an unneeded cast is gone.
- Residual risk: never sent by this client; the first live run is the test. Other
  platforms are unrecorded and not offered.
