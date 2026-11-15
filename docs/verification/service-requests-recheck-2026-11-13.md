# Service requests and callbacks: full recheck — 13 November 2026

## Result

Passed locally against synthetic records. This is a fresh recheck of the request, callback, conversion and job-link implementation; it is not staff UAT or production acceptance.

| Check | Result |
| --- | --- |
| `npm run verify:service-requests-browser` | Passed. Disposable PostgreSQL and local browser covered request creation, caller/contact history, callback updates, correction recovery, existing-job linking, request-to-arrival conversion, lost-response retry with the same command key, close/reopen history, linked-request visibility, four responsive widths, automated WCAG 2.1 A/AA checks and browser errors. |
| `npm run test --workspace @vmms/api` | 121 passed, 0 failed, 1 optional local S3/ClamAV integration skipped. Includes PostgreSQL isolation and the service-request command, history, conversion and linked-job tests. |
| `npm run test --workspace @vmms/web` | 32 passed, 0 failed. Includes request draft/retry scoping, navigation role sets, formatting and API proxy tests. |

The service-request browser suite was rerun after the work-history changes on 13 November 2026 and passed against a fresh disposable PostgreSQL database. This confirms the current intake/callback flow still works alongside the updated work-history and report pages.

## Limits

The browser run used synthetic data and local identity. The the source-report customer workshop report is still only a source note: the payer is confirmed, but the report and sales workbook VINs conflict. Staff must verify the VIN on the physical vehicle or its documents before the canonical vehicle and work order are created. Remaining request-workflow gaps include staff UAT, broader role and site-time-zone permutations, simultaneous browser tabs, and pre-commit response-loss behavior. The request workflow does not approve repairs or later technical, inspection, release, payment or collection transitions.
