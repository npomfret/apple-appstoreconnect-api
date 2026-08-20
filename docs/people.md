# People and invitations

> **Legacy official overlap:** Apple's App Store Connect API officially supports users,
> invitations, visible-app access, role changes and revocation. This less-complete private
> implementation is pending removal under
> [remove-official-api-overlap.md](../tasks/remove-official-api-overlap.md). This page
> documents the current code only. Use Apple's official
> [Users](https://developer.apple.com/documentation/appstoreconnectapi/users) and
> [User Invitations](https://developer.apple.com/documentation/appstoreconnectapi/user-invitations)
> APIs instead.

```sh
node dist/cli.js invites                                   # who has been invited and not yet joined
node dist/cli.js invite ada@example.com Ada Lovelace \
  --role CUSTOMER_SUPPORT --all-apps
```

This is the People page rather than the review centre: invitations belong to the developer
account, not to an app, so neither command takes an app id. Both were recorded from the
browser sending one invitation and reloading the list, and that recording is the whole of
what is mapped — see [the limits](#what-is-not-here) below.

```
GET  userInvitations?limit=1000&sort=lastName&include=visibleApps&limit[visibleApps]=3&fields[apps]=
POST userInvitations   {email, firstName, lastName, roles, provisioningAllowed, allAppsVisible}
```

`fields[apps]=` is not a mistake: it asks for the visible apps to be identified by id
rather than expanded, which is what the page sends. `asc apps` turns the ids into names.

## Sending one

`invite` is in the same bracket as `send-reply` — it shows what it is about to do and asks
first, and `--yes` answers for you:

```
Invite ada@example.com to the developer account?

  person:       Ada Lovelace <ada@example.com>
  roles:        CUSTOMER_SUPPORT
  apps:         every app on the account
  provisioning: no

  Apple emails them. This client has no way to cancel an invitation; the People
  page in the browser does.
```

It comes back `201` with the invitation, an `expirationDate` three days out, and a
`visibleApps` link with nothing behind it yet. Reading the list a moment later showed the
same invitation with `allAppsVisible: null` and `visibleApps` naming every app on the
account — so "all apps" appears to be stored as the concrete list rather than as the flag
that was sent. That is one observation, not a rule.

`--role` is repeatable, and at least one is required. `CUSTOMER_SUPPORT` is the role in the
recording; `ADMIN`, `APP_MANAGER`, `DEVELOPER`, `MARKETING`, `FINANCE`, `SALES`,
`ACCESS_TO_REPORTS`, `CREATE_APPS` and the key-management roles are Apple's public API
documentation rather than evidence from here. The value is passed through unchecked: a role
iris won't take is a 4xx, which beats this client refusing a legitimate one it has never
seen.

`--provisioning` grants certificates and provisioning profiles. The recording sent
`provisioningAllowed: false`, so `true` is the unproven half of that pair, the same way
`USES_THIRD_PARTY_CONTENT` is for `set-content-rights`.

The POST is `application/vnd.api+json`, which is what the recording sent — the App
Information writes use plain `application/json`, so this is not the client's default for a
write and is passed explicitly.

`--all-apps` is required rather than defaulted. It is the only app scope this client has a
body for, and an access grant should be visible at the point it is written rather than
assumed.

## Addresses Apple refuses

**Plus-addressing is refused.** `you+tag@gmail.com` comes back `409
ENTITY_ERROR.ATTRIBUTE.INVALID` — "Email format not valid." — with a `source.pointer` of
`/data/attributes/email`. Gmail delivers a `+` tag to the base inbox, but Apple is not
validating deliverability: the invitee's address becomes an Apple ID, and Apple is stricter
about those than a mail server is. Invite the untagged address instead.

The address is sent exactly as typed, and a `+` is not rejected locally. Stripping the tag
would quietly invite a different address, and refusing it here would put this client's guess
about a private API ahead of Apple's own answer — which arrives as a clear 409 naming the
field.

## What is not here

The capture is one POST and one GET, and nothing else on the People page is mapped:

- **No revoke.** Cancelling a pending invitation was never recorded, so this client cannot
  undo what `invite` does. The browser can, from the People page.
- **No app-restricted invitation.** The recording set `allAppsVisible: true` and sent no
  `visibleApps` relationship, so inviting someone to a subset of apps has no body to copy.
  `invite` refuses without `--all-apps` rather than inventing one.
- **No user list and no role editing.** The people already on the account are a different
  endpoint (`users`), and nothing here has seen it.

`asc get userInvitations` and `asc get users` reach all of it read-only without a code
change, which is the way to look before capturing the rest.
