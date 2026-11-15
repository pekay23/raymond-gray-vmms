# Raymond Gray project hosting strategy

Status: provisional engineering recommendation, updated 14 November 2026. No provider, account, deployment, domain record or secret has been changed. The current per-service assessment and new findings are recorded in the [14 November hosting compatibility review](../verification/checks/hosting-compatibility-2026-11-14.md). Cloudflare remains the preferred edge and VMMS web candidate; keep the VMMS API/scanner on a conventional Node container behind its tested fixed-origin proxy for now. The direct Fastify Worker spike again failed during route registration because `workerd` rejected router `new Function` code generation; tenant commands and uploads did not run. HOST-001 remains in progress.

## Owner preference

The owner selected Cloudflare Pages as the preferred VMMS web frontend deployment target and has Vercel available as a fallback. The current app is a React/Vite frontend plus a separate Fastify/PostgreSQL API and evidence scanner. Pages Functions run on the Workers runtime with a subset of Node.js APIs; this does not prove that the current API, streaming uploads, database transaction semantics or long-running scanner fit. First test Pages/Workers same-origin routing and the real API behaviors; use a separate Worker/container or Vercel/container runtime for the API and scanner if required. Do not deploy or change DNS before the proof and exact release are reviewed.

## Recommendation

Use Cloudflare as the shared edge platform where it reduces routing and operations: DNS, TLS, CDN/WAF, static marketing and documentation, and web/API projects that pass runtime and database verification on Workers. Keep deployment choices at the service boundary instead of forcing every product into Pages or a single serverless runtime.

For this architecture, consider Workers the active application target; reserve static assets deployments for static sites. Cloudflare's Vite plugin supports a React SPA with static assets and API Worker routing. Cloudflare also now provides `cloudflare:node` `httpServerHandler` to adapt supported Node HTTP servers into the Worker Fetch lifecycle. That makes a Fastify Worker experiment credible, but does not establish Fastify compatibility or production readiness. Do not start a new multi-project system on a legacy Pages-only model where a Worker static-assets deployment is a better fit.

Do not promise that the existing applications can be moved directly with a DNS change. VMMS is React/Vite plus a Fastify API, PostgreSQL, and a continuously polling evidence-scan worker. Cloudflare's HTTP adapter may support Fastify's underlying server, but the app's startup, cookies, raw streamed uploads, content parser, S3 client and Node streams need a local Worker-runtime proof. Hyperdrive documents `pg` support and supports local `wrangler dev` with a direct local connection; prove transaction-local RLS context and transaction-scoped advisory locks against a disposable database, then separately validate remote Hyperdrive pooling. Cloudflare Queues can replace the resident scan loop only after retry, idempotency, poison-message handling and operational monitoring are demonstrated. Until those tests pass, the conventional container remains the low-change API/scanner baseline.

Vercel is also a credible API candidate: its current Fastify guide deploys a Fastify app as a Node.js Function, and this repo's server entry uses `app.listen()`. However, Vercel Functions impose a 4.5 MB request/response body limit, while VMMS currently permits configuration of evidence uploads up to 100 MiB. A Vercel Functions deployment therefore cannot carry the maximum-size upload route. It would require either an independently verified container/origin path for uploads or a security-reviewed direct-to-private-storage upload design that preserves scoped upload intents, quarantine, checksum, scanning and access audit. The scanner still cannot run as an endless request function; a durable queue or separate worker/container is required. Vercel remains viable for the API only after the deployment shape and complete evidence path are proven.

Cloudflare's current limits introduce a separate ingress constraint: requests to a Worker on a custom domain are limited by the **zone's Cloudflare plan**, not the Workers plan. Free and Pro document a 100 MB request-body ceiling; Business documents 200 MB. VMMS permits `VMMS_EVIDENCE_MAX_UPLOAD_BYTES` up to 100 MiB (104,857,600 bytes), which is 4,857,600 bytes above 100 MB (100,000,000 bytes). Therefore the maximum configured upload cannot pass through a Free/Pro proxied Worker as currently sized. Do not silently lower the product cap or assume the owner's zone plan. Before staging, choose and verify a zone plan plus an application cap with safe headroom, or design and review a private direct-to-object-store upload path that retains the existing intent, quarantine, hashing, scan, and audit controls. Cloudflare also documents 100 MiB limits on request bodies sent outbound by Durable Objects or Container outbound handlers; that is distinct from the incoming Worker request limit and must be considered if those products are used as an upload relay. The default application cap is 10 MiB, but the configurable maximum and actual deployment route still need proof.

Platform, remote support and vehicle services are Next.js applications with different dependency and route profiles. Cloudflare's current Next.js guide recommends vinext, which reimplements much of the Next.js API on Vite and is explicitly in beta; OpenNext remains another deployment path. Run compatibility checks and exercise the actual routes, packages, image handling, server actions, background jobs, analytics, caching and required Node APIs before choosing either path.

Keep Keycloak as a persistent container service backed by a separate supported managed PostgreSQL service. Cloudflare Containers can run existing container images, but that is a newer Workers product surface. Validate container lifecycle, session consistency, planned availability, backups, restore, outbound routing, region placement and administration isolation before considering it for the critical identity provider. Until this is proven and accepted, choose an established managed container/VM host for Keycloak and keep Cloudflare DNS/edge in front. Do not host Keycloak in a Worker function.

## VMMS web frontend local Workers preview

The opt-in `apps/web` Cloudflare Vite configuration builds the current React SPA into the Worker static-assets layout and runs it in local `workerd` preview. The Worker delegates normal page and asset requests to `ASSETS`, with SPA fallback for deep links. It explicitly returns JSON `503 API_UNAVAILABLE` with `Cache-Control: no-store` for `/api` and `/api/*` until an API service binding is deliberately configured. The existing local Vite development proxy and ordinary build remain separate and unchanged.

Local verification on 11 November 2026: `npm run cloudflare:build --workspace @vmms/web` succeeded; `npm run cloudflare:preview --workspace @vmms/web` ran under `workerd`; `/` and `/sites/synthetic-site/overview` returned HTML `200`; `/api/v1/session` returned JSON `503` with `no-store`. See [local Cloudflare frontend verification](../verification/checks/cloudflare-frontend-preview-2026-11-11.md).

This proves only the static frontend Worker shape and disconnected-API response. It does not prove production deployment or API routing, Fastify compatibility, Hyperdrive connectivity, PostgreSQL transaction-local RLS/advisory locking, streamed evidence uploads, object storage, malware scanning, authentication cookies/CSRF/OIDC, real device behavior or production limits. The preview is not deployed; no provider credentials, DNS, customer data or remote database were used. Keep HOST-001 in progress until its separate API/Hyperdrive/upload and service-matrix acceptance items have evidence.

## VMMS API Worker compatibility result

The local Fastify Worker experiment was built with Wrangler 4.160.0 and invoked through `workerd` using the real `createApp`, a loopback-only disposable PostgreSQL database, the `vmms_runtime` role, synthetic OIDC, and an in-memory evidence store. The app completed its database role and table-ownership checks through the local Hyperdrive binding. On the first HTTP request, Fastify failed while `find-my-way` registered its not-found route: `HandlerStorage._compileCreateParamsObject` uses `new Function`, which `workerd` rejected. A minimal Fastify route declared at module scope hit the same error when `app.ready()` ran for the first request. The startup-only eval compatibility flag did not change request-time route initialization. The database was dropped and the local database list was checked for leftover `vmms_cf_spike_` names.

This proves local `pg` connectivity for startup safety queries, but does not prove business transactions, tenant RLS, advisory locks, session/CSRF behavior, commands or uploads on Workers. Keep the current Node container API as the working backend shape and keep Cloudflare as the frontend/edge candidate. Do not patch Fastify router internals or enable request-time code generation to force compatibility. A future alternative may build a separate Worker-native API or put the container behind a Worker proxy, but each adds code or operational boundaries and must be evaluated against the actual lifecycle and upload path. The synthetic Fastify bundle dry-run was 3,614.93 KiB (652.36 KiB gzip); this is not a deployable or compatible API artifact.

See [the local API Worker spike report](../verification/checks/cloudflare-api-worker-spike-2026-11-11.md). HOST-001 remains in progress; the remaining API transaction/RLS/upload checks need a conventional container baseline, and remote Hyperdrive behavior still requires isolated staging review.

## Why not automatically Vercel for everything?

Vercel remains a strong option for the current Next.js projects because it provides a direct Node.js runtime and framework deployment path. Cloudflare has an official Workers Vite integration and its `@opennextjs/cloudflare` adapter supports many Next.js app-router features, but it is an additional compatibility surface. Compare total costs, operational ownership, region/data placement, backup and recovery for each production service. The project's current domain administration in Cloudflare is a useful consolidation point, not proof that all workloads are best served by the same compute product.

## Service-by-service target

| Service | Starting recommendation | Migration gate |
| --- | --- | --- |
| Public company pages/static assets | Cloudflare static assets/Workers | Build, redirects, forms, analytics and SEO checks |
| VMMS web (React/Vite) | Cloudflare Worker + static assets if browser and same-origin API proxy paths pass | Build and `workerd` preview, SPA routing, fixed API-origin binding, auth redirects/cookies, browser smoke, accessibility, upload, cache headers and rollback checks |
| VMMS API (Fastify/PostgreSQL) | Conventional container remains the baseline; test both a Cloudflare `httpServerHandler` Worker and Vercel Fastify Function before choosing | Fastify request/response lifecycle; `pg` pool and transaction-local RLS; concurrent commands; same-origin auth/CSRF; streaming uploads/downloads; worker/outbox behavior; retries and rollback. The current configurable 100 MiB application maximum exceeds Cloudflare Free/Pro's documented 100 MB incoming Worker cap and Vercel Functions' documented 4.5 MB request/response cap; select an approved plan/cap or verify a security-reviewed alternate upload path |
| Raymond Gray platform (Next.js + Prisma/PostgreSQL + native modules) | Keep on Vercel for now | Isolated compatibility spike for Next adapter, Prisma/pg, `argon2`, cron replacement, analytics, image optimization, background writes and OIDC |
| Remote support (Next.js) | Candidate for Cloudflare Workers after an isolated build/route check | Contact relay timeout, forwarded client metadata, failure responses, media, route protection and browser checks |
| Vehicle services (Next.js) | Candidate for Cloudflare Workers after an isolated build/route check | Booking relay limits/timeouts, auth, protected routes, maps/device behavior, build and browser checks |
| Shared auth (Keycloak + PostgreSQL) | Persistent managed container/VM host initially; Cloudflare edge/DNS | Secure origin/proxy, stable sessions, supported DB, backup/restore, availability and upgrade drills; then separately assess Cloudflare Containers |
| Product PostgreSQL databases | Supported managed PostgreSQL, close to their main compute region | PITR/restore, RLS, connection pooling, region/latency and vendor exit evidence |

## Same-origin VMMS API proxy

The frontend Worker forwards only `/api` and `/api/*` to the fixed `VMMS_API_ORIGIN` binding. The binding is never selected by request input; it must be a bare HTTPS origin in hosted environments. Loopback HTTP is accepted only for local preview. Unset, malformed or self-referential configuration fails closed. The Worker forwards an explicit allowlist of request headers needed by the browser API and uses manual redirect handling so central OIDC redirects and session cookies return to the browser; all API responses are non-cacheable. The API does not receive caller-supplied `Host`, forwarded-address or arbitrary headers.

The local `workerd` proxy check passed first against a synthetic loopback API. A follow-up check now routes the real Fastify application and a disposable PostgreSQL database through the frontend Worker: session cookies, a synthetic OIDC redirect, SPA deep routes, same-site access, cross-site denials, a concurrent version conflict, and a 5.3 MB upload through the application's pending-evidence path all passed. The upload used an in-memory quarantine store and disabled scanner; it proves edge-to-Node request streaming and database behavior, not durable object storage or malware acceptance. The API and Worker were bound only to loopback. The full local verifier passed 14/14 commands with no changed source files. Before a remote origin is connected, select a host and constrain direct API-origin access, configure the exact public `WEB_ORIGIN` and callback route, establish the trusted ingress and address-throttling policy, and repeat the full upload/scanning path using the selected private services. A public, directly reachable API origin with no ingress restrictions is not an acceptable production configuration. See the [synthetic proxy check](../verification/checks/cloudflare-same-origin-proxy-2026-11-11.md) and [real API proxy check](../verification/checks/cloudflare-real-api-proxy-2026-11-12.md).

## Rollout and portability

1. Build deploy manifests and secret contracts without creating a production deployment.
2. Run a non-production VMMS compatibility spike against Cloudflare Workers/Hyperdrive with synthetic data. Keep the known working local Docker API as the baseline.
3. Test each Next.js repository independently; record unsupported packages and adapter/runtime gaps.
4. Compare Cloudflare Container and a conventional managed container host for Keycloak. Include monthly cost, actual region, PostgreSQL backup/restore and admin isolation.
5. Deploy a staging slice only after review of the concrete provider/configuration, domains, access controls and rollback procedure.
6. Keep application business commands, PostgreSQL migrations and OIDC contracts provider-neutral; use platform-specific adapters at the hosting boundary.

## Trusted ingress and network throttling

The API only uses forwarded client addresses when `TRUSTED_PROXY_CIDRS` explicitly lists the exact ingress IPs or CIDR ranges. Fastify ignores forwarded headers from every other peer. Empty lists trust no proxy; `/0` trust-all ranges, hostnames and malformed CIDRs are rejected. Production startup requires a non-empty list and remains blocked by the other readiness gates. At deployment, populate this setting from the selected ingress provider's current published ranges, restrict direct origin access to that ingress, and test both genuine forwarded addresses and spoofed headers. Do not copy example/test ranges into production.

Public staff/owner sign-in, invitation and central logout limits key on the address resolved under this policy. Until the VMMS origin and exact proxy route are chosen and tested, network-based limits are local protections only and are not proof of production edge abuse protection.

## Repository-backed compatibility findings

These findings are a source audit, not a successful provider build or deployment. They are based on repository manifests and call paths; `.env` files, credentials and customer records were not inspected.

- `C:\Projects\raymond-gray-vmms\apps\api\src\app.ts` starts Fastify, checks runtime PostgreSQL role/RLS safety, and accepts streamed evidence uploads. `apps/api/src/evidence.ts` uses Node streams and TCP (`node:net`) for ClamAV and runs the scan worker as a persistent polling loop. `apps/api/src/db.ts` uses `pg` transactions with transaction-local tenant/site/actor scope. The 11 November local Worker spike reached `createApp`'s runtime-role and table-ownership queries through local Hyperdrive, then failed before any API response: Fastify's `find-my-way` router uses `new Function` while registering its not-found route, which `workerd` rejected. A minimal Fastify probe reproduced the route-initialization failure. Transaction/RLS behavior, advisory locks, uploads, scanner and remote Hyperdrive behavior remain untested; see the [Worker spike report](../verification/checks/cloudflare-api-worker-spike-2026-11-11.md). The separately tested frontend Worker proxy can route to a fixed API origin; it does not make Fastify itself Worker-compatible or prove that origin's production ingress and service behavior. Retain the Node container API and scanner behind a restricted Cloudflare edge path unless another API runtime passes the complete behavior matrix.
- `C:\Projects\raymond-gray-platform\package.json`, `src/lib/prisma.ts`, `src/app/signin/actions.ts`, and `vercel.json` show Next.js 16, Prisma 7/PostgreSQL adapters, `argon2`, a Vercel SLA cron, and Vercel observability integrations. Keep this app on Vercel until a Workers build proves those integration points. `better-sqlite3` is declared but no direct application import was found in the source audit; its runtime impact remains unverified. Vercel's first-party Fastify guide now makes a Node Function candidate for the VMMS API, but the current evidence request path exceeds the Function body limit.
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

Current cost, runtime and platform-limit claims were rechecked on 14 November 2026; see the dated compatibility review for the service matrix and direct official references. Hyperdrive supports `pg` and transaction-level advisory locks. VMMS uses transaction-scoped locks, but its transaction/RLS command path remains untested on Workers because Fastify failed before route setup. The platform source audit also found a fire-and-forget secondary database write and disabled TLS certificate verification; these require reliability/security review before that app is relied upon for canonical identity or business data. Vehicle-services location lookup currently conflicts with its browser policy/CSP, and both companion apps' protected routes need real authorization before release.

- [Cloudflare React/Vite Worker integration](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)
- [Cloudflare PostgreSQL and Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
- [Cloudflare Workers best practices for remote databases](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Workers `node:net` API](https://developers.cloudflare.com/workers/runtime-apis/nodejs/net/)
- [Cloudflare Workers platform and request-body limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers Node HTTP server adapter](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)
- [Cloudflare Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)
- [Cloudflare Queues and Workflows for background work](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Containers overview](https://developers.cloudflare.com/containers/)
- [Cloudflare Container instance limits](https://developers.cloudflare.com/containers/platform/limits/)
- [Cloudflare Vite/Next framework configuration](https://developers.cloudflare.com/workers/framework-guides/automatic-configuration/)
- [Cloudflare Next.js on Workers (vinext, currently beta)](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Cloudflare Next.js migration guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/vercel-to-workers/nextjs/)
- [OpenNext Cloudflare adapter and feature support](https://opennext.js.org/cloudflare)
- [Vercel Functions runtime/region behavior and limits](https://vercel.com/docs/functions)
- [Vercel Functions payload limit and direct-upload guidance](https://vercel.com/docs/errors/function_payload_too_large)
- [Vercel Fastify deployment guide](https://vercel.com/kb/guide/ship-a-fastify-app-on-vercel)
- [Vercel Queues](https://vercel.com/docs/queues)
- [Keycloak production configuration](https://www.keycloak.org/server/configuration-production)
