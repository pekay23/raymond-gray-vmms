# Candidate B: Server-owned one-post OIDC sign-out

## Shape

The browser submits one same-origin, CSRF-protected form POST to VMMS. VMMS revokes the selected local audience session, creates a short-lived one-use logout transaction, clears its session cookie, and responds with a `303` to the identity provider's discovered end-session endpoint. The identity provider then returns to one exact VMMS callback. A callback handler consumes the transaction and redirects to the fixed `/signed-out` page. This replaces the current unsigned `iss`/`sid` GET redirect route; provider-initiated session revocation remains the signed back-channel logout flow.

Staff and vehicle owners retain separate local logout actions and cookies. The user-visible control can say “Sign out” for either audience. The request path determines the audience; a body field cannot select which cookie is revoked.

## Browser/API use

```text
POST /api/v1/auth/oidc/staff/sign-out
  Origin: exact VMMS web origin
  X-CSRFToken: vmms_csrf
  Cookie: vmms_session, vmms_csrf

303 Location: https://auth.raymond-gray.org/.../protocol/openid-connect/logout
  ?client_id=vmms-web-<environment>
  &post_logout_redirect_uri=<exact callback>
  &state=<one-use random value>

GET /api/v1/auth/oidc/logout/callback?state=<same value>
  Cookie: vmms_oidc_logout_binding (host-only, HttpOnly, Secure in HTTPS,
                                    SameSite=Lax, scoped to callback)

303 Location: <configured WEB_ORIGIN>/signed-out
```

Owner sign-out uses a separate endpoint under `/api/v1/owner/` and verifies the owner CSRF/session cookie. If the browser is not logged in to the requested audience, it clears that audience's cookie and returns a harmless local signed-out page; it does not fabricate a provider session or choose a different account.

## Transaction and module sketch

- `oidc-client.ts`: expose a typed, validated way to obtain the provider's discovered `end_session_endpoint`; do not return a generic metadata bag to route handlers. Validate exact configured issuer and HTTPS outside local loopback development, reject URL credentials/fragments, and use bounded fetch timeout plus issuer-keyed cache.
- `oidc-logout.ts`: define `startRpLogout({ audience, session, request, reply, ... })` and `completeRpLogout({ state, binding, ... })`. Start consumes CSRF and revokes the local staff/owner session before redirecting. Callback accepts only `state`, validates the signed binding cookie, atomically consumes a matching, unexpired database transaction once, clears the transient cookie, and redirects to the configured fixed signed-out URL.
- Migration: add a narrow `oidc_logout_transactions` table and non-owner runtime functions. Store SHA-256 hashes of random state and browser binding, selected audience, created/expiry times, and consumed time. Do not store callback-controlled destination, raw ID token, provider access token, or refresh token. Creation and consumption are one-use and bounded-cleanup operations.
- Config: add one exact `OIDC_LOGOUT_CALLBACK_URL`. It must be HTTPS outside local development; require it to match the configured web/API host policy. Add that exact URI to each environment's provider client allowlist only through reviewed provider configuration. Never accept callback URL or return URL from the request.
- Provider request: use `client_id` plus exact `post_logout_redirect_uri` and random `state`; do not use unsigned `sid` or fabricate an `id_token_hint`. Confirm the deployed Keycloak version supports this parameter combination before environment registration. If it requires `id_token_hint`, redesign around a narrowly protected encrypted server-side token store with explicit retention and deletion review; do not silently persist raw ID tokens.
- Frontend: submit a real form navigation rather than `fetch`, so the browser follows the provider redirect. Show a local signed-out confirmation even when central logout cannot be reached; local session revocation is already complete. Offer a fresh sign-in link.

## Boundaries and failure behavior

1. Local session revocation is the primary security action and happens before any provider network round-trip. If discovery is unavailable, the user remains signed out of VMMS and sees a retryable central-sign-out notice; VMMS must not restore the local cookie.
2. A forged, replayed, expired, cross-browser or wrong-audience callback cannot consume a transaction. Callback state and binding are both random, one-use and short-lived. Cookie flags and callback path minimize exposure.
3. The logout redirect endpoint comes only from validated metadata for the configured issuer. The post-logout destination comes only from VMMS configuration. Do not construct redirects from `iss`, `sid`, `returnTo`, `next`, or `redirect_uri` query/body values.
4. The current `GET /api/v1/auth/oidc/logout?iss=...&sid=...` is not an authenticated RP logout: it accepts unsigned parameters and redirects without proving an IdP request or revoking a VMMS session. Remove it or reserve it for a separately specified, protocol-validated front-channel endpoint. Do not derive session authority from it.
5. Central provider logout may end the Keycloak browser session, but other products' app sessions end only when each product processes its own verified back-channel logout token or session expiry. UI copy should not claim global product-session revocation unless every relying party has verified that behavior.
6. Staff and owner cookies can coexist. Each local route clears only its own audience; provider logout may end the shared Keycloak browser session. Verify that account switching works after this flow without manually clearing provider cookies.

## Verification matrix

- PostgreSQL/non-owner API: staff and owner local session revocation before redirect; no cross-audience cookie deletion; missing or invalid CSRF/Origin denied; unauthenticated repeat is idempotent.
- Transaction security: wrong state, wrong binding cookie, expired state, replay, concurrent callback, audience mismatch, missing cookie and unexpected callback parameters are rejected; cleanup is bounded and cannot revive a transaction.
- Redirect security: request-supplied `iss`, `sid`, `next`, `returnTo` and callback URL cannot change the endpoint or return location; invalid issuer metadata, HTTP endpoint outside loopback, malformed endpoint, timeout and provider outage fail closed for redirects while preserving local logout.
- Browser/Keycloak: verify form navigation, back-button behavior, end-session registration, confirmation redirect, sign-in again without deleting IdP cookies, and separate staff/owner local cookies. Repeat against local Keycloak; record that this is not production evidence.
- Regression: signed back-channel logout remains the only provider-initiated mechanism that writes revocation barriers; replay and login/logout race tests continue to pass.

## Alternatives considered

- **Client fetches logout URL then navigates:** rejected because it splits one security-sensitive browser flow across JavaScript and can leave a revoked local session with no coherent provider redirect or callback state.
- **Trust the existing `iss`/`sid` GET route:** rejected because unsigned query values are not proof of provider identity or user intent, and the route does not revoke a local session.
- **Store raw ID tokens to supply `id_token_hint`:** rejected as the default because it expands credential retention and breach impact. Reconsider only if the actual Keycloak version requires it and a separately reviewed encrypted, short-retention design is accepted.
- **Use `client_id` without `id_token_hint`:** selected for the candidate because it avoids token retention, subject to local Keycloak version verification and exact provider registration.
- **Make local and central logout separate clicks:** rejected for the main user flow because it leaves a provider session active after the ordinary “Sign out” action; retain an explicit local-only escape only for provider outage handling.

## Rationale

One browser form and one callback keep the security boundary in the VMMS server while giving users a single sign-out action. Revoking local access before the redirect makes provider availability unable to prolong VMMS access. A database-backed one-use transaction gives auditable state consumption and avoids another bespoke cookie-only protocol. Keeping `client_id` logout token-free preserves the existing no-raw-provider-token boundary.
