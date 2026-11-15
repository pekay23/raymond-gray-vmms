# Production shared-auth preflight

Date: 14 November 2026\
Scope: unauthenticated checks of the production Keycloak discovery and VMMS authorization redirect. No credentials, admin API, user account, token exchange, or business data were used.

## Verified

- The selected issuer `https://auth.raymond-gray.org/realms/raymond-gray` returns OIDC discovery over HTTPS, and the issuer in the response matches the requested issuer.
- The authorization endpoint accepts the VMMS production client `vmms-web-prod` with the exact callback `https://vmms.raymond-gray.org/api/v1/auth/oidc/callback` and serves the sign-in page.
- The same client rejects an authorization request using `https://evil.example/callback` with HTTP 400.
- The unauthenticated master-realm admin API request returns HTTP 401. The public admin-console app shell is not evidence of admin access.
- The discovery and sign-in responses include transport and browser security headers, including HSTS and content-type protection.

## Not verified

- A real user sign-in, authorization-code exchange, VMMS callback, local account mapping, session creation, central logout, recovery, or account revocation against production.
- The production Google broker and passkey enrollment/passwordless flow for an actual account.
- VMMS production API configuration, database role/migrations, secret custody, hosting, monitoring, backup/restore, or a production deployment.
- Any other product's callback or client. Each product and environment must have its own reviewed client and exact redirect allowlist.

The VMMS API deliberately refuses production startup until its independent readiness gates are satisfied. Keep `IDP-005`, `IDP-006`, and `REV-056` open until the remaining checks have evidence. This preflight does not authorize production deployment or credential changes.
