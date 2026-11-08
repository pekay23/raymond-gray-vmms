# Raymond Gray shared identity service

Status: recommended architecture baseline for implementation, 8 November 2026. Keycloak is the local candidate; the production identity host and operations provider remain pending owner review.

## Purpose

Provide one user-facing authentication service for Raymond Gray products at `auth.raymond-gray.org`, while preventing a shared login from becoming shared business authorization. The standalone project is `C:\Projects\raymond-gray-auth`; VMMS remains a separate relying party with its own API, PostgreSQL data, user access state, site membership, customer/vehicle grants and audit trail.

## Chosen components

| Concern | Baseline | Boundary |
| --- | --- | --- |
| Identity provider | Keycloak, self-hosted OIDC candidate | Owns credential verification, Google brokering, passkeys and central login sessions |
| Federated sign-in | Google OIDC broker | Identity only; no Google API access or automatic same-email linking |
| Browser applications | Server-side OIDC BFF, authorization code + PKCE | Each app owns its origin session and business authorization |
| Native apps | System browser with authorization code + PKCE | Distinct public client per product/platform; secure OS token store |
| User and resource grants | Individual application database | Never sourced from cross-product roles or email-domain heuristics |
| VMMS offline behavior | Per-user saved drafts only | No offline grants, commits, or identity/credential sync in launch scope |

## Client registration contract

Every registered application client records an owner, product, environment, client type, exact redirect URIs, post-logout URIs, allowed scopes, expected audiences and rotation/review date. Production callbacks are HTTPS. Do not use wildcard redirects, wildcard origins or shared secrets. Only `openid`, `profile` and `email` are baseline identity scopes. Tokens are audience-bound; app web clients are confidential server-side clients, while native clients are public clients protected by PKCE.

Initial client inventory (registered only when implemented):

| Product | Web callback host | First client | Status |
| --- | --- | --- | --- |
| VMMS | `vmms.raymond-gray.org` | `vmms-web` | Planned |
| Platform | inspect actual app host before configuring | `platform-web` | Planned |
| Remote support | inspect actual app host before configuring | `remote-support-web` | Planned |
| Vehicle services | inspect actual app host before configuring | `vehicle-services-web` | Planned |
| Native clients | per product and OS after platform decision | separate clients | Deferred |

Development clients and realms are separate from staging and production. Each integration validates `(iss, sub)` and stores that mapping locally. An app must not call Keycloak's admin API in normal request handling.

## Account lifecycle and linking

Central sign-up stays closed. A user is provisioned by an authorised process, completes a verified sign-in method, and receives application-specific access only through that application's approval flow. Inviting a person into VMMS must not grant access to the other products. Suspending central authentication blocks future authentication; product suspension also revokes that product's sessions and local grants.

Google linking is deliberate and account-bound. Do not auto-link by email. Existing local accounts gain an immutable central subject through a controlled migration or a fresh-authenticated proof of both accounts. Preserve a product's local account UUIDs and actor references; no current prototype data migration is required.

## Runtime and availability

Keycloak and PostgreSQL require persistent runtime/storage; production setup includes a fixed public hostname, TLS, trusted reverse-proxy configuration, private administration access, database backup/restore, health checks, monitoring, patching and an outage/recovery procedure. Store secrets in the selected host's secret manager. The Cloudflare zone owner controls DNS, but DNS is not changed by this local architecture work. Hosting is an open decision until latency, availability, recovery, cost and operational ownership are compared.

## Security acceptance

- State, nonce, S256 PKCE, exact callback matching, signature, issuer, audience and expiry are validated.
- No implicit flow or direct password grant. No password or refresh token is sent to browser JavaScript.
- A forged or expired token, replayed code/state, bad nonce, wrong issuer or wrong audience is rejected.
- Google same-email auto-link and open registration are disabled.
- Passkey enrollment and authentication enforce user verification and the exact auth origin/RP ID.
- Production passkey RP ID is exactly `auth.raymond-gray.org`, with origin `https://auth.raymond-gray.org`; staging and local development use their own exact origins.
- Local app authorization remains correct after central login: pending and suspended accounts, wrong-site staff and unapproved customer/vehicle relationships are denied.
- App-local logout, central logout, account disablement and lost-passkey revocation have explicit, tested behavior.
- Admin consoles and administration APIs are not exposed on the public login surface.

The local synthetic passkey enrollment and passwordless login passed with a Chromium virtual authenticator. This does not replace physical-device, cross-device, browser/OS matrix, recovery, revocation, or production checks; see [`shared-passkey-local-2026-11-08.md`](../verification/shared-passkey-local-2026-11-08.md).

## Owner review items

## Current implementation evidence

VMMS is the first local OIDC relying party. The integration flow and its exact protocol boundary are described in [`oidc-vmms-integration.md`](oidc-vmms-integration.md); provider discovery, the synthetic authorization-code HTTP flow, API test results, and remaining gaps are recorded in [`oidc-local-2026-11-08.md`](../verification/oidc-local-2026-11-08.md). Local passkey enrollment and conditional passwordless login are recorded separately in [`shared-passkey-local-2026-11-08.md`](../verification/shared-passkey-local-2026-11-08.md). This is a development slice only. Google federation, physical-device/browser coverage, central logout, and production configuration remain unverified.

- Select hosting/runtime and managed PostgreSQL provider; define recovery time and recovery point objectives.
- Confirm identity administrators and account provisioning approvers.
- Configure the Google OAuth application, consent/test-user controls and exact callback after environment selection.
- Choose email/recovery delivery provider and shared-device inactivity policy.
- Decide whether authentication outage should block all product access (recommended default) or whether any emergency local access is warranted; any exception needs a tightly controlled, audited and tested break-glass process.
- Approve first-party OIDC client origins and callbacks from each project.
- Set production availability/monitoring ownership and on-call response.

## References

- [Keycloak OIDC application flows](https://www.keycloak.org/securing-apps/oidc-layers)
- [Keycloak passkeys and WebAuthn](https://www.keycloak.org/docs/latest/server_admin/#passkeys)
- [Keycloak Google identity provider](https://www.keycloak.org/docs/latest/server_admin/#_google)
- [Keycloak production configuration](https://www.keycloak.org/server/configuration-production)
- [Keycloak hostname and proxy headers](https://www.keycloak.org/server/hostname)
- [Local Keycloak/PostgreSQL smoke check](../../../raymond-gray-auth/docs/verification/local-compose-2026-11-08.md) (startup and discovery only; not production evidence)
