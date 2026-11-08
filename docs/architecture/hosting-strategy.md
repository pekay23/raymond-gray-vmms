# Raymond Gray project hosting strategy

Status: provisional engineering recommendation, 8 November 2026. No provider, account, deployment, domain record or secret has been changed. Cloudflare is the preferred default for public edge delivery and compatible web applications; identity runtime and the VMMS API require independent compatibility and operational gates. A repository-backed source audit has been completed; the required runtime/build spikes are still open.

## Recommendation

Use Cloudflare as the shared edge platform where it reduces routing and operations: DNS, TLS, CDN/WAF, static marketing and documentation, and web/API projects that pass runtime and database verification on Workers. Keep deployment choices at the service boundary instead of forcing every product into Pages or a single serverless runtime.

For this architecture, consider Workers the active application target; reserve Pages for static assets/sites. Cloudflare's current direction supports static assets, SSR and APIs on Workers. Do not start a new multi-project system on legacy Pages where a Worker static-assets deployment is a better fit.

Do not promise that the existing applications can be moved directly with a DNS change. VMMS is React/Vite plus a Fastify API, PostgreSQL, and a continuously polling evidence-scan worker. Cloudflare Workers supports a subset of Node APIs, including `node:net`, and PostgreSQL can connect through Hyperdrive; that does not make the current Fastify server lifecycle or always-running worker a drop-in Worker deployment. A Workers implementation would need an HTTP Fetch adapter and event-driven scan jobs (for example, a queue consumer), with transaction/RLS, uploads, retries, and recovery proven in a synthetic runtime spike. Until that passes, use a conventional container as the VMMS API/scanner baseline and Cloudflare for the web assets and edge. Vercel Functions offer a broad Node runtime but are request-triggered functions, so they are not a direct host for the current resident scanner loop either.

Platform, remote support and vehicle services are Next.js applications with different dependency and route profiles. Cloudflare's current Next.js guide recommends vinext, which reimplements much of the Next.js API on Vite and is explicitly in beta; OpenNext remains another deployment path. Run compatibility checks and exercise the actual routes, packages, image handling, server actions, background jobs, analytics, caching and required Node APIs before choosing either path.

Keep Keycloak as a persistent container service backed by a separate supported managed PostgreSQL service. Cloudflare Containers can run existing container images, but that is a newer Workers product surface. Validate container lifecycle, session consistency, planned availability, backups, restore, outbound routing, region placement and administration isolation before considering it for the critical identity provider. Until this is proven and accepted, choose an established managed container/VM host for Keycloak and keep Cloudflare DNS/edge in front. Do not host Keycloak in a Worker function.

## Why not automatically Vercel for everything?

Vercel remains a strong option for the current Next.js projects because it provides a direct Node.js runtime and framework deployment path. Cloudflare has an official Workers Vite integration and its `@opennextjs/cloudflare` adapter supports many Next.js app-router features, but it is an additional compatibility surface. Compare total costs, operational ownership, region/data placement, backup and recovery for each production service. The project's current domain administration in Cloudflare is a useful consolidation point, not proof that all workloads are best served by the same compute product.

## Service-by-service target

| Service | Starting recommendation | Migration gate |
| --- | --- | --- |
| Public company pages/static assets | Cloudflare static assets/Workers | Build, redirects, forms, analytics and SEO checks |
| VMMS web (React/Vite) | Cloudflare Worker + static assets if browser and API paths pass | Full browser smoke, accessibility, upload, cache and rollback checks |
| VMMS API (Fastify/PostgreSQL) | Conventional container for the current server/worker shape; separately spike a Worker redesign with Hyperdrive and Queues | Fastify lifecycle or Fetch adapter, pg, transactions/RLS, connection behavior, uploads, queue retries/recovery, scan integration and rollback |
| Raymond Gray platform (Next.js + Prisma/PostgreSQL + native modules) | Keep on Vercel for now | Isolated compatibility spike for Next adapter, Prisma/pg, `argon2`, cron replacement, analytics, image optimization, background writes and OIDC |
| Remote support (Next.js) | Candidate for Cloudflare Workers after an isolated build/route check | Contact relay timeout, forwarded client metadata, failure responses, media, route protection and browser checks |
| Vehicle services (Next.js) | Candidate for Cloudflare Workers after an isolated build/route check | Booking relay limits/timeouts, auth, protected routes, maps/device behavior, build and browser checks |
| Shared auth (Keycloak + PostgreSQL) | Persistent managed container/VM host initially; Cloudflare edge/DNS | Secure origin/proxy, stable sessions, supported DB, backup/restore, availability and upgrade drills; then separately assess Cloudflare Containers |
| Product PostgreSQL databases | Supported managed PostgreSQL, close to their main compute region | PITR/restore, RLS, connection pooling, region/latency and vendor exit evidence |

## Rollout and portability

1. Build deploy manifests and secret contracts without creating a production deployment.
2. Run a non-production VMMS compatibility spike against Cloudflare Workers/Hyperdrive with synthetic data. Keep the known working local Docker API as the baseline.
3. Test each Next.js repository independently; record unsupported packages and adapter/runtime gaps.
4. Compare Cloudflare Container and a conventional managed container host for Keycloak. Include monthly cost, actual region, PostgreSQL backup/restore and admin isolation.
5. Deploy a staging slice only after review of the concrete provider/configuration, domains, access controls and rollback procedure.
6. Keep application business commands, PostgreSQL migrations and OIDC contracts provider-neutral; use platform-specific adapters at the hosting boundary.

## Repository-backed compatibility findings

These findings are a source audit, not a successful provider build or deployment. They are based on repository manifests and call paths; `.env` files, credentials and customer records were not inspected.

- `C:\Projects\raymond-gray-vmms\apps\api\src\app.ts` starts Fastify, checks runtime PostgreSQL role/RLS safety, and accepts streamed evidence uploads. `apps/api/src/evidence.ts` uses Node streams and TCP (`node:net`) for ClamAV and runs the scan worker as a persistent polling loop. `apps/api/src/db.ts` uses `pg` transactions with transaction-local tenant/site/actor scope. This makes a container the low-change API baseline; a Worker migration entails a server adapter and durable job model even though Workers exposes Node `net` and Hyperdrive.
- `C:\Projects\raymond-gray-platform\package.json`, `src/lib/prisma.ts`, `src/app/signin/actions.ts`, and `vercel.json` show Next.js 16, Prisma 7/PostgreSQL adapters, `argon2`, a Vercel SLA cron, and Vercel observability integrations. Keep this app on Vercel until a Workers build proves those integration points. `better-sqlite3` is declared but no direct application import was found in the source audit; its runtime impact remains unverified.
- `C:\Projects\raymond-gray-remote-support\src\app\api\contact\route.ts` is a small Fetch-based relay with no declared database or background-job package. It is a plausible Cloudflare candidate after route, timeout, request-metadata, and failure-response checks.
- `C:\Projects\raymond-gray-vehicle-services\src\app\api\booking\route.ts` validates and relays bounded booking requests and does not declare a database package. It is a plausible Cloudflare candidate after adapter, request-limit, timeout, and map/browser checks.
- `C:\Projects\raymond-gray-auth\compose.yaml`, `README.md`, and `docs\architecture.md` describe a local-only Keycloak/PostgreSQL Compose environment; no production auth application or deployment config exists there. Use a managed Linux container/VM and managed PostgreSQL as the initial candidate. Do not put Keycloak in a Worker or Vercel Function. Cloudflare Containers remain a separate, unproven alternative requiring an operational trial.

The findings do not settle the account plan, database region, cost, recovery targets, approved hostname, or production host. Those remain owner decisions under O-006/USER-024.

## Open owner decisions

- Budget/availability/recovery targets and named operations owner per service.
- Cloudflare Workers paid account availability and provider plan needed for production.
- PostgreSQL region and provider for VMMS and auth.
- Whether to prioritize one provider versus the lowest-risk runtime fit per product.
- Whether Cloudflare Containers' operational maturity and limits meet auth-service expectations.
- Vercel account/plan cost comparison where Next.js compatibility and migration effort favor it.
- Approved production hostnames and DNS/certificate changes.

## Current-source evidence

- [Cloudflare React/Vite Worker integration](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)
- [Cloudflare PostgreSQL and Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
- [Cloudflare Workers best practices for remote databases](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Workers `node:net` API](https://developers.cloudflare.com/workers/runtime-apis/nodejs/net/)
- [Cloudflare Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Cloudflare Queues and Workflows for background work](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Containers overview](https://developers.cloudflare.com/containers/)
- [Cloudflare Container instance limits](https://developers.cloudflare.com/containers/platform/limits/)
- [Cloudflare Vite/Next framework configuration](https://developers.cloudflare.com/workers/framework-guides/automatic-configuration/)
- [Cloudflare Next.js on Workers (vinext, currently beta)](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Cloudflare Next.js migration guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/vercel-to-workers/nextjs/)
- [OpenNext Cloudflare adapter and feature support](https://opennext.js.org/cloudflare)
- [Vercel Functions runtime/region behavior and limits](https://vercel.com/docs/functions)
- [Vercel Functions payload limit and direct-upload guidance](https://vercel.com/docs/errors/function_payload_too_large)
- [Keycloak production configuration](https://www.keycloak.org/server/configuration-production)
