# Local role fixture lifecycle verification — 15 November 2026

**Status:** Partial lifecycle implemented and exercised against one new isolated local installation. Production identity, live business databases, staff data, invitations, DNS, and deployments were not used. The newly prepared fixture remains running locally so the owner can continue browser testing.

## Implemented and exercised

- Allocated a new private installation without reusing or changing the three earlier rehearsal folders.
- Added `prepare`, `up`, `status`, and `verify` lifecycle commands. Docker operations reject remote contexts, occupied loopback ports, mismatched project/volume ownership, changed container IDs, unhealthy services, unexpected images, or non-loopback bindings. Process logs and identity/database credentials stay in the private fixture directory or child environment; command output suppresses process details.
- Resumed an interrupted Keycloak first boot only after matching the installation markers, project labels, images, health, ports, and database volume. The initial cold start exceeded the former five-minute timeout. The wait is now fifteen minutes and a secret-free journal is written before service mutation.
- Fixed a combined-role seed ordering defect. A Team Lead Engineer placement can report to a Supervisor placement that appears later in the manifest; placements are now inserted parent-first to satisfy the reporting foreign key.
- Prepared 15 staff identities, 18 role placements and zero operational authority grants in the isolated PostgreSQL database. `prepare` was repeated against the same state without resetting credentials or records.
- Started API and web on recorded loopback ports. A repeated `up` verified and reused the same process identities. Live `verify` now checks those recorded process identities and their assigned loopback HTTP endpoints, alongside Keycloak discovery, PostgreSQL, the recorded database name/OID, exact synthetic counts, and zero operational authority grants. An adversarial review caught and corrected the earlier journal-only app status check.
- Browser login runner passed for all 15 synthetic staff accounts: OIDC redirect, authenticated session, one site, exact role set, expected role landing/access checks, CSRF cookie, and logout revocation. The Head and Operator separation checks passed.
- The synthetic vehicle-owner rehearsal passed the actual owner-access approval command, single-use invitation, OIDC claim, owner-only session, synthetic vehicle allowlist, and logout revocation. Its temporary fixture-only approval grant was confirmed revoked at cleanup; the claim token was neither logged nor persisted.

## Verification evidence

- `python -m unittest discover -s scripts/local-role-fixtures -p 'test_*.py'`: 29 passed, including app process and endpoint verification.
- `python -m py_compile` on the local role-fixture Python scripts: passed after lifecycle changes.
- `node --import tsx --test apps/api/test/local-role-fixture-seed.test.ts`: 5 passed, including parent-before-child role-placement ordering.
- `npx tsc --noEmit -p apps/api/tsconfig.json`: passed after the fixture-seed edit.
- `python scripts/local-role-fixtures/lifecycle.py prepare --installation-id <private fixture UUID>`: prepared, 3 owned containers, exit code 0 after successful idempotent rerun. The UUID and all credentials remain only in the private local directory.
- `python scripts/local-role-fixtures/lifecycle.py up --installation-id <private fixture UUID>`: passed; second invocation returned the same web origin and two recorded app processes.
- `python scripts/local-role-fixtures/lifecycle.py verify --installation-id <private fixture UUID>`: passed; 15 staff identities, 18 placements, zero operational authority grants, database identity, recorded app processes, and responding endpoints.
- `npm run verify:role-fixture-logins`: passed for all 15 staff personas and all 18 placements.
- `npm run verify:owner-role-fixture`: passed owner approval, invitation claim, audience separation, synthetic vehicle visibility, and logout; the temporary synthetic grant was revoked.
- `npm run docs:check` and `npm run docs:test`: rerun after this record and task update.

## Limits and remaining work

- `down` is not implemented. The running web/API and the three exact synthetic identity/database containers are intentionally left available for owner testing. Database volumes and generated credentials have not been removed.
- Broader lifecycle failure injection is incomplete: process crash at every boundary, partial Compose startup, volume-label drift, changed database OID, occupied app ports, interrupted stop, and unrelated live project preservation need explicit tests.
- Real customer-data import is not covered. No real customer or staff data was introduced. Role login and the focused owner flow do not prove every role workbench, technical workflow, SOP, accessibility requirement, production readiness, or business UAT. Keep AUTH-015 and AUTH-013 in progress.
