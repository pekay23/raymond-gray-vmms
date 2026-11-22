# Draft work-scope proposal verification — 2026-11-18

## Result

The bounded draft-proposal slice passed its local API, browser, build and traceability checks. Full G2 customer approval, repair authorization and dispatch remain incomplete.

## Behaviour verified

- A proposal records the exact planned task IDs, a canonical digest, diagnosis/repair request type, rationale, revision, author, work-order version and predecessor revision.
- A proposal command requires the current `work-order.prepare-scope-proposal` authority grant and a current writable site membership. No production grant is seeded.
- Stale versions, cross-site/cross-tenant access and a changed payload under a reused idempotency key are rejected. The test also checks replay, append-only runtime rights, event/audit counts and that the response does not claim the proposal is authorized.
- The real work-order page says that a proposal is not customer consent or permission to begin work, explains that diagnostic consent does not authorize repair, and hides the write form when the specific grant is absent.

## Checks

| Check | Result |
| --- | --- |
| Full API suite against disposable PostgreSQL | 145 passed, 0 failed, 1 optional local-service test skipped |
| Web unit tests | 37 passed, 0 failed |
| Workspace TypeScript check | Passed |
| Production web build | Passed |
| Focused real browser workflow | Passed; includes proposal no-grant and safety wording, plus work-order and task workflows |
| Full work-plan browser workflow | Passed; 60 recorded browser checks, including the scope-proposal boundary, 200%/400% zoom, phone/foldable/tablet/desktop layouts, role scoping, assignments, technician activity, pagination and purpose-built reports; `errors: []` |
| Documentation counts and traceability | Passed; 258 requirements, 710 tasks, 350 source blocks |
| `git diff --check` | Passed; Git reported line-ending conversion notices only |

Browser evidence: [focused browser results](work-order-scope-proposal-check/results.json) and [full work-plan browser results](browser-work-plan-final/results.json). API coverage is in `apps/api/test/foundation.test.ts`.

## Limits and follow-up

The full `verify:work-plan-browser` run completed successfully after stabilizing viewport settling and refreshing the synthetic browser session before zoom checks. It verified 60 browser checks, including the complete proposal-enabled workflow, print/report pagination, role restrictions, responsive views and accessibility at 200% and 400% zoom. The final result records `VERIFIED` with no browser errors.

This work does not record or infer customer consent, diagnostic approval, estimates, prices, commercial or technical approval, repair dispatch, inspection, payment, or release. REV-061's general payer rule is now resolved, but effective procedures, evidence methods and action-specific authorities remain open. Do not treat this draft proposal as permission to begin work.
