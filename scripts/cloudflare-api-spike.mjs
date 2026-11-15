import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import pg from 'pg';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = resolve(root, 'apps/api');
const reportPath = resolve(root, 'docs/verification/checks/cloudflare-api-worker-spike-2026-11-11.md');
const sqlDirectory = resolve(apiRoot, 'migrations');
const localEnv = dotenv.parse(await readFile(resolve(root, '.env')));
const ownerBase = checkedLocalUrl(localEnv.MIGRATION_DATABASE_URL, 'MIGRATION_DATABASE_URL');
const runtimeBase = checkedLocalUrl(localEnv.DATABASE_URL, 'DATABASE_URL');
assert.equal(ownerBase.hostname, runtimeBase.hostname, 'Migration and runtime endpoints must be the same local host.');
assert.equal(ownerBase.port, runtimeBase.port, 'Migration and runtime endpoints must be the same local port.');
assert.equal(runtimeBase.username, 'vmms_runtime', 'Worker must use the restricted local runtime role.');

const runId = randomBytes(16).toString('hex');
const databaseName = `vmms_cf_spike_${runId}`;
const organisationId = randomUUID();
const otherOrganisationId = randomUUID();
const siteId = randomUUID();
const secondSiteId = randomUUID();
const otherSiteId = randomUUID();
const actorId = randomUUID();
const username = `cf-spike-${runId.slice(0, 12)}`;
const password = `Synthetic-Cloudflare-Spike-${runId}`;
const ownerUrl = databaseUrl(ownerBase, databaseName);
const runtimeUrl = databaseUrl(runtimeBase, databaseName);
const owner = new pg.Pool({ connectionString: ownerBase.toString(), max: 1 });
let admin;
let child;
let databaseCreated = false;
let reportResult = 'failed';
let phase = 'database-create';
const findings = [];
let workerLog = '';

function checkedLocalUrl(value, label) {
  assert.equal(typeof value, 'string', `${label} is required in the local environment.`);
  const url = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(url.hostname), `${label} must point to loopback; remote DB access is prohibited.`);
  assert.equal(url.protocol, 'postgresql:', `${label} must use PostgreSQL.`);
  return url;
}

function databaseUrl(base, name) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

function cookieJar() {
  const values = new Map();
  return {
    absorb(headers) {
      for (const line of headers.getSetCookie?.() ?? []) {
        const pair = line.split(';', 1)[0];
        const splitAt = pair.indexOf('=');
        if (splitAt > 0) values.set(pair.slice(0, splitAt), pair.slice(splitAt + 1));
      }
    },
    header() { return [...values].map(([name, value]) => `${name}=${value}`).join('; '); },
    csrf() { const token = values.get('vmms_csrf'); return token ? decodeURIComponent(token) : ''; },
  };
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

async function seedDatabase() {
  const role = await owner.query('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1', [runtimeBase.username]);
  assert.equal(role.rowCount, 1, 'The local restricted runtime role must already exist.');
  assert.equal(role.rows[0].rolsuper, false, 'Runtime role cannot be a superuser.');
  assert.equal(role.rows[0].rolbypassrls, false, 'Runtime role cannot bypass row-level security.');

  await owner.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  const migrations = (await readdir(sqlDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) await admin.query(await readFile(resolve(sqlDirectory, name), 'utf8'));

  const { hashPassword } = await import('../apps/api/src/identity.ts');
  const passwordHash = await hashPassword(password);
  await admin.query('INSERT INTO organisations(id,name) VALUES($1,$2),($3,$4)', [organisationId, 'Synthetic Worker Spike A', otherOrganisationId, 'Synthetic Worker Spike B']);
  await admin.query('INSERT INTO sites(id,organisation_id,code,name) VALUES($1,$2,$3,$4),($5,$2,$6,$7),($8,$9,$10,$11)', [siteId, organisationId, 'CFA', 'Synthetic Worker Site A', secondSiteId, 'CFA2', 'Synthetic Worker Site A2', otherSiteId, otherOrganisationId, 'CFB', 'Synthetic Worker Site B']);
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)', [actorId, username, 'Synthetic Worker Spike Staff', passwordHash]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true)', [actorId, siteId]);
}

function childEnvironment() {
  const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH'];
  const result = Object.fromEntries(allowed.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  result.WRANGLER_SEND_METRICS = 'false';
  result.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = runtimeUrl;
  for (const key of Object.keys(result)) assert.ok(!/TOKEN|SECRET|PASSWORD|DATABASE_URL$/i.test(key) || key === 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE');
  return result;
}

function startWorker(port) {
  const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  child = spawn(process.execPath, [wrangler, 'dev', '--config', 'wrangler.spike.jsonc', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'], {
    cwd: apiRoot,
    env: childEnvironment(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => { workerLog = (workerLog + chunk.toString()).slice(-8000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
}

function sanitizedWorkerLog() {
  let value = workerLog;
  for (const secret of [ownerBase.password, runtimeBase.password, ownerBase.toString(), runtimeBase.toString(), ownerUrl, runtimeUrl, password]) {
    if (secret) value = value.replaceAll(secret, '[redacted]');
  }
  return value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL redacted]').slice(-3000);
}

async function waitForWorker(origin) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited before the Worker became ready (${child.exitCode}).`);
    try {
      const response = await fetch(`${origin}/api/v1/session`, { signal: AbortSignal.timeout(1500) });
      if (response.status === 200) return response;
      if (response.status === 503) throw new Error('The Worker returned a startup failure.');
    } catch (error) {
      if (error instanceof Error && error.message.includes('startup failure')) throw error;
    }
    await delay(250);
  }
  throw new Error('Wrangler did not start a local HTTP listener within 90 seconds.');
}

async function expectJson(response, status, label) {
  const text = await response.text();
  assert.equal(response.status, status, `${label} returned ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${label} did not return JSON.`); }
}

async function runScenario(origin, initialSessionResponse) {
  const jar = cookieJar();
  jar.absorb(initialSessionResponse.headers);
  assert.deepEqual(await initialSessionResponse.json(), { authenticated: false });
  assert.ok(jar.csrf(), 'Session response must set a signed CSRF cookie.');
  findings.push('Fastify worker startup and PostgreSQL-backed unauthenticated session route passed.');

  const request = async (path, options = {}) => {
    const headers = new Headers(options.headers);
    if (jar.header()) headers.set('cookie', jar.header());
    if (options.mutate) {
      headers.set('origin', 'http://127.0.0.1:5173');
      headers.set('x-csrftoken', jar.csrf());
      headers.set('idempotency-key', randomUUID());
    }
    const response = await fetch(`${origin}${path}`, { ...options, mutate: undefined, headers, signal: AbortSignal.timeout(30_000) });
    jar.absorb(response.headers);
    return response;
  };

  phase = 'session-csrf-login';
  await expectJson(await request('/api/v1/session', { method: 'POST', mutate: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) }), 200, 'Synthetic staff login');
  findings.push('Synthetic staff login and same-origin CSRF cookies passed through the Worker HTTP adapter.');

  phase = 'intake-and-site-scope';
  const intake = {
    client: { kind: 'new', partyKind: 'organisation', name: 'Synthetic Worker Client', phone: '', email: '' },
    owner: { kind: 'new', partyKind: 'person', name: 'Synthetic Worker Vehicle Owner', phone: '', email: '' },
    visitContact: { kind: 'new', name: 'Synthetic Worker Visit Contact', phone: '+233200000000', email: '' },
    vehicle: { kind: 'new', vin: 'WVWZZZ1JZXW000001', registration: 'CF-SPIKE-01', make: 'Synthetic', model: 'EV', variant: 'Test', powertrain: 'Battery electric' },
    odometerKm: 100,
    socPercent: 42,
    powertrainClass: 'EV',
    warrantyStatus: 'unknown',
    warrantyConfirmationNote: '',
    complaint: 'Synthetic Cloudflare Worker compatibility check.',
  };
  const created = await expectJson(await request(`/api/v1/sites/${siteId}/intake-drafts`, { method: 'POST', mutate: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(intake) }), 200, 'Create synthetic intake');
  assert.ok(created.id && Number.isInteger(created.version));
  const ownQueue = await expectJson(await request(`/api/v1/sites/${siteId}/work-orders`), 200, 'Read same-site work-order queue');
  assert.equal(ownQueue.totalCount, 1, 'The same-site scope must return the one created synthetic work order.');
  for (const deniedSite of [secondSiteId, otherSiteId]) {
    const denied = await request(`/api/v1/sites/${deniedSite}/work-orders`);
    assert.equal(denied.status, 403, `Unassigned site ${deniedSite} must be denied.`);
    const body = await denied.json();
    assert.equal(body.error.code, 'SITE_FORBIDDEN');
  }
  findings.push('Real API writes and reads passed for one site; another site in the same organisation and a second organisation were denied.');

  phase = 'concurrent-command-transaction';
  const complaintPath = `/api/v1/sites/${siteId}/work-orders/${created.id}/complaints`;
  const command = () => request(complaintPath, { method: 'POST', mutate: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: created.version, wording: 'Synthetic competing command.' }) });
  const results = await Promise.all([command(), command()]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409], 'Exactly one competing work-order command must commit.');
  findings.push('Two simultaneous same-version work-order commands produced one commit and one conflict through the Worker.');

  phase = 'streamed-evidence-upload';
  const png = await sharp({ create: { width: 1150, height: 1150, channels: 4, background: { r: 37, g: 92, b: 143, alpha: 1 } } }).png({ compressionLevel: 0, adaptiveFiltering: false }).toBuffer();
  assert.ok(png.byteLength > 4_500_000 && png.byteLength < 12 * 1024 * 1024, 'Synthetic PNG must be over 4.5 MB and below the local application cap.');
  const uploadIntent = await expectJson(await request(`/api/v1/sites/${siteId}/work-orders/${created.id}/evidence/intents`, { method: 'POST', mutate: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'synthetic-worker-upload.png', declaredMediaType: 'image/png', expectedBytes: png.byteLength }) }), 200, 'Create evidence intent');
  const upload = await expectJson(await request(`/api/v1/sites/${siteId}/evidence/intents/${uploadIntent.id}/content`, { method: 'PUT', mutate: true, headers: { 'content-type': 'application/octet-stream', 'content-length': String(png.byteLength) }, body: png }), 202, 'Stream evidence upload');
  assert.equal(upload.sizeBytes, png.byteLength);
  assert.equal(upload.sha256, createHash('sha256').update(png).digest('hex'));
  const probe = await expectJson(await request('/__spike/probe'), 200, 'Read synthetic quarantine byte counter');
  assert.equal(probe.lastQuarantinedBytes, png.byteLength);
  const status = await expectJson(await request(`/api/v1/sites/${siteId}/evidence/intents/${uploadIntent.id}`), 200, 'Read pending evidence intent');
  assert.equal(status.state, 'completed');
  assert.equal(status.evidenceId, upload.evidenceId);
  assert.notEqual(status.evidenceState, 'accepted', 'Uploaded evidence must remain unaccepted with the scanner disabled.');
  const evidence = await expectJson(await request(`/api/v1/sites/${siteId}/evidence/${upload.evidenceId}`), 200, 'Read quarantined evidence');
  assert.equal(evidence.state, 'quarantined');
  findings.push(`Real evidence intent and upload route streamed ${png.byteLength} PNG bytes (>4.5 MB) through Fastify and the Worker; digest matched, memory quarantine received all bytes, and scan state remained unaccepted.`);
  return { workOrderId: created.id, uploadBytes: png.byteLength, sha256: upload.sha256 };
}

try {
  phase = 'database-create';
  await seedDatabase();

  phase = 'worker-start';
  const port = await freeLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  startWorker(port);
  const initial = await waitForWorker(origin);
  const scenario = await runScenario(origin, initial);
  reportResult = 'passed';
  console.log(`Cloudflare API Worker local spike passed. Disposable database and credentials were not logged. Upload bytes: ${scenario.uploadBytes}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown failure.';
  console.error(`Cloudflare API Worker spike failed during ${phase}: ${message.replaceAll(password, '[redacted]')}`);
  console.error(sanitizedWorkerLog());
  throw error;
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolvePromise) => child.once('close', resolvePromise)), delay(5000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (admin) await admin.end().catch(() => undefined);
  if (databaseCreated) {
    try {
      await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
      await owner.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } catch {
      console.error('CRITICAL: disposable Worker spike database cleanup failed; inspect only local PostgreSQL databases with the vmms_cf_spike_ prefix.');
    }
  }
  await owner.end().catch(() => undefined);
  const safeLog = sanitizedWorkerLog();
  const report = [
    '# Cloudflare API Worker compatibility spike',
    '',
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Result: **${reportResult}** at phase \`${phase}\`.`,
    'Environment: local Wrangler/workerd on loopback, Node.js 24, disposable local PostgreSQL database, restricted `vmms_runtime` role. No online database, Cloudflare account, remote mode, production secrets, DNS, customer data or deployment used.',
    '',
    '## Checks',
    '',
    ...(findings.length ? findings.map((finding) => `- ${finding}`) : ['- Local migrations and the restricted-runtime startup checks completed. Fastify route registration failed before session, tenant, transaction, authentication, or upload scenarios could run.']),
    '',
    '## Boundaries',
    '',
    '- Local Hyperdrive mode connects directly to loopback PostgreSQL; remote Hyperdrive pooling and query caching were not exercised.',
    '- The evidence upload scenario was not reached. R2/S3 durability, backup/restore, ClamAV, accepted download and the resident scan worker remain untested on Workers.',
    '- No upload-size compatibility claim is made from this failed run.',
    '- This run does not select a production host. Keep the conventional container baseline; validate remote pooling, object storage, scanner operations, limits, cost, region, backup/restore and rollback before a staging decision.',
    '',
    '## Sanitized Wrangler output',
    '',
    '```text',
    safeLog || '(no Wrangler output captured)',
    '```',
    '',
  ].join('\n');
  await writeFile(reportPath, report, 'utf8');
}
