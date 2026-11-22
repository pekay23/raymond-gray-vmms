# Full local verification — 18 November 2026

## Result

The latest `npm run verify` completed all 15 stages successfully on Windows with Node v24.22.1 at 00:00 UTC on 19 November. The machine-readable report is [the stage results](checks/results.json); each command has a saved log in [checks](checks/). The runner reported `changedDuringChecks: false` with no changed source paths.

The latest run passed documentation and traceability checks for 258 requirements and 724 tasks; historical-import templates and staging tests; evidence-backup package tests; image generation; API and web typechecks; API and web builds; Cloudflare Worker-to-local-API/PostgreSQL proxy integration; responsive sign-in assets; API/web test suites; the real S3Mock/ClamAV browser journey; technician assigned-task browser checks; and Operations, Team Lead and Supervisor pagination/browser checks.

The API suite passed 153 tests, failed 0 and skipped 1 optional S3/ClamAV fixture. The web suite passed 40 tests, failed 0 and skipped 0. The proxy check used a disposable local database and synthetic identity; it did not change Cloudflare production resources. Its fixture now creates an active Service Advisor placement, matching the API's current work-order access policy.

Responsive sign-in checks covered 280–2560 px, portrait and landscape foldable/tablet/phone profiles, retina, and 200%/400% browser zoom; the recorded layout-shift value was zero for each profile. The evidence-service browser run verified clean, delayed, rejected and interrupted uploads, retry, attachment, replay and access behavior, then confirmed its disposable containers, network and volumes were removed. Queue pagination covered search, page changes and retained role filters across five widths plus 200%/400% zoom.

The isolated local Keycloak role rehearsal passed all 14 staff personas. It verified the Operator/Head separation and denied work-order access for roles outside the workshop. Details are in [the role rehearsal report](auth-role-fixture-2026-11-18.md). This extra run is not part of the 15-stage machine report. The separate work-plan browser run also passed all 73 recorded checks with Chromium 157 on a disposable PostgreSQL database; see [its result](browser-work-plan/results.json). It exercises Operations review, work-plan, Supervisor handoff, Technician activity/evidence, report generation, queues, holds and responsive/accessibility behavior.

## Limits and remaining gates

This is local synthetic verification. It does not establish production deployment, Cloudflare account configuration, shared-auth production behavior, staff UAT, live backup restoration, physical-device/HarmonyOS coverage, or customer-data import accuracy.

G2 remains unavailable until versioned estimate/charge and technical-review records, their separate action grants and applicable instructions are implemented and verified. G3/G4 remain unavailable until source-backed task procedures, qualifications, inspection criteria and authority are configured. The approved interim policy does not create manufacturer-specific EV/HV instructions or person-specific grants. See [G2 authorization design](../architecture/g2-scope-authorization.md), [interim workshop policy](../operations/interim-workshop-operating-policy.md), and the open implementation tasks.
