# Operational pilot priority checkpoint — 19 November 2026

## Scope

This checkpoint revalidates the day-to-day workshop path from Operations through Team Lead, Supervisor and assigned technicians, plus the Head overview and maintenance checklist report. Tests used synthetic accounts and disposable PostgreSQL. No production data, deployment, migration, DNS, or external service was changed by this checkpoint.

## Local results

- `npm test` — API 160 passed, 0 failed, 1 optional local S3/ClamAV integration skipped; web 43 passed, 0 failed.
- `npm run typecheck` — API and web passed.
- `npm run build` — API and web passed; the web production bundle completed without compiler or bundler warnings.
- `npm run verify:work-plan-browser` — 75 browser checks passed against disposable PostgreSQL. Coverage included intake, source-report corrections, G2 consent boundaries, Operations review and assignment, versioned Team Lead plans, Supervisor handoff, technician task updates/evidence/time entries, supervisor review requests/replies, scoped queues, client-contact boundaries, purpose-built reports, failure recovery and 200%/400% zoom.
- `npm run verify:checklist-report-browser` — passed in Chromium at 320, 360, 390, 430, 768, 1024 and 1440 pixels; two-page version pinning, print isolation and zero automated accessibility violations.
- `npm run verify:head-overview-browser` — passed across 11 widths from 280 to 1440 pixels, including role denial, site activity, filtered reports, offline behavior and print isolation; zero automated accessibility violations.
- `npm run docs:check` and `npm run docs:test` — passed after refreshing the task status totals and generated tracker.
- `git diff --check` — passed; Git reported line-ending conversion warnings only.

Detailed browser outputs: [work-plan results](browser-work-plan/results.json), [checklist report results](work-order-checklist-report-2026-11-18/browser-results.json), and [Head overview results](browser/head-overview-browser-results.json).

## Limits and next gates

These results prove local synthetic behavior, not staff UAT or production readiness. G2 repair dispatch remains blocked because there is no effective policy resolver or verified model/task instruction mapping. Supervisor technical completion (G3), Team Lead release (G4), independent Head inspection and Advisor completion-contact eligibility remain unavailable until those prerequisites, applicable inspection criteria, individual qualifications and action grants are configured. The production domain still serves the frontend HTML at `/api/v1/health`; the protected Preview API returns JSON health and anonymous-session responses. The configured auth UI domain does not currently expose OIDC discovery, and the VMMS client/callback is not registered. Production routing, runtime database/schema, identity configuration, backups/recovery and authenticated sign-in remain release blockers. See [production routing state](production-routing-state-2026-11-19.md).

## Current-tree core workflow recheck — 19 November 2026, 20:03 UTC

- `npm test` — API 164 passed, 0 failed, 1 optional local S3/ClamAV integration skipped; web 43 passed, 0 failed.
- `npm run typecheck` — API and web passed.
- `npm run build` — API and web passed; Vite completed without warnings.
- `npm run docs:check` and `npm run docs:test` — passed before this verification entry; the tracker validated 258 requirements, 731 tasks and 350 source blocks.
- `npm run verify:work-plan-browser` — 80 checks passed against disposable PostgreSQL using the real API and browser. It covers Operations review and Team Lead assignment, scope/payer evidence and boundaries, Team Lead plan/handoff, Supervisor and Technician queues, task activity, labor timing, accepted evidence, worker declarations and Supervisor replies, purpose-built reports, accessibility/responsive/zoom checks, and blocked G2/G3/G4 close-out states. Results: [browser report](browser-work-plan/results.json).
- `git diff --check` — not rerun as part of this verification entry.

This rerun confirms the implemented daily path locally; it does not add the missing effective policy resolver or authorize dispatch. G3 Supervisor completion, G4 Team Lead release, Head inspection, production identity/routing, recovery rehearsal and staff UAT remain incomplete. Test fixtures were disposable and synthetic; no production data or services were changed.

## Current-tree verification recheck — 19 November 2026, 12:02 UTC

- `npm test` — API 163 passed, 0 failed, 1 optional local S3/ClamAV integration skipped; web 43 passed, 0 failed.
- `npm run typecheck` — API and web passed.
- `npm run build` — API and web passed; Vite production build completed without compiler or bundler warnings.
- `npm run verify:work-plan-browser` — 78 checks passed against disposable PostgreSQL with 0 runtime errors. This covers current intake, review, assignment, planning/handoff, Technician task work, Supervisor response and role/report flows. It does not exercise G3/G4 or Head inspection commands because they remain unavailable.
- `npm run verify:checklist-preparation-browser` — 10 checks passed with synthetic API responses, including lost-response retry with the same idempotency key/body, draft-only wording, seven responsive widths and zero automated WCAG 2.1 A/AA violations.
- `npm run verify:checklist-review-browser` — passed with zero Axe violations and no page errors; API responses are synthetic.
- `npm run verify:checklist-report-browser` — passed at seven widths with zero Axe violations, no page errors and print isolation.
- `git diff --check` — passed; Git reported existing line-ending conversions.

This recheck improves local evidence only. Effective model/variant sources, named technical grants and qualifications, G3 Supervisor completion, G4 Team Lead release, the separate Head inspection, staff UAT and production identity/API/database/backup configuration remain open. The production domain still has no functioning API route, and login is not end-to-end verified.

## Local full-suite recheck — 19 November 2026, 13:59 UTC

- `npm test` — API 163 passed, 0 failed, 1 optional local S3/ClamAV integration skipped; web 43 passed, 0 failed.
- `npm run typecheck` — API and web passed.
- `npm run build` — API TypeScript build and web Vite production build passed; image/logo asset generators confirmed all outputs unchanged.
- `npm run docs:check` — passed (258 requirements, 729 tasks, 350 source blocks).
- Browser workflows were not rerun in this recheck; the previously recorded 78-check work-plan journey remains the browser evidence.

This verifies current local compilation, automated tests and document traceability only. It does not enable G3/G4 or establish production routing, identity, database migration, real staff authority, staff UAT or device acceptance.

## Current-tree and live release recheck — 19 November 2026, 12:25 UTC

- `npm test` — API 163 passed, 0 failed, 1 optional local S3/ClamAV integration skipped; web 43 passed, 0 failed.
- `npm run typecheck` — API and web passed.
- `npm run build` — API TypeScript build and web Vite production build passed; image and brand derivatives were unchanged.
- `npm run docs:check` and `npm run docs:test` — passed.
- `git diff --check` — passed; Git reported existing line-ending conversion warnings.
- `npm run verify:work-plan-browser` — 78 checks passed against disposable PostgreSQL, 0 runtime errors. It covered Operations intake/review/assignment, plan and Supervisor handoff, assigned Technician activity/evidence/time, Supervisor requests/responses, report/accessibility/responsive cases, and the fail-closed closeout readiness screen. It does not exercise G3/G4 or the Head inspection commands because they remain unavailable.
- Live read-only release check — the API Preview health route returned JSON `ready`; public OIDC discovery returned HTTP 200 for the expected issuer; the VMMS Production custom-domain API health route still returned frontend HTML. The only API Production deployment is errored on its missing configured Root Directory, both VMMS projects have no Production environment variables, and the Preview client remains an unregistered placeholder. Details are in [production route recheck](production-route-recheck-2026-11-19.md).

These local results confirm the current operational path and its denial boundaries, not staff UAT or Production readiness. Effective model-specific instructions, named technical grants/qualifications, G3, G4, separate Head inspection, Production routing/database/runtime, registered VMMS OIDC client, backup/restore rehearsal, and authenticated staff login remain release blockers.

## Follow-up checklist browser verification — 19 November 2026, 12:29 UTC

- `npm run verify:checklist-review-browser` — passed in Chromium 157 with zero automated accessibility violations and no page errors. It verifies the missing-evidence return, reason-required review, confirmation, idempotency headers and queue refresh against synthetic API responses.
- `npm run verify:checklist-report-browser` — passed at 320, 360, 390, 430, 768, 1024 and 1440 pixels with zero automated accessibility violations, no page errors and application controls excluded from print.
- `npm run verify:checklist-preparation-browser` — all 10 checks passed at the same seven widths; lost-response retry retained its idempotency key/body, the prepared record remained draft-only, and the automated WCAG 2.1 A/AA scan found zero violations.

The review and preparation browser tests use synthetic API responses; their PostgreSQL authorization, audit and transaction guarantees come from the API suite, not these UI checks. These results do not activate a checklist or verify staff use.

## Fresh local suite recheck — 19 November 2026, 13:13 UTC

- `npm test` — API 163 passed, 0 failed, 1 optional S3/ClamAV integration skipped; web 43 passed, 0 failed.
- `npm run typecheck` — API and web passed.
- `npm run build` — API TypeScript build and Vite production build passed; image derivatives were already current and the build emitted no compiler or bundler warnings.

This confirms the current local source tree still passes its automated suites. It does not close the controlled-source, authority, G2/G3/G4/Head-inspection, Production configuration, staff UAT or deployment gates described above.

## Work-plan browser rerun — 19 November 2026, 14:33 UTC

- The first full rerun failed once while waiting 15 seconds for a task work-entry correction response. The run had passed technician allocation and task evidence upload; it did not capture an application failure response.
- Added a 30-second bounded wait and request/response diagnostics around the browser assertion so a recurrence reports matching request traffic and the visible task panel state.
- `npm run verify:work-plan-browser` — passed all 78 checks against a fresh disposable PostgreSQL database with zero failures. The Technician correction was recorded and read back as a new immutable entry while preserving the original. Supervisor review responses remained separate from completion; report, queue, role and responsive checks also passed.
- The harness cleaned up the disposable runtime. No production data or services were changed.

The earlier timeout remains recorded as a transient test-run failure; the successful rerun is the current browser evidence. This adds no G3/G4 or Head inspection functionality and does not change the production readiness gates.

## Current-tree release-check rerun — 19 November 2026, 20:35 UTC

- `npm test` — API 164 passed, 0 failed, 1 optional local S3/ClamAV integration skipped; web 43 passed, 0 failed.
- `npm run typecheck` — API and web passed.
- `npm run build` — API and web passed; the Vite production build completed without compiler or bundler warnings, and all 26 workshop image outputs and 10 logo derivatives were already current.
- `npm run docs:check` — passed with 258 requirements, 731 tasks and 350 source blocks.
- `npm run docs:test` — passed traceability, decision-log integrity, stale-count and BUILD/CHECK path assertions.
- `git diff --check` — passed; Git reported existing line-ending conversion notices.

These results confirm the current local source tree compiles and its automated suites pass. They do not implement or enable G3 Supervisor completion, G4 Team Lead release, or the separate Head inspection. Those commands remain closed until effective applicable instructions, exact qualification and action grants, required evidence and inspection criteria can be resolved and exercised. The 80-check real API/browser work-plan report remains the latest browser verification; browser workflows were not rerun in this suite-only check.

The production route was rechecked read-only at 20:35 UTC. Both Vercel VMMS projects report `live: false`, and each reports zero Production environment variables. The frontend's Production domain is verified; the API project has only its Vercel project domain and no Production custom API hostname. All listed runtime settings remain Preview-only. `https://vmms.raymond-gray.org/api/v1/health` still serves frontend HTML rather than API health JSON. No deployment, environment, domain, DNS, database or identity setting was changed. See [production route recheck](production-route-recheck-2026-11-19.md).
