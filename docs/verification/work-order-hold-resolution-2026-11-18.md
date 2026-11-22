# Work-order hold resolution verification

**Date:** 18 November 2026  
**Scope:** Append-only resolution of a work-order hold by its currently assigned Team Lead.

## Implemented behavior

- Open and resolved holds remain visible on the work order; the queue count includes only unresolved holds.
- Resolution requires writable site access, a current `work-order.hold.resolve` grant, the current work-order Team Lead assignment, and that Team Lead's current powertrain qualification.
- The resolution requires a plain-language explanation and at least one accepted, clean evidence item already attached to the same work order.
- The transaction records the resolution, evidence links, grant/qualification/assignment snapshot, domain event, idempotency receipt and outbox item together.
- The resolution changes no technical completion, independent inspection, release, payment or departure decision. No production grant is created.

## Verification evidence

- `node --import tsx --test --test-concurrency=1 --test-name-pattern="hold resolution requires" test/foundation.test.ts` — passed against a disposable PostgreSQL database after the final changes. It verifies cross-site denial, denied action without a grant, rejected unattached evidence without partial writes, successful resolution, evidence and assignment/grant/qualification attribution, stale-version denial, idempotent replay, denial after grant revocation, audit/outbox/receipt creation, append-only enforcement, zero remaining open holds, and pending G1–G5 states.
- `npm run test --workspace @vmms/api` — 153 passed, 0 failed, 1 optional local S3/ClamAV test skipped. This full run preceded the final addition of assignment identifiers to the decision snapshot; the focused test above was rerun after that change.
- `npm run typecheck` and `npm run build` — passed after the final implementation change.
- `npm run docs:check` and `npm run docs:test` — passed; task counts and traceability validate.
- `git diff --check` — passed; Git reported only line-ending normalization warnings in already-dirty files.
- `codegraph sync` — complete; `codegraph affected` identifies the API foundation/evidence and work-order workflow tests, plus Web API and workspace-navigation tests.
- `npm run verify:work-plan-browser` — passed 73 checks, 0 browser errors, on Chromium with disposable PostgreSQL. It creates a hold through the Head of Service Centre page, resolves it as the assigned qualified Team Lead using accepted evidence, confirms the resolution history and zero open holds, and verifies that G1–G5 remain unchanged. It also covers the broader work-plan journey, role visibility, accessible form behavior, and responsive layouts.

## Limits

This does not complete the broader SafetyHold/Permit contract, asset/vehicle/incident holds, G4 inspection, Team Lead vehicle release, approved OEM instructions, or production qualification/grant setup. The hold-resolution implementation task is verified; the separate verification task remains in progress for its additional negative-case matrix, including expired qualification and explicit wrong-site evidence checks. No production database, grant, DNS, deployment or customer record was changed.
