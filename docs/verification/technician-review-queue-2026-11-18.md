# Technician review-request queue verification

## Scope

The Today page can show unanswered task guidance requests to the current Supervisor, the Team Lead assigned to each work order, and the Head of Service Centre. The queue is read-only and does not authorize work, mark a task complete, release a vehicle, or approve a technical decision.

## Checks completed

- Focused API integration: `node --import tsx --test --test-name-pattern="Supervisor task allocations stay scoped" apps/api/test/foundation.test.ts` passed on disposable database state. It confirms the pending request appears for the current Supervisor, assigned Team Lead, and Head; a Technician and wrong-site read are denied; successful reads are no-store and audited; and the request leaves the queue after a Supervisor response.
- Full API and web tests: `npm test` passed (151 API tests passed, one environment-dependent S3/ClamAV test skipped; all 40 web tests passed).
- Type check: `npm run typecheck` passed.
- Build: `npm run build` passed; 2,251 web modules transformed.
- Real-browser run: `npm run verify:work-plan-browser` passed with 68 checks. The Supervisor saw a real pending request, followed its current work-order link, replied, and saw the queue clear. The Today preview fit widths from 280 to 1440 px. Isolated synthetic responses also verified loading, recoverable failure/retry, and page navigation in both directions.

## Still required

- Complete staff acceptance for the named operational roles and target devices.
- Production identity, role schedule, and current effective technical procedures remain separate deployment gates for the broader workshop workflow.

No production data, notification, deployment, or sign-off authority was changed in these checks.
