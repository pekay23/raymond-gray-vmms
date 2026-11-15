# Site-local time on business screens — 13 November 2026

## Change

Business timestamps now use the authenticated site's `timeZone` on the request, intake, work-order, task-allocation, message, controlled-document, evidence, overview and print-report screens. This applies to work-order history, assignment/review/handover times, work-plan times, request follow-ups, read receipts, report preparation times and evidence dates. The browser timezone is not used to display these records.

The shared formatter and saved callback/work-entry inputs already support explicit site zones. This change wires the selected site's persisted value through the remaining business-screen render paths. The default launch site remains `Africa/Accra`.

## Verification

- `npm test` — API: 121 passed, 0 failed, 1 optional local S3/ClamAV fixture skipped; web: 33 passed, 0 failed.
- `npm run typecheck` — passed after fixing the `MessageCard` boundary to receive the timezone as an explicit prop.
- `npm run build --workspace @vmms/web` — passed; Vite production build completed.
- `npm run verify:service-requests-browser` — passed against disposable PostgreSQL and synthetic records: lost-response retry, request/contact history, close/reopen, four viewport widths and automated accessibility.
- Source audit: every `dateTime(...)` JSX call under `apps/web/src` passes either `site.timeZone`, a locally provided `timeZone`, or an equivalent explicit site timezone prop. No one-argument JSX timestamp formatter calls remain.
- `npm run verify:work-plan-browser` — incomplete. Against a disposable PostgreSQL database, the run verified report text/layout, accessibility, work-plan/review/assignment, task activity, site-local 14:00 input persistence and correction, and the complete 101-entry workshop report. The process later exited with PostgreSQL `idle-in-transaction timeout` before the remaining suite finished. Do not count this rerun as a passed browser suite.

## Remaining work

- Add a focused browser assertion that a non-default site's stored instant displays in that site's timezone on messages, callbacks, overview and print outputs.
- Approve a controlled workflow for changing a site's timezone before configuring another timezone.
- Complete the wider accessibility, print catalogue, financial formatting and staff UAT cases in `R-M-0181`.

No production data, DNS, deployment, domain configuration, notification or third-party service was changed. Browser data was synthetic and isolated to a generated disposable database.
