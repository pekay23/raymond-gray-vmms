# Payer response to a proposed work scope — 18 November 2026

## Result

Phone and written payer responses are implemented and verified in the synthetic local workflow. No production records or grants were used; every payer response remains blocked for authorization pending price and technical review.

## Implemented behavior

- An after-sales user with the distinct `work-order.record-payer-scope-response` grant can record an approved or declined phone or written response to the latest proposal only.
- The command binds to the current payer party, exact scope revision and digest, current work-order version and unchanged task list. It records the respondent, relationship, identity and authority checks, scope read-back, call summary and actor attribution.
- The response is immutable and stored with an authority snapshot. The work-order version, audit record, idempotency receipt and outbox entry are committed atomically under the work-order lock.
- The result is always `blocked` for authorization with reason `price-and-technical-review-required`. Payer agreement is not approval of a charge and does not authorize diagnosis, repair, parts, dispatch, or release.
- Recording the response advances the work-order version. The browser workflow verifies that Operations reviews the latest version and reassigns the qualified team lead before planning resumes.
- The page displays response history and the non-authorizing boundary. The response form is hidden without the grant and only shown for a current proposal.
- A written response requires at least one accepted, malware-scanned file already attached to the same work order. The API and database both enforce attachment status and work-order binding; phone responses cannot link written evidence.
- Written payer-response evidence remains available in proposal response history and is excluded from Technician task-work evidence choices.
- No grant was seeded in production or local role fixtures.

## Verification evidence

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test --workspace @vmms/web` | 37 passed |
| `npm run build` | API and web production builds passed |
| Focused disposable PostgreSQL scope-proposal/response integration | Passed: 1 focused test, including exact planned-task binding and non-authorizing scope proposal behavior |
| `npm run verify:work-plan-browser` | Passed: 63 checks, 0 failures, Chromium 157.0.4341.60; includes written evidence, response history, blocked authorization, task-evidence separation, responsive and accessibility checks |
| Response UI accessibility | Passed in the full real-browser workflow, including responsive workspace and 200%/400% zoom checks |
| Documentation traceability | `docs:generate`, `docs:check`, `docs:test`, and `git diff --check` passed |

The PostgreSQL integration assertion is in `apps/api/test/foundation.test.ts`. Browser output is recorded in `docs/verification/browser-work-plan/results.json` (63 verified checks, Chromium 157.0.4341.60).

## Limits

This is not complete G2. Negative database checks for cross-site, rejected, pending, changed-payload and immutable-link cases still need targeted verification. Charge preparation/approval, technical scope approval, written evidence retention policy, applicable procedures, qualifications, and G2 readiness derivation also remain outstanding. G2 must remain blocked until each required control is implemented and verified. The owner-approved interim policy does not grant named staff individual technical authority or publish OEM procedures.
