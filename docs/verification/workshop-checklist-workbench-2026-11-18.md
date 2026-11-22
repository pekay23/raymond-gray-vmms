# Workshop checklist screens — local recheck, 18 November 2026

## Result

The assigned-task and maintenance report browser checks pass against synthetic API responses. The checklist report rendered all 51 items in two pages, requested page 2 with the saved checklist version, stayed within widths from 320 px to 1440 px, passed the automated WCAG 2.1 A/AA scan with zero violations, and printed the report without its toolbar.

The assigned-task check passed 17 browser assertions for role-specific work queues, task updates, supervisor review requests, non-authorizing checklist drafts, technician outcome history, pagination, empty and failure states, keyboard access and responsive overflow. It reported zero automated accessibility violations on the populated task page.

| Check | Result | Evidence limits |
| --- | --- | --- |
| Assigned-task workbench | Pass, 17 browser checks | Synthetic API responses; not staff UAT |
| Maintenance report | Pass, 7 viewport widths, 2 report pages | Synthetic report content; Chromium only |
| Accessibility | Zero automated violations on checked screens | Does not replace assistive-technology or user testing |
| Print | Purpose-built report visible; toolbar hidden | Browser print emulation, not a physical printer test |

## Change

When a maintenance draft request fails with a client error, its stale idempotency attempt is now discarded so a corrected request can be made. A `409` also refreshes the current work order and checklist state before the next attempt. Network failures and server errors retain the request key so a retry cannot duplicate a successful command whose response was lost.

## Commands

- `npm run verify:my-assigned-tasks-browser` — passed; 17 checks.
- `npm run verify:checklist-report-browser` — passed; 7 widths, two version-pinned pages, zero axe violations, clean print isolation.
- `npm run typecheck` — passed.

The two Vite browser commands were rerun serially after parallel execution briefly contended for the shared dependency cache. The serial results above passed.

## Remaining acceptance

These checks do not cover physical devices, HarmonyOS, production identity, live evidence storage/scanning, staff acceptance or the checklist draft preparation conflict path in a real browser/API session. Checklist templates remain source-gated; no vehicle-specific technical procedure or sign-off authority is inferred.
