# Shared-auth MFA assurance at the VMMS relying party

Date: 18 November 2026. This is a local implementation check for the Vercel/Neon Better Auth evaluation. It does not alter the currently configured issuer, deploy VMMS, or certify production readiness.

## Change

The VMMS OIDC client now requests `acr_values=urn:raymond-gray:auth:mfa` when `OIDC_REQUIRE_MFA_ASSURANCE=true`. After `openid-client` verifies the token signature, issuer, audience, nonce, expiry and callback transaction, VMMS also requires the signed ID token to contain that exact `acr` and an `amr` entry of `mfa`.

The configuration defaults to the existing local-development behavior. Staging and production startup reject configurations that do not set `OIDC_REQUIRE_MFA_ASSURANCE=true`. Production startup remains blocked by the pre-existing identity, deployment and ingress readiness gate.

Changed implementation files:

- `apps/api/src/config.ts`
- `apps/api/src/oidc-client.ts`
- `apps/api/src/cloudflare-spike.ts` (synthetic test configuration)
- `apps/api/test/config.test.ts`
- `apps/api/test/oidc-client.test.ts`
- `apps/api/test/evidence.test.ts`
- `apps/api/test/foundation.test.ts`
- `apps/api/test/support/evidence-browser-runtime.ts`

## Verification

`npm exec --workspace @vmms/api -- tsx --test test/config.test.ts test/oidc-client.test.ts` passed all 9 tests. The cases cover the staging configuration gate, request of the MFA authentication class, acceptance of valid signed MFA claims, rejection of missing or insufficient claims, and the existing issuer, audience, nonce, expiry, signature, state, PKCE and logout checks.

`npm run typecheck --workspace @vmms/api` passed after the config and OIDC changes.

## Hosted preview client

The isolated Neon evaluation branch now has a confidential client named `Raymond Gray VMMS local preview`. Its client ID is stored in the ignored local config `apps/api/.env.shared-auth-preview.local`; the secret is stored only in that file. It uses `client_secret_basic`, S256 PKCE, the exact local callback and logout URIs, and a consent prompt. Better Auth accepts loopback HTTP only under its native redirect policy, so this temporary local-test client is marked `application_type=native` while remaining confidential. It has no HTTP back-channel logout URI; that field requires HTTPS. Do not reuse this local client for production.

The live authorization endpoint accepted the registered callback and sent the request to the sign-in page. A request using an unregistered callback returned `invalid_redirect`. This proves registration and redirect allowlisting, not an end-to-end login.

## Limits and next integration step

The Better Auth preview's live discovery document advertises the MFA authentication class, and its synthetic Neon tests verify MFA claims. VMMS has not yet completed an end-to-end OIDC transaction against the hosted preview. Vercel Authentication protects the preview; the VMMS server's token exchange is server-to-server, so it still needs an approved local test access path before the complete browser flow can run. The live Google OAuth redirect has also not been completed. Do not change the production issuer or DNS based on this check.

Next: complete the protected-preview server-to-server path and exercise login, MFA, consent, callback, local session creation and logout using a disposable synthetic identity. For production, register a separate confidential `application_type=web` client only after the VMMS callback is deployed over HTTPS, configure its exact back-channel logout URI, and verify revocation. Preserve the existing Keycloak client and issuer until the whole path and revocation behavior pass review.

## Hosted shared-auth integration follow-up

The auth Preview was refreshed at `https://raymond-gray-auth-c7i8fdzx5-pekay23s-projects.vercel.app` and is protected by Vercel Authentication. The synthetic hosted flow passes password/MFA and reaches consent, but the auth consent-details signature check returns HTTP 400. No authorization code or VMMS session was obtained. This remains an open integration blocker; local API tests and typecheck passing do not prove hosted OIDC completion. Recheck consent-query verification against the live preview before marking shared-auth UAT complete.
