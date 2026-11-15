# Sales delivery and PDI browser verification

**Date:** 13 November 2026\
**Status:** Local synthetic browser workflow passed; import and operational acceptance remain open.

## Journey exercised

- Head of Service Centre assigns Sales Representative and PDI Observer roles to a synthetic staff member through the real application API.
- Staff searches by full VIN with the keyboard, records one delivery, and sees the purchaser displayed as a sourced historical claim.
- Staff records a PDI observation, with copy that makes clear it is not an approval or safety sign-off.
- After reload and another VIN search, staff selects the existing delivery to add PDI notes. The page does not offer a second delivery save.
- An API/PostgreSQL test denies history access to an active site member without one of the approved history roles.

## Results

- `npm run verify:sales-deliveries-browser`: passed against a disposable PostgreSQL database and the real VMMS API/browser path.
- The browser report covers eight widths: compact phone, small phone, foldable cover, phone, tablet portrait, tablet landscape, desktop and phone landscape. No horizontal overflow or clipped controls were found.
- Automated WCAG 2.1 A/AA scan passed. No uncaught browser page errors were reported.
- `npm run typecheck --workspace @vmms/api` and `npm run typecheck --workspace @vmms/web`: passed.
- `npm run test --workspace @vmms/api`: 121 passed, 0 failed, 1 optional S3/ClamAV test skipped.
- `npm run test --workspace @vmms/web`: 32 passed, 0 failed.
- `npm run build --workspace @vmms/web`: passed.
- Evidence output: [browser results](sales-deliveries-browser/results.json), [desktop capture](sales-deliveries-browser/sales-deliveries-desktop.png), [phone capture](sales-deliveries-browser/sales-deliveries-phone.png).
- Reasoned, append-only PDI correction from the history page has separate, later PostgreSQL and browser evidence in [PDI correction verification](sales-pdi-correction-2026-11-13.md).

## Limits

- Test records and accounts were synthetic and isolated. No live sales/customer records were created or imported.
- This run does not verify the monthly sales workbook import, the maintenance backlog importer, approved PDI instructions, vehicle/delivery correction lifecycle, full role matrix, screen-reader operation or staff UAT. PDI note correction is covered by the separate check above.
- Wider visibility for Service Advisors and workshop roles remains pending under `REV-049`.
- These local checks do not establish production readiness, remote hosting, physical-device behavior or management approval.
