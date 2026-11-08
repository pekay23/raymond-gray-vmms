import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { makePool } from '../src/db.js';
import { hashPassword } from '../src/identity.js';
import { createEvidenceServices, processNextEvidenceScanJob, type EvidenceServices, type MalwareScanner, type PrivateEvidenceStore } from '../src/evidence.js';
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
const siteId = randomUUID(), organisationId = randomUUID(), staffId = randomUUID();
const otherSiteId = randomUUID(), otherOrganisationId = randomUUID(), otherStaffId = randomUUID();
const config: Config = {
  DATABASE_URL: testRuntimeUrl.toString(),
  SESSION_SECRET: 'synthetic-test-session-secret-at-least-32',
  WEB_ORIGIN: 'http://127.0.0.1:5173',
  OIDC_ISSUER: 'http://localhost:8080/realms/raymond-gray-dev',
  OIDC_CLIENT_ID: 'vmms-web-dev',
  OIDC_CALLBACK_URL: 'http://127.0.0.1:4100/api/v1/auth/oidc/callback',
  PORT: 4100, HOST: '127.0.0.1', NODE_ENV: 'test',
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
  store: new MemoryPrivateStore(), scanner, maxUploadBytes: 1024 * 1024, allowedMediaTypes: new Set(['application/pdf']),
};
const integratedStorage = process.env.VMMS_EVIDENCE_STORAGE_INTEGRATION === '1'
  ? {
      api: createEvidenceServices(process.env, 'api'),
      worker: createEvidenceServices(process.env, 'worker'),
    }
  : null;
const oidc: OidcProvider = {
  async createAuthorizationUrl() { return new URL('http://localhost:8080/'); },
  async exchangeAuthorizationCode() { return { issuer: config.OIDC_ISSUER, subject: 'not-used' }; },
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

before(async () => {
  const hasRuntime = await owner.query("SELECT 1 FROM pg_roles WHERE rolname='vmms_runtime'");
  if (!hasRuntime.rowCount) await owner.query("CREATE ROLE vmms_runtime LOGIN PASSWORD 'vmms_runtime_local_development_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  await owner.query(`CREATE DATABASE ${dbName}`);
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter((name) => name.endsWith('.sql')).sort()) {
    await dbOwner.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  await owner.query(`CREATE ROLE "${workerLogin}" LOGIN INHERIT PASSWORD '${workerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await owner.query(`GRANT vmms_evidence_worker TO "${workerLogin}"`);
  const password = await hashPassword('Synthetic-evidence-test-password');
  await dbOwner.query('INSERT INTO organisations(id,name) VALUES($1,$2),($3,$4)', [organisationId, 'Synthetic Evidence Organisation', otherOrganisationId, 'Synthetic Other Evidence Organisation']);
  await dbOwner.query('INSERT INTO sites(id,organisation_id,code,name) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [siteId, organisationId, 'EVID', 'Synthetic Evidence Site', otherSiteId, otherOrganisationId, 'OTHER', 'Synthetic Other Evidence Site']);
  await dbOwner.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4)', [staffId, 'evidence-test', 'Evidence Tester', password, otherStaffId, 'evidence-other-site', 'Other Site Evidence Tester']);
  await dbOwner.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true),($3,$4,true)', [staffId, siteId, otherStaffId, otherSiteId]);
  app = await createApp(config, runtime, oidc, services);
});

after(async () => {
  if (app) await app.close();
  await worker.end();
  await dbOwner.end();
  await owner.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await owner.query(`DROP ROLE IF EXISTS "${workerLogin}"`);
  await owner.end();
});

test('staff evidence upload is quarantined, scanned, verified, and served with an access audit', async () => {
  const headers = await staffHeaders();
  const { bytes, intentId, evidenceId } = await uploadPdf(headers, 'invoice-scan.pdf');
  const result = { evidenceId };
  assert.equal(await processNextEvidenceScanJob(worker, services), true);

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

test('local S3 and malware scanner accept and serve a verified synthetic file', { skip: integratedStorage === null }, async () => {
  if (!integratedStorage) return;
  const apiServices = integratedStorage.api;
  const workerServices = integratedStorage.worker;
  assert.ok(apiServices.store && apiServices.scanner, 'API object storage and scanner configuration must be complete');
  assert.ok(workerServices.store && workerServices.scanner, 'Worker object storage and scanner configuration must be complete');
  const integrationRuntime = makePool(testRuntimeUrl.toString());
  let integrationApp: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    integrationApp = await createApp(config, integrationRuntime, oidc, apiServices);
    const headers = await staffHeaders(integrationApp);
    const { bytes, evidenceId } = await uploadPdf(headers, 'local-object-store.pdf', integrationApp);
    assert.equal(await processNextEvidenceScanJob(worker, workerServices), true);
    const status = await integrationApp.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}`, headers });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().state, 'accepted');
    const download = await integrationApp.inject({ method: 'GET', url: `/api/v1/sites/${siteId}/evidence/${evidenceId}/download`, headers });
    assert.equal(download.statusCode, 200, download.body);
    assert.equal(download.body, bytes.toString());
  } finally {
    if (integrationApp) await integrationApp.close();
    else await integrationRuntime.end();
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

test('worker storage configuration requires its separate object-store identity', () => {
  const shared = {
    VMMS_EVIDENCE_S3_ENDPOINT: 'http://127.0.0.1:19090',
    VMMS_EVIDENCE_S3_BUCKET: 'vmms-evidence',
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
