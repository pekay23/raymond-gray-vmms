# Task labour time records — version 1

**Status:** Server-timed labour sessions implemented and verified; the wider task, parts and instruction-revision requirement remains open.\
**Requirement:** `R-M-0066`\
**Source:** `master-0066` requires task checklists, start/stop timestamps, work-instruction revisions, actual labour, parts and nonconformance events.

## Boundary with narrative task entries

Task work entries remain immutable narratives (`finding`, `test`, `action`, or `follow-up`) with an outcome and evidence references. They do not supply elapsed labour. A narrative “action done” is not proof of time worked and must not be converted into a labour charge.

## Selected time-record contract

- A technician/engineer/trainee starts a work session only for a task currently assigned to them in the current work-plan and assignment revisions. The server checks current site membership and assignment at start time.
- The server records `started_at`; the browser cannot submit a start timestamp, elapsed duration, staff identity, site, work plan, assignment, or rate.
- The assigned person stops their own active session. The server records `stopped_at`. Stopping remains available to the session owner if the task assignment changes while the session is open, so reassignment cannot trap an active clock.
- Store each session against organization, site, work order, task, plan revision, assignment revision, staff user and role placement. A person may have only one open session across the organization at a time. An organization-and-actor unique constraint and actor-scoped transaction lock enforce this under concurrent requests. The active-session read remains site-scoped; if a person switches sites while a session is open, a new start is rejected with instructions to return to the original site.
- Session facts are append-only except for one database-authoritative transition from open to stopped. Updates to identity, assignment, start time, or an already stopped interval are rejected. Any later correction must be a separate reasoned, attributable event; no correction capability is implied by this design.
- Start/stop commands use the shared idempotent staff-command transaction and record an audit/outbox event atomically. Stale or cross-site assignment data is denied. A replay returns its original session result; a reused command key with a changed body conflicts.
- Time records do not complete a task, approve a repair, establish competence, authorize safety work, or set an invoice amount. Finance may consume time only under a separately approved billing policy and rate schedule. Offline time entry is not supported.

## Implemented slice

- Migration `074_work_order_task_labor_sessions.sql` stores attributed intervals with a database timestamp, one stop-only mutation, row-level site security, and an organization-wide one-open-session index.
- The assigned-technician API exposes the current site's own active session, starts only against the current work-plan and assignment revisions, and lets the session owner stop after reassignment. Start and stop use the atomic command, event and outbox contract.
- The “My assigned tasks” page has a persistent active-session panel, per-task start control, server-refreshed elapsed time, keyboard-accessible stop, conflict feedback, offline state, and reload recovery. It explicitly says the timer does not grant work permission, complete work or set a charge.
- The feature is limited to elapsed-time capture. It does not add rates, invoice lines, task completion or sign-off.

## Verification record

The implementation and checks are recorded in [task-labour-tracking verification](../verification/task-labour-tracking-2026-11-14.md). The `R-M-0066` requirement remains open for checklist lifecycle, work-instruction revision links, parts and nonconformance records.

## Verification contract

Use disposable PostgreSQL and synthetic identities to verify assigned-role start, server timestamps, stop, one-open-session concurrency, double start/stop, replay and changed-body conflict, stale reassignment, session-owner stop after reassignment, other-user denial, cross-site denial, immutable fields, audit/outbox rollback, and no task-completion or financial side effects. Browser checks cover start/stop feedback, active-session recovery after navigation/reload, keyboard access, error/conflict states and responsive layouts. A successful timer test does not complete `R-M-0066`; checklist instructions, actual parts, nonconformance and source-backed UAT remain separate acceptance items.
