# Sales and PDI history read access

**Date:** 13 November 2026\
**Status:** Server role boundary verified; broader workflow and role review remain open.

## Change

The Sales/PDI history API now checks for an active Head of Service Centre, Sales Representative or PDI Observer placement after confirming active site membership. This matches the current Vehicles navigation boundary. A site membership by itself no longer returns purchaser-at-delivery or PDI history. The API continues to filter by organisation and site and records a sensitive-read event for authorized reads.

## Verification

- `npm run typecheck --workspace @vmms/api`: passed.
- `npx tsx --test --test-name-pattern="sales delivery and PDI observations" test/foundation.test.ts` from `apps/api`: passed, 1 test, 0 failures.
- The test verifies the roleless site member receives `403 ROLE_REQUIRED`; an authorized history role still reads the delivery/PDI facts and creates the sensitive-read audit entry.
- `codegraph affected apps/api/src/sales-deliveries.ts apps/api/test/foundation.test.ts` identified the API foundation and evidence suites plus their runtime support.
- `npm run test --workspace @vmms/api`: passed, 121 passed, 0 failures, 1 optional S3/ClamAV test skipped.

## Limits and follow-up

- `REV-049` remains open: decide whether Service Advisors and other workshop roles need a restricted vehicle-history view. Keep purchaser-at-delivery claims hidden from any role that does not need them.
- This check does not verify browser behavior, the full Sales-to-Service journey, historical workbook import, approved PDI procedure, or staff acceptance.
- No operational customer or vehicle data was changed.
