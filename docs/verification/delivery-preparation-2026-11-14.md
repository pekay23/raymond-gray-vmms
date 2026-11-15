# Delivery preparation implementation verification

**Status:** Source-attributed delivery preparation and explicit delivery linkage verified locally. Technical PDI is still unavailable; this record does not claim the full USER-043 requirement is complete.

## Implemented scope

- A Sales Representative can create one or more site-scoped preparation records for a canonical vehicle before an actual delivery is recorded. A new stock vehicle and its first preparation are created in one command under the organisation-wide VIN lock.
- Preparation records retain their source reference, notes, actor and timestamp. They do not create a visit or work order, infer a client/owner/payer, record technical completion, or authorize work or release.
- The vehicle-history read returns preparations separately from dated deliveries and existing PDI observations. Preparation-only VIN lookup is restricted to active Head of Service Centre, Sales Representative and PDI Observer roles.
- After an actual dated delivery exists, a Sales Representative explicitly selects its ID. The link command checks the expected preparation version, same vehicle, same site and writable role; it stores an immutable versioned relation and the shared command event, receipt and outbox atomically.
- Multiple preparations per vehicle and multiple preparation links to one delivery are allowed. No one-preparation or one-link-per-delivery business rule was inferred.
- The page states that a technical PDI checklist is unavailable because no approved vehicle-specific procedure is configured. Preparation notes do not represent a checklist or sign-off.

## Verification evidence

- Local migrations `076_delivery_preparations.sql` and `077_allow_multiple_preparation_links_per_delivery.sql` applied to the configured local PostgreSQL host `127.0.0.1`; no remote database was changed.
- The focused disposable-PostgreSQL API test passed: 1 test, 0 failures. It verifies role denial, same-site visibility, no visit/work-order creation, no inferred client, no link before an actual delivery, wrong-vehicle rejection, two preparations sharing one dated delivery, same-key replay, changed-payload rejection, concurrent link attempts (one success and one conflict), event/receipt/outbox counts, forced RLS, and no runtime UPDATE/DELETE access.
- `npm run typecheck` passed for the API and web workspaces.
- `npm run verify:sales-deliveries-browser` passed 17 browser checks using a disposable synthetic database. It covers two preparations, independent selectors, actual-delivery creation and explicit links, observation/correction history, reload persistence, eight viewport profiles (including foldable cover), an Axe WCAG 2.1 A/AA scan with 0 violations, and no uncaught page errors. Detailed output and screenshots are in [the browser results folder](sales-deliveries-browser/results.json).
- The full local verification run passed traceability, historical-import template and staging checks, evidence backup package tests, typecheck, production build, Cloudflare Worker proxy integration against the local API, responsive/sign-in image checks, API integration (135 passed, 0 failed, 1 optional external-service fixture skipped), technician assigned-task browser checks, and queue-pagination browser checks. Queue pagination covered Operations, Team Lead and Supervisor at phone, tablet, desktop, 200% and 400% zoom.
- The full run's real-service evidence browser stage did not pass: its disposable ClamAV container did not answer the local readiness handshake within 180 seconds. The orchestration removed its temporary containers, network and volumes successfully. Evidence upload browser behavior against S3Mock + ClamAV therefore remains unverified by that run; the timeout does not indicate an application assertion failure.
- `git diff --check` completed without whitespace errors; Git reported only existing line-ending conversion notices.

## Remaining boundaries

- No approved model-specific PDI procedure, effective checklist template, technical grant, evidence/measurement rule or approval authority exists. No PDI task, pass/fail result, technical sign-off or delivery gate is available.
- REV-055 still requires owner decisions on preparation correction, cancellation, repeat/reinspection rules and whether PDI is a handover prerequisite. REV-049 still controls broader Sales and after-sales visibility. Those decisions are not implied by this implementation.
- This is synthetic local verification only. Staff UAT, production identity/deployment, real customer history import, assistive-technology review and physical-device verification remain open.
