# Workshop operations journey — 20 November 2026

## Result

The current local work-order journey passed **80 browser checks** against a disposable PostgreSQL database with synthetic staff and customer records. The run finished with `VERIFIED`, no failed checks and no runtime errors. Raw results, screenshots and printed report samples are in [work-plan-core-journey-2026-11-20](work-plan-core-journey-2026-11-20/).

The current local API suite passed **170 tests**, with one optional S3/ClamAV integration test skipped because those services were not configured. The web suite passed **46 tests**. API and web typechecks and production builds passed. The Head overview browser passed at 11 viewport sizes and its accessibility scan; the Technician assigned-task browser passed; the checklist preparation browser passed 10 checks with no automated WCAG violations or page errors. These checks do not prove hosted Production configuration, staff sign-off readiness, or user acceptance.

## Pilot module gate verification

The pilot hides Sales delivery and Finance setup screens while keeping Sales staff able to open service requests. A local browser run passed for eight personas: Head with Operator, Advisor, read-only Advisor, Technician, Sales-only, Operator-only, Finance-only and a multi-site account. Direct navigation to Sales deliveries and Finance setup returned Sales-only, Finance-only and read-only staff to their permitted Today page.

The API route-level test passed for all seven guarded Sales and Finance setup handlers in development, staging and production modes. Each returned the same generic `404 FEATURE_UNAVAILABLE` response without requiring an authenticated caller. The isolated test mode remained open for existing tests. Commands: `npm run verify:workspace-navigation --workspace @vmms/web`; `npm exec --workspace @vmms/api -- tsx --test --test-name-pattern "Sales and Finance setup route handlers" test/foundation.test.ts`; `npm exec --workspace @vmms/api -- tsx --test test/pilot-modules.test.ts`. The full API suite passed 170 tests with one optional S3/ClamAV integration skipped; the web unit suite passed 46 tests. API and web typechecks, the production build, and docs traceability passed.

This verifies the local pilot boundary only. It does not establish the Production deployment or completion of the invoice/payment/guarantee/receipt/departure safeguards.

## Day-to-day operations covered

- Reception intake, source-report capture and correction history.
- Head of Service Centre review, qualified Team Lead assignment, exact-scope payer response and versioned work planning.
- Team Lead handover of the current plan to a qualified Supervisor.
- Technician task updates, time records, accepted task evidence, immutable work declarations and reasoned corrections.
- Supervisor review requests and replies, scoped activity views, current assignment queues and site-level workload.
- Purpose-built service and task-progress reports, with selectable content, pagination and print isolation.
- Hold reporting and evidence-backed resolution, while independent completion/release gates remain unchanged.
- Role visibility boundaries, keyboard/focus behavior, automated WCAG checks, and phone, foldable, tablet, desktop and landscape layouts. The Team Lead plan and Supervisor handover forms passed native 200% and 400% zoom.

## Stability work

The previous attempts timed out on unrelated local PostgreSQL reads and accumulated 34 disconnected generated test databases, using about 499 MB. We confirmed that all 34 matched the harness naming pattern, were inactive and used the local `vmms` test server; we removed only those disposable databases. A site-scoped accepted-qualification candidate index was added in migration 101. The next clean browser run no longer reproduced the database timeouts.

The first clean run found a test-harness error: its final responsive assertion still inspected the Head's read-only work-order page while expecting Team Lead plan controls. The harness now selects the Team Lead page for that assertion; the final 80-check run passed. Because cleanup, the index and the harness correction were followed by the successful run, the timeout cause is not attributed to the index alone.

## Limits

- This verifies a local synthetic journey only. It is not staff UAT, production identity, production database/RLS proof, production storage or a production deployment check.
- Supervisor technical completion, Team Lead release, Head inspection and vehicle departure remain unavailable until effective vehicle-specific procedures, action grants, qualifications, inspection/evidence criteria and commercial handover rules are configured.
- Sales delivery and Finance setup navigation/direct pages and APIs are locally verified as unavailable outside isolated tests, including role-specific direct-route behavior. Production runtime and the separate transaction closeout controls still require verification.
- The screens capture attributed work and reviews; they do not authorize repairs or infer that a vehicle is safe or ready to leave.
- Physical-device and manual screen-reader checks remain open.
