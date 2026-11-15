# Task labour tracking verification — 2026-11-14

## Result

**Verified:** assigned technicians can record actual elapsed time using server-timed sessions. The feature is separate from task progress, repair approval, release authority and finance.

## Implemented behavior

- Migration `074_work_order_task_labor_sessions.sql` stores the organization, site, work order, task, work-plan revision, assignment revision, staff member, role placement and server start/stop timestamps.
- A database uniqueness rule and organization-scoped actor lock allow at most one open session per staff member across the organization, including concurrent starts. Reads remain scoped to the active site; an attempt from another site is denied without exposing the original session.
- The API requires a current task assignment to start. The browser cannot supply a start or stop time, duration, actor or authority. Only the session owner may stop, including after the task is reassigned.
- Session facts are immutable except for one transition from open to stopped. Start/stop events, command receipts and outbox records share a transaction.
- “My assigned tasks” has a server-refreshed active-session panel, a per-task start action, stop control, offline state, accessible conflict feedback and recovery after reload. It says the timer does not grant work permission, complete a task or set a charge.

## Verification evidence

- `node --import tsx --test --test-name-pattern="Supervisor task allocations stay scoped" apps/api/test/foundation.test.ts` — passed on disposable PostgreSQL. Covers valid/stale assignment, server timestamp, rejected caller time, duplicate and concurrent starts, start/stop replay, changed-input denial, cross-user and cross-site denial, owner stop after reassignment, immutable facts, event/outbox pairing, rollback on outbox failure, and unchanged work-order version.
- `VMMS_BROWSER_OUTPUT_NAME=task-labor node --import tsx scripts/work-plan-browser.mjs --run --labor-only` — passed with synthetic staff and a real disposable PostgreSQL/API instance. The technician starts by keyboard, reloads and recovers the open session, stops by keyboard, sees a stale-assignment error in an alert, and can start again. Automated WCAG checks passed and the page fit 280, 320, 390, 768, 1024 and 1440 px widths.
- Full browser evidence and screenshots: [`task-labor`](task-labor/).
- API and web TypeScript checks, web unit tests, web production build and documentation validation are recorded below after the final source state is checked.

## Limits and remaining work

This verifies only the elapsed-time slice of `R-M-0066`. Checklist parent/lifecycle, controlled work-instruction revisions, actual parts and nonconformance are not implemented by this change. No rates, invoice lines or billing rules were added. The verification uses synthetic identities and a disposable local database; it is not staff UAT, production proof or a concurrency test against a managed PostgreSQL deployment.
