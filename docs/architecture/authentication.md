# Shared identity and application authentication

Status: recommended shared-identity baseline recorded 8 November 2026. The earlier VMMS-local Better Auth proposal is superseded because the owner requested one sign-in service shared by Raymond Gray applications. Keycloak is the local implementation candidate; production provider operations, external credentials and DNS are not configured.

## Decision

Build the shared identity service in `C:\Projects\raymond-gray-auth` and serve its eventual production sign-in origin at `https://auth.raymond-gray.org`. Keycloak is the recommended standards-based OpenID Connect identity-provider candidate. Applications use Authorization Code Flow with PKCE S256 and exact registered redirect URIs. No application receives a user's password. VMMS, platform, remote support and vehicle services each keep their own local account/access records and create their own first-party sessions.

Keycloak is recommended as the current implementation candidate because it supports OpenID Connect, Google identity brokering and WebAuthn passkeys in one self-hostable service. This avoids building an identity provider and custom passkey protocol. The owner has not selected a production identity host or accepted its operational obligations. Reconsider if a documented operational or licensing assessment shows it cannot meet our needs. It does not remove the need for secure hosting, database backups, upgrades, monitoring and incident response.

## Identity and authorization boundary

The identity provider proves control of an authentication method and supplies a stable `(issuer, subject)` pair. It does not decide what a person may do in any Raymond Gray product.

Each application must:

- map `(iss, sub)` to its own internal identity record using a unique constraint;
- validate issuer, audience, signature, expiry, nonce, state and PKCE through a maintained OIDC library;
- create an app-origin, HttpOnly, Secure, host-only session after the server completes the OIDC callback;
- keep provider tokens server-side; do not expose refresh/access tokens to browser JavaScript;
- check application-specific active status, approved audience, site membership, customer relationship and permission on each protected operation;
- invalidate its own sessions promptly when its access record is revoked, and process central logout/revocation events where configured;
- avoid reading or writing the identity provider's database directly.

Do not use email, username, Google Workspace domain, Keycloak group, display name or role claim as a cross-application identity key or a grant of business access. Email is a verified contact attribute. Account linking requires explicit proof of both identities or a reviewed administrator procedure; matching email alone never links accounts.

## Shared sign-in behavior

- Canonical sign-in hostname: `auth.raymond-gray.org`.
- Identifier and password remain available as a fallback. Google is the primary federated option when its provider credentials are configured.
- Passkeys are offered through Keycloak WebAuthn passwordless authentication. User verification is required. Support platform authenticators and roaming security keys.
- Production passkey RP ID is exactly `auth.raymond-gray.org`, with origin `https://auth.raymond-gray.org`. Development and staging use their own exact origins and credentials; do not set the VMMS relying-party host as the shared identity RP.
- No public self-registration. Enrollment is invitation/provisioning based. A central identity can exist without access to an individual application.
- A signed-in central SSO session may make later application redirects seamless, but each application still establishes and revokes its own session.
- Each app uses a distinct confidential server-side OIDC client for web BFF flows, and distinct public clients only for future native apps. Never share client secrets between projects or OS targets.
- Configure exact callback and post-logout URIs per environment. Use separate development, staging and production realms/clients; do not register wildcard preview domains.
- Keep shared-device sign-out visible. Central sign-out and app-local sign-out behavior must be specified and tested independently.

## Web, local and native clients

For VMMS web, use a server-side BFF: the browser redirects to the central provider, the VMMS server validates the callback, and the browser receives only the VMMS session cookie. The current web-first launch does not need a separate local Windows identity database or offline credential sync. Saved drafts remain app data and are bound to the signed-in VMMS identity.

Windows/macOS desktop shells and iOS/iPadOS, Android and HarmonyOS apps must use system-browser OIDC with Authorization Code + PKCE. They use the platform secure credential store for app refresh credentials, never an embedded webview or a shared cross-platform client secret. Select native frameworks and distribution only after the device and operational requirements are measured. Browser access remains the baseline where a native package is not justified.

## Provider and protocol security

- Google login is brokered by Keycloak. Use only OpenID Connect identity scopes required for sign-in. Do not request Drive, Calendar or unrelated Google API scopes.
- Do not automatically link an existing local identity to a Google identity because their emails match. Require an already authenticated session or explicit proof of the existing account.
- Keycloak user self-registration is disabled. Avoid a generic auto-link first-broker-login flow.
- Enforce WebAuthn user verification and exact RP ID/origin. Require recent reauthentication to enroll, remove or recover authenticators.
- The OIDC clients must use state, nonce and S256 PKCE. Never use implicit or password grant. Reject tokens with wrong issuer/audience, invalid signature, stale expiry, reused state/nonce or wrong callback.
- Do not embed VMMS safety/financial approvals, staff roles, customer-vehicle access or site memberships into a global identity token.
- Do not configure production domain forwarding, real credentials, email delivery, public ingress or Cloudflare DNS as part of a local scaffold.

## Platform auth assessment

The platform implementation is a useful feature inventory, not an identity-service foundation to copy wholesale. It has an application-local NextAuth credentials bridge that stores role, approval status and app identifiers in its session token; the sign-in actions validate local password hashes, account approval and TOTP; and the UI has passkey and two-factor affordances. Those are workflows the app can retain through the shared provider and its own local authorization.

The custom passkey completion path in `src/app/api/auth/passkey/login-verify/route.ts` reads a matching login challenge then deletes it as a separate database operation before the credentials bridge consumes it. That is not an atomic single-use transition. Its WebAuthn verification config sets `requireUserVerification:false`. Do not port that challenge protocol, token exchange, or global role-bearing session. Replace the app's authentication adapter with OIDC while retaining the platform's own role/status checks against its own records. Its 2FA/TOTP behavior requires a separate decision because central passkeys and the identity provider's MFA policy may make duplicated app-local MFA unnecessary.

The vehicle-services `proxy.ts` contains a placeholder that always treats protected access as unauthenticated, and remote-support's focused codegraph query did not identify a working auth flow. No claim of a complete auth audit is made for those repositories. Integrate each project only after tracing its actual protected routes and documenting local authorization requirements.

## Service operations and deployment gate

The auth service is a critical shared dependency. Production requires a persistent Keycloak runtime, supported managed PostgreSQL, encrypted backups with a tested restore, HTTPS, a fixed external hostname, correctly overwritten proxy headers, restricted administration endpoints, monitoring/alerting, upgrade rehearsal, emergency account recovery and a documented outage procedure. Establish recovery objectives and availability expectations before choosing a host. A marketing/site deployment target is not presumed to be suitable for the identity service.

Local development uses an isolated Keycloak 26.8.2/PostgreSQL 18.1 compose stack and synthetic-only identities. Its first-start and master-realm discovery smoke result is recorded in [`raymond-gray-auth`](../../../raymond-gray-auth/docs/verification/local-compose-2026-11-08.md); this does not prove the planned closed development realm, passkey policy, Google broker or a VMMS callback. Production credentials, Google client secrets and administrator bootstrap passwords must come from a managed secret store and must never be committed or printed. Do not connect to the platform's live database or inspect its `.env` just to build this identity service.

## Migration sequence

1. Build and document the standalone identity service and its client registration contract using local synthetic identities.
2. Prove a minimal OIDC relying-party integration in VMMS while preserving app-local access rules and the existing synthetic staff workflow.
3. Integrate platform behind a staged flag, preserving its local user/role/status records and mapping them with `(issuer, sub)`; there are no prototype records that need migration.
4. Integrate remote support and vehicle services only after their access boundaries and protected routes are inventoried.
5. Exercise login, logout, account linking, suspension, session expiry, callback tampering, passkey enrollment/revocation and shared-device behavior in each client.
6. Review hosting, restore, Google configuration, enrollment ownership, email/recovery, domain and monitoring before any production deployment.

No production rollout, credential migration or DNS change is implied by this decision.
