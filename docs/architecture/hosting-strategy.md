# Raymond Gray project hosting strategy

Status: provisional engineering recommendation, 8 November 2026. No provider, account, deployment, domain record or secret has been changed. Cloudflare is the preferred default for public edge delivery and compatible web applications; identity runtime and the VMMS API require independent compatibility and operational gates.

## Recommendation

Use Cloudflare as the shared edge platform where it reduces routing and operations: DNS, TLS, CDN/WAF, static marketing and documentation, and web/API projects that pass runtime and database verification on Workers. Keep deployment choices at the service boundary instead of forcing every product into Pages or a single serverless runtime.

For this architecture, consider Workers the active application target; reserve Pages for static assets/sites. Cloudflare's current direction supports static assets, SSR and APIs on Workers. Do not start a new multi-project system on legacy Pages where a Worker static-assets deployment is a better fit.

Do not promise that the existing applications can be moved directly with a DNS change. VMMS is React/Vite plus a Fastify API and PostgreSQL. Platform, remote support and vehicle services are Next.js applications with several packages that need runtime checks. Cloudflare's current Next.js guide recommends vinext, which reimplements much of the Next.js API on Vite and is explicitly in beta; OpenNext remains another deployment path. Run compatibility checks and exercise the actual routes, packages, image handling, server actions, background jobs, analytics, caching and required Node APIs before choosing either path. Cloudflare supports Vite/React apps and PostgreSQL through Hyperdrive. The current VMMS API needs a representative Worker adapter/runtime spike; if Fastify or native packages do not behave correctly, host the API in a conventional Linux container while Cloudflare remains its edge front door.

Keep Keycloak as a persistent container service backed by a separate supported managed PostgreSQL service. Cloudflare Containers can run existing container images, but that is a newer Workers product surface. Validate container lifecycle, session consistency, planned availability, backups, restore, outbound routing, region placement and administration isolation before considering it for the critical identity provider. Until this is proven and accepted, choose an established managed container/VM host for Keycloak and keep Cloudflare DNS/edge in front. Do not host Keycloak in a Worker function.

## Why not automatically Vercel for everything?

Vercel remains a strong option for the current Next.js projects because it provides a direct Node.js runtime and framework deployment path. Cloudflare has an official Workers Vite integration and its `@opennextjs/cloudflare` adapter supports many Next.js app-router features, but it is an additional compatibility surface. Compare total costs, operational ownership, region/data placement, backup and recovery for each production service. The project's current domain administration in Cloudflare is a useful consolidation point, not proof that all workloads are best served by the same compute product.

## Service-by-service target

| Service | Starting recommendation | Migration gate |
| --- | --- | --- |
| Public company pages/static assets | Cloudflare static assets/Workers | Build, redirects, forms, analytics and SEO checks |
| VMMS web (React/Vite) | Cloudflare Worker + static assets if browser and API paths pass | Full browser smoke, accessibility, upload, cache and rollback checks |
| VMMS API (Fastify/PostgreSQL) | Evaluate Worker + Hyperdrive; keep container option open | Fastify lifecycle/plugins, pg 8 version, transactions/RLS, connection behavior, uploads, worker CPU/time and integration tests |
| Raymond Gray platform (Next.js + Prisma/PostgreSQL + native modules) | Keep current provider; evaluate vinext/OpenNext in an isolated spike | Build output, Prisma adapter, SQLite/native package audit, image optimization, background work, auth OIDC and server actions |
| Remote support (Next.js) | Keep current provider until vinext/OpenNext compatibility and route checks pass | Contact/intake proxy, media, route protection, build and browser checks |
| Vehicle services (Next.js) | Keep current provider until vinext/OpenNext compatibility and route checks pass | Auth, protected routes, maps/device APIs, build and browser checks |
| Shared auth (Keycloak + PostgreSQL) | Persistent managed container/VM host initially; Cloudflare edge/DNS | Secure origin/proxy, stable sessions, supported DB, backup/restore, availability and upgrade drills; then separately assess Cloudflare Containers |
| Product PostgreSQL databases | Supported managed PostgreSQL, close to their main compute region | PITR/restore, RLS, connection pooling, region/latency and vendor exit evidence |

## Rollout and portability

1. Build deploy manifests and secret contracts without creating a production deployment.
2. Run a non-production VMMS compatibility spike against Cloudflare Workers/Hyperdrive with synthetic data. Keep the known working local Docker API as the baseline.
3. Test each Next.js repository independently; record unsupported packages and adapter/runtime gaps.
4. Compare Cloudflare Container and a conventional managed container host for Keycloak. Include monthly cost, actual region, PostgreSQL backup/restore and admin isolation.
5. Deploy a staging slice only after review of the concrete provider/configuration, domains, access controls and rollback procedure.
6. Keep application business commands, PostgreSQL migrations and OIDC contracts provider-neutral; use platform-specific adapters at the hosting boundary.

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
- [Cloudflare Containers overview](https://developers.cloudflare.com/containers/)
- [Cloudflare Container instance limits](https://developers.cloudflare.com/containers/platform/limits/)
- [Cloudflare Vite/Next framework configuration](https://developers.cloudflare.com/workers/framework-guides/automatic-configuration/)
- [Cloudflare Next.js on Workers (vinext, currently beta)](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Cloudflare Next.js migration guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/vercel-to-workers/nextjs/)
- [OpenNext Cloudflare adapter and feature support](https://opennext.js.org/cloudflare)
- [Vercel Functions runtime/region behavior and limits](https://vercel.com/docs/functions)
