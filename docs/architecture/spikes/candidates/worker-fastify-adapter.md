# Candidate A: adapt Fastify into a local Worker

## Caller usage

Start a loopback-only Wrangler Worker with a local Hyperdrive binding redirected to a uniquely named disposable PostgreSQL database. The Worker constructs the real Fastify app through `createApp`, injects only synthetic identity and in-memory evidence dependencies, and adapts `app.server` with Cloudflare's `httpServerHandler`.

## Module sketch

- `apps/api/src/cloudflare-spike.ts`: explicit `Config`, Worker binding type, lazy Fastify startup and HTTP handler.
- `apps/api/wrangler.spike.jsonc`: local-only entry point and `HYPERDRIVE` binding placeholder; no routes, domains, or deployment environment.
- `apps/api/scripts/cloudflare-spike.mjs`: create/migrate/seed/drop the disposable DB, start Wrangler, drive real HTTP scenarios, and write sanitized evidence.
- `docs/verification/checks/cloudflare-api-worker-spike-YYYY-MM-DD.md`: versions, outcomes and limits.

## Rationale

`createApp` already accepts a pool, OIDC provider and evidence service bundle. Its startup also rejects owner/superuser database roles, so the spike can preserve production boundary checks while avoiding production secrets. The database URL comes only from `env.HYPERDRIVE.connectionString`; the local Wrangler override points at the disposable DB with the restricted runtime identity. The scanner remains out of process.

This candidate gives the strongest signal about whether the existing VMMS API can run on Workers without changing the container baseline. It does not establish remote Hyperdrive pooling, durable object storage, malware scanning, production request limits, or production readiness.

## Risks to prove

- Node HTTP adapter differences may affect Fastify streaming and response behavior.
- `pg` and transaction-local scope must work through the local Hyperdrive path.
- A memory quarantine store proves bytes traverse the Worker and API, not durable storage or scanning.
- A 5 MiB request is below the current configured maximum and does not prove production ingress limits.
