import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { crc32 } from 'node:zlib';
import pg from 'pg';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { makePool } from '../src/db.js';
import { hashPassword } from '../src/identity.js';
import { createEvidenceServices, processNextEvidenceScanJob, type EvidenceServices, type MalwareScanner, type PrivateEvidenceStore } from '../src/evidence.js';
import { processNextStaffAccountProvisioningRequest, type StaffAccountProvisioningAdapter } from '../src/staff-account-worker.js';
import { startClamAvFixture } from './support/clamav-fixture.js';
import type { Config } from '../src/config.js';
import type { OidcProvider } from '../src/oidc-client.js';

loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const ownerUrl = z.url().parse(process.env.MIGRATION_DATABASE_URL);
const runtimeUrl = z.url().parse(process.env.DATABASE_URL);
const dbName = `vmms_evidence_test_${process.pid}_${randomBytes(4).toString('hex')}`;
const owner = new pg.Pool({ connectionString: ownerUrl });
const testOwnerUrl = new URL(ownerUrl); testOwnerUrl.pathname = `/${dbName}`;
const testRuntimeUrl = new URL(runtimeUrl); testRuntimeUrl.pathname = `/${dbName}`;
const dbOwner = new pg.Pool({ connectionString: testOwnerUrl.toString() });
const runtime = makePool(testRuntimeUrl.toString());
const workerLogin = `vmms_evidence_test_worker_${process.pid}_${randomBytes(3).toString('hex')}`;
const workerPassword = 'synthetic-worker-only-password';
const workerUrl = new URL(runtimeUrl);
workerUrl.pathname = `/${dbName}`; workerUrl.username = workerLogin; workerUrl.password = workerPassword;
const worker = makePool(workerUrl.toString());
const accountWorkerLogin = `vmms_account_test_worker_${process.pid}_${randomBytes(3).toString('hex')}`;
const accountWorkerPassword = 'synthetic-account-worker-only-password';
const accountWorkerUrl = new URL(runtimeUrl);
accountWorkerUrl.pathname = `/${dbName}`; accountWorkerUrl.username = accountWorkerLogin; accountWorkerUrl.password = accountWorkerPassword;
const accountWorker = makePool(accountWorkerUrl.toString());
const siteId = randomUUID(), organisationId = randomUUID(), staffId = randomUUID(), sameSiteStaffId = randomUUID();
const otherSiteId = randomUUID(), otherOrganisationId = randomUUID(), otherStaffId = randomUUID();
const config: Config = {
  DATABASE_URL: testRuntimeUrl.toString(),
  SESSION_SECRET: 'synthetic-test-session-secret-at-least-32',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  OIDC_ISSUER: 'http://localhost:8080/realms/raymond-gray-dev',
  OIDC_CLIENT_ID: 'vmms-web-dev',
  OIDC_CALLBACK_URL: 'http://127.0.0.1:4100/api/v1/auth/oidc/callback',
  OIDC_LOGOUT_CALLBACK_URL: 'http://127.0.0.1:4100/api/v1/auth/oidc/logout/callback',
  TRUSTED_PROXY_CIDRS: [],
  PORT: 4100, HOST: '127.0.0.1', NODE_ENV: 'test', STAFF_MESSAGES_ENABLED: false,
};
const objectMap = new Map<string, Buffer>();
let app: Awaited<ReturnType<typeof createApp>>;
let scannerMode: 'clean' | 'infected' | 'unavailable' = 'clean';

class MemoryPrivateStore implements PrivateEvidenceStore {
  async putQuarantine(key: string, body: Readable, _sizeBytes: number) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    objectMap.set(key, Buffer.concat(chunks));
  }
  async readQuarantine(key: string) { return webStream(objectMap.get(key)); }
  async promoteAccepted(sourceKey: string, targetKey: string) {
    const source = objectMap.get(sourceKey);
    if (!source) throw new Error('missing synthetic quarantine object');
    objectMap.set(targetKey, Buffer.from(source));
  }
  async readAccepted(key: string) { return webStream(objectMap.get(key)); }
  async delete(key: string) { objectMap.delete(key); }
}

function webStream(value: Buffer | undefined): ReadableStream<Uint8Array> {
  if (!value) throw new Error('synthetic object not found');
  return new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(value)); controller.close(); } });
}

const scanner: MalwareScanner = {
  async scan(input) {
    const hash = createHash('sha256');
    for await (const chunk of Readable.fromWeb(input)) hash.update(Buffer.from(chunk));
    const sha256 = hash.digest('hex');
    if (scannerMode === 'unavailable') return { kind: 'unavailable', engine: 'synthetic-test', version: '1', detailCode: 'scanner-unavailable', scannedAt: new Date() };
    return { kind: scannerMode, sha256, engine: 'synthetic-test', version: '1', detailCode: scannerMode, scannedAt: new Date() };
  },
};

const services: EvidenceServices = {
  store: new MemoryPrivateStore(), scanner, maxUploadBytes: 1024 * 1024, allowedMediaTypes: new Set(['application/pdf']), close: async () => {},
};
const evidenceTestBucket = 'vmms-test-evidence';

function requireLoopbackEvidenceIntegration(env: NodeJS.ProcessEnv) {
  const endpoint = new URL(z.url().parse(env.VMMS_EVIDENCE_S3_ENDPOINT));
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, '');
  assert.equal(endpoint.protocol, 'http:', 'S3 integration must use the loopback-only local mock.');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(hostname), 'S3 integration cannot write to a remote host.');
  assert.equal(env.VMMS_EVIDENCE_S3_BUCKET, evidenceTestBucket, 'S3 integration must use the dedicated disposable test bucket.');
  const scannerHost = env.VMMS_EVIDENCE_CLAMAV_HOST?.trim();
  assert.ok(scannerHost, 'S3 integration requires a configured local ClamAV service.');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(scannerHost.replace(/^\[|\]$/g, '')), 'Scanner integration cannot connect to a remote host.');
}

function trackEvidenceObjects(store: PrivateEvidenceStore, owners: Map<string, PrivateEvidenceStore>): PrivateEvidenceStore {
  return {
    async putQuarantine(key, body, sizeBytes) {
      owners.set(key, store);
      await store.putQuarantine(key, body, sizeBytes);
    },
    readQuarantine: (key) => store.readQuarantine(key),
    async promoteAccepted(sourceKey, targetKey) {
      owners.set(targetKey, store);
      await store.promoteAccepted(sourceKey, targetKey);
    },
    readAccepted: (key) => store.readAccepted(key),
    async delete(key) {
      await store.delete(key);
      owners.delete(key);
    },
  };
}

if (process.env.VMMS_EVIDENCE_STORAGE_INTEGRATION === '1') requireLoopbackEvidenceIntegration(process.env);
const integratedStorage = process.env.VMMS_EVIDENCE_STORAGE_INTEGRATION === '1'
  ? { api: createEvidenceServices(process.env, 'api'), worker: createEvidenceServices(process.env, 'worker') }
  : null;
const oidc: OidcProvider = {
  async createLogoutUrl(input) { const url=new URL('http://localhost:8080/logout'); url.searchParams.set('client_id',config.OIDC_CLIENT_ID); url.searchParams.set('post_logout_redirect_uri',input.postLogoutRedirectUri); url.searchParams.set('state',input.state); return url; },
  async createAuthorizationUrl() { return new URL('http://localhost:8080/'); },
  async exchangeAuthorizationCode() { return { issuer: config.OIDC_ISSUER, subject: 'not-used', issuedAt: Math.floor(Date.now()/1000) }; },
};

async function staffHeaders(targetApp = app, username = 'evidence-test') {
  const jar: Record<string, string> = {};
  const initial = await targetApp.inject({ method: 'GET', url: '/api/v1/session' });
  const initialCookies = initial.headers['set-cookie'];
  for (const cookie of typeof initialCookies === 'string' ? [initialCookies] : initialCookies ?? []) {
    const [pair] = cookie.split(';'); if (!pair) continue; const divider = pair.indexOf('='); jar[pair.slice(0, divider)] = pair.slice(divider + 1);
  }
  const securityHeaders = {
    cookie: Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; '),
    origin: config.WEB_ORIGIN,
    'x-csrftoken': decodeURIComponent(jar.vmms_csrf ?? ''),
    'idempotency-key': randomUUID(),
  };
  const signIn = await targetApp.inject({
    method: 'POST', url: '/api/v1/session', headers: securityHeaders,
    payload: { username, password: 'Synthetic-evidence-test-password' },
  });
  assert.equal(signIn.statusCode, 200, signIn.body);
  const signInCookies = signIn.headers['set-cookie'];
  for (const cookie of typeof signInCookies === 'string' ? [signInCookies] : signInCookies ?? []) {
    const [pair] = cookie.split(';'); if (!pair) continue; const divider = pair.indexOf('='); jar[pair.slice(0, divider)] = pair.slice(divider + 1);
  }
  return {
    ...securityHeaders,
    cookie: Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; '),
    'x-csrftoken': decodeURIComponent(jar.vmms_csrf ?? ''),
  };
}

async function createUploadIntent(headers: Awaited<ReturnType<typeof staffHeaders>>, name: string, expectedBytes: number, declaredMediaType = 'application/pdf', targetApp = app, targetSiteId = siteId) {
  const intent = await targetApp.inject({
    method: 'POST', url: `/api/v1/sites/${targetSiteId}/evidence/intents`, headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { purpose: 'attachment', displayName: name, declaredMediaType, expectedBytes },
  });
  assert.equal(intent.statusCode, 200, intent.body);
  return z.object({ id: z.string().uuid() }).parse(intent.json()).id;
}

async function submitEvidenceBytes(headers: Awaited<ReturnType<typeof staffHeaders>>, intentId: string, bytes: Buffer, contentLength = bytes.length, targetApp = app, targetSiteId = siteId) {
  return targetApp.inject({
    method: 'PUT', url: `/api/v1/sites/${targetSiteId}/evidence/intents/${intentId}/content`,
    headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(contentLength) }, payload: bytes,
  });
}

async function uploadPdf(headers: Awaited<ReturnType<typeof staffHeaders>>, name: string, targetApp = app, targetSiteId = siteId) {
  const bytes = Buffer.from('%PDF-1.4\nSynthetic work evidence\n%%EOF\n');
  const intentId = await createUploadIntent(headers, name, bytes.length, 'application/pdf', targetApp, targetSiteId);
  const upload = await submitEvidenceBytes(headers, intentId, bytes, bytes.length, targetApp, targetSiteId);
  assert.equal(upload.statusCode, 202, upload.body);
  return { bytes, intentId, evidenceId: z.object({ evidenceId: z.string().uuid() }).parse(upload.json()).evidenceId };
}

function zipStoredFile(name: string, content: Buffer): Buffer {
  const filename = Buffer.from(name, 'utf8');
  const checksum = crc32(content);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(content.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(filename.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(content.length, 20);
  centralHeader.writeUInt32LE(content.length, 24);
  centralHeader.writeUInt16LE(filename.length, 28);

  const centralDirectorySize = centralHeader.length + filename.length;
  const centralDirectoryOffset = localHeader.length + filename.length + content.length;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralDirectorySize, 12);
  endRecord.writeUInt32LE(centralDirectoryOffset, 16);

  return Buffer.concat([localHeader, filename, content, centralHeader, filename, endRecord]);
}

before(async () => {
  const hasRuntime = await owner.query("SELECT 1 FROM pg_roles WHERE rolname='vmms_runtime'");
  if (!hasRuntime.rowCount) await owner.query("CREATE ROLE vmms_runtime LOGIN PASSWORD 'vmms_runtime_local_development_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  await owner.query(`CREATE DATABASE ${dbName}`);
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort()) {
    await dbOwner.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  await owner.query(`CREATE ROLE "${workerLogin}" LOGIN INHERIT PASSWORD '${workerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await owner.query(`GRANT vmms_evidence_worker TO "${workerLogin}"`);
  await owner.query(`CREATE ROLE "${accountWorkerLogin}" LOGIN INHERIT PASSWORD '${accountWorkerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await owner.query(`GRANT vmms_staff_account_worker TO "${accountWorkerLogin}"`);
  const password = await hashPassword('Synthetic-evidence-test-password');
  await dbOwner.query('INSERT INTO organisations(id,name) VALUES($1,$2),($3,$4)', [organisationId, 'Synthetic Evidence Organisation', otherOrganisationId, 'Synthetic Other Evidence Organisation']);
  await dbOwner.query('INSERT INTO sites(id,organisation_id,code,name) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [siteId, organisationId, 'EVID', 'Synthetic Evidence Site', otherSiteId, otherOrganisationId, 'OTHER', 'Synthetic Other Evidence Site']);
  await dbOwner.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4),($8,$9,$10,$4)', [staffId, 'evidence-test', 'Evidence Tester', password, otherStaffId, 'evidence-other-site', 'Other Site Evidence Tester', sameSiteStaffId, 'evidence-same-site', 'Same Site Evidence Tester']);
  await dbOwner.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true),($3,$4,true),($5,$2,true)', [staffId, siteId, otherStaffId, otherSiteId, sameSiteStaffId]);
  app = await createApp(config, runtime, oidc, services, undefined, dbOwner);
});

after(async () => {
  if (app) await app.close();
  await accountWorker.end();
  await worker.end();
  await dbOwner.end();
  await owner.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await owner.query(`DROP ROLE IF EXISTS "${accountWorkerLogin}"`);
  await owner.query(`DROP ROLE IF EXISTS "${workerLogin}"`);
  await owner.end();
});

test('API shutdown attempts service and database cleanup without exposing disposal errors', async () => {
  const shutdownPool = makePool(testRuntimeUrl.toString());
  let closeCalls = 0;
  const shutdownApp = await createApp(config, shutdownPool, oidc, {
    ...services,
    close: async () => {
      closeCalls += 1;
      throw new Error('synthetic-private-endpoint-must-not-escape');
    },
  });

  await assert.rejects(shutdownApp.close(), /VMMS API resources did not close cleanly/);
  assert.equal(closeCalls, 1, 'the app should close the transferred evidence service bundle once');
  await assert.rejects(shutdownPool.query('SELECT 1'), /Cannot use a pool after calling end/);
});

test('staff evidence upload is quarantined, scanned, verified, and served with an access audit', async () => {
  const headers = await staffHeaders();
  const { bytes, intentId, evidenceId } = await uploadPdf(headers, 'invoice-scan.pdf');
  const storedKeys = await dbOwner.query('SELECT quarantine_key,accepted_key FROM evidence_records WHERE id=$1', [evidenceId]);
  assert.deepEqual(storedKeys.rows[0], { quarantine_key: `quarantine/${evidenceId}`, accepted_key: null });
  assert.doesNotMatch(storedKeys.rows[0].quarantine_key, new RegExp(`${organisationId}|${siteId}`));
  const result = { evidenceId };
  assert.equal(await processNextEvidenceScanJob(worker, services), true);
  const acceptedKey = await dbOwner.query('SELECT accepted_key FROM evidence_records WHERE id=$1', [evidenceId]);
  assert.equal(acceptedKey.rows[0]?.accepted_key, `accepted/${evidenceId}`);

  const detail = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${result.evidenceId}`, headers });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().state, 'accepted');
  const download = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${result.evidenceId}/download`, headers });
  assert.equal(download.statusCode, 200, download.body);
  assert.match(download.headers['cache-control'] ?? '', /no-store/);
  assert.match(download.headers['content-disposition'] ?? '', /attachment/);
  assert.equal(download.body, bytes.toString());
  const audit = await dbOwner.query('SELECT count(*)::int AS count FROM evidence_access_events WHERE evidence_id=$1 AND actor_id=$2', [result.evidenceId, staffId]);
  assert.equal(audit.rows[0].count, 1);

  const replay = await app.inject({
    method: 'PUT', url: `/api/v1/sites/${siteId}/evidence/intents/${intentId}/content`,
    headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) }, payload: bytes,
  });
  assert.equal(replay.statusCode, 409);
  const anonymous = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}/download` });
  assert.equal(anonymous.statusCode, 401);
  const otherSite = await app.inject({ method: 'GET', url: `/api/v1/sites/${randomUUID()}/evidence/${evidenceId}/download`, headers });
  assert.equal(otherSite.statusCode, 403);
});

test('work-order evidence stays private until clean, attaches through a versioned command and resumes idempotently', async () => {
  const headers = await staffHeaders();
  const sameSiteHeaders = await staffHeaders(app, 'evidence-same-site');
  const intake = await app.inject({
    method: 'POST', url: `/api/v1/sites/${siteId}/intake-drafts`,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      client: { kind: 'new', partyKind: 'organisation', name: 'Synthetic Evidence Customer', phone: '', email: '' },
      owner: { kind: 'new', partyKind: 'person', name: 'Synthetic Evidence Owner', phone: '', email: '' },
      visitContact: { kind: 'new', name: 'Synthetic Evidence Contact', phone: '+233200000001', email: '' },
      vehicle: { kind: 'new', vin: 'WVWZZZ1JZXW000001', registration: 'EVID-001', make: 'Development', model: 'EV' },
      odometerKm: 12000, socPercent: 42, powertrainClass:'EV', warrantyStatus:'unknown', warrantyConfirmationNote:'', complaint: 'Synthetic attachment workflow fixture',
    },
  });
  assert.equal(intake.statusCode, 200, intake.body);
  const orderId = z.object({ id: z.string().uuid() }).parse(intake.json()).id;
  const bytes = Buffer.from('%PDF-1.4\nSynthetic work-order evidence\n%%EOF\n');
  const intentResponse = await app.inject({
    method: 'POST', url: `/api/v1/sites/${siteId}/work-orders/${orderId}/evidence/intents`,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { displayName: 'service-record.pdf', declaredMediaType: 'application/pdf', expectedBytes: bytes.length },
  });
  assert.equal(intentResponse.statusCode, 200, intentResponse.body);
  const intentId = z.object({ id: z.string().uuid() }).parse(intentResponse.json()).id;
  const peerBeforeUpload = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/intents/${intentId}`, headers: sameSiteHeaders });
  assert.equal(peerBeforeUpload.statusCode, 404, 'A different staff member at the same site cannot recover another person’s upload pointer.');
  const otherTenantHeaders = await staffHeaders(app, 'evidence-other-site');
  const crossTenantIntent = await app.inject({ method: 'GET', url: `/api/v1/sites/${otherSiteId}/evidence/intents/${intentId}`, headers: otherTenantHeaders });
  assert.equal(crossTenantIntent.statusCode, 404, 'A different tenant cannot resolve another tenant’s upload pointer.');
  const upload = await submitEvidenceBytes(headers, intentId, bytes);
  assert.equal(upload.statusCode, 202, upload.body);
  const evidenceId = z.object({ evidenceId: z.string().uuid() }).parse(upload.json()).evidenceId;

  const stagedDownload = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}/download`, headers });
  assert.equal(stagedDownload.statusCode, 404, 'A work-order upload must not be downloadable until it is linked.');
  const recovered = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/intents/${intentId}`, headers });
  assert.equal(recovered.statusCode, 200, recovered.body);
  assert.equal(recovered.json().state, 'completed');
  assert.equal(recovered.json().evidenceId, evidenceId);
  const peerAfterUpload = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/intents/${intentId}`, headers: sameSiteHeaders });
  assert.equal(peerAfterUpload.statusCode, 404, 'Upload completion does not widen creator-only recovery access.');

  const pendingAttach = await app.inject({
    method: 'POST', url: `/api/v1/sites/${siteId}/work-orders/${orderId}/evidence`,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { expectedVersion: 1, evidenceId },
  });
  assert.equal(pendingAttach.statusCode, 409);
  assert.equal(pendingAttach.json().error.code, 'EVIDENCE_NOT_ACCEPTED');

  assert.equal(await processNextEvidenceScanJob(worker, services), true);
  const complaintId = z.object({ complaints: z.array(z.object({ id: z.string().uuid() })).min(1) }).parse(intake.json()).complaints[0]!.id;
  const findingPath = `/api/v1/sites/${siteId}/work-orders/${orderId}/diagnostic-findings`;
  const unattachedFinding = await app.inject({
    method: 'POST', url: findingPath,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: {
      expectedVersion: 1,
      complaintId,
      observedAt: new Date().toISOString(),
      summary: 'Uploaded service record supports the reported concern.',
      certainty: { state: 'inconclusive', explanation: 'The record is relevant but does not confirm the cause.' },
      residualRisk: 'Cause remains unresolved.',
      restrictions: 'Do not represent the concern as cleared.',
      observations: [{ kind: 'condition', description: 'Reviewed the customer-provided service record; relevant history found, but the cause remains unconfirmed.' }],
      evidenceIds: [evidenceId],
    },
  });
  assert.equal(unattachedFinding.statusCode, 409, unattachedFinding.body);
  assert.equal(unattachedFinding.json().error.code, 'DIAGNOSTIC_EVIDENCE_NOT_ACCEPTED');

  const attachKey = randomUUID();
  const attach = () => app.inject({
    method: 'POST', url: `/api/v1/sites/${siteId}/work-orders/${orderId}/evidence`,
    headers: { ...headers, 'idempotency-key': attachKey },
    payload: { expectedVersion: 1, evidenceId },
  });
  const attached = await attach();
  assert.equal(attached.statusCode, 200, attached.body);
  assert.equal(attached.json().version, 2);
  assert.equal(attached.json().evidence.length, 1);
  assert.equal(attached.json().evidence[0].evidenceId, evidenceId);
  assert.equal(attached.json().evidence[0].uploadIntentId, null);

  const findingPayload = {
    expectedVersion: 2,
    complaintId,
    observedAt: new Date().toISOString(),
    summary: 'Uploaded service record supports the reported concern.',
    certainty: { state: 'inconclusive', explanation: 'The record is relevant but does not confirm the cause.' },
    residualRisk: 'Cause remains unresolved.',
    restrictions: 'Do not represent the concern as cleared.',
    observations: [{ kind: 'condition', description: 'Reviewed the customer-provided service record; relevant history found, but the cause remains unconfirmed.' }],
    evidenceIds: [evidenceId],
  };
  const linkedFinding = await app.inject({
    method: 'POST', url: findingPath,
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: findingPayload,
  });
  assert.equal(linkedFinding.statusCode, 200, linkedFinding.body);
  assert.deepEqual(linkedFinding.json().diagnosticFindings[0].evidenceIds, [evidenceId]);
  assert.ok(linkedFinding.json().gates.every((gate: { state: string }) => gate.state === 'pending'));

  const replay = await attach();
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().version, 2, 'Replaying the command must not add another work-order version.');
  const events = await dbOwner.query(
    "SELECT count(*)::int AS count FROM domain_events WHERE aggregate_id=$1 AND event_type='work-order.evidence-attached'",
    [orderId],
  );
  assert.equal(events.rows[0].count, 1);
  await assert.rejects(
    runtime.query(
      'INSERT INTO work_order_evidence_links(organisation_id,site_id,work_order_id,evidence_id,attached_by) VALUES($1,$2,$3,$4,$5)',
      [organisationId, siteId, orderId, evidenceId, staffId],
    ),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === '42501'),
    'The runtime connection must not bypass the approved attachment command.',
  );

  const download = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}/download`, headers });
  assert.equal(download.statusCode, 200, download.body);
  assert.equal(download.body, bytes.toString());
});

test('authorised staff cannot read evidence from another tenant and membership revocation blocks evidence access', async () => {
  const ownerHeaders = await staffHeaders();
  const { evidenceId } = await uploadPdf(ownerHeaders, 'scope-boundary.pdf');
  assert.equal(await processNextEvidenceScanJob(worker, services), true);

  const otherTenantHeaders = await staffHeaders(app, 'evidence-other-site');
  const crossTenantRead = await app.inject({ method: 'GET', url: `/api/v1/sites/${otherSiteId}/evidence/${evidenceId}`, headers: otherTenantHeaders });
  const crossTenantDownload = await app.inject({ method: 'GET', url: `/api/v1/sites/${otherSiteId}/evidence/${evidenceId}/download`, headers: otherTenantHeaders });
  assert.equal(crossTenantRead.statusCode, 404);
  assert.equal(crossTenantDownload.statusCode, 404);

  await dbOwner.query('UPDATE memberships SET active=false WHERE user_id=$1 AND site_id=$2', [staffId, siteId]);
  try {
    const revokedRead = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}`, headers: ownerHeaders });
    const revokedDownload = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}/download`, headers: ownerHeaders });
    assert.equal(revokedRead.statusCode, 403);
    assert.equal(revokedDownload.statusCode, 403);
  } finally {
    await dbOwner.query('UPDATE memberships SET active=true WHERE user_id=$1 AND site_id=$2', [staffId, siteId]);
  }

  const audit = await dbOwner.query('SELECT count(*)::int AS count FROM evidence_access_events WHERE evidence_id=$1', [evidenceId]);
  assert.equal(audit.rows[0].count, 0, 'Denied status and download attempts must not create successful access audit events.');
});

test('local S3 and ClamAV accept clean synthetic evidence and reject the EICAR scanner fixture', { skip: integratedStorage === null }, async () => {
  if (!integratedStorage) return;
  const apiServices = integratedStorage.api;
  const workerServices = integratedStorage.worker;
  assert.ok(apiServices.store && apiServices.scanner, 'API object storage and scanner configuration must be complete');
  assert.ok(workerServices.store && workerServices.scanner, 'Worker object storage and scanner configuration must be complete');
  const objectOwners = new Map<string, PrivateEvidenceStore>();
  apiServices.store = trackEvidenceObjects(apiServices.store, objectOwners);
  workerServices.store = trackEvidenceObjects(workerServices.store, objectOwners);
  const integrationRuntime = makePool(testRuntimeUrl.toString());
  let integrationApp: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    integrationApp = await createApp(config, integrationRuntime, oidc, apiServices, undefined, dbOwner);
    const headers = await staffHeaders(integrationApp);
    const cleanUpload = await uploadPdf(headers, 'local-object-store.pdf', integrationApp);
    const { bytes, evidenceId } = cleanUpload;
    const concurrentClaims = await Promise.allSettled([
      processNextEvidenceScanJob(worker, workerServices),
      processNextEvidenceScanJob(worker, workerServices),
    ]);
    const rejectedClaims = concurrentClaims.filter((claim): claim is PromiseRejectedResult => claim.status === 'rejected');
    assert.equal(rejectedClaims.length, 0, 'Both concurrent workers must finish before object cleanup.');
    const claimResults = concurrentClaims.map((claim) => claim.status === 'fulfilled' ? claim.value : false);
    assert.deepEqual(claimResults.sort(), [false, true], 'Only one concurrent worker may claim and process the same scan job.');
    const scanCounts = await dbOwner.query(`
      SELECT j.attempts::int AS claims,
             (SELECT count(*)::int FROM evidence_scan_attempts a WHERE a.evidence_id=j.evidence_id) AS verdicts
      FROM evidence_scan_jobs j WHERE j.evidence_id=$1`, [evidenceId]);
    assert.deepEqual(scanCounts.rows[0], { claims: 1, verdicts: 1 });
    const status = await integrationApp.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}`, headers });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().state, 'accepted');
    const download = await integrationApp.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}/download`, headers });
    assert.equal(download.statusCode, 200, download.body);
    assert.equal(download.body, bytes.toString());

    const abandoned = await uploadPdf(headers, 'expired-worker-lease.pdf', integrationApp);
    const abandonedClaim = await worker.query('SELECT * FROM public.claim_evidence_scan_job($1)', [10]);
    const lease = z.object({ job_id: z.string().uuid(), evidence_id: z.string().uuid() }).parse(abandonedClaim.rows[0]);
    assert.equal(lease.evidence_id, abandoned.evidenceId);
    await dbOwner.query("UPDATE evidence_scan_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [lease.job_id]);
    assert.equal(await processNextEvidenceScanJob(worker, workerServices), true, 'A worker must reclaim a job after the previous lease expires.');
    const recovered = await integrationApp.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${abandoned.evidenceId}`, headers });
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.equal(recovered.json().state, 'accepted');
    const leaseRecovery = await dbOwner.query(`
      SELECT j.attempts::int AS claims,
             (SELECT count(*)::int FROM evidence_scan_attempts a WHERE a.evidence_id=j.evidence_id) AS verdicts
      FROM evidence_scan_jobs j WHERE j.evidence_id=$1`, [abandoned.evidenceId]);
    assert.deepEqual(leaseRecovery.rows[0], { claims: 2, verdicts: 1 });

    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const eicarArchive = zipStoredFile('eicar.com', eicar);
    const eicarIntentId = await createUploadIntent(headers, 'eicar-safe-scanner-check.zip', eicarArchive.length, 'application/zip', integrationApp);
    const eicarUpload = await submitEvidenceBytes(headers, eicarIntentId, eicarArchive, eicarArchive.length, integrationApp);
    assert.equal(eicarUpload.statusCode, 202, eicarUpload.body);
    const eicarEvidenceId = z.object({ evidenceId: z.string().uuid() }).parse(eicarUpload.json()).evidenceId;
    assert.equal(await processNextEvidenceScanJob(worker, workerServices), true);
    const rejected = await integrationApp.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${eicarEvidenceId}`, headers });
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(rejected.json().state, 'rejected');
    const rejectedDownload = await integrationApp.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${eicarEvidenceId}/download`, headers });
    assert.equal(rejectedDownload.statusCode, 404, rejectedDownload.body);
  } finally {
    const cleanupResults = await Promise.allSettled(
      [...objectOwners].map(([key, store]) => store.delete(key)),
    );
    const cleanupErrors = cleanupResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    try {
      if (integrationApp) await integrationApp.close();
      else await integrationRuntime.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Local evidence integration cleanup failed.');
  }
});

test('unavailable and infected scan verdicts never allow evidence download', async () => {
  const headers = await staffHeaders();
  try {
    for (const mode of ['unavailable', 'infected'] as const) {
      scannerMode = mode;
      const { evidenceId } = await uploadPdf(headers, `${mode}.pdf`);
      assert.equal(await processNextEvidenceScanJob(worker, services), true);
      const status = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}`, headers });
      assert.equal(status.statusCode, 200, status.body);
      assert.equal(status.json().state, mode === 'infected' ? 'rejected' : 'quarantined');
      const download = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}/download`, headers });
      assert.equal(download.statusCode, 404);
    }
  } finally {
    scannerMode = 'clean';
  }
});

test('a synthetic ClamAV protocol timeout leaves uploaded evidence quarantined and unavailable to download', async () => {
  const fixture = await startClamAvFixture('scan-timeout');
  const timeoutServices = createEvidenceServices({
    VMMS_EVIDENCE_CLAMAV_HOST: fixture.host,
    VMMS_EVIDENCE_CLAMAV_PORT: String(fixture.port),
    VMMS_EVIDENCE_CLAMAV_TIMEOUT_MS: '1000',
  });
  const previousScanner = services.scanner;
  assert(timeoutServices.scanner);
  services.scanner = timeoutServices.scanner;
  try {
    const headers = await staffHeaders();
    const { evidenceId } = await uploadPdf(headers, 'scanner-timeout.pdf');
    let evidenceState = 'pending';
    for (let attempt = 0; attempt < 20 && evidenceState === 'pending'; attempt += 1) {
      assert.equal(await processNextEvidenceScanJob(worker, services), true);
      const result = await dbOwner.query('SELECT scan_state FROM evidence_records WHERE id=$1', [evidenceId]);
      evidenceState = String(result.rows[0]?.scan_state ?? 'missing');
    }
    assert.equal(evidenceState, 'quarantined', 'The worker must process this upload, even when older scan jobs are queued first.');

    const status = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}`, headers });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().state, 'quarantined');
    assert.equal(status.json().scanDetailCode, 'scanner-unavailable');
    const record = await dbOwner.query('SELECT scan_state,accepted_key FROM evidence_records WHERE id=$1', [evidenceId]);
    assert.deepEqual(record.rows[0], { scan_state: 'quarantined', accepted_key: null });
    assert.equal(objectMap.has(`quarantine/${evidenceId}`), true);
    assert.equal(objectMap.has(`accepted/${evidenceId}`), false);

    const download = await app.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}/download`, headers });
    assert.equal(download.statusCode, 404);
  } finally {
    services.scanner = previousScanner;
    await timeoutServices.close();
    await fixture.close();
  }
});

test('evidence rejects type mismatch, oversized requests and interrupted uploads without retaining bytes', async () => {
  const headers = await staffHeaders();
  const bytes = Buffer.from('%PDF-1.4\nSynthetic rejection fixture\n%%EOF\n');
  const storedBefore = [...objectMap.keys()].sort();
  const allowedMediaTypes = services.allowedMediaTypes;
  services.allowedMediaTypes = new Set([...allowedMediaTypes, 'image/png']);
  try {
    const mismatchIntent = await createUploadIntent(headers, 'declared-png-actual-pdf.png', bytes.length, 'image/png');
    const mismatch = await submitEvidenceBytes(headers, mismatchIntent, bytes);
    assert.equal(mismatch.statusCode, 415, mismatch.body);
    assert.equal(mismatch.json().error.code, 'EVIDENCE_TYPE_MISMATCH');
  } finally {
    services.allowedMediaTypes = allowedMediaTypes;
  }

  const oversizedIntent = await app.inject({
    method: 'POST', url: `/api/v1/sites/${siteId}/evidence/intents`, headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { purpose: 'attachment', displayName: 'too-large.pdf', declaredMediaType: 'application/pdf', expectedBytes: services.maxUploadBytes + 1 },
  });
  assert.equal(oversizedIntent.statusCode, 413);

  const lengthIntent = await createUploadIntent(headers, 'content-length-mismatch.pdf', bytes.length, 'application/pdf');
  const lengthMismatch = await submitEvidenceBytes(headers, lengthIntent, bytes, bytes.length + 1);
  assert.equal(lengthMismatch.statusCode, 413, lengthMismatch.body);
  assert.equal(lengthMismatch.json().error.code, 'EVIDENCE_SIZE_MISMATCH');

  const interruptedIntent = await createUploadIntent(headers, 'interrupted.pdf', bytes.length + 7, 'application/pdf');
  const interrupted = await submitEvidenceBytes(headers, interruptedIntent, bytes, bytes.length + 7);
  assert.equal(interrupted.statusCode, 400, interrupted.body);
  assert.equal(interrupted.json().error.code, 'EVIDENCE_SIZE_MISMATCH');
  assert.deepEqual([...objectMap.keys()].sort(), storedBefore, 'Rejected or interrupted uploads must leave no quarantined objects.');
});

test('account provisioning worker retries the same operation safely and keeps its database capability isolated',async()=>{
  const runtimePrivileges=await dbOwner.query(`SELECT
    has_column_privilege('vmms_runtime','public.staff_account_provisioning_requests','email','INSERT') AS may_request,
    has_column_privilege('vmms_runtime','public.staff_account_provisioning_requests','state','INSERT') AS may_set_state,
    has_column_privilege('vmms_runtime','public.staff_account_provisioning_requests','lease_token','INSERT') AS may_set_lease,
    has_column_privilege('vmms_runtime','public.staff_account_provisioning_requests','provider_reference','INSERT') AS may_forge_provider`);
  assert.deepEqual(runtimePrivileges.rows[0],{may_request:true,may_set_state:false,may_set_lease:false,may_forge_provider:false},
    'The API can store request intent but cannot forge worker outcomes or leases.');
  const functionOwner=await dbOwner.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcanlogin,
      has_table_privilege(r.rolname,'public.staff_account_provisioning_requests','SELECT,UPDATE') AS may_process_requests,
      has_table_privilege(r.rolname,'public.staff_account_provisioning_activity','INSERT') AS may_append_activity
    FROM pg_roles r WHERE r.rolname='vmms_staff_account_function_owner'`);
  assert.deepEqual(functionOwner.rows[0],{rolsuper:false,rolbypassrls:false,rolcanlogin:false,may_process_requests:true,may_append_activity:true},
    'Worker functions must run as a non-login, non-superuser owner that remains subject to RLS.');
  const email='synthetic.worker-target@example.test';
  const requestId=randomUUID();
  await dbOwner.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type)
    VALUES($1,$2,$3,'staff-account-provisioning')`,[requestId,organisationId,siteId]);
  await dbOwner.query(`INSERT INTO staff_account_provisioning_requests
    (id,organisation_id,site_id,email,display_name,site_access,requested_by)
    VALUES($1,$2,$3,$4,$5,'read-only',$6)`,[requestId,organisationId,siteId,email,'Synthetic Worker Target',staffId]);

  await assert.rejects(accountWorker.query('SELECT email FROM staff_account_provisioning_requests'),/permission denied/i,
    'The account worker must not query private request rows directly.');
  await assert.rejects(runtime.query('SELECT * FROM public.claim_staff_account_provisioning_request(120)'),/permission denied/i,
    'The normal VMMS runtime must not claim provisioning work.');
  await assert.rejects(accountWorker.query('SELECT * FROM public.staff_account_provisioning_activity'),/permission denied/i,
    'The account worker may write activity only through its narrow functions.');

  const calls:Array<{operationId:string;email:string;displayName:string}>=[];
  const references=new Map<string,string>();
  const adapter:StaffAccountProvisioningAdapter={async createInvitation(input){
    calls.push(input);
    assert.equal(input.operationId,requestId,'Retries must use the original durable request as the provider idempotency key.');
    assert.equal(input.email,email);
    assert.equal(input.displayName,'Synthetic Worker Target');
    if(calls.length===1)return {kind:'retryable-failure',errorCode:'provider-unavailable'};
    const reference=references.get(input.operationId)??`synthetic-invitation-${input.operationId}`;
    references.set(input.operationId,reference);
    return {kind:'invitation-issued',providerReference:reference};
  }};

  assert.equal(await processNextStaffAccountProvisioningRequest(accountWorker,adapter,{retryDelaySeconds:1,maxAttempts:3}),true);
  const first=await dbOwner.query('SELECT state,attempt_count FROM staff_account_provisioning_requests WHERE id=$1',[requestId]);
  assert.deepEqual(first.rows[0],{state:'queued',attempt_count:1});
  assert.equal(await processNextStaffAccountProvisioningRequest(accountWorker,adapter,{retryDelaySeconds:1,maxAttempts:3}),false,
    'A request must not be retried before its durable retry time.');
  await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal(await processNextStaffAccountProvisioningRequest(accountWorker,adapter,{retryDelaySeconds:1,maxAttempts:3}),true);
  assert.equal(calls.length,2);
  assert.deepEqual(new Set(calls.map(call=>call.operationId)),new Set([requestId]));

  const settled=await dbOwner.query('SELECT state,attempt_count,provider_reference FROM staff_account_provisioning_requests WHERE id=$1',[requestId]);
  assert.deepEqual(settled.rows[0],{state:'invitation-issued',attempt_count:2,provider_reference:`synthetic-invitation-${requestId}`});
  const history=await dbOwner.query(`SELECT attempt_no,worker_principal,phase,previous_state,next_state,provider_reference,error_code
    FROM staff_account_provisioning_activity WHERE organisation_id=$1 AND site_id=$2 AND request_id=$3
    ORDER BY attempt_no,CASE WHEN phase='claimed' THEN 0 ELSE 1 END`,[organisationId,siteId,requestId]);
  assert.equal(history.rowCount,4);
  assert.deepEqual(new Set(history.rows.map(row=>row.phase)),new Set(['claimed','retryable-failure','invitation-issued']));
  assert.deepEqual(history.rows.map(row=>[row.previous_state,row.next_state]),[
    ['queued','provisioning'],['provisioning','queued'],['queued','provisioning'],['provisioning','invitation-issued'],
  ]);
  assert.ok(history.rows.every(row=>row.worker_principal===accountWorkerLogin),'Each service transition must record the actual database worker principal.');
  assert.equal(JSON.stringify(history.rows).includes(email),false,'Worker activity must not copy the requested email.');
  assert.equal(Number((await dbOwner.query('SELECT count(*)::int AS count FROM staff_users WHERE display_name=$1',['Synthetic Worker Target'])).rows[0]?.count),0,
    'Issuing an invitation does not create or link a VMMS account before verified OIDC sign-in.');
  assert.equal(Number((await dbOwner.query('SELECT count(*)::int AS count FROM staff_identities WHERE subject=$1',[requestId])).rows[0]?.count),0);
  assert.equal(await processNextStaffAccountProvisioningRequest(accountWorker,adapter),false,'A completed request must not dispatch again.');

  const expiredId=randomUUID();
  await dbOwner.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type)
    VALUES($1,$2,$3,'staff-account-provisioning')`,[expiredId,organisationId,siteId]);
  await dbOwner.query(`INSERT INTO staff_account_provisioning_requests
    (id,organisation_id,site_id,email,display_name,site_access,requested_by)
    VALUES($1,$2,$3,'synthetic.expired-lease@example.test','Synthetic Expired Lease','read-only',$4)`,[expiredId,organisationId,siteId,staffId]);
  const firstLease=(await accountWorker.query('SELECT * FROM public.claim_staff_account_provisioning_request($1)',[10])).rows[0] as {request_id:string;operation_id:string;lease_token:string;attempt_no:number};
  await dbOwner.query("UPDATE staff_account_provisioning_requests SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[expiredId]);
  const reclaimed=(await accountWorker.query('SELECT * FROM public.claim_staff_account_provisioning_request($1)',[10])).rows[0] as {request_id:string;operation_id:string;lease_token:string;attempt_no:number};
  assert.equal(reclaimed.request_id,firstLease.request_id);
  assert.equal(reclaimed.operation_id,firstLease.operation_id,'Lease recovery must keep the provider idempotency key stable.');
  assert.equal(reclaimed.attempt_no,2);
  assert.notEqual(reclaimed.lease_token,firstLease.lease_token);
  const staleComplete=await accountWorker.query(`SELECT public.complete_staff_account_provisioning_request($1,$2,'invitation-issued',$3,NULL,1,8) AS completed`,
    [expiredId,firstLease.lease_token,`synthetic-stale-${expiredId}`]);
  assert.equal(staleComplete.rows[0]?.completed,false,'A late worker must not settle a request after its lease is replaced.');
  const currentComplete=await accountWorker.query(`SELECT public.complete_staff_account_provisioning_request($1,$2,'invitation-issued',$3,NULL,1,8) AS completed`,
    [expiredId,reclaimed.lease_token,`synthetic-current-${expiredId}`]);
  assert.equal(currentComplete.rows[0]?.completed,true);
  assert.equal((await dbOwner.query('SELECT state FROM staff_account_provisioning_requests WHERE id=$1',[expiredId])).rows[0]?.state,'invitation-issued');

  const concurrentId=randomUUID();
  await dbOwner.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type)
    VALUES($1,$2,$3,'staff-account-provisioning')`,[concurrentId,organisationId,siteId]);
  await dbOwner.query(`INSERT INTO staff_account_provisioning_requests
    (id,organisation_id,site_id,email,display_name,site_access,requested_by)
    VALUES($1,$2,$3,'synthetic.concurrent-target@example.test','Synthetic Concurrent Target','read-only',$4)`,[concurrentId,organisationId,siteId,staffId]);
  let markStarted!:()=>void;
  let resolveProvider!:(value:{kind:'invitation-issued';providerReference:string})=>void;
  const started=new Promise<void>(resolve=>{markStarted=resolve;});
  const providerResult=new Promise<{kind:'invitation-issued';providerReference:string}>(resolve=>{resolveProvider=resolve;});
  let concurrentCalls=0;
  const slowAdapter:StaffAccountProvisioningAdapter={async createInvitation(){concurrentCalls++;markStarted();return providerResult;}};
  const firstWorker=processNextStaffAccountProvisioningRequest(accountWorker,slowAdapter);
  await started;
  assert.equal(await processNextStaffAccountProvisioningRequest(accountWorker,{async createInvitation(){throw new Error('A second worker must not claim the active lease.');}}),false);
  resolveProvider({kind:'invitation-issued',providerReference:`synthetic-invitation-${concurrentId}`});
  assert.equal(await firstWorker,true);
  assert.equal(concurrentCalls,1,'Concurrent workers must not dispatch the same active lease twice.');

  const existingIdentityId=randomUUID();
  await dbOwner.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type)
    VALUES($1,$2,$3,'staff-account-provisioning')`,[existingIdentityId,organisationId,siteId]);
  await dbOwner.query(`INSERT INTO staff_account_provisioning_requests
    (id,organisation_id,site_id,email,display_name,site_access,requested_by)
    VALUES($1,$2,$3,'already-used@example.test','Synthetic Existing Identity','read-only',$4)`,[existingIdentityId,organisationId,siteId,staffId]);
  const conflictAdapter:StaffAccountProvisioningAdapter={async createInvitation(){return {kind:'permanent-failure',errorCode:'identity-already-exists'};}};
  assert.equal(await processNextStaffAccountProvisioningRequest(accountWorker,conflictAdapter),true);
  assert.equal((await dbOwner.query('SELECT state FROM staff_account_provisioning_requests WHERE id=$1',[existingIdentityId])).rows[0]?.state,'failed',
    'An existing identity must require review and never be linked automatically by email.');

  const retryLimitId=randomUUID();
  await dbOwner.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type)
    VALUES($1,$2,$3,'staff-account-provisioning')`,[retryLimitId,organisationId,siteId]);
  await dbOwner.query(`INSERT INTO staff_account_provisioning_requests
    (id,organisation_id,site_id,email,display_name,site_access,requested_by)
    VALUES($1,$2,$3,'synthetic.retry-limit@example.test','Synthetic Retry Limit','read-only',$4)`,[retryLimitId,organisationId,siteId,staffId]);
  const unavailableAdapter:StaffAccountProvisioningAdapter={async createInvitation(){return {kind:'retryable-failure',errorCode:'provider-unavailable'};}};
  assert.equal(await processNextStaffAccountProvisioningRequest(accountWorker,unavailableAdapter,{maxAttempts:1}),true);
  assert.equal((await dbOwner.query('SELECT state FROM staff_account_provisioning_requests WHERE id=$1',[retryLimitId])).rows[0]?.state,'failed',
    'Retry exhaustion must become visible for review instead of retrying forever.');
});

test('worker storage configuration requires its separate object-store identity', () => {
  const shared = {
    VMMS_EVIDENCE_S3_ENDPOINT: 'http://127.0.0.1:19091',
    VMMS_EVIDENCE_S3_BUCKET: evidenceTestBucket,
    VMMS_EVIDENCE_S3_ACCESS_KEY_ID: 'api-test',
    VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY: 'api-test-secret',
  };
  assert.throws(() => createEvidenceServices(shared, 'worker'), /incomplete for the worker role/);
  const workerServices = createEvidenceServices({
    ...shared,
    VMMS_EVIDENCE_WORKER_S3_ACCESS_KEY_ID: 'worker-test',
    VMMS_EVIDENCE_WORKER_S3_SECRET_ACCESS_KEY: 'worker-test-secret',
  }, 'worker');
  assert.ok(workerServices.store);
});
