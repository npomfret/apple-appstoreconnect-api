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

## Exceptions

None needed. `Verify` is not applicable: a composite runs no steps and checks
nothing out, and `.teamcity/settings.kts` says so beside it.

## Verification

Temporary configurations at `126835b`, all on `macstudio-1`, run one at a time.
Each run confirmed `git rev-parse HEAD` was the exact build revision, checked six
seeds by path, then planted them again: `.git/probe-sentinel`, the untracked
`probe-sentinel.txt`, and the ignored `out-tsc/junit.xml`, `dist/stale.js`,
`node_modules/.stale` and `tmp/stale.log`.

| Configuration | What acts | Builds | Result |
|---|---|---|---|
| `ProbeControl` | Nothing cleans | 21204, 21415, 21614, 21775 | From run 2, all six seeds survive, so a missing seed elsewhere means something removed it |
| `ProbeCleanCheckout` | Emptying before checkout | 20925, 21221, 21438, 21629 | All six gone every run; the log shows `Clean build enabled: removing old files` |
| `ProbeBuildCleanup` | Removal after the build | 21205 success, 21414 controlled failure, 21615 execution timeout, 21776 success | All six gone after each ending; the log shows the directory empty or missing at the next start, and each build published its sentinel first |

Residual risk: the cancellation case is an execution timeout, not a person
pressing Stop, and an agent lost mid-build was not tried. Either way the next
build still empties the directory first, as `ProbeCleanCheckout` shows.

- [x] Inventory every CI build/leg and its checkout and output directories.
- [ ] Apply clean checkout isolation and explicit cache/artifact handling.
  Configured and removed from the probes; open until `Checks` and `Tests` run in
  their named directories.
- [ ] Verify freshness and cleanup serially; record build IDs and evidence.
  Probe evidence above; the same real-leg run is outstanding.
- [x] Record each justified exception with its build/path, reason, retained
  state and freshness/isolation controls, or record why no exception is needed.

Keep paused builds paused. Creating this task does not change CI settings,
delete build data or claim the requirement is already satisfied.
