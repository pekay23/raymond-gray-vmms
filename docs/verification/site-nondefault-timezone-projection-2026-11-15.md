# Non-default site timezone projection

**Result: passed in local synthetic PostgreSQL/API/browser checks on 15 November 2026.**

The authenticated-session integration test changes one disposable site to `America/New_York`, reads `/api/v1/session`, and verifies the session returns that persisted value for the site. The test restores `Africa/Accra` before subsequent assertions. The database is created for the test run and contains synthetic records only.

## Checks

- `npm exec --workspace @vmms/api -- tsx --test --test-concurrency=1 --test-name-pattern='shared OIDC login binds tabs' test/foundation.test.ts` — 1 passed, 0 failed.
- `npm test --workspace @vmms/web` — 35 passed, 0 failed. This includes explicit timezone formatting, site-local input conversion, daylight-saving gap/repeated-time rejection, and unchanged-instant conversion checks.
- `npm run verify:service-requests-browser` — passed. A disposable site persisted as `America/New_York` and a browser set to `America/Los_Angeles` recorded a fixed overdue callback at `2026-11-02T02:30:00.000Z`; the Today panel showed New York local time, and the workflow retained privacy, retry, contact-history, close/reopen, viewport and accessibility checks.
- `npm run verify:work-plan-browser` — 57 checks passed, 0 errors. The disposable site persisted as `America/New_York` while the assigned Technician browser used `America/Los_Angeles`. Entering `2026-11-01T21:30` saved `2026-11-02T02:30:00.000Z`; correction restored the same site-local input; original and corrected entries both printed as New York local time in selectable report text. The complete work-plan, task, report, denial, pagination, keyboard, zoom and responsive checks passed.

## Limits

This verifies callback entry/display and work-entry entry/correction/print projections across different browser and service-centre timezones. It does not approve a timezone editor or establish production configuration. Additional sites, physical devices, and staff acceptance remain unverified.
