# VMMS Production routing state (2026-11-19)

This is a read-only deployment and database check for the Vercel/Neon migration. No Production deployment, environment variable, database, domain, or DNS record was changed.

## Evidence

- The existing Vercel frontend project owns the verified `vmms.raymond-gray.org` Production domain. Its latest Production deployment is `dpl_HBTRWDDNhkhjtRz2eeXcNEtPxR9V` on commit `7da5e845096241fa338cce75e90f5f825af3364a` (commit message: `ci: simplify Railway deploy - service must be created manually first`).
- The live `https://vmms.raymond-gray.org/api/v1/health` path returned HTTP 200 with the frontend HTML document, not the API's JSON health response. The live `/api/v1/session` path did the same. These probes do not show a functioning VMMS API on the Production domain.
- The protected Vercel API Preview alias returned HTTP 200 and `{"status":"ready"}` from `/api/v1/health`.
- The existing Vercel API project's Root Directory is now `apps/api`, and its Preview install command explicitly includes workspace dev dependencies. The earlier Production deployment, `dpl_8arAruDiPW46DbPCJwfE4zLPffne`, remains `ERROR`; its upload lacked the `apps/api` subtree while requesting that root. A new deployment uploaded the full repository root and is Ready as protected Preview `dpl_4gbLX8dJw35ocPVVx9HnWPUczWfN`.
- The first root-based attempt built the web app under the API project's Preview alias. That exposed that the API project must use the API subdirectory as its Vercel root. Its Preview `NODE_ENV=production` also omitted TypeScript and image tooling; Preview is now `development`, and the corrected API build installed dev dependencies and passed.
- The corrected Preview returned JSON HTTP 200 from `/api/v1/health` (`{"status":"ready"}`) and `/api/v1/session` (`{"authenticated":false}`). `/api/v1/auth/oidc/start` returned HTTP 302 to the Production auth issuer and used the stable VMMS Preview callback. The callback/client has not been registered with the identity service, so this proves route construction only, not completed authentication.
- The stable API Preview alias `vmms-api-preview-pekay23s-projects.vercel.app` now points to `dpl_4gbLX8dJw35ocPVVx9HnWPUczWfN`. Through the stable frontend Preview alias, proxied health and session also returned the same JSON responses, and proxied OIDC start returned HTTP 302 to `https://auth.raymond-gray.org/api/auth/oauth2/authorize`.
- Vercel environment metadata (values not retrieved) shows the API and frontend projects currently have only Preview variables. There is no Production `DATABASE_URL`, session secret, OIDC client configuration, API origin, or proxy bypass configured in those projects.
- The existing Neon project `raymond-gray-vmms` (`dawn-wind-48590007`) has a ready default branch named `production` (`br-ancient-fire-bjnkcr4r`) and a separate Preview integration branch (`br-dawn-firefly-bj1y8jzd`). The Production branch currently has no application tables. No business rows were queried.

## Result

The current Production `/api/v1/*` request falls through to the frontend; it is not serving the new Vercel API. This particular path did not reach Railway, but this check does not prove there are no Railway references elsewhere in the deployed frontend. The API Root Directory and Preview build are corrected, but Production cutover is not ready: the prior Production deployment is still in error, Production runtime settings are absent, the Neon Production branch is uninitialized, and the OIDC client has not been registered at `auth.raymond-gray.org`.

Keep the current Production deployment and data untouched until a Production-target API deployment from the corrected `apps/api` root is reviewed, the isolated Production database schema and least-privilege runtime role are prepared, the Production Vercel settings are reviewed, and the VMMS OIDC callback/client setup can be verified. The older Production site remains separate from the protected Vercel Preview integration.
