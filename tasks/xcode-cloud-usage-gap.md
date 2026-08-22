# The rest of the `/ci/api` surface

## Status

**Proposed. Nothing is authorised by this file.** One read from the Xcode Cloud Usage page
recording, unbuilt. Everything else this file was opened for has left it as it shipped: the
compute reads as `asc usage`, team/PLA state as `asc team`, and the session's Xcode Cloud
permissions as `asc capabilities`.

Audited **2026-08-21** against Apple's official OpenAPI specification **4.4.1**, generated
2026-07-15, 966 paths and 1,393 schemas. The recording was read through an extractor that
emits methods, redacted paths, query keys, statuses and response key structure only.

Every `/ci/api` request in the recording is a **GET**. Nothing here could be implemented as
a write on this evidence, and the `CI` base is declared read-only in the transport anyway.

## What is left

### 1. Infrastructure validation

Opt-in state for Apple's pre-release macOS/Xcode validation, at three levels:

- `GET /ci/api/teams/{teamId}/infrastructure-validation` → `{opt_in}`
- `GET …/infrastructure-validation/products?continuation_offset=&limit=20` →
  `products[] {product_id, product_name, opt_in}`
- `GET …/infrastructure-validation/products/{productId}/workflows?continuation_offset=&limit=20`
  → `workflows[] {workflow_id, workflow_name, opt_in}`

No official equivalent. The writes that would set `opt_in` were **not** recorded, and
`asc capabilities` reports a `can_configure_infrastructure_validation`, which implies they
exist; inventing them is the guess this repository refuses. This is the weakest thing left
in the file: three nested reads whose only point is a write nobody has captured.

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
- **`GET /ci/api/teams/{teamId}/integrations/slack`** → `{is_user_connected}`. No official
  equivalent, and one boolean is thin.
- **The two `iris` reads** are `/v1/apps` and `/v1/ciProducts`, both official operations
  with official query parameters.
- **The seven `olympus` calls** — `actors`, `people`, `sites`, `contractMessages`,
  `providerNews` and a `providerSwitchRequests` POST — are session and account plumbing.
  `people` and `actors` carry personal data. Deliberately out of scope.
- `asc-extension-products` and `/ci/status/system-status` both returned empty in this
  recording (`{"items":[]}` and `{}`). Nothing can be claimed about either.

## What integrating any of it would cost

Almost nothing in plumbing, and that is no longer the question. The `/ci/api` base, the
per-base content type, the per-base 403 rule and the team id from the session all exist and
are exercised. A read added here is one function in `src/ci.ts`, one command, fixtures and
an evidence note.

What is left to weigh is scope rather than cost. The team-scoped boundary has now been
crossed three times deliberately — compute usage, then team/PLA state, then the session's
own permissions — each on the ground that what it reads has no per-app form and no official
equivalent. It does not follow that it is open, and what remains here is not blocked on
scope anyway: it is blocked on the toggle never having been recorded.

One correction belongs here rather than in the deleted item. That item claimed `notariz`
occurs zero times in 4.4.1; re-checked on 2026-08-22 it occurs **four** times — the
`NOTARIZATION` release destination and a `STAPLED_NOTARIZED_ARCHIVE` artifact type, neither
of them a permission. The conclusion the number was supporting survives unchanged, and the
corrected count is in [evidence.md](../docs/evidence.md). Re-run a count before quoting one.

## What would settle it

A browser recording of the opt-in toggle. Until there is one, this is a read of a switch
this client cannot throw, and the three reads describe a setting nothing here can change.
