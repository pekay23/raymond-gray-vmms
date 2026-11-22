# Routine maintenance and delivery PDI schedule-basis boundary — 18 November 2026

## Change

Routine-maintenance checklist records now reject `delivery-inspection` as their schedule basis in both the API response contract and the web response contract. Delivery PDI remains in its separate delivery-preparation workflow.

Migration `080_work_order_maintenance_schedule_basis.sql` adds a database constraint for the same invariant. Before adding it, the migration checks for existing routine-maintenance rows with the PDI basis and raises an error for manual review. It does not rewrite or delete historical records.

## Verification

- `npm run typecheck --workspace @vmms/api` passed.
- `npm run typecheck --workspace @vmms/web` passed.
- `npm test --workspace @vmms/web` passed: 37 tests, including rejection of the invalid basis.
- Focused API integration run passed: 93 tests across `evidence.test.ts`, `foundation.test.ts`, and `work-order-checklists.test.ts`; one optional local S3/ClamAV test was skipped. This includes checklist-source availability, PDI exclusion, and the existing outcome-source checks.
- `node --import tsx --test test/migration-upgrade.test.ts` passed against a disposable local PostgreSQL 18.1 container: one migration-upgrade test, including migration 080.
- The first full API run exposed two test issues: the checklist fixture still expected a PDI template in the routine-maintenance list, and an evidence test processed a queued scan without waiting for the uploaded file's terminal state. After correcting both, the full API suite passed: 141 passed, 0 failed, and one optional local S3/ClamAV test skipped.

## Limits

This verifies schema and migration behavior, not checklist creation, a positive checklist outcome round-trip, current grants, exact OEM procedures, report generation, deployment, or staff acceptance. No managed database, production data, or production service was used.
