# VMMS local shared sign-in recheck — 14 November 2026

## Result

The VMMS staff sign-in completed through the local shared Keycloak realm using the configured synthetic advisor identity. VMMS received a server-side staff session, and the same browser was able to sign out; a subsequent session read was unauthenticated. The credential was read from the ignored local environment file and was not printed or changed.

## Root cause found and corrected

The earlier local sign-in failure was after authentication, inside VMMS session construction. The development database had migrations applied only through `047_identity_runtime_least_privilege.sql`; current session code reads `sites.time_zone`, introduced by migrations 048 and 051. The missing column caused the session read to fail after OIDC returned from Keycloak. The configured `.env` issuer and VMMS callback were correct, and the local Keycloak realm was reachable.

Applied the outstanding local migrations through `075_restore_finance_configuration_read_audit_action.sql` using the repository migration runner. Both configured database URLs resolved to the loopback development PostgreSQL service (`127.0.0.1:55432`, database `vmms`); no production database, DNS, or deployed identity service was involved. Each migration is recorded in `schema_migrations` and the runner completed successfully.

## Browser flow checked

- VMMS created an OIDC authorization-code request and redirected to the configured local realm.
- The synthetic username/password was accepted by Keycloak.
- The callback returned to VMMS, resolved its existing `(issuer, subject)` mapping, and created an authenticated VMMS session.
- VMMS local sign-out returned success; a follow-up session read returned `authenticated: false`.
- No work orders, customer records, invitations, or role grants were created or changed by this check.

The API was started with process-only synthetic S3Mock settings because the ignored local environment has partial evidence-storage configuration. This avoided reading or printing the stored access credentials. Evidence upload and malware scanning were not part of this authentication check.

## Limits and remaining work

This is local synthetic development evidence. Together with the all-role login recheck, it satisfies the local VMMS relying-party acceptance in IDP-002, which is now verified. It does not verify production authentication at `https://auth.raymond-gray.org`, Google federation, a deployed email/recovery service, physical-device passkeys, production session revocation, multi-browser/OS coverage, or VMMS role-specific UAT. Cross-product rollout, production identity operations and the full USER-023 requirement remain open under IDP-003 through IDP-006 and REV-056.
