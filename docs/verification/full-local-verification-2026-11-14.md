# Full local verification — 14 November 2026

## Latest run

The latest `npm run verify` completed **14 of 14 stages successfully** on Windows with Node v24.22.1. The run was recorded at `2026-11-14T21:36:18Z`; its machine-readable results are in [the stage report](checks/results.json), with one log per stage under [checks](checks/). It verified traceability, historical-import templates and staging, backup-package tests, API/web typechecks, production builds, the Cloudflare frontend-to-real-local-API proxy, responsive sign-in images, API integration, real S3Mock/ClamAV evidence handling, assigned-task browser behavior and paginated role queues. The runner reported `changedDuringChecks: false` and no changed source paths.

The API suite passed 139 tests, failed 0 and skipped 1 optional S3/ClamAV fixture test. The web suite passed 35 tests, failed 0 and skipped 0. The queue pagination check covered Operations, Team Lead and Supervisor with page navigation, search, retained role filters, five viewport widths, and 200%/400% browser zoom. The assigned-task browser check passed. Responsive sign-in checks passed phone, foldable, tablet, desktop, landscape, retina and zoom profiles with no recorded layout shift.

The real-service evidence browser stage passed its scan, upload recovery, explicit attachment, retry, rejection, access-control and stale-version scenarios. The disposable S3Mock and ClamAV containers, network and volumes were removed after the run. The separate optional local-storage API fixture remains skipped; its successful browser service-backed scenarios are independent evidence.

An earlier run recorded 13/14 because a cold ClamAV container did not become ready within the configured deadline. A targeted retry and this later full run both passed the real-service browser checks. The earlier failure is retained here as run history, not as the current status. The runner emits bounded ClamAV service logs when its readiness deadline expires; details are in [the targeted evidence verification](checks/evidence-browser-real-services-2026-11-14.md).

The separate broad `npm run verify:browser-smoke` is not part of the 14-stage `npm run verify` pipeline. It completed 64/64 checks on 14 November, including local OIDC login, owner-session isolation, roleless access messaging, accessibility scans, intake, evidence recovery, pagination and responsive/zoom profiles. Its scope and limits are recorded in the [browser smoke report](browser-smoke-2026-11-14.md). The browser run preceded this latest full pipeline; both results are separate evidence.

## Failure correction

Earlier runs exposed short browser navigation deadlines and a slow cold start for the local scanner. The scripts now wait for `domcontentloaded`, followed by page-readiness assertions, with bounded navigation and service-readiness deadlines. The 14 November full run completed the service-backed evidence scenarios successfully.

## Separate local auth recheck

Local staff OIDC sign-in and logout succeeded after local migrations 048–075. The configured synthetic `vmms.advisor.local` identity authenticated using the password already stored locally; no password is included here. This verifies local Keycloak and local PostgreSQL only. Production `auth.raymond-gray.org`, Google federation, physical-device passkeys, central logout, production client registration and credential hygiene remain unverified and are tracked under REV-056.

## Limits

This is local development evidence, not production deployment or staff UAT. It does not prove real-device or assistive-technology coverage, live backup restoration, approved SOPs or technical/financial grants, historical-data reconciliation, or rollout readiness. Requirements remain open until their own full acceptance criteria, owner approvals and operational evidence are complete.
