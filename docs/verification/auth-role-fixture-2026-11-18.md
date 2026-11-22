# Local staff role sign-in recheck — 18 November 2026

## Result

Passed the isolated VMMS role rehearsal for all 14 active staff personas. The rehearsal used its own loopback Keycloak realm, synthetic VMMS PostgreSQL database, and local web/API processes. No production identity, database, customer records, or staff accounts were used.

The browser check confirmed one site and exactly the manifest role in each staff session, role-appropriate portal access, logout revocation, and the separation between the VMMS Operator and Head of Service Centre. Finance and Compliance Records could sign in and reach their workspace home, but the server denied their work-order queue and detail requests with `WORK_ORDER_ROLE_REQUIRED`. A separate API regression confirms that a site member with no active work-order role cannot read the queue, detail, checklist list/report, scope proposals, service report or source reports. Sales and PDI Observer opened the sales and vehicle-history workspace.

| Staff role | Result |
| --- | --- |
| VMMS Operator | Sign-in, account page; workshop routes denied |
| Head of Service Centre | Sign-in; Operator account API denied; role home opened |
| EV Team Lead | Sign-in and exact site/role scope |
| ICE Team Lead | Sign-in and exact site/role scope |
| Supervisor | Sign-in and exact site/role scope |
| Technician / Engineer Trainee | Sign-in and exact site/role scope |
| Service Advisor | Sign-in and exact site/role scope |
| Quality Inspector | Sign-in and exact site/role scope |
| Parts and Inventory | Sign-in and exact site/role scope |
| Warranty Customer Support | Sign-in and exact site/role scope |
| Finance Billing | Sign-in; work-order APIs denied |
| Compliance Records HR | Sign-in; work-order APIs denied |
| Sales Representative | Sign-in and sales/vehicle-history workspace |
| PDI Observer | Sign-in and sales/vehicle-history workspace |

The fixture reported 14 staff identities, 14 role placements, and zero operational authority grants. The separate owner invitation and claim path was not exercised by this staff-login run; its previous evidence remains linked from `AUTH-013`.

## Commands and supporting checks

- `python scripts/local-role-fixtures/lifecycle.py --installation-id <private-local-fixture-id> up` — passed after resuming the recorded API process.
- `npm run verify:role-fixture-logins` with the exact private local fixture ID — passed for 14 staff roles.
- `python -m unittest discover -s scripts/local-role-fixtures -p 'test_*.py'` — 30 tests passed.
- `npm run typecheck` — passed after the work-order read guard was added.
- `npm test --workspace @vmms/api` — 152 passed, zero failed, one skipped optional S3/ClamAV integration test.

## Changes

Work-order routes require an active site role that includes work-order access; site membership by itself is insufficient. The role list mirrors the existing workspace access rules. Direct child-report URLs have the same server check as the queue and detail page. This read permission does not grant technical, inspection, release, finance, or governance authority.

The local fixture runtime now resumes a recorded `up` installation when its API or web process has stopped. It validates the recorded process identity and only restarts the missing VMMS process. Its 30 safety tests pass.

## Limits

These are local synthetic checks, not production identity or staff acceptance. The owner claim path, evidence storage/scanning service, real staff UAT, production OIDC, and deployment health remain separate checks. The test-only actor counts and cross-site scenarios use synthetic site assignments.
