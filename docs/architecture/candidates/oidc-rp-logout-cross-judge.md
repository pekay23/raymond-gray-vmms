# Cross-judge: VMMS OIDC browser sign-out

## Rubric and scores

Scores are 1 (weak) to 5 (strong), based on the proposals and current VMMS source.

| Criterion | Candidate A | Candidate B | Finding |
| --- | ---: | ---: | --- |
| Correctly separates RP-initiated logout from signed back-channel logout | 5 | 5 | Both remove authority from unsigned `iss`/`sid` input and preserve signed back-channel logout as the provider-initiated revocation mechanism. |
| Blocks open redirects and untrusted logout targets | 4 | 5 | Both require the configured issuer and fixed return destination. B more explicitly binds the callback URL to environment configuration and forbids query/body override. |
| One-use, browser-bound state for both audiences | 4 | 5 | A uses state-derived signed cookies. B adds an atomic, expiring database transaction and audience-specific routes, so concurrent callback replay can be rejected reliably. |
| Local VMMS access ends before provider availability can affect it | 5 | 5 | Both revoke the requested local session before discovery/redirect and preserve local sign-out if the provider is unavailable. |
| Small interface and understandable ownership | 4 | 4 | A’s cookie-only approach has fewer parts. B’s transaction adds schema work, but follows the existing database-backed OIDC login transaction pattern and gives explicit one-use semantics. |
| Exact environment callback and provider compatibility | 3 | 5 | A leaves callback derivation partly open. B requires a single configured exact callback and explicitly leaves provider allowlist registration to reviewed environment configuration. Both need local Keycloak proof that `client_id` without `id_token_hint` works. |
| Verifiable acceptance coverage | 4 | 5 | A has useful route and browser checks. B adds atomic replay, concurrent callback, bounded cleanup, separate audience, outage, and exact callback cases. |

## Recommendation

Use Candidate B as the base. The current login implementation already stores one-use OIDC transactions in PostgreSQL and consumes them atomically. Reusing that pattern for logout gives the clearest protection against concurrent callback replay and makes staff/owner intent explicit. Add Candidate A’s clearer user-facing provider-failure result: local VMMS sign-out remains complete, and the signed-out page should say that central sign-out could not be confirmed and offer a retry.

Candidate B’s route sketch should be implemented as an authenticated, CSRF-protected server command. A request path selects one audience; the command must prove the matching active session before revoking it. Preserve the separate local-only logout action as a fallback if provider logout is unavailable, and do not claim that this clears other Raymond Gray product sessions.

## Reject or defer

- Do not keep the current unsigned `GET /api/v1/auth/oidc/logout?iss=...&sid=...` behavior. It accepts a caller-controlled session identifier and does not prove an IdP request. The provider-signed back-channel endpoint remains the only provider-initiated session-revocation path.
- Do not store or send raw ID or refresh tokens merely to support logout. First verify the configured Keycloak version accepts the client-ID-based logout request with the exact registered post-logout URI. If it does not, stop and redesign under an explicit token-retention review.
- Do not attempt production client registration, DNS, deployment, or issuer validation as part of the local implementation.

## Current source grounding

`apps/api/src/app.ts` currently implements the unsigned `iss`/`sid` GET redirect and separate staff and owner DELETE logout routes. `apps/api/src/oidc-login.ts` already demonstrates database-backed, one-use transaction consumption for login. `docs/architecture/oidc-session-revocation.md` requires a fixed post-logout destination, separate local and central sign-out, and signed back-channel revocation.

## Verification gate

Before the implementation task can be marked verified, run API and database checks with the non-owner runtime role for both audiences, CSRF and wrong-audience denial, revocation-before-provider-failure, invalid/replayed/concurrent/expired state, cookie binding, exact callback and fixed destination, malformed or hostile provider discovery, and preservation of the other audience session. Run a local Keycloak browser check for sign-out and account switching without manually clearing IdP cookies. Record exact local callback registration and limits. Production registration, Google behavior, physical authenticators, and operational recovery remain separate launch work.
