# CI builds must start from a clean, empty checkout

Project: `apple-appstoreconnect-api`. Requested by Nick on 31 October 2026. Status: open.

Ensure every CI build starts from an empty source directory before checking out
the exact requested revision, unless a specific, justified exception is recorded.
Follow the [shared acceptance criteria](../../snowmonkey-proxy-common/tasks/2026-10-31-ci-clean-checkouts.md#shared-acceptance-criteria).

Local CI entry points found: `.teamcity`. Include server-managed builds and inherited templates in the inventory too.

## Inventory

TeamCity project `AppStoreConnectBot`, wholly owned by versioned settings
(`.teamcity/settings.kts`, `ALWAYS_USE_CURRENT`). `settings.kts` declares no
subproject or template, and `settings` shows no paused build and no build outside
the three below. There is no
`.github/workflows`, and no release or deployment job.

| Build | Checkout before | Checkout configured, verification pending | Outputs |
|---|---|---|---|
| `Checks` | Agent-side, reused hash directory shared with `Tests`; emptied only by the nightly | `appstoreconnect-bot-checks`, emptied before checkout, removed after the build | `dist/`, `node_modules/`; nothing published |
| `Tests` | As `Checks` | `appstoreconnect-bot-tests`, emptied before checkout, removed after the build | `out-tsc/` with `junit.xml` parsed into TeamCity during the build; `node_modules/` |
| `Verify` | Composite, no checkout | Unchanged: not applicable | None |

Caches and retained state, all outside the checkout: the agent's Git mirror
(TeamCity-owned, and checkout resolves one exact SHA from it) and npm's download
cache (content-addressed, with `npm ci` checking the lockfile's integrity
hashes). Neither can supply a generated file or a test result, so neither needs
an exception. No artifact dependencies exist, and no artifact is published beyond
TeamCity's own perfmon data.

`Verify`'s nightly trigger keeps `enforceCleanCheckout` and its dependency form:
every leg already starts empty, but without them the snapshot dependencies reuse
the last successful legs on an unchanged revision.

Temporary configurations `ProbeControl`, `ProbeCleanCheckout` and
`ProbeBuildCleanup` exist only to produce the verification evidence and are
removed once it is recorded.

- [x] Inventory every CI build/leg and its checkout and output directories.
- [ ] Apply clean checkout isolation and explicit cache/artifact handling.
- [ ] Verify freshness and cleanup serially; record build IDs and evidence.
- [ ] Record each justified exception with its build/path, reason, retained
  state and freshness/isolation controls, or record why no exception is needed.

Keep paused builds paused. Creating this task does not change CI settings,
delete build data or claim the requirement is already satisfied.
