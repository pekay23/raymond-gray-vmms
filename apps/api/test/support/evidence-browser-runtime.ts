import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createServer, Socket } from 'node:net';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import type { Config } from '../../src/config.js';
import { makePool } from '../../src/db.js';
import { hashPassword } from '../../src/identity.js';
import { createEvidenceServices, processNextEvidenceScanJob, type PrivateEvidenceStore, type EvidenceServices } from '../../src/evidence.js';

const roleSchema = z.object({ rolname: z.string(), rolsuper: z.boolean(), rolbypassrls: z.boolean() });
const count = z.number().int().nonnegative();
const factsSchema = z.object({
  evidence: count, jobs: count, attempts: count, links: count, events: count,
  receipts: count, outbox: count, access: count, version: z.number().int().positive(),
});

function localDatabase(value: string | undefined) {
  assert(value, 'A local test database setting is required.');
  const parsed = new URL(value);
  assert(['postgres:', 'postgresql:'].includes(parsed.protocol), 'PostgreSQL URLs are required.');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Only loopback PostgreSQL is permitted.');
  assert(!parsed.search && !parsed.hash, 'Database URL query overrides are not permitted.');
  return parsed;
}

class MemoryPrivateStore implements PrivateEvidenceStore {
  private readonly objects = new Map<string, Buffer>();

  async putQuarantine(key: string, body: Readable, sizeBytes: number) {
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of body) {
      const bytes = Buffer.from(chunk);
      received += bytes.length;
      assert(received <= sizeBytes && received <= 1024 * 1024, 'Synthetic store byte limit exceeded.');
      chunks.push(bytes);
    }
    assert.equal(received, sizeBytes, 'Synthetic store received an incomplete body.');
    this.objects.set(key, Buffer.concat(chunks));
  }

  private stream(key: string) {
    const stored = this.objects.get(key);
    assert(stored, 'Synthetic private object is missing.');
    const bytes = new Uint8Array(stored);
    return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  }

  async readQuarantine(key: string) { return this.stream(key); }
  async readAccepted(key: string) { return this.stream(key); }
  async promoteAccepted(sourceKey: string, targetKey: string) {
    const bytes = this.objects.get(sourceKey);
    assert(bytes, 'Synthetic quarantine object is missing.');
    this.objects.set(targetKey, Buffer.from(bytes));
  }
  async delete(key: string) { this.objects.delete(key); }
  clear() { this.objects.clear(); }
}

export async function startEvidenceBrowserRuntime(options: {
  migrationDatabaseUrl: string | undefined;
  runtimeDatabaseUrl: string | undefined;
  webOrigin: string;
  evidenceMode?: 'synthetic' | 'configured';
}) {
  assert(process.env.NODE_ENV !== 'production', 'Browser recovery tests cannot run in production.');
  const web = new URL(options.webOrigin);
  assert.equal(web.hostname, '127.0.0.1', 'The browser origin must bind IPv4 loopback.');
  const ownerUrl = localDatabase(options.migrationDatabaseUrl);
  const runtimeUrl = localDatabase(options.runtimeDatabaseUrl);
  assert.equal(ownerUrl.hostname, runtimeUrl.hostname, 'Test database connections must use the same cluster.');
  assert.equal(ownerUrl.port, runtimeUrl.port, 'Test database connections must use the same port.');
  assert.equal(decodeURIComponent(runtimeUrl.username), 'vmms_runtime', 'Migrations require the existing vmms_runtime role.');
  ownerUrl.pathname = '/postgres';
  const suffix = `${process.pid}_${randomBytes(5).toString('hex')}`;
  const databaseName = `vmms_evidence_browser_${suffix}`;
  const workerName = `vmms_evidence_browser_worker_${suffix}`;
  assert(/^vmms_evidence_browser_\d+_[a-f0-9]{10}$/.test(databaseName));
  const owner = makePool(ownerUrl.href);
  const testOwnerUrl = new URL(ownerUrl); testOwnerUrl.pathname = `/${databaseName}`;
  runtimeUrl.pathname = `/${databaseName}`;
  const workerUrl = new URL(runtimeUrl);
  workerUrl.username = workerName;
  workerUrl.password = randomBytes(24).toString('hex');
  const dbOwner = makePool(testOwnerUrl.href);
  const runtime = makePool(runtimeUrl.href);
  const worker = makePool(workerUrl.href);
  const evidenceMode = options.evidenceMode ?? 'synthetic';
  const syntheticStore = evidenceMode === 'synthetic' ? new MemoryPrivateStore() : undefined;
  let databaseCreated = false;
  let databaseOid: number | null = null;
  let workerCreated = false;
  let closed = false;
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let apiEvidenceServices: EvidenceServices | undefined;
  let workerEvidenceServices: EvidenceServices | undefined;
  let scanVerdict: 'clean' | 'infected' | 'unavailable' = 'clean';
  if (evidenceMode === 'synthetic') {
    const syntheticServices: EvidenceServices = {
      store: syntheticStore!,
      maxUploadBytes: 1024 * 1024,
      allowedMediaTypes: new Set(['application/pdf']),
      close: async () => {},
      scanner: { async scan(input) {
        const hash = createHash('sha256');
        for await (const chunk of Readable.fromWeb(input)) hash.update(Buffer.from(chunk));
        const sha256 = hash.digest('hex');
        if (scanVerdict === 'unavailable') {
          return { kind: 'unavailable', engine: 'synthetic-browser-test', version: '1', detailCode: 'scanner-unavailable', scannedAt: new Date() };
        }
        return { kind: scanVerdict, sha256, engine: 'synthetic-browser-test', version: '1', detailCode: scanVerdict, scannedAt: new Date() };
      } },
    };
    apiEvidenceServices = syntheticServices;
    workerEvidenceServices = syntheticServices;
  }

  async function close() {
    if (closed) return;
    closed = true;
    const failures: string[] = [];
    async function cleanup(label: string, run: () => Promise<unknown>) {
      try { await run(); } catch { failures.push(label); }
    }
    if (app) await cleanup('api', () => app ? app.close() : runtime.end());
    else await cleanup('api-pool', () => runtime.end());
    if (!app && apiEvidenceServices) await cleanup('api-evidence', () => apiEvidenceServices!.close());
    if (workerEvidenceServices && workerEvidenceServices !== apiEvidenceServices) {
      await cleanup('worker-evidence', () => workerEvidenceServices!.close());
    }
    await cleanup('worker-pool', () => worker.end());
    await cleanup('assertion-pool', () => dbOwner.end());
    if (databaseCreated) {
      await cleanup(`database:${databaseName}`, async () => {
        assert(/^vmms_evidence_browser_\d+_[a-f0-9]{10}$/.test(databaseName));
        const identity = z.object({ oid: z.number().int().positive() }).parse((await owner.query('SELECT oid::int AS oid FROM pg_database WHERE datname=$1', [databaseName])).rows[0]);
        assert.equal(identity.oid, databaseOid, 'Refusing to drop a database whose identity changed.');
        await owner.query(`DROP DATABASE "${databaseName}"`);
        databaseCreated = false;
      });
    }
    if (workerCreated && !databaseCreated) await cleanup(`role:${workerName}`, async () => {
      assert(/^vmms_evidence_browser_worker_\d+_[a-f0-9]{10}$/.test(workerName));
      await owner.query(`DROP ROLE "${workerName}"`);
    });
    await cleanup('provisioning-pool', () => owner.end());
    syntheticStore?.clear();
    assert.deepEqual(failures, [], `Owned resource cleanup failed: ${failures.join(', ')}`);
  }

  try {
    if (evidenceMode === 'configured') {
      apiEvidenceServices = createEvidenceServices(process.env, 'api');
      workerEvidenceServices = createEvidenceServices(process.env, 'worker');
      assert(apiEvidenceServices.store && apiEvidenceServices.scanner, 'Configured browser mode requires API storage and scanner settings.');
      assert(workerEvidenceServices.store && workerEvidenceServices.scanner, 'Configured browser mode requires worker storage and scanner settings.');
    }
    const client = await owner.connect();
    try {
      const connection: unknown = Reflect.get(client, 'connection');
      assert(typeof connection === 'object' && connection !== null, 'Cannot inspect provisioning socket.');
      const socket: unknown = Reflect.get(connection, 'stream');
      assert(socket instanceof Socket, 'Cannot inspect provisioning socket.');
      assert(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.remoteAddress ?? ''), 'Provisioning socket peer is not loopback.');
      z.object({ database: z.literal('postgres') }).parse((await client.query('SELECT current_database() AS database')).rows[0]);
    } finally { client.release(); }
    const roles = z.array(roleSchema).parse((await owner.query("SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('vmms_runtime','vmms_evidence_worker')")).rows);
    assert.equal(roles.length, 2, 'Provision the local runtime and worker capability roles before running this test.');
    assert(roles.every(role => !role.rolsuper && !role.rolbypassrls), 'Runtime capability roles cannot bypass RLS.');
    await owner.query(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;
    databaseOid = z.object({ oid: z.number().int().positive() }).parse((await owner.query('SELECT oid::int AS oid FROM pg_database WHERE datname=$1', [databaseName])).rows[0]).oid;
    for (const filename of (await readdir(new URL('../../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort()) {
      await dbOwner.query(await readFile(new URL(`../../migrations/${filename}`, import.meta.url), 'utf8'));
    }
    await owner.query(`CREATE ROLE "${workerName}" LOGIN INHERIT PASSWORD '${workerUrl.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    workerCreated = true;
    await owner.query(`GRANT vmms_evidence_worker TO "${workerName}"`);
    const workerRole = roleSchema.parse((await worker.query('SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]);
    assert(!workerRole.rolsuper && !workerRole.rolbypassrls);
    const organisationId = randomUUID(), otherOrganisationId = randomUUID();
    const siteId = randomUUID(), secondSiteId = randomUUID(), otherSiteId = randomUUID();
    const password = randomBytes(24).toString('hex');
    const actors = {
      creator: { id: randomUUID(), username: 'browser-creator', password },
      peer: { id: randomUUID(), username: 'browser-peer', password },
      otherTenant: { id: randomUUID(), username: 'browser-other-tenant', password },
      teamLead: { id: randomUUID(), username: 'browser-team-lead', password },
      supervisor: { id: randomUUID(), username: 'browser-supervisor', password },
      technician: { id: randomUUID(), username: 'browser-technician', password },
    };
    const passwordHash = await hashPassword(password);
    await dbOwner.query('INSERT INTO organisations(id,name) VALUES($1,$2),($3,$4)', [organisationId, 'Synthetic Browser Organisation', otherOrganisationId, 'Synthetic Other Organisation']);
    await dbOwner.query('INSERT INTO sites(id,organisation_id,code,name) VALUES($1,$2,$3,$4),($5,$2,$6,$7),($8,$9,$10,$11)', [siteId, organisationId, 'BROWSE', 'Synthetic Browser Site', secondSiteId, 'SECOND', 'Synthetic Second Site', otherSiteId, otherOrganisationId, 'OTHER', 'Synthetic Other Site']);
    for (const actor of Object.values(actors)) await dbOwner.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)', [actor.id, actor.username, `Synthetic ${actor.username}`, passwordHash]);
    await dbOwner.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true),($1,$3,true),($4,$2,true),($5,$6,true),($7,$2,true),($8,$2,true),($9,$2,true)', [actors.creator.id, siteId, secondSiteId, actors.peer.id, actors.otherTenant.id, otherSiteId, actors.teamLead.id, actors.supervisor.id, actors.technician.id]);
    const placements = new Map<string, string>();
    for (const [staffUserId, roleCode] of [
      [actors.creator.id, 'head-service-centre'],
      [actors.peer.id, 'ev-team-lead'],
      [actors.teamLead.id, 'ev-team-lead'],
      [actors.supervisor.id, 'supervisor'],
      [actors.technician.id, 'technician-engineer-trainee'],
    ] as const) {
      const placementId = randomUUID();
      placements.set(staffUserId, placementId);
      await dbOwner.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')", [placementId, organisationId, siteId]);
      const reportsToPlacementId = staffUserId === actors.technician.id ? placements.get(actors.supervisor.id)! : null;
      await dbOwner.query('INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,reports_to_placement_id,revision,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,1,$7,$7)', [placementId, organisationId, siteId, staffUserId, roleCode, reportsToPlacementId, actors.creator.id]);
      await dbOwner.query("INSERT INTO staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,reports_to_placement_id,state,changed_by) VALUES($1,$2,$3,1,$4,$5,$6,'active',$7)", [organisationId, siteId, placementId, staffUserId, roleCode, reportsToPlacementId, actors.creator.id]);
    }
    for (const [staffUserId, capability, revision] of [
      [actors.creator.id, 'work-order.operations-review', 1],
      [actors.creator.id, 'work-order.assign-lead', 1],
      [actors.teamLead.id, 'work-order.prepare-work-plan', 1],
      [actors.teamLead.id, 'work-order.handoff-supervisor', 1],
    ] as const) {
      await dbOwner.query(
        'INSERT INTO staff_authority_grants(id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()-interval \'1 minute\')',
        [randomUUID(), organisationId, siteId, staffUserId, capability, revision, actors.creator.id, 'Synthetic browser work-plan test grant'],
      );
    }
    await dbOwner.query(
      'INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes) VALUES($1,$2,$3,$4,\'EV-TEAM-LEAD\',1,\'accepted\',\'synthetic-browser-work-plan-qualification\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'])',
      [randomUUID(), organisationId, siteId, actors.teamLead.id, actors.creator.id],
    );
    await dbOwner.query(
      'INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes) VALUES($1,$2,$3,$4,\'EV-SUPERVISOR\',1,\'accepted\',\'synthetic-browser-work-plan-qualification\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'])',
      [randomUUID(), organisationId, siteId, actors.supervisor.id, actors.creator.id],
    );
    const config: Config = {
      DATABASE_URL: runtimeUrl.href,
      SESSION_SECRET: randomBytes(32).toString('hex'),
      WEB_ORIGIN: web.origin,
      OIDC_ISSUER: 'http://127.0.0.1:1/unused', OIDC_CLIENT_ID: 'synthetic-browser-test',
      OIDC_CALLBACK_URL: 'http://127.0.0.1:1/unused', PORT: 4100, HOST: '127.0.0.1', NODE_ENV: 'test',
      OIDC_LOGOUT_CALLBACK_URL: 'http://127.0.0.1:1/api/v1/auth/oidc/logout/callback',
      TRUSTED_PROXY_CIDRS: [],
      STAFF_MESSAGES_ENABLED: false,
    };
    app = await createApp(config, runtime, undefined, apiEvidenceServices, undefined, dbOwner);
    const apiOrigin = await app.listen({ host: '127.0.0.1', port: 0 });
    return {
      apiOrigin, databaseName, actors, siteId, secondSiteId, otherSiteId,
      setWebOrigin(value: string) {
        const origin = new URL(value);
        assert.equal(origin.hostname, '127.0.0.1');
        config.WEB_ORIGIN = origin.origin;
      },
      async grantVehicleLearningReviewerForTest(staffUserId: string) {
        assert(Object.values(actors).some(actor => actor.id === staffUserId), 'Only an isolated synthetic browser actor can receive this test grant.');
        const id = randomUUID();
        await dbOwner.query(`INSERT INTO staff_authority_grants
          (id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from)
          VALUES($1,$2,$3,$4,'vehicle-learning.review',1,$5,'Synthetic browser verification grant only',now()-interval '1 minute')`,
        [id, organisationId, siteId, staffUserId, actors.creator.id]);
        return id;
      },
      async grantFinanceConfigurationForTest(staffUserId: string, access: 'read' | 'manage') {
        assert(Object.values(actors).some(actor => actor.id === staffUserId), 'Only an isolated synthetic browser actor can receive this test grant.');
        const id = randomUUID();
        await dbOwner.query(`INSERT INTO staff_authority_grants
          (id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from)
          VALUES($1,$2,$3,$4,$5,1,$6,'Synthetic browser verification grant only',now()-interval '1 minute')`,
        [id, organisationId, siteId, staffUserId, `finance.configuration-draft.${access}`, actors.creator.id]);
        return id;
      },
      async scanNext(verdict: 'clean' | 'infected' | 'unavailable' = 'clean') {
        if (evidenceMode === 'configured') {
          if (verdict !== 'unavailable') {
            // Clean and infected outcomes are determined by the configured scanner and uploaded bytes.
            return processNextEvidenceScanJob(worker, workerEvidenceServices!);
          }
          const probe = createServer();
          const port = await new Promise<number>((resolve, reject) => {
            probe.once('error', reject);
            probe.listen(0, '127.0.0.1', () => {
              const address = probe.address();
              if (!address || typeof address === 'string') return reject(new Error('Could not reserve a loopback port for the unavailable-scanner case.'));
              probe.close((error) => error ? reject(error) : resolve(address.port));
            });
          });
          const unavailableServices = createEvidenceServices({
            ...process.env,
            VMMS_EVIDENCE_CLAMAV_HOST: '127.0.0.1',
            VMMS_EVIDENCE_CLAMAV_PORT: String(port),
          }, 'worker');
          try {
            assert(unavailableServices.store, 'Unavailable-scanner verification still requires configured object storage.');
            return await processNextEvidenceScanJob(worker, unavailableServices);
          } finally {
            await unavailableServices.close();
          }
        }
        scanVerdict = verdict;
        try { return await processNextEvidenceScanJob(worker, workerEvidenceServices!); }
        finally { scanVerdict = 'clean'; }
      },
      async makeScanRetryAvailable(evidenceId: string) {
        z.uuid().parse(evidenceId);
        const result = await dbOwner.query(
          "UPDATE evidence_scan_jobs SET available_at=clock_timestamp() WHERE evidence_id=$1 AND state='pending' RETURNING id",
          [evidenceId],
        );
        assert.equal(result.rowCount, 1, 'Expected one scheduled retry for the selected synthetic evidence.');
      },
      async inspect(orderId: string, attachmentCommandId: string | null = null) {
        z.uuid().parse(orderId);
        if (attachmentCommandId) z.uuid().parse(attachmentCommandId);
        const facts = await dbOwner.query(`SELECT
          (SELECT count(*)::int FROM evidence_records WHERE target_id=$1 AND purpose_kind='work-order') AS evidence,
          (SELECT count(*)::int FROM evidence_scan_jobs j JOIN evidence_records e ON e.id=j.evidence_id WHERE e.target_id=$1 AND e.purpose_kind='work-order') AS jobs,
          (SELECT count(*)::int FROM evidence_scan_attempts a JOIN evidence_records e ON e.id=a.evidence_id WHERE e.target_id=$1 AND e.purpose_kind='work-order') AS attempts,
          (SELECT count(*)::int FROM work_order_evidence_links WHERE work_order_id=$1) AS links,
          (SELECT count(*)::int FROM domain_events WHERE aggregate_id=$1 AND event_type='work-order.evidence-attached') AS events,
          (SELECT count(*)::int FROM command_receipts WHERE command_id=$2) AS receipts,
          (SELECT count(*)::int FROM outbox o JOIN domain_events e ON e.id=o.event_id WHERE e.aggregate_id=$1 AND e.event_type='work-order.evidence-attached') AS outbox,
          (SELECT count(*)::int FROM evidence_access_events a JOIN evidence_records e ON e.id=a.evidence_id WHERE e.target_id=$1 AND e.purpose_kind='work-order') AS access,
          (SELECT version FROM work_orders WHERE id=$1) AS version`, [orderId, attachmentCommandId]);
        return factsSchema.parse(facts.rows[0]);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
