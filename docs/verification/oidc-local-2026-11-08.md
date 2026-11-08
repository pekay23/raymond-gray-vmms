# VMMS local OIDC verification

Date: 8 November 2026  
Scope: local development provider and synthetic VMMS staff identity only.

## Evidence

- OIDC discovery against the local Keycloak realm completed successfully with the configured issuer and `vmms-web-dev` client.
- The automated HTTP flow followed VMMS start → Keycloak credential form → authorization-code callback → VMMS session. It reported `browser_redirect_chain=passed`, an authenticated VMMS session, and one authorised synthetic site.
- The first smoke attempt exposed a Python `CookieJar` host-only-cookie behavior for `localhost`; the harness was corrected to preserve the browser cookies. Keycloak was not the source of that failure.
- `npm test --workspace @vmms/api`: 18/18 tests passed, including concurrent login tabs, binding-cookie mismatch, replay rejection, unmapped identity denial, and site authorization.
- `npm run typecheck --workspaces --if-present`: passed.
- `npm run build --workspaces --if-present`: passed; the web build regenerated and verified 20 workshop image outputs.
- `npm run docs:check`: passed with 237 requirements, 564 tasks, and 350 source blocks.
- A read-only accessibility-tree inspection of the running web app showed the branded service-centre portal, descriptive sign-in guidance, one clearly labelled “Continue to secure sign-in” action, and administrator access guidance. No credentials were entered.

The HTTP smoke test exercises the real local OIDC provider and VMMS callback, but it is not a rendered browser UI test. Credentials and client secrets are synthetic and stored in ignored local environment files; command output contains no secret values.

## Not yet proven

- Google broker configuration or Google sign-in.
- Passkey enrollment/sign-in through the exact VMMS callback: this is covered separately by [`shared-passkey-local-2026-11-08.md`](shared-passkey-local-2026-11-08.md), which exercises the VMMS UI, callback, and local session using a virtual authenticator.
- Production HTTPS, provider/client registration, proxy configuration, central logout, secret management, backup/restore, monitoring, or deployment.
- Full browser-rendered sign-in interaction or cross-device responsive behavior.
- Production denial cases for wrong issuer/audience/signature, expired tokens, callback mismatch, provider outage, and multi-instance rate limiting.

Therefore `IDP-002` remains **in progress**. The local implementation and flow are evidence for a development slice, not production readiness or completion of the shared authentication rollout.
