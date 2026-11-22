# Supervisor team workload summary — 19 November 2026

## Result

The Supervisor’s current work-plan assignment panel shows each active direct report and the number of tasks assigned across current handed-over plans at the selected site. It also shows how many current assignments have a latest progress entry marked blocked or waiting. Each count is explicitly labelled as last reported; it is not presented as live availability, safe status, capacity, permission, or completion.

The API derives these figures from the latest assignment revision for each task, then uses only the latest progress entry attached to that same assignment revision. It filters by organisation, site, current Operations review, current lead/plan/handoff, active direct-report placement, and writable membership. Reassignment starts with no inherited blocked or waiting status from the previous assignee. A later progress update replaces the previous reported state for summary purposes while preserving the full activity history.

## Verification

- `npm run typecheck` — API and web passed.
- `npm exec --workspace @vmms/api -- tsx --test --test-name-pattern='Supervisor task allocations' test/foundation.test.ts` — 1 integration test passed against disposable PostgreSQL. It verified scoped assignment counts, blocked-to-waiting state changes, idempotent assignment behavior, denied assignment cases, history/audit, and that reassignment does not carry progress state from a prior assignment revision.
- `npm run verify:work-plan-browser` — 78 Chromium checks passed against disposable PostgreSQL, with 0 errors. The Supervisor view displayed the current assigned-task count and the latest blocked/waiting report after refresh. The broader workflow also checked handoff, task updates, reports, responsive layouts, accessibility, and safety gates.
- `codegraph affected` identified 10 related test files; the focused API integration test and complete work-plan browser workflow were run.
- `codegraph sync` — index is up to date.
- `git diff --check` — passed; Git printed existing line-ending conversion warnings.

## Limits and remaining work

This makes reported blockers easier for a Supervisor to spot; it does not set escalation thresholds or infer that a task remains blocked after a later unrecorded event. The view updates when it refreshes. Equipment readiness, measured availability, capacity limits and configured escalation rules remain unimplemented. Workload counts cannot authorize task assignment beyond grants or replace task-specific qualification checks. Staff UAT and production checks remain outstanding; G2, G3, G4 and Head inspection stay fail-closed.
