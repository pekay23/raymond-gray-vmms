# Service history for workshop roles — 20 November 2026

## Scope

A distinct **Service history** screen is available to active Head of Service Centre, Service Advisor, EV/ICE Team Lead, Supervisor, and Technician/Engineer/Trainee roles. It searches by a full VIN and returns work orders from the selected organisation and site, including complaints and attributed task work entries. The route requires current active site membership and an active allowed role, and writes a sensitive-read audit event.

This is separate from **Sales and PDI history**. Service history excludes delivery records, purchaser-at-delivery claims, owner details, and payer details. Work entries are displayed as recorded activity; the page says they do not represent approval, sign-off, or release.

## Verification

- API typecheck: passed.
- Web typecheck: passed.
- API test suite: 168 passed, 0 failed, 1 optional local S3/ClamAV integration skipped.
- Web unit tests: 45 passed, 0 failed.
- API TypeScript build: passed.
- Web production build: passed.
- PostgreSQL `foundation.test.ts`: 89 passed, 0 failed, 0 skipped. Includes an integration case for roleless denial, current advisor access, read auditing, site isolation and organisation isolation, and exclusion of a synthetic purchaser claim.
- Browser navigation workflow: passed for Head with Operator, Advisor, Technician, Sales-only, Operator-only, Finance-only, and multi-site role selection.
- The Advisor browser path searches synthetic service history and checks complaint/work-entry display, purchaser-claim exclusion, viewport widths 280–1440px, and axe WCAG 2.1 A/AA tags: no overflow or axe violations.
- `node --check scripts/workspace-navigation-browser.mjs`: passed.
- Documentation status, traceability, and `git diff --check`: passed. Git reported only line-ending normalization notices.

The browser used mocked API responses. The PostgreSQL test exercised the real API implementation. Staff UAT, physical-device checks, and manual screen-reader checks remain open. This slice does not complete USER-040 or authorize technical work or sign-off.

## Production/API domain state

`api.raymond-gray.org` is attached and verified on the standalone Vercel project `raymond-gray-vmms-api`. Cloudflare currently has no DNS record for that name. Vercel reports the current DNS target as `b5e1d81e4c679f42.vercel-dns-017.com`, but the only production deployment is in `ERROR`: project Root Directory `apps/api` was not found in the deployment source, and the API project has no production environment variables. The domain therefore has not been connected through Cloudflare DNS; pointing it at an unavailable production API would not yield a usable service. Correct and verify the API production deployment first, then create the exact CNAME with proxying disabled and verify HTTPS plus the health and readiness routes.

## Remaining

- Do not treat mocked browser fixtures as live API acceptance.
- Keep broad role UAT and production service readiness in progress.
