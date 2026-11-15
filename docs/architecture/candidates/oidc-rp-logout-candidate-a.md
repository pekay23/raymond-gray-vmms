# Candidate A: Complete the VMMS browser logout round trip

## Proposal

Use an authenticated, CSRF-protected server command as the single entry point for “Sign out”. It revokes the selected VMMS session first, then redirects the browser to the configured provider's RP-Initiated Logout endpoint. The provider returns through a fixed API callback and the browser lands on the existing `/signed-out` page. A discovery or provider failure still leaves the local session revoked and returns the user to the signed-out page with a clear “VMMS signed out; provider sign-out unavailable” status.

Remove the current GET `/api/v1/auth/oidc/logout?iss=…&sid=…` behavior. `sid` is not a logout credential. Do not substitute it into an RP-Initiated Logout request or treat it as a signed back-channel logout event. Provider-initiated logout remains exclusively the signed `/api/v1/auth/oidc/backchannel-logout` path.

## Caller flow

```text
Staff or owner clicks Sign out
  -> POST /api/v1/auth/oidc/logout/{staff|owner} with same-origin Origin + VMMS CSRF token
  -> server requires the matching active local audience session
  -> server revokes that VMMS session and clears its cookie immediately
  -> server creates a random one-time state and a short-lived signed HttpOnly cookie
  -> server constructs provider URL from configured issuer discovery:
       client_id=VMMS client
       post_logout_redirect_uri=exact configured API callback
       state=random value
  -> browser navigates to provider URL
  -> provider redirects to exact callback with state
  -> callback validates and consumes its audience-specific state cookie
  -> callback clears that cookie and redirects to fixed WEB_ORIGIN/signed-out
```

The `staff` and `owner` actions use distinct route/cookie names and only revoke the matching app session. They must not clear or revoke the other audience implicitly. The post-logout callback may be shared if the state cookie identifies and validates the audience; separate callbacks are also acceptable if they simplify routing.

## Proposed boundary and signatures

Keep app-session deletion in the existing owner and staff identity modules. Add a narrow provider operation to the existing OIDC provider boundary, or a focused module with equivalent behavior:

```ts
type LogoutAudience = 'staff' | 'owner';
type LogoutStart = { audience: LogoutAudience; state: string; callbackUrl: URL };

interface OidcProvider {
  createLogoutUrl(input: LogoutStart): Promise<URL>;
}

function beginOidcLogout(input: {
  audience: LogoutAudience;
  request: FastifyRequest;
  reply: FastifyReply;
  pool: Database;
  config: Config;
  provider: OidcProvider;
}): Promise<URL>;

function completeOidcLogout(input: {
  audience: LogoutAudience;
  state: string;
  request: FastifyRequest;
  reply: FastifyReply;
  config: Config;
}): void;
```

Parse `state` at the route boundary. Require a strict high-entropy format. Create the provider endpoint from verified discovery data and a fixed callback derived from `WEB_ORIGIN`/configured API origin, never from query or form input. Use the OIDC client ID plus the exact registered `post_logout_redirect_uri`; do not persist or send raw ID/refresh tokens. Validate discovery issuer exactly and accept only HTTPS metadata endpoints outside the explicit loopback development environment.

The state cookie should be audience-specific, HttpOnly, Secure in production, SameSite=Lax, host-only, `Path` limited to the callback, and have a short max age (for example five minutes). Bind its cookie name to a digest of state as the login callback already does, sign it with the application cookie secret, compare the returned value in constant time, then clear it. A fixed destination (`WEB_ORIGIN/signed-out`) avoids open redirects. If multiple simultaneous logout tabs must be supported, the state-derived cookie name avoids a shared-cookie overwrite.

## Grounded current behavior

- `apps/api/src/app.ts` has the existing GET route at lines 132–164. It accepts `iss` and `sid`, checks `iss` against the configured issuer, discovers `end_session_endpoint`, and redirects using a hard-coded `/signed-out` return URI plus the caller-supplied `sid`. It does not verify that the requesting browser owns that session or revoke any VMMS session.
- Staff logout is `DELETE /api/v1/session` -> `logout()` in `apps/api/src/identity.ts`; owner logout is `DELETE /api/v1/owner/session` -> `logoutOwner()` in `apps/api/src/owner-identity.ts`. Both require CSRF and revoke app-local sessions, but do not initiate central logout.
- The auth-code provider implementation and issuer discovery are in `apps/api/src/oidc-client.ts`; the `OidcProvider` is currently injected into `createApp()` for local tests.
- `docs/architecture/oidc-session-revocation.md` requires app-local logout followed by provider logout with server-generated return URL and disallows raw provider tokens. Back-channel revocation is independently signed and verified in `apps/api/src/oidc-logout.ts`.

## Acceptance and verification

1. A staff sign-out and owner sign-out each revoke only their own local session before redirecting.
2. Missing/invalid CSRF, wrong audience, inactive session, malformed state, absent/mismatched state cookie, replayed callback, expired cookie, and wrong callback path are rejected or end safely on the fixed signed-out page; none authenticates the user.
3. Caller-supplied `iss`, `sid`, `client_id`, callback, and return URLs are ignored or rejected. No untrusted URL is fetched; no caller value can choose the redirect destination.
4. Provider discovery is exact-issuer checked and bounded by timeout; provider failure does not restore the revoked VMMS session.
5. The provider URL carries the VMMS client ID, exact callback and state, and contains no raw ID/refresh token. Unrelated staff/owner sessions remain valid.
6. Local Keycloak configuration has the exact API post-logout callback registered for `vmms-web-dev`; verify sign-out/account switching in a browser without manually clearing provider cookies. Keep production client registration and live provider behavior pending under REV-056.
7. Continue the signed back-channel tests and verify the removed unsigned `sid` route cannot revoke or trigger logout for another browser.

Suggested checks: `npm run typecheck --workspace @vmms/api`; focused `oidc-client`, `foundation` logout tests on the non-owner PostgreSQL role; and the isolated browser OIDC/passkey flow. Record the exact Keycloak callback registration and browser evidence before updating IDP-005. Passing those checks does not verify Google, physical authenticators, or production operations.

## Rationale and rejected alternative

This keeps one browser sign-out command clear for staff and owners while making the immediate security guarantee local: VMMS access ends before any external redirect. The identity-provider protocol remains behind the already-injected OIDC provider boundary and can be exercised with a synthetic issuer. A second unauthenticated GET route that trusts `sid` was rejected because a browser query parameter cannot prove a provider logout event or a user's right to terminate a session. Storing the raw ID token solely to populate `id_token_hint` was rejected because it expands token-at-rest risk; Keycloak's client-ID-based logout request can be evaluated against the registered client contract without storing provider tokens.
