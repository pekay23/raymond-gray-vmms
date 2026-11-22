# VMMS production readiness check — 19 November 2026

## Decision

Do not deploy this revision to Production yet. The user authorized a production release after local readiness is confirmed, and directed that there be no Preview deployments. Local core workflow checks are green, but the Vercel projects have no Production runtime configuration and shared auth is not fully integrated for VMMS. Nothing was deployed.

Keep the standalone API project. It is the VMMS server runtime, not a duplicate web portal. Vercel currently shows one web project (`raymond-gray-vmms`) and one API project (`raymond-gray-vmms-api`).

### Local recheck update — 20 November 2026

The earlier work-plan browser failure below is superseded: after removing 34 inactive, harness-named local test databases and correcting the responsive test to inspect the Team Lead page that owns the plan controls, the complete journey passed 80/80 checks against disposable PostgreSQL with no browser errors. See [the 20 November workshop journey](workshop-operations-journey-2026-11-20.md). Production configuration remains blocked as recorded here.

### Production configuration recheck — 20 November 2026

- Vercel still has exactly two VMMS projects: `raymond-gray-vmms` (web) and `raymond-gray-vmms-api` (standalone API). The API remains a separate project because it provides the server runtime; it is not a duplicate portal.
- Both projects report `live: false`. The API's recent `main` deployments are READY build records with no Production target. The API project has 14 environment variables, all scoped to Preview; no Production runtime variables were found. The web project remains unpromoted as well.
- Vercel has `api.raymond-gray.org` attached to the standalone API project and reports it verified. Cloudflare's `raymond-gray.org` zone has no DNS record for that hostname. The project-specific Vercel CNAME remains `b5e1d81e4c679f42.vercel-dns-017.com` from the earlier domain setup. DNS is intentionally not linked until the API has a working Production deployment and its health route is verified.
- Current API configuration enforces Production-only origin, issuer, callback, HTTPS, MFA assurance and Vercel runtime checks in `apps/api/src/config.ts`; the old note that it contained an unconditional Production sentinel is stale and has been corrected below. These code checks do not provide the missing Production variables, a registered VMMS client, database schema/RLS proof, private evidence services or a deployed API.
- The auth Production rollout report still says the VMMS Production OIDC client and full VMMS callback/logout flow are unverified. The auth repository is not modified by this VMMS release check.

No Production alias, DNS record, environment variable, database migration, invitation or user record was changed during this recheck.

## Local verification

- `node --import tsx --test apps/web/src/worker.test.ts apps/web/src/vercel-proxy.test.ts`: **12/12 passed**. Added coverage confirms a noncanonical API origin is rejected before forwarding credentials and a canonical production request does not receive the Preview bypass header.
- `npm run typecheck --workspaces --if-present`: **passed** for the API and web workspaces.
- `npm run verify:cloudflare-real-api-proxy`: the asset generation and Worker/client build passed, but the integration did not start on this Windows host. Wrangler exited with `spawn EFTYPE`; the test did not verify proxy runtime behavior. The stale import of the removed `apps/api/src/app.ts` was corrected to `apps/api/src/routes.ts` before this attempt.
- `npm run verify:work-plan-browser` on the initial 19 November attempt failed while the local test server contained 34 stale generated databases. The 20 November clean rerun passed all 80 checks, including Supervisor handover at 200%/400%, hold resolution and the final 11-viewport sweep. The timeout's cause was not isolated to the new candidate index versus database cleanup; see the dated journey report.
- The earlier full API run had 3 failures under suite load. On 20 November, the complete API rerun passed 167 tests, with 0 failures and one optional S3/ClamAV integration test skipped because those services were not configured. The complete web suite passed 44 tests. See the dated journey report for scope and limits.

## Production configuration observed

Read-only Vercel checks found both projects marked `live: false`. The API runtime variables are Preview-only; no Production runtime variable set was present. Its newest `main` deployment is READY but has no Production target. The API Production deployment has no confirmed live health route.

The API project now has `api.raymond-gray.org` attached in Vercel. Its Vercel DNS configuration recommends the project-specific CNAME `b5e1d81e4c679f42.vercel-dns-017.com`. Cloudflare currently has no DNS record for `api.raymond-gray.org`, so the hostname does not route to Vercel. Do not create that record until the API Production runtime and health checks are ready; otherwise the new host would point to an unready service.

## Independent review findings

The two read-only production reviews found:

1. `apps/api/src/config.ts` now has concrete Production configuration checks for the Vercel runtime, deployment stage, exact web/auth/callback origins, HTTPS and MFA assurance. No unconditional Production sentinel is present in the current source. Production startup still cannot be verified because no Production runtime variables or registered VMMS identity client are configured; retain all existing fail-closed validations and prove startup only after those prerequisites are configured.
2. Production identity depends on the central auth client returning `acr=urn:raymond-gray:auth:mfa` and `amr` containing `mfa`; that deployed claim contract has not been verified.
3. Vercel ingress currently trusts proxy headers wholesale. Verify the platform's trusted client-IP behavior or use a narrowly configured trusted-hop policy before relying on IP-based OIDC throttling.
4. Production tenant/site isolation needs PostgreSQL proof using the real non-owner, non-superuser, non-`BYPASSRLS` runtime role, including cross-site and cross-organisation denials.
5. The review did not find a completed migration/RLS audit. A green typecheck or local SQLite result would not satisfy the hosted PostgreSQL checks.

The production web proxy source was hardened in this checkpoint: Production requires the exact `https://api.raymond-gray.org` origin and never forwards `VMMS_API_PROTECTION_BYPASS`. This change is local and has not been deployed.

## Remaining release gates

- The Supervisor-handover timeout did not recur on the clean 20 November run; keep monitoring this path under hosted PostgreSQL load and real staff use.
- Complete the relevant API suite without unexplained failures and verify the current migration set against the hosted PostgreSQL runtime role and RLS policies.
- Register and verify the VMMS OIDC client and callback/logout URLs in `auth.raymond-gray.org`; confirm its MFA assurance claims against the API contract. Do not change the auth repository as part of this workstream.
- Configure Production-only API/database/evidence variables and service bindings using dedicated Production credentials; do not copy Preview secrets.
- Keep all concrete Production configuration checks fail-closed until the exact production settings and dependencies are reviewed and verified. Keep the API proxy's exact Production origin and no-bypass checks.
- After a working Production API deployment and health check, add the project-specific Cloudflare CNAME in DNS-only mode, verify Vercel domain configuration and TLS, then check the API JSON health route and same-origin web proxy route over the new hostname.
- Verify the production deployment has the expected commit, protected session behavior, rollback target and monitoring before calling it live.
- Keep `O-020` open until recovery/rollback has been exercised and the selected pilot configuration has passed the required acceptance checks.

## Scope and data safety

No production database, staff records, invitations, DNS records, runtime variables, or live notifications were changed. The Vercel API custom-domain association was added, but no Cloudflare record was created. No secret values were decrypted or included in this report.
