# Task update visibility for workshop oversight

Date: 2026-11-13\
Result: Verified for this bounded read-only slice

## Behavior checked

- The current handoff Supervisor reads updates only for active, writable direct reports on the current plan.
- The Team Lead assigned to the current work order and the active Head of Service Centre can read updates across that current plan.
- All three audiences share the current Supervisor and direct-report boundary, so an inactive or moved worker is excluded from the feed.
- An unassigned Team Lead, a different Supervisor, and unrelated roles cannot read the oversight feed.
- The allocation projection identifies whether the signed-in staff member may see the feed. The API independently authorizes every feed read; hiding the panel is not the security control.
- Each allowed feed read creates a sensitive-read audit record. No feed action can complete work, inspect it, release the vehicle, approve a request, or authorize payment.
- The work-plan panel shows assignment controls only to the current Supervisor. The assigned Team Lead and Head see current assignee names without disabled assignment controls; an unassigned Team Lead sees neither the activity feed nor assignment controls.

## Evidence

- `node --import tsx --test --test-concurrency=1 apps/api/test/foundation.test.ts`: 73 passed, including PostgreSQL checks for direct-report scope, assigned Team Lead and Head access, unassigned Team Lead denial, unrelated Supervisor denial, and audit rows.
- The PostgreSQL regression moves the assigned worker to another Supervisor after task updates are saved and confirms that all three former-team feeds then return no items.
- `npm run test --workspace @vmms/api`: 121 passed, 0 failed, 1 optional S3/ClamAV integration skipped.
- `npm run typecheck --workspace @vmms/api`: passed.
- `npm run typecheck --workspace @vmms/web`: passed.
- `npm run test --workspace @vmms/web`: 32 passed, including API response-shape and workspace-navigation checks.
- `npm run verify:work-plan-browser`: passed 44 recorded checks against a disposable PostgreSQL database and real VMMS API/browser. The Supervisor, assigned Team Lead and Head saw the persisted progress note; assignment controls appeared only for the Supervisor; no sign-off controls appeared. Phone through desktop layouts had no horizontal overflow. See [browser results](task-activity-oversight-2026-11-13/results.json).
- `codegraph sync`: completed without changes. `codegraph affected` identified the API foundation/evidence tests and web API, worker, VIN, and navigation tests for consideration.

## Limits

All actors and records were synthetic and isolated. This verifies the current configured site-role hierarchy only. It does not establish staff qualification, SOP approval, technical completion, inspection, vehicle release, payment, management approval, staff acceptance or production readiness. Physical-device and manual assistive-technology testing remain open.
