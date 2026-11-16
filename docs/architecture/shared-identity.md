# Raymond Gray shared identity service

16 November 2026 target amendment: the owner rejects Railway and user-managed containers. Follow the [managed-services redesign plan](../delivery/managed-services-redesign-plan-2026-11-16.md) for the proposed replacement. The conditional Supabase/Vercel/Cloudflare recommendation supersedes earlier future-hosting assumptions; existing implementation and verification described below remain historical/current facts until migration is proved. No provider or DNS change is implied.

Status: shared-identity baseline, with local VMMS integration evidence and a limited production OIDC preflight. The owner selected `auth.raymond-gray.org`. Public issuer discovery and the exact VMMS authorization redirect were verified on 14 November 2026; a hostile redirect was rejected. Full production sign-in, code exchange, VMMS callback/session, logout, recovery and deployment operations remain unverified. See [production preflight evidence](../verification/oidc-production-preflight-2026-11-14.md) and REV-056.

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

| Product | Environment | Web callback host | Client | Status |
| --- | --- | --- | --- | --- |
| VMMS | Development | loopback (`localhost` / `127.0.0.1`) | `vmms-web-dev` | Local OIDC and passkey sign-in verified; API sign-out path tested, actual provider logout callback registration remains unverified; see [local sign-in](../verification/oidc-local-2026-11-14.md) and [RP logout check](../verification/oidc-rp-logout-2026-11-14.md) |
| VMMS | Production | `vmms.raymond-gray.org` | `vmms-web-prod` | Exact authorization callback accepted and hostile redirect rejected; full sign-in/callback/logout and VMMS production API remain unverified. See [preflight evidence](../verification/oidc-production-preflight-2026-11-14.md). |
| Platform | all | inspect actual app host before configuring | `platform-web-*` | Planned |
| Remote support | all | inspect actual app host before configuring | `remote-support-web-*` | Planned |
| Vehicle services | all | inspect actual app host before configuring | `vehicle-services-web-*` | Planned |
| Native clients | per product, environment and OS after platform decision | exact app link/redirect after registration | separate clients | Deferred |

Development clients and realms are separate from staging and production. Each integration validates `(iss, sub)` and stores that mapping locally. An app must not call Keycloak's admin API in normal request handling.

The exact VMMS development post-logout callback is `http://127.0.0.1:4100/api/v1/auth/oidc/logout/callback`; the local registration helper in `C:\Projects\raymond-gray-auth\scripts\register-local-vmms-client.py` configures it and writes the matching `OIDC_LOGOUT_CALLBACK_URL` into the ignored VMMS `.env`. Production authorization-start redirect validation was preflighted, but the production post-logout callback, provider logout, and local session revocation remain unverified. See [logout contract and implementation evidence](oidc-session-revocation.md) and [production preflight evidence](../verification/oidc-production-preflight-2026-11-14.md).

## Account lifecycle and linking

Central sign-up stays closed. A user is provisioned by an authorised process, completes a verified sign-in method, and receives application-specific access only through that application's approval flow. Inviting a person into VMMS must not grant access to the other products. Suspending central authentication blocks future authentication; product suspension also revokes that product's sessions and local grants.

### VMMS Operator and Head of Service Centre boundary

The owner confirmed that the top-level VMMS Operator and the Head of Service Centre / Operations Admin are separate roles. The Operator manages VMMS account lifecycle: create, update, suspend and review user accounts through the approved shared-identity flow. The Head combines Operations Admin duties, oversees the service-centre site, assigns work to eligible Team Leads, and assigns employees to existing effective VMMS role profiles. The Head does not create or suspend central identity accounts. The Operator does not receive Operations review or job-allocation authority from account administration.

The VMMS-side account states, command boundary, worker handoff, bootstrap limits and verification cases are defined in the [Operator account administration contract](operator-account-administration.md). The cross-repository request/response, idempotency and enrollment lifecycle are in the [shared-auth provisioning contract](shared-auth-provisioning-contract.md), with the selected service design in [shared-auth provisioning](shared-auth-provisioning.md). The owner approved a private VMMS-only API and isolated staging implementation with a 24-hour invitation and at most one resend. Production delivery, enrollment and provisioning remain gated by staging evidence and review of the exact production operation. The design keeps Keycloak administration behind the shared identity service and does not expose provisioning credentials to VMMS browsers or normal API requests.

VMMS now has a synthetic-tested worker module and a dedicated database capability for leased account-request processing. There is still no configured shared-auth adapter or long-running worker process; no real identity or invitation can be created through this slice. The auth repository still lacks the staging provisioning service. Production identity-service endpoints, service authentication and enrollment delivery remain open.

Neither role may edit role permission definitions, approved policies, technical/inspection/release/financial sign-off grants, or the shared identity provider's administration settings. Role assignment and account lifecycle changes must be attributable and audited. The Head/Operator role split and role assignment rules are recorded in `docs/architecture/workforce-organogram.md`; the authority to edit role profiles or publish controlled documents remains open under REV-041. Build role definitions and synthetic test accounts, not named-person production accounts.

Google linking is deliberate and account-bound. Do not auto-link by email. Existing local accounts gain an immutable central subject through a controlled migration or a fresh-authenticated proof of both accounts. Preserve a product's local account UUIDs and actor references; no current prototype data migration is required.

## Runtime and availability

Keycloak and PostgreSQL require persistent runtime/storage; production setup includes a fixed public hostname, TLS, trusted reverse-proxy configuration, private administration access, database backup/restore, health checks, monitoring, patching and an outage/recovery procedure. Store secrets in the selected host's secret manager. The auth repository's `DEPLOYMENT.md` documents Railway and Cloudflare DNS as current configuration, but those claims have not been independently verified here and conflict with the status in `docs/architecture.md`. The auth repository also reports a possible live database credential in ad hoc scripts; see REV-056. Do not use production authentication until the owner/operator verifies the deployment, rotates any exposed credential and confirms the VMMS client registration.

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

The separate auth project provides the approved Raymond Gray Keycloak sign-in theme, using inherited provider templates and existing workshop/logo assets. Its 11-profile responsive preview is recorded in [the theme verification](../verification/checks/shared-auth-theme-2026-11-11.md). A disposable local Keycloak/PostgreSQL project also verified realm discovery survives a Keycloak restart and that its database volume, network and containers are removed after the check; this is not backup/restore or production evidence ([persistence check](../verification/checks/shared-auth-persistence-2026-11-11.md)). Google provider setup, production client registration, central logout, credential hygiene and production readiness remain open.

## Owner review items

## Current implementation evidence

VMMS is the first local OIDC relying party. The integration flow and its exact protocol boundary are described in [`oidc-vmms-integration.md`](oidc-vmms-integration.md); provider discovery, the synthetic authorization-code HTTP flow, API test results, and remaining gaps are recorded in [`oidc-local-2026-11-14.md`](../verification/oidc-local-2026-11-14.md). The RP-initiated logout design is synthesized in [`candidates/oidc-rp-logout-synthesis.md`](candidates/oidc-rp-logout-synthesis.md), with local API evidence in [`oidc-rp-logout-2026-11-14.md`](../verification/oidc-rp-logout-2026-11-14.md). Local passkey enrollment and conditional passwordless login are recorded separately in [`shared-passkey-local-2026-11-08.md`](../verification/shared-passkey-local-2026-11-08.md). This is a development slice only. Google federation, physical-device/browser coverage, provider-driven logout delivery and production client registration remain unverified.

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
