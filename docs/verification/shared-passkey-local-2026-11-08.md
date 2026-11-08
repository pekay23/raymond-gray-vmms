# Shared identity passkey verification

Date: 8 November 2026. Scope: local synthetic Keycloak account and local browser virtual authenticator.

## Result

- Ran `npm ci` and `npm run test:passkey` from `C:\Projects\raymond-gray-auth` with local Keycloak, VMMS API and VMMS web development server healthy.
- Playwright 1.65.0 launched its isolated Chromium build and attached a CTAP2 internal virtual authenticator with resident-key support and user verification enabled.
- Starting from the VMMS sign-in button, the test authenticated the synthetic `vmms.advisor.local` account with its local password, completed Keycloak's WebAuthn passwordless required action, followed the real VMMS OIDC callback and verified an authenticated VMMS session with an authorised site.
- The browser cookies were cleared and VMMS local logout was performed. A fresh VMMS authorization request then completed through conditional passkey sign-in without submitting the password again, followed the VMMS callback and created a new authorised VMMS session.
- The test verified one discoverable resident credential, revoked each VMMS session through the app logout route, deleted its synthetic passkey, restored the account's required actions, and asserted cleanup. No OIDC callback or client registration was changed.
- `npm ci` and package-lock audit reported zero dependency vulnerabilities; `node --check scripts/smoke-local-passkey.mjs` passed.

The automation drives the real VMMS and Keycloak browser flows and WebAuthn ceremonies, but uses a software virtual authenticator. It proves local enrollment, a passwordless OIDC return through VMMS, and VMMS session issue/revocation. It does not prove behavior with a physical device, cross-device handoff, every browser/OS, or production authenticator policy.

## Remaining identity work

- Google federation and consent configuration.
- Physical platform and roaming-key checks across supported browsers/OSs, including recovery and revocation.
- Production issuer, HTTPS, secrets, administrative isolation, backup/restore, monitoring, deployment and outage drills.
- The separate HTTP OIDC smoke report retains additional callback/session evidence; the passkey browser test also covers the full local callback/session path.
