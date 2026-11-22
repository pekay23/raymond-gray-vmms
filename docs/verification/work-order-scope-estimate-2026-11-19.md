# Work-order repair estimate and payer read-back

**Date:** 19 November 2026  
**Status:** Verified for the bounded estimate and payer-response slice  
**Data:** Synthetic records in disposable PostgreSQL; no production data or grants

## Behavior checked

- Repair scope revisions require a positive amount in a stated ISO-style currency code. Amounts are stored as exact minor units, and the estimate is included in the immutable scope digest.
- Diagnosis-only proposals may omit a repair estimate. Legacy repair proposals without an estimate remain readable but cannot receive a payer approval response.
- The payer response form reads back the exact task list and estimate. Its stored scope revision and digest remain bound to that same quote.
- A payer response remains non-authorizing. Technical policy, current effective procedure, qualification, evidence, and action authority are still required before work can begin.
- The estimate does not calculate tax, invoice totals, payment, or receipts.

## Verification evidence

- API TypeScript typecheck passed.
- Focused API/PostgreSQL test `scope proposals bind exact planned tasks and remain non-authorizing` passed after migration 095. It checks rejection of a repair proposal without an estimate, exact GHS minor-unit persistence, scope-digest mismatch denial, idempotent replay, stale-version handling, tenant/site isolation, payer-versus-owner identity, immutable rows, audit events and non-authorization.
- Web test suite passed: 42 tests, including exact decimal conversion for GHS, JPY, and KWD and rejection of invalid precision or signed values.
- The complete work-plan browser journey passed 73/73 checks in Chromium 157 against disposable PostgreSQL. It exercised a GHS 1,250.00 estimate, written payer evidence, exact amount/task read-back, the blocked authorization state, accessibility, print output, role queues, and responsive/zoom layouts. Result file: [browser-work-plan results](browser-work-plan/results.json).
- CodeGraph sync reported the index up to date. `codegraph affected` identified API foundation/evidence and web formatting tests; the focused API test and complete web suite were run.

## Limits

This does not complete G2 or authorize work. It stores a staff-entered estimate and the payer's response to it. No tax treatment, line-item rate, internal Finance approval, technical approval, effective procedure, individual qualification, dispatch authority, invoice, payment, receipt, G3, G4, or G5 behavior is enabled by this record. Production grants, policies, identity, deployment, and staff UAT remain unverified.

The first API-wide run reported two connection failures in unrelated vehicle-learning and staff-message tests while a browser/database run was active. Both passed sequentially in isolation, and a clean API-suite rerun then passed 157 tests with 0 failures and 1 optional S3/ClamAV test skipped because the dedicated service fixture was not configured.
