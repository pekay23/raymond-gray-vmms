# Team Lead and Head diagnostic review queue

## Purpose

Help the Head of Service Centre and Team Leads find the latest recorded diagnostic findings across the work they oversee. This is a read-only review aid. Opening or reviewing a finding does not authorize diagnosis or repair, clear a safety hold, complete a task, or sign off G3, G4 or vehicle release.

## Access and scope

- The Head of Service Centre can read findings for the selected organisation and site.
- An EV or ICE Team Lead can read findings only for work orders whose latest Team Lead assignment names that user.
- Other roles, inactive site memberships, other sites and other organisations are denied by the API and constrained by transaction-local database scope.
- Reads are audited and returned with `Cache-Control: no-store`.
- The response excludes customer, owner and visit-contact names and contact details.

## Queue rules

- A finding remains listed until a newer finding explicitly supersedes it. The earlier record remains in the work-order history.
- The queue preserves its recorded certainty, explanation, residual risk and restrictions. It does not infer whether a risk is acceptable or whether a system is safe.
- Results are ordered by recorded time and finding ID and use bounded pagination.
- Selecting a row opens the canonical work order. The work-order page remains the source for the complete observation and evidence history.
- The Today page shows the queue only for the Head and Team Lead roles. It provides loading, failure, empty, offline and pagination states.

## Implementation and verification

The API contract is in `apps/api/src/work-order-diagnostic-review-queue.ts`; the Today preview is in `apps/web/src/pages/today.tsx`. Audit action registration is enforced in migration `093_work_order_diagnostic_review_queue_audit.sql`.

The queue does not change a finding or work-order version and does not replace the separate task, hold, scope, authority, qualification or sign-off workflows. Detailed API authorization and browser presentation evidence is recorded in `../verification/diagnostic-review-queue-2026-11-18.md`.
