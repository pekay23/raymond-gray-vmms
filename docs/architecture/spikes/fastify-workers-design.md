# Fastify on Cloudflare Workers: spike design

**Decision:** use Candidate A for the first local compatibility experiment, with Candidate B's provider-neutral HTTP scenarios and the existing container as the comparison baseline. This is an experiment only; it does not choose production hosting.

## Caller usage

`npm run spike:cloudflare:api --workspace @vmms/api` creates an isolated PostgreSQL database, starts the opt-in Wrangler Worker on loopback, exercises the real Fastify HTTP routes, records sanitized results, and drops the exact database it created. It must refuse non-loopback database endpoints, never use `wrangler dev --remote`, and leave no test database behind after success or failure.

## Type and module sketch

```ts
interface SpikeEnv {
  HYPERDRIVE: { connectionString: string };
  VMMS_SPIKE_ENABLE: string;
}

type SpikeRuntime = {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
};

function createSpikeConfig(connectionString: string): Config;
function createSyntheticOidcProvider(): OidcProvider;
function createMemoryEvidenceServices(): EvidenceServices;
async function createSpikeRuntime(env: SpikeEnv): Promise<SpikeRuntime>;
```

The Worker uses `createApp(config, pool, fakeOidc, memoryEvidence)` and `httpServerHandler(app.server)`. It owns one cached app per isolate and closes it on explicit test shutdown or startup failure. The ordinary `server.ts` path remains untouched. The Worker config enables only the current Node compatibility flags required by the adapter.

## Test ownership and safety

- Runner: `.env` is read in process only for local migration/runtime URLs; credentials and full URLs never enter logs or committed files.
- DB admin: use only the local migration URL, verified at runtime to target loopback. Create a name with a fixed `vmms_cf_spike_` prefix and random suffix.
- API Worker: connect only as the restricted `vmms_runtime` role to that named database via `HYPERDRIVE.connectionString`.
- Fixtures: synthetic orgs, sites, staff, work orders and valid image bytes only.
- Upload: use a memory store, upload a valid 5 MiB PNG through the real evidence-intent and upload routes, and assert byte count, digest, pending/quarantine status and no accepted download.
- Auth/scope: authenticate through the actual cookie/CSRF routes; create/read in one site, deny another tenant/site, and attempt two commands at the same aggregate version to prove exactly one commits.
- Cleanup: close Worker/containers and DB pools, terminate active sessions, then drop only the exact generated database from an allowlisted name. Cleanup failure is a failed run and is reported.

## Boundaries

Local Wrangler Hyperdrive mode connects directly to PostgreSQL. It does not prove remote Hyperdrive pooling or cache behavior. The in-memory store does not prove S3/R2 durability, scanner behavior or restore. The 5 MiB upload tests the application's end-to-end Worker path but not the 100 MiB configured ceiling or Cloudflare plan ingress cap. The persistent scanner remains a separate Node worker/container pending a queue/retry/poison-message design.

## Acceptance for HOST-001

This spike can provide evidence for Fastify adapter, local `pg`, transaction/RLS, and streamed application uploads only. HOST-001 also requires the other product service matrix, runtime/package reviews, costs, regions, rollback plans, remote Hyperdrive pooling, object storage/scanner strategy, identity operations, owner decisions and a staging proof. Keep HOST-001 in progress until those are complete.
