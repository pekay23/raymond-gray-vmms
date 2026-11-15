# Develop and verify VMMS

Follow the repository [setup instructions](../../README.md#local-development). Run commands from `C:\Projects\raymond-gray-vmms`. Both applications are npm workspaces. The Vite development proxy forwards `/api` to the Fastify server, reproducing the intended same-origin deployment arrangement.

## Database ownership

`MIGRATION_DATABASE_URL` belongs to the local schema owner. `DATABASE_URL` belongs to `vmms_runtime`, which cannot own application tables, act as superuser or bypass RLS. The server checks these properties at startup. Development migration creates the local role if needed. These local credentials and role provisioning are not a production deployment procedure.

The integration suite creates a uniquely named `vmms_test_...` database with the migration account, applies migrations, seeds synthetic fixtures, connects with the actual runtime role, runs API/database assertions and drops only that test database. The test process must never point at a production owner URL. Keep `.env` ignored.

## Command and session behavior

Web sign-in redirects to the shared OIDC provider using an authorization code, PKCE S256, one-time state and nonce, plus a browser-bound short-lived transaction. Only an explicitly mapped active VMMS staff identity receives a VMMS session. The local test app exposes password login only under `NODE_ENV=test`. The browser still receives a host-only VMMS session and CSRF cookie; mutations send the CSRF token in `X-CSRFToken`, preserve the same-origin `Origin`, and business commands require a UUID `Idempotency-Key`.

For local OIDC smoke testing, start Keycloak from `C:\Projects\raymond-gray-auth`, register its loopback-only VMMS client, provision the disposable test user, run `npm run dev:seed`, then `npm run dev:link-auth`. Before browser smoke testing, run `npm run dev:seed-browser-switch`; it creates or verifies a marked local QA-only read-only identity for account-switch coverage. Both seeds refuse non-loopback databases, and the account-switch seed also requires a loopback OIDC issuer. It uses the existing synthetic OIDC password and creates no technical or financial grants. See the [OIDC integration design](../architecture/oidc-vmms-integration.md). Do not use synthetic local identities or credentials outside development.

Updates include `expectedVersion`. Do not retry a changed payload with the previous key or turn a rejected command into an accepted UI state.

Use a site for which the signed-in person has active membership. The server derives the organisation from that relationship. A browser-selected site ID does not grant access. The first slice saves reception drafts; it cannot approve gates, resolve safety holds, authorise repair or release a vehicle.

## Documentation and evidence

The requirement JSON and task JSON are canonical. Use `scripts/update-tracker.py` for evidenced status changes, then regenerate the Markdown tracker. Keep planned and verified statuses distinct. The verification runner records its commands, result logs and application source hashes. A check that runs while source changes cannot establish a stable final result.

Run `npm run verify` before handing off a change. It validates requirement/task traceability, historical staging, typechecks both workspaces, builds both applications, checks responsive sign-in assets, runs API integration tests, exercises the configured evidence workflow against a disposable PostgreSQL database plus isolated S3Mock/ClamAV, and checks queue pagination. It hashes both application and verification-script sources and fails if either changes during the run. The test suite does not need production credentials. The browser workflow uses local Keycloak and Microsoft Edge and is run separately with `npm run verify:browser-smoke` (or `node scripts/browser-smoke.mjs`). It includes automated Axe WCAG 2.1 A/AA scans on sign-in, the owner portal, staff queue and intake. `npm run verify:work-plan-browser` runs separate disposable-database browser workflows with synthetic Operations, team-lead and supervisor roles, including their current work queues; the harness requires local PostgreSQL provisioning credentials and tears down its uniquely named database.

CodeGraph returns current source and call paths. Graphify supports bounded relationships and impact using local code extraction. Read the [tooling review](../discovery/reference-patterns-and-tooling.md) before changing their flags. Do not include real exports, uploads, secrets or backups in semantic indexing.

Production runbooks, staff manuals and customer instructions are developed with their actual workflows. Do not document a future control as currently available.

## PDF print verification

`npm run verify:evidence-browser-recovery` runs the evidence workflow in a separate Edge/Chromium browser against a disposable PostgreSQL database, using a synthetic scanner and in-memory object store. It requires the local PostgreSQL provisioning and runtime credentials from `.env`; it creates and drops an isolated test database and worker role.

The print-layout portion of `npm run verify:work-plan-browser` requires Poppler utilities `pdftotext`, `pdfinfo` and `pdftoppm` on `PATH`. It extracts report text, checks pagination, and renders first and last pages for visual review. It does not use a screenshot of the application page as the report.
