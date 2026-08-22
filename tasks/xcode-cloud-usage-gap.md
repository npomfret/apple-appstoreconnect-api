# Xcode Cloud usage, capabilities and infrastructure validation — an unmapped `/ci/api` gap

## Status

**Proposed. Nothing is authorised by this file.** It records what a browser recording of
the Xcode Cloud *Usage* page contains, which of those calls Apple serves officially, and
what integrating the rest would actually cost. No code has been written for any read in
this file. Updated 2026-08-22: the transport it was waiting on now exists, built for
`post_actions`, so what remains is one product decision rather than a reversal.

Audited **2026-08-21** against Apple's official OpenAPI specification **4.4.1**, generated
2026-07-15 — re-downloaded that day from
`https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip`
and unchanged at 966 paths and 1,393 schemas.

### How the recording was read

Read through an extractor that emits method, host, path, query keys, status and *response
key structure* only. No header, cookie, `itctx`, CSRF value or signed URL was read or
printed, and the two `olympus` responses that carry names and email addresses were reduced
to key names with every value discarded — which is the contract's rule for reading a
recording. The recording stays private and outside the repository.

## What the page does

28 requests: 22 to an API, six to page assets and telemetry. Two are `iris` reads this
client already knows are official (`/v1/apps` with the icon and version sideloads, and
`/v1/ciProducts` filtered to `FRAMEWORK`). Seven are `olympus` session plumbing. The
remaining thirteen are `/ci/api`, and they are the subject of this file.

Every one is a **GET**. The recording contains no `/ci/api` write at all, so nothing here
could be implemented as a write on this evidence.

## The gaps

Checked field by field. `usage`, `compute`, `minute` and `credit` match no `/ci/api`-shaped
schema in 4.4.1 — the only official `usage` paths are TestFlight metrics
(`betaTesterUsages`, `betaBuildUsages`, `publicLinkUsages`), which are about testers, not
build minutes. `usage_in_minutes`, `number_of_builds`, `computeHours`, `reset_date`,
`can_view_all_products`, `csv_export`, `user-capabilities` and `infrastructure-validation`
each occur **zero** times in the whole document.

### 1. Compute usage — the substantial one

`GET /ci/api/teams/{teamId}/usage/summary` returns the plan itself:

| field | what it is |
| --- | --- |
| `plan.name`, `plan.total` | the entitlement |
| `plan.used`, `plan.available` | consumption against it |
| `plan.reset_date`, `plan.reset_date_time` | when the allowance rolls over |

`GET /ci/api/teams/{teamId}/usage/days?start=YYYY-MM-DD&end=YYYY-MM-DD` returns the
breakdown behind it: a `usage[]` series of `{date, minutes, number_of_builds}`, a
`product_usage[]` of `{product_id, usage_in_minutes, usage_in_seconds, number_of_builds}`
each paired with its `previous_` counterpart for the preceding window, and an `info` block
carrying `can_view_all_products`, current and previous `{builds, used, average_30_days}`,
and a `links.csv_export`.

**Nothing official comes close.** `CiBuildRun` carries `startedDate` and `finishedDate`, so
a per-run wall-clock duration is derivable one build at a time by walking every product's
build runs — but wall-clock is not billed compute, there is no allowance, no reset date and
no plan. This is the strongest candidate in the file: it answers "how much Xcode Cloud is
left this month", which no official call answers at any price.

### 2. Xcode Cloud permissions for the signed-in user

`GET /ci/api/teams/{teamId}/user-capabilities` returns thirteen booleans —
`can_edit_restricted_workflows`, `can_restrict_workflows`,
`can_configure_external_deployments`, `can_trigger_external_deployments`,
`can_remove_products`, `can_change_next_build_number`, `can_manage_subscriptions`,
`can_configure_notarization`, `can_trigger_notarization`,
`can_configure_locked_version_aliases`,
`can_configure_locked_product_environment_variables`,
`can_configure_infrastructure_validation`, `can_onboard_to_distribution`.

`notariz` occurs zero times in 4.4.1, and the official API has no per-user capability
resource of any kind. This is the answer to "will this call be refused before I make it",
which is worth more to a script than to the page it was recorded from.

### 3. Infrastructure validation

Opt-in state for Apple's pre-release macOS/Xcode validation, at three levels:

- `GET /ci/api/teams/{teamId}/infrastructure-validation` → `{opt_in}`
- `GET …/infrastructure-validation/products?continuation_offset=&limit=20` →
  `products[] {product_id, product_name, opt_in}`
- `GET …/infrastructure-validation/products/{productId}/workflows?continuation_offset=&limit=20`
  → `workflows[] {workflow_id, workflow_name, opt_in}`

No official equivalent. The writes that would set `opt_in` were **not** recorded, and
`can_configure_infrastructure_validation` above implies they exist; inventing them is the
guess this repository refuses.

### 4. Team and programme state

`GET /ci/api/teams/{teamId}` returns `{id, name, program_state, wwdr_pla_needs_signing,
wwdr_team_id, public_provider_id, wwdr_team_within_pla_grace_period, links}`. `team` as a
resource does not exist in the official API. `wwdr_pla_needs_signing` is the useful one: an
unsigned Program License Agreement stops builds and submissions, and there is no official
way to see it coming.

### 5. Slack

`GET /ci/api/teams/{teamId}/integrations/slack` → `{is_user_connected}`. No official
equivalent, and one boolean is thin.

## What is *not* a gap

- **`GET /ci/api/teams/{teamId}/products-v4?limit=100`** duplicates official `ciProducts`:
  `id`, `name`, `product_type`, `created_at` and `app_id` are `CiProduct.name`,
  `.productType`, `.createdDate` and the `app` relationship. Only `modified_at` has no
  official field, and a last-modified date is not on its own worth a private call.
- **`GET /ci/api/teams/{teamId}/scm-providers-v2`** is mostly official:
  `provider`/`provider_display_name`/`is_on_premise` are exactly
  `ScmProviderType.kind`/`.displayName`/`.isOnPremise`, and `host` is `ScmProvider.url`.
  What is private is the *connection* state — `is_registered`, `is_user_connected`,
  `supports_registration_flow`, `register_type`, `install_type`, `connect_type`,
  `username`, `oauth_callback_base_uri`. That is OAuth plumbing for a browser to render a
  Connect button with, not a capability a CLI needs.
- **The two `iris` reads** are `/v1/apps` and `/v1/ciProducts`, both official operations
  with official query parameters.
- **The seven `olympus` calls** — `actors`, `people`, `sites`, `contractMessages`,
  `providerNews` and a `providerSwitchRequests` POST — are session and account plumbing.
  `people` and `actors` carry personal data. They are deliberately out of scope, with one
  exception noted below.
- `asc-extension-products` and `/ci/status/system-status` both returned empty in this
  recording (`{"items":[]}` and `{}`). Nothing can be claimed about either.

## What integrating this would cost

**The transport half is done and is no longer a cost.** The `/ci/api` base was restored on
2026-08-22 for `post_actions` — see
[xcode-cloud-post-actions-gap.md](xcode-cloud-post-actions-gap.md) — and with it the things
this file used to list as blockers: a per-base content type (`Accept: */*` and no
`Content-Type`, which is what stops the 403 that refused every `ci-*` command for its whole
life), a per-base 403 rule that does not report a refusal as a dead session, and a
plain-JSON `items` page shape. The team id turned out to need no discovery either: on all 22
recorded `/ci/api` requests the `teams/{id}` path segment is the same value as the
`X-Connect-Team-ID` header the session already carries, so no `--team` flag and no third
`olympus` base — which matters, because `actors` and `people` carry personal data this
client has no reason to hold.

A read added here is now roughly one function in `src/ci.ts`, one command, fixtures, and the
evidence note. What is left to weigh is not plumbing:

1. **These are team-scoped, and about the account rather than an app.** `post_actions` is
   reached through a team id but describes a product's workflow. Compute minutes, per-user
   capabilities and PLA status describe the *team*.
   `.claude/references/architecture.md` records that nothing here reads account-wide state,
   the People page having been the one such corner and having gone with the invitations
   slice. **That is a product call for the owner**, and it is the whole of what this file
   is still waiting on.
2. **Reads only.** Nothing here can be written on this evidence, and the `CI` base is
   declared read-only in the transport, so nothing here could be written by accident either.

## A smaller shape, if any of it is wanted

If the answer is "the minutes, and nothing else", the honest slice is one read-only
command — `asc usage` — over `usage/summary` and optionally `usage/days`, with the team id
from the session as `post-actions` takes it. `user-capabilities` is the natural second,
being a single flat GET with no pagination. Infrastructure validation is the natural last,
because it is three nested reads whose only point is a write that was not recorded.

## What would settle it

1. The owner's decision on point 1 — whether an account-wide, team-scoped surface is back
   in scope. Nothing else blocks the usage read.
2. For infrastructure validation only: a browser recording of the opt-in toggle. Until then
   it is a read of a switch this client cannot throw.
