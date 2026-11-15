# Work-order search wording check

Date: 14 November 2026

## Change

The work-order search now describes the values it accepts in familiar terms. Its screen-reader label is “Search by booking number, vehicle ID, registration or client”; its short placeholder is “Booking no., vehicle ID, registration or client”. The no-results hint spells out “vehicle identification number” and uses “client” consistently with the paying-client record.

This changes display text only. Search fields, matching behavior, party records and permissions are unchanged.

## Checks

- `npm run --workspace @vmms/web test`: passed, 35 tests.
- `npm run --workspace @vmms/web typecheck`: passed.
- `npm run --workspace @vmms/web build`: passed; 2,247 modules transformed.
- `git diff --check -- apps/web/src/pages/reception.tsx`: passed.
- `npm run verify:browser-smoke` with local Keycloak, PostgreSQL, S3Mock and ClamAV: **65 checks passed**, with no uncaught browser errors. Four WCAG 2.1 A/AA scans passed on sign-in, owner portal, work-order queue and visit intake. The search's accessible name and placeholder passed; queue and intake layouts passed 16 responsive profiles, and work-order, intake and diagnostic layouts passed 200% and 400% reflow checks. The detailed isolated output is in `docs/verification/browser-work-order-search-2026-11-14/results.json` in this working copy.
- The first two attempts exposed local test setup issues (missing API evidence settings and a cold OIDC discovery timeout). The final run used loopback-only S3Mock and ClamAV settings and passed end to end. No production provider, database, DNS or deployment was used.

## Remaining review

This is one wording correction, not completion of the full staff and owner language review. Screen-reader review, physical-device checks, owner review of proposed terms and staff UAT remain open under USER-031.
