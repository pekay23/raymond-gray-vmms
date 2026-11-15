# VMMS shared OIDC integration

Status: implementation design with local VMMS sign-in verified 14 November 2026. Local Keycloak is the only provider tested end-to-end by VMMS. An unauthenticated production preflight verified issuer discovery and that Keycloak accepts the exact VMMS authorization callback while rejecting an unlisted redirect. Full production sign-in/callback/logout, VMMS API runtime and operational recovery remain unverified; see [preflight evidence](../verification/oidc-production-preflight-2026-11-14.md) and REV-056. Do not infer production readiness from redirect validation.

## Scope and boundaries

VMMS delegates credential entry and primary authentication to the shared identity service. VMMS remains the authority for its local staff account, approval state, site membership, work permissions, and app session. The web browser receives only the opaque VMMS session cookie. No provider token or email becomes an authorization key.

This is a web BFF flow. Native clients will use separate public OIDC clients, system browsers, PKCE, and OS credential storage when native rollout is scheduled.

## Flow

1. The sign-in page navigates to `GET /api/v1/auth/oidc/start`.
2. VMMS creates cryptographically random state, nonce, PKCE verifier, and a separate browser-binding secret. It stores only hashes of state and browser binding, and stores the short-lived nonce/verifier with a five-minute expiry in `oidc_login_transactions`. A unique callback-path HttpOnly SameSite=Lax cookie binds this flow to the initiating browser; its name is derived from a prefix of the random state so multiple tabs do not overwrite one another.
3. VMMS redirects to the discovered authorization endpoint for the exact configured issuer/client/callback, requesting only `openid profile email`, with `response_type=code`, state, nonce, and PKCE S256 challenge.
4. `GET /api/v1/auth/oidc/callback` validates the state shape, requires the matching browser cookie, and atomically consumes the unexpired state row once. The callback URL passed to the OIDC library is built from the configured exact callback URI plus provider query parameters; it does not trust the incoming Host or forwarded-host header.
5. A maintained OIDC library exchanges the code and validates issuer, audience, signature, expiry, nonce, state, redirect, and PKCE. VMMS reads the verified `iss` and `sub` only; the displayed name comes from the mapped VMMS staff row.
6. VMMS resolves the exact `(issuer, subject)` to a product-local staff identity mapping. There is no account creation, email matching, or auto-linking. An unmapped, inactive, or unapproved VMMS account is denied.
7. VMMS rotates/creates its existing opaque eight-hour server-side session. Existing membership and site authorization are evaluated on every protected request. Provider tokens are discarded after identity resolution and are never returned to the browser.
8. Sign-out always invalidates the VMMS session. Central RP-initiated logout, its exact allowlisted return URL, and provider-session behavior remain an explicit follow-up under `IDP-005`; identity-token hint storage is not introduced unless an interoperability test proves it is required.

## Type and module sketch

```ts
type LoginStart = { authorizationUrl: URL; flowCookie: { name: string; value: string } };
type VerifiedSubject = { issuer: string; subject: string };
type LoginResult = { kind: "authenticated"; session: SessionView } | { kind: "denied" };

interface OidcClient {
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): Promise<URL>;
  exchange(input: { callbackUrl: URL; state: string; nonce: string; codeVerifier: string }): Promise<VerifiedSubject>;
}

interface LoginTransactionStore {
  create(input: { stateHash: string; browserHash: string; nonce: string; verifier: string; expiresAt: Date }): Promise<void>;
  consume(input: { stateHash: string; browserHash: string; now: Date }): Promise<{ nonce: string; verifier: string } | undefined>;
}

interface LocalIdentityStore {
  findActiveStaff(input: { issuer: string; subject: string }): Promise<{ id: string; displayName: string } | undefined>;
  rotateSession(input: { staffId: string; previousToken?: string }): Promise<{ token: string; view: SessionView }>;
}

interface OidcLoginService {
  start(): Promise<LoginStart>;
  callback(input: { query: URLSearchParams; state: string; browserBinding: string }): Promise<LoginResult>;
}
```

- `oidc-client.ts` owns exact-issuer discovery, authorization URL construction, and validated code exchange using `openid-client`.
- `oidc-login.ts` owns state creation, browser binding, transaction consumption, identity mapping, and local session issuance.
- `identity.ts` keeps current local session lookup, CSRF validation, logout, and `authorisedScope`; password verification is not used by development/production web sign-in.
- `app.ts` registers the two redirect routes and keeps existing site-guarded API routes unchanged.
- A versioned SQL migration adds the one-time OIDC login transaction table and `(issuer, subject)` staff identity mapping. Runtime grants are limited to the required lookup and transaction operations; no new product roles are placed in Keycloak.

## Security invariants

- Configured issuer is exact and HTTPS outside explicit local development. Discovery is from that issuer only; no request-controlled issuer, callback, token endpoint, or redirect URI.
- `openid-client` performs protocol/token validation. Authorization Code + PKCE S256 is required; implicit and resource-owner password grants are not used.
- The discovered client enables `openid-client` non-repudiation checks before code exchange. This verifies the ID-token signature against the configured issuer's JWKS; parsed claims alone are not identity proof.
- Login state is high-entropy, stored as a hash, browser-bound, expires after five minutes, and is consumed atomically exactly once. Validate the matching browser cookie before consuming the transaction. The binding cookie uses Secure in production, HttpOnly, SameSite=Lax, callback-only path, and no Domain attribute.
- A callback from another browser, invalid state, provider error, replay, expiry, issuer/audience/signature/nonce/PKCE failure, or unmapped/suspended local identity cannot create a VMMS session.
- OIDC errors return a generic sign-in failure; do not echo authorization codes, state, tokens, provider error descriptions, or secrets into logs or response pages.
- The existing VMMS session cookie remains host-only, signed, HttpOnly, Secure in production, SameSite=Strict, and bounded to eight hours. Unsafe app requests retain exact-origin CSRF checks.
- Email, usernames, Google hosted-domain claims, and provider groups do not establish identity or authorize VMMS access.

## Verification plan

1. Type-check and unit-test state hashing, cookie naming/validation, callback construction, and issuer/subject mapping boundaries.
2. API integration tests cover state replay/expiry, wrong browser cookie, nonce/PKCE validation failures, provider errors, unapproved/inactive local mapping, session rotation, CSRF logout, and unchanged site authorization.
3. A real local Keycloak client and synthetic account prove the authorization-code path and exact VMMS callback through the local HTTP smoke harness. A separate Playwright virtual-authenticator check proves the provider's passkey enrollment and passwordless authorization-code path; neither is a production or physical-device check.
4. The local security gate is recorded in `docs/verification/checks/oidc-protocol-denials-2026-11-09.md`: wrong issuer, audience, signature, expiry, state, code replay, nonce, PKCE, redirect mismatch, and provider outage are denied; callback state replay, cross-browser binding, local account disablement, local logout revocation, and site authorization are also tested. Google linking, passkey user verification, and production revocation/configuration remain open.
5. Production remains blocked pending HTTPS client registration, secret management, Google broker, physical-device passkey coverage, central logout, deployment/recovery, and owner review.

## Design synthesis

The selected base is a short-lived PostgreSQL transaction table. It provides atomic one-time consumption and operationally inspectable expiry while fitting the existing VMMS server-side session store. From the encrypted-cookie alternative, retain the per-flow unique cookie name and explicit browser binding so parallel tabs work without cookie clobbering. Reject cookie-only storage because key rotation, cookie parsing, replay prevention, and flow invalidation would require bespoke crypto/state logic already provided by the database and maintained OIDC library. The database stores the PKCE verifier only for five minutes; restrict table access to the API runtime and clean expired rows opportunistically or by scheduled maintenance.

## Reference

- Shared OIDC client contract: `C:\Projects\raymond-gray-auth\docs\oidc-client-contract.md`.
- [`openid-client` authorization-code API](https://github.com/panva/openid-client/blob/main/docs/functions/authorizationCodeGrant.md)
- [`openid-client` release history](https://github.com/panva/openid-client/releases)
