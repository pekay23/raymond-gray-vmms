# Production and Preview route recheck — 19 November 2026

## Read-only checks

Checked the Vercel VMMS project and fetched its current routes through the Vercel connector. No configuration, environment variable, deployment target, domain, DNS, or production data was changed.

- Vercel project `raymond-gray-vmms` reports `live: false`; latest deployment `dpl_GLWUMNnv6qVEN1AXqNL8mGWoNopq` is `READY` with `target: null`, built from commit `e6e9b4cbac1e8ae3905ea5989b510c367f52e363`.
- That protected Preview deployment returns HTTP 200 JSON `{"status":"ready"}` for `/api/v1/health` and HTTP 200 JSON `{"authenticated":false}` for `/api/v1/session`.
- Preview `/api/v1/auth/oidc/start` returns HTTP 302 to `auth.raymond-gray.org` using the stable VMMS Preview callback, but its client ID is the unregistered `vmms-preview-unconfigured-…` placeholder. This verifies redirect construction, not an authenticated session.
- The Production custom domain `https://vmms.raymond-gray.org/api/v1/health` returns HTTP 200 with the frontend `index.html`, not API health JSON.

## Live deployment recheck — 19 November 2026, 12:25 UTC

This follow-up used the connected Vercel account and read-only HTTP requests. It did not retrieve decrypted environment values or change deployment settings.

- The public identity issuer now returns HTTP 200 OIDC discovery JSON at `https://auth.raymond-gray.org/api/auth/.well-known/openid-configuration`, with issuer `https://auth.raymond-gray.org/api/auth`. The auth service discovery endpoint is reachable; that does not establish a VMMS client registration or a successful user login.
- The current Vercel API Preview returns HTTP 200 JSON `{"status":"ready"}` from `/api/v1/health`.
- The API project's only Production deployment remains `ERROR` with `NOW_SANDBOX_WORKER_ROOTDIR_NOT_EXIST`: the upload did not include `apps/api` while the project requested that Root Directory. The latest API deployment is a Preview (`target: null`), not Production.
- Environment metadata for both VMMS projects has no Production variables (`hiddenProductionEnvCount: 0`); the visible API and web integration settings target Preview only. No values were decrypted.
- A fresh request to `https://vmms.raymond-gray.org/api/v1/health` still returns HTTP 200 `text/html`, the frontend document rather than API JSON.

## Result

The tested Preview API is not a Production deployment and cannot complete staff login: Preview still uses an unregistered placeholder client. The public auth discovery endpoint is reachable, but the Production domain still has no working `/api/v1` API route, the API Production deployment is errored, and neither project has Production runtime variables. Keep release status open until routing, production database schema/runtime credentials, registered VMMS client, and authenticated end-to-end login are configured and verified. Earlier database inspection is recorded in [production routing state](production-routing-state-2026-11-19.md).

## Live deployment recheck — 19 November 2026, 12:54 UTC

Checked both Vercel projects and their current domains with read-only project, deployment, environment-metadata and HTTP requests. No values were decrypted, and no settings or deployments were changed.

- The web project's `vmms.raymond-gray.org` domain is verified and serves the frontend. Its latest Production deployment is `READY`, but it was built from an older commit than the current `main` Preview.
- The API project's only Production deployment is still `ERROR`. Its latest deployments built from current `main` are Preview deployments with `target: null`.
- Both projects report zero Production environment variables. Their configured environment variables target Preview only.
- The API Preview still has a placeholder VMMS OIDC client ID. The shared auth discovery endpoint returns HTTP 200 with issuer `https://auth.raymond-gray.org/api/auth`, but discovery does not prove that the VMMS client exists or that a staff login completes.
- `https://vmms.raymond-gray.org/api/v1/health` returns HTTP 200 `text/html` containing the frontend document, not the API health response.
- `https://raymond-gray-vmms-api.vercel.app/api/v1/health` returns HTTP 404 `DEPLOYMENT_NOT_FOUND`.

Production deployment remains blocked by API routing/runtime setup, missing Production variables for both projects, the VMMS OIDC client registration, and production database/runtime verification. The current Preview remains the only API deployment that returned a healthy JSON response in the recorded check.

## Local runtime configuration inventory — 19 November 2026, 13:10 UTC

Read the local `.env` variable names and evaluated configuration shape without printing values. The file is a development configuration, not a production source of truth: `NODE_ENV` is not production; the web origin, identity issuer and callbacks do not match the production origins; MFA assurance is not enabled; and the production API proxy origin and Vercel protection bypass are absent. Database runtime and evidence-storage variables exist locally, but their production target and authority were not established by this inventory. Do not copy local values into Production.

The API startup validation requires an exact HTTPS issuer, web origin, login callback and logout callback, a configured OIDC secret, MFA assurance outside local development, and other production safeguards. `readConfig()` currently ends with an unconditional Production startup rejection pending identity, MFA and deployment readiness review. A passing Preview health check therefore cannot establish that Production can start safely. Keep production deployment and login gates open until the identity owner registers the VMMS client and callback and Production runtime, database and evidence settings are prepared and reviewed.

The latest protected Preview health endpoints were fetched again at 13:03 UTC and returned HTTP 200 JSON `{"status":"ready"}` for both the API project and same-origin web proxy. The custom Production domain continues to return HTTP 200 frontend HTML at `/api/v1/health`. No deployment or settings were changed.

## Live deployment recheck — 19 November 2026, 18:58 UTC

Rechecked the current Vercel project records, deployment history, environment-variable metadata and public routes. No values were decrypted and no configuration or deployment was changed.

- Both Vercel projects still report `live: false`. Their newest builds from `main` are `READY` Preview deployments (`target: null`), including the API deployment `dpl_4gbLX8dJw35ocPVVx9HnWPUczWfN`; the web and API projects do not have a current Production deployment from this revision.
- The latest protected API Preview returns HTTP 200 `application/json` with `{"status":"ready"}` from `/api/v1/health`.
- `https://vmms.raymond-gray.org/api/v1/health` still returns HTTP 200 `text/html` containing the web app's `index.html`, confirming the Production path does not reach the API.
- The Vercel API project has no custom API hostname configured. All reported API and web runtime variables target `preview`; neither project has Production variables. Variable values were not requested or read.

Production remains unavailable for staff use. The immediate hosting setup required is a production API runtime and route for the web origin, reviewed Production-only runtime/database/evidence configuration, a registered Production OIDC client and callbacks, and a successful authenticated end-to-end check. Do not copy local or Preview secrets into Production.

## Live deployment and local release-check recheck — 19 November 2026, 20:35 UTC

Checked the Vercel project records, Production-domain metadata, environment-variable targets without decryption, and public API path. No configuration or deployment was changed.

- `raymond-gray-vmms` and `raymond-gray-vmms-api` both report `live: false`; their latest deployments are `READY` Preview deployments (`target: null`).
- Both projects report zero Production environment variables. The listed frontend API origin and bypass setting, and all listed API runtime settings, target Preview only.
- `vmms.raymond-gray.org` is attached and verified on the frontend project. The API project has no custom API hostname; its only Production domain is the Vercel project hostname.
- `https://vmms.raymond-gray.org/api/v1/health` returns the frontend HTML shell rather than the API health response. Production therefore still has no working same-origin API route.
- Local `npm test` passed (API 164 passed, 0 failed, 1 optional integration skipped; web 43 passed, 0 failed), `npm run typecheck`, `npm run build`, `npm run docs:check` and `npm run docs:test` all passed. This does not repair Production routing/configuration or prove authenticated Production login.

The VMMS auth issuer discovery endpoint is reachable under `https://auth.raymond-gray.org/api/auth/.well-known/openid-configuration`, but the production VMMS client and exact callback/login path remain unverified. Production release remains blocked on a production API deployment and route, reviewed Production-only database/evidence/runtime settings, a registered VMMS Production client, and successful authenticated role checks. Preview credentials were not decrypted or copied.
