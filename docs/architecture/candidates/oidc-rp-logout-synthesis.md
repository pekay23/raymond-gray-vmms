# VMMS RP-initiated sign-out synthesis

## Selected shape

Use a CSRF-protected VMMS server command to clear the current browser's staff and vehicle-owner sessions, then redirect the browser to the shared Keycloak end-session endpoint. The browser's visible sign-out action already means “sign out of this browser”; keeping the existing all-session behavior avoids leaving a second VMMS audience active on shared workshop devices. The separate audience DELETE routes remain local-only escape hatches.

The return is always to the one configured `OIDC_LOGOUT_CALLBACK_URL`. A five-minute database transaction stores only hashes of random state and browser binding plus a fixed destination enum. A signed, host-only, HttpOnly, SameSite=Lax cookie binds the browser to the state. The callback atomically consumes the transaction and can route only to `/signed-out`, `/?audience=staff`, or `/?audience=owner`.

`openid-client` constructs the end-session URL from the discovered provider configuration with `client_id`, exact `post_logout_redirect_uri`, and random state. VMMS does not store or send a raw ID or refresh token. The returned provider URL is checked for exact issuer origin and exact parameter set. Local session revocation commits before metadata-dependent logout work; when discovery fails, the response still confirms local sign-out and the UI opens the signed-out page with a central sign-out warning.

## Candidate and review record

- Candidate B is the base because its database transaction follows VMMS's existing OIDC login state pattern and provides atomic one-use callback consumption.
- Candidate A's clearer provider-outage behavior is included: VMMS access is already revoked and the user sees that central sign-out could not be confirmed.
- Candidate B's per-audience route selection was adapted to the existing “sign out of this browser” behavior. One action revokes both local VMMS audience sessions; the finite server-owned callback destination supports the existing staff/owner account switch links.
- The unsigned `GET /api/v1/auth/oidc/logout?iss=...&sid=...` route was removed. Provider-initiated revocation remains exclusively on the signed back-channel Logout Token endpoint.
- Storing raw ID tokens for `id_token_hint`, trusting an unsigned `sid`, or accepting request-supplied return URLs were rejected.

The independent scorecard is in [the cross-judge review](oidc-rp-logout-cross-judge.md); full alternatives are in [Candidate A](oidc-rp-logout-candidate-a.md) and [Candidate B](oidc-rp-logout-candidate-b.md).

## Verification state

API/PostgreSQL tests cover CSRF denial, rejecting the removed GET route, invalid destinations, staff and owner session revocation, exact client and callback parameters, cookie-bound state, one-use replay rejection, fixed callback routing, and provider failure after local revocation. OIDC client unit tests verify URL construction from discovery. The web app typecheck and production build pass.

The local Keycloak stack reported healthy, but the local client registration script failed without exposing a safe HTTP error code. Therefore exact post-logout registration and a real Keycloak browser round-trip remain unverified. No production issuer, DNS, provider configuration or credentials were accessed or changed.
