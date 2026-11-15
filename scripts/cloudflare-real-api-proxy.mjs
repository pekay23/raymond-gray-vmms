import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import pg from 'pg';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = resolve(root, 'apps/api');
const webRoot = resolve(root, 'apps/web');
const reportPath = resolve(root, 'docs/verification/checks/cloudflare-real-api-proxy-2026-11-12.md');
const sqlDirectory = resolve(apiRoot, 'migrations');
const localEnv = dotenv.parse(await readFile(resolve(root, '.env')));
const ownerBase = checkedLocalUrl(localEnv.MIGRATION_DATABASE_URL, 'MIGRATION_DATABASE_URL');
const runtimeBase = checkedLocalUrl(localEnv.DATABASE_URL, 'DATABASE_URL');
assert.equal(ownerBase.hostname, runtimeBase.hostname, 'Migration and runtime endpoints must use the same local host.');
assert.equal(ownerBase.port, runtimeBase.port, 'Migration and runtime endpoints must use the same local port.');
assert.equal(runtimeBase.username, 'vmms_runtime', 'The real API must use the restricted runtime database role.');

const runId = randomBytes(16).toString('hex');
const databaseName = `vmms_cf_proxy_${runId}`;
const organisationId = randomUUID();
const otherOrganisationId = randomUUID();
const siteId = randomUUID();
const secondSiteId = randomUUID();
const otherSiteId = randomUUID();
const actorId = randomUUID();
const username = `cf-proxy-${runId.slice(0, 12)}`;
const password = `Synthetic-Cloudflare-Proxy-${runId}`;
const ownerUrl = databaseUrl(ownerBase, databaseName);
const runtimeUrl = databaseUrl(runtimeBase, databaseName);
const owner = new pg.Pool({ connectionString: ownerBase.toString(), max: 1 });
let admin;
let api;
let workerProcess;
let workerSpawnError;
let databaseCreated = false;
let reportResult = 'failed';
let phase = 'database-create';
let workerLog = '';
let lastQuarantinedBytes = 0;
const findings = [];

function checkedLocalUrl(value, label) {
  assert.equal(typeof value, 'string', `${label} is required in the local environment.`);
  const url = new URL(value);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(url.hostname), `${label} must point to loopback; remote database access is prohibited.`);
  assert.equal(url.protocol, 'postgresql:', `${label} must use PostgreSQL.`);
  return url;
}

function databaseUrl(base, name) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
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

async function seedDatabase() {
  const role = await owner.query('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1', [runtimeBase.username]);
  assert.equal(role.rowCount, 1, 'The local restricted runtime role must already exist.');
  assert.equal(role.rows[0].rolsuper, false, 'The runtime role cannot be a superuser.');
  assert.equal(role.rows[0].rolbypassrls, false, 'The runtime role cannot bypass row-level security.');

  await owner.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  const migrations = (await readdir(sqlDirectory)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) await admin.query(await readFile(resolve(sqlDirectory, name), 'utf8'));

  const { hashPassword } = await import('../apps/api/src/identity.ts');
  const passwordHash = await hashPassword(password);
  await admin.query('INSERT INTO organisations(id,name) VALUES($1,$2),($3,$4)', [organisationId, 'Synthetic Proxy Tenant A', otherOrganisationId, 'Synthetic Proxy Tenant B']);
  await admin.query('INSERT INTO sites(id,organisation_id,code,name) VALUES($1,$2,$3,$4),($5,$2,$6,$7),($8,$9,$10,$11)', [siteId, organisationId, 'CPA', 'Synthetic Proxy Site A', secondSiteId, 'CPA2', 'Synthetic Proxy Site A2', otherSiteId, otherOrganisationId, 'CPB', 'Synthetic Proxy Site B']);
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)', [actorId, username, 'Synthetic Proxy Staff', passwordHash]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true)', [actorId, siteId]);
}

function createTestEvidenceServices() {
  const objects = new Map();
  const store = {
    async putQuarantine(key, body, sizeBytes) {
      const chunks = [];
      let total = 0;
      for await (const chunk of body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(bytes);
        total += bytes.byteLength;
      }
      if (total !== sizeBytes) throw new Error('The local quarantine fixture received a different byte count.');
      objects.set(key, Buffer.concat(chunks));
      lastQuarantinedBytes = total;
    },
    async readQuarantine(key) {
      const value = objects.get(key);
      if (!value) throw new Error('The synthetic quarantined object was not found.');
      return Readable.toWeb(Readable.from(value));
    },
    async promoteAccepted(sourceKey, targetKey) {
      const value = objects.get(sourceKey);
      if (!value) throw new Error('The synthetic quarantined object was not found.');
      objects.set(targetKey, value);
      objects.delete(sourceKey);
    },
    async readAccepted(key) {
      const value = objects.get(key);
      if (!value) throw new Error('The synthetic accepted object was not found.');
      return Readable.toWeb(Readable.from(value));
    },
    async delete(key) { objects.delete(key); },
  };
  return {
    store,
    scanner: null,
    maxUploadBytes: 12 * 1024 * 1024,
    allowedMediaTypes: new Set(['image/png']),
    async close() { objects.clear(); lastQuarantinedBytes = 0; },
  };
}

function createSyntheticOidcProvider() {
  return {
    async createLogoutUrl(input) {
      const url = new URL('/logout', 'https://accounts.google.com');
      url.searchParams.set('client_id', 'vmms-local-proxy-test');
      url.searchParams.set('post_logout_redirect_uri', input.postLogoutRedirectUri);
      url.searchParams.set('state', input.state);
      return url;
    },
    async createAuthorizationUrl(parameters) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', 'vmms-local-proxy-test');
      url.searchParams.set('state', parameters.state);
      url.searchParams.set('nonce', parameters.nonce);
      return url;
    },
    async exchangeAuthorizationCode() {
      throw new Error('The local proxy check does not perform an external OIDC exchange.');
    },
  };
}

async function startApi(apiPort, webOrigin) {
  const [{ createApp }, { makePool }] = await Promise.all([
    import('../apps/api/src/app.ts'),
    import('../apps/api/src/db.ts'),
  ]);
  const config = {
    DATABASE_URL: runtimeUrl,
    SESSION_SECRET: `local-cloudflare-proxy-secret-${runId}`,
    WEB_ORIGIN: webOrigin,
    OIDC_ISSUER: 'https://accounts.google.com',
    OIDC_CLIENT_ID: 'vmms-local-proxy-test',
    OIDC_CALLBACK_URL: `${webOrigin}/api/v1/auth/oidc/callback`,
    TRUSTED_PROXY_CIDRS: [],
    PORT: apiPort,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    STAFF_MESSAGES_ENABLED: false,
  };
  api = await createApp(config, makePool(runtimeUrl), createSyntheticOidcProvider(), createTestEvidenceServices(), undefined, admin);
  api.get('/api/v1/__spike/probe', async (request) => ({
    lastQuarantinedBytes,
    forwardedHeaders: {
      xForwardedFor: request.headers['x-forwarded-for'] ?? null,
      forwarded: request.headers.forwarded ?? null,
      cfConnectingIp: request.headers['cf-connecting-ip'] ?? null,
      internalUser: request.headers['x-internal-user'] ?? null,
    },
  }));
  await api.listen({ host: '127.0.0.1', port: apiPort });
}

function workerEnvironment() {
  const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH'];
  const env = Object.fromEntries(allowed.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  env.WRANGLER_SEND_METRICS = 'false';
  return env;
}

function startFrontendWorker(port, apiOrigin) {
  const wrangler = process.env.VMMS_CF_PROXY_WRANGLER_BIN || resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  const executable = process.env.VMMS_CF_PROXY_EXECUTABLE || process.execPath;
  workerProcess = spawn(executable, [wrangler, 'dev', '--config', 'wrangler.jsonc', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0', '--var', `VMMS_API_ORIGIN:${apiOrigin}`], {
    cwd: webRoot,
    env: workerEnvironment(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  workerProcess.on('error', (error) => { workerSpawnError = error; });
  const collect = (chunk) => { workerLog = (workerLog + chunk.toString()).slice(-8000); };
  workerProcess.stdout.on('data', collect);
  workerProcess.stderr.on('data', collect);
}

function safeWorkerLog() {
  return workerLog.replace(/http:\/\/127\.0\.0\.1:\d+/g, '[loopback origin]').slice(-3000);
}

async function waitForWorker(origin) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (workerSpawnError) throw new Error('The local frontend Worker process could not be started.');
    if (workerProcess.exitCode !== null) throw new Error(`The frontend Worker exited before becoming ready (${workerProcess.exitCode}).`);
    try {
      const response = await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
      if (response.status === 200) return;
      if (response.status === 503) throw new Error('The frontend Worker reports an unavailable API.');
    } catch (error) {
      if (error instanceof Error && error.message.includes('unavailable API')) throw error;
    }
    await delay(250);
  }
  throw new Error('The frontend Worker did not expose a ready API through its proxy within 90 seconds.');
}

async function expectJson(response, status, label) {
  const body = await response.text();
  assert.equal(response.status, status, `${label} returned ${response.status}: ${body.slice(0, 500)}`);
  try { return JSON.parse(body); } catch { throw new Error(`${label} did not return JSON.`); }
}

async function runScenario(origin, apiOrigin) {
  const jar = cookieJar();
  const sessionResponse = await fetch(`${origin}/api/v1/session`, { headers: { 'x-forwarded-for': '203.0.113.91', 'cf-connecting-ip': '203.0.113.91' } });
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.headers.get('cache-control'), 'no-store');
  jar.absorb(sessionResponse.headers);
  assert.deepEqual(await sessionResponse.json(), { authenticated: false });
  assert.ok(jar.csrf(), 'The actual API must set a signed CSRF cookie through the Worker.');
  findings.push('Cloudflare frontend Worker served API requests from the real Fastify process and returned PostgreSQL-backed session state, CSRF cookies, and no-store headers.');

  const request = async (path, options = {}) => {
    const headers = new Headers(options.headers);
    if (jar.header()) headers.set('cookie', jar.header());
    if (options.mutate) {
      headers.set('origin', origin);
      headers.set('x-csrftoken', jar.csrf());
      headers.set('idempotency-key', randomUUID());
    }
    const response = await fetch(`${origin}${path}`, { ...options, mutate: undefined, headers, signal: AbortSignal.timeout(30_000), redirect: 'manual' });
    jar.absorb(response.headers);
    assert.equal(response.headers.get('cache-control'), 'no-store', `${path} must not be cached by the Worker.`);
    return response;
  };

  phase = 'oidc-redirect-and-cookie';
  const oidc = await request('/api/v1/auth/oidc/start');
  assert.equal(oidc.status, 302);
  assert.equal(new URL(oidc.headers.get('location')).origin, 'https://accounts.google.com');
  const oidcCookies = oidc.headers.getSetCookie?.() ?? [];
  assert.ok(oidcCookies.some((cookie) => cookie.startsWith('vmms_oidc_')), 'The OIDC browser-binding cookie must traverse the Worker.');
  findings.push('A real API OIDC-start redirect to the synthetic Google authorization origin and its state-binding cookie passed through the frontend Worker without following the redirect.');

  phase = 'session-csrf-login';
  await expectJson(await request('/api/v1/session', { method: 'POST', mutate: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) }), 200, 'Synthetic staff login');
  findings.push('Password sign-in through the Worker established a real PostgreSQL-backed staff session with same-origin CSRF validation.');

  phase = 'spa-route';
  const page = await fetch(`${origin}/sites/${siteId}/reception`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await page.text(), /Raymond Gray|VMMS/i);
  findings.push('The configured static asset binding returned the VMMS single-page application at a deep route.');

  phase = 'intake-and-site-scope';
  const intake = {
    client: { kind: 'new', partyKind: 'organisation', name: 'Synthetic Proxy Client', phone: '', email: '' },
    owner: { kind: 'new', partyKind: 'person', name: 'Synthetic Proxy Vehicle Owner', phone: '', email: '' },
    visitContact: { kind: 'new', name: 'Synthetic Proxy Visit Contact', phone: '+233200000000', email: '' },
    vehicle: { kind: 'new', vin: 'WVWZZZ1JZXW000001', registration: 'CF-PROXY-01', make: 'Synthetic', model: 'EV', variant: 'Test', powertrain: 'Battery electric' },
    odometerKm: 100,
    socPercent: 42,
    powertrainClass: 'EV',
    warrantyStatus: 'unknown',
    warrantyConfirmationNote: '',
    complaint: 'Synthetic Cloudflare real API proxy check.',
  };
  const created = await expectJson(await request(`/api/v1/sites/${siteId}/intake-drafts`, { method: 'POST', mutate: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(intake) }), 200, 'Create synthetic intake');
  const ownQueue = await expectJson(await request(`/api/v1/sites/${siteId}/work-orders`), 200, 'Read same-site queue');
  assert.equal(ownQueue.pagination.totalItems, 1);
  for (const deniedSite of [secondSiteId, otherSiteId]) {
    const denied = await request(`/api/v1/sites/${deniedSite}/work-orders`);
    assert.equal(denied.status, 403, 'The unassigned site must be denied through the Worker.');
    assert.equal((await denied.json()).error.code, 'SITE_FORBIDDEN');
  }
  findings.push('Real PostgreSQL-backed intake, same-site read, same-tenant cross-site denial, and cross-tenant denial passed through the fixed-origin proxy.');

  phase = 'concurrent-command-transaction';
  const complaintPath = `/api/v1/sites/${siteId}/work-orders/${created.id}/complaints`;
  const command = () => request(complaintPath, { method: 'POST', mutate: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: created.version, wording: 'Synthetic competing proxy command.' }) });
  const competing = await Promise.all([command(), command()]);
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  findings.push('Two simultaneous same-version commands through the Worker produced one commit and one stale-version conflict.');

  phase = 'streamed-evidence-upload';
  const png = await sharp({ create: { width: 1150, height: 1150, channels: 4, background: { r: 37, g: 92, b: 143, alpha: 1 } } }).png({ compressionLevel: 0, adaptiveFiltering: false }).toBuffer();
  assert.ok(png.byteLength > 4_500_000 && png.byteLength < 12 * 1024 * 1024);
  const intent = await expectJson(await request(`/api/v1/sites/${siteId}/work-orders/${created.id}/evidence/intents`, { method: 'POST', mutate: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'synthetic-proxy-upload.png', declaredMediaType: 'image/png', expectedBytes: png.byteLength }) }), 200, 'Create evidence intent');
  const upload = await expectJson(await request(`/api/v1/sites/${siteId}/evidence/intents/${intent.id}/content`, { method: 'PUT', mutate: true, headers: { 'content-type': 'application/octet-stream', 'content-length': String(png.byteLength) }, body: png }), 202, 'Stream evidence upload');
  const digest = createHash('sha256').update(png).digest('hex');
  assert.equal(upload.sizeBytes, png.byteLength);
  assert.equal(upload.sha256, digest);
  const status = await expectJson(await request(`/api/v1/sites/${siteId}/evidence/intents/${intent.id}`), 200, 'Read uploaded evidence status');
  assert.equal(status.state, 'completed');
  assert.notEqual(status.evidenceState, 'accepted');
  const pendingEvidence = await expectJson(await request(`/api/v1/sites/${siteId}/evidence/${upload.evidenceId}`), 200, 'Read uploaded evidence state');
  assert.equal(pendingEvidence.state, 'pending');
  const probe = await expectJson(await request('/api/v1/__spike/probe', { headers: { 'x-forwarded-for': '203.0.113.92', forwarded: 'for=203.0.113.92;proto=https', 'cf-connecting-ip': '203.0.113.92', 'x-internal-user': 'spoofed' } }), 200, 'Read test-only upload probe');
  assert.equal(probe.lastQuarantinedBytes, png.byteLength);
  assert.deepEqual(probe.forwardedHeaders, { xForwardedFor: null, forwarded: null, cfConnectingIp: null, internalUser: null });
  findings.push(`A real Fastify API accepted a ${png.byteLength}-byte streamed PNG through the Cloudflare Worker; SHA-256 matched, all bytes reached local quarantine, scan state remained pending and unaccepted, and spoofed forwarding/identity headers were removed.`);
  findings.push('API response no-store behavior was checked on session, OIDC, site reads, mutations, and evidence routes; no production OIDC exchange or scanner acceptance was attempted.');
  assert.notEqual(new URL(origin).origin, apiOrigin);
  return { uploadBytes: png.byteLength };
}

try {
  phase = 'database-seed';
  await seedDatabase();
  const apiPort = await freeLoopbackPort();
  const webPort = await freeLoopbackPort();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;
  phase = 'real-api-start';
  await startApi(apiPort, webOrigin);
  phase = 'frontend-worker-start';
  startFrontendWorker(webPort, apiOrigin);
  await waitForWorker(webOrigin);
  const scenario = await runScenario(webOrigin, apiOrigin);
  reportResult = 'passed';
  console.log(`Cloudflare frontend Worker -> real local API/PostgreSQL proxy check passed. Synthetic upload bytes: ${scenario.uploadBytes}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown failure.';
  console.error(`Cloudflare real API proxy check failed during ${phase}: ${message.replaceAll(password, '[redacted]')}`);
  console.error(safeWorkerLog());
  throw error;
} finally {
  if (workerProcess && workerProcess.exitCode === null) {
    workerProcess.kill('SIGTERM');
    await Promise.race([new Promise((resolvePromise) => workerProcess.once('close', resolvePromise)), delay(5000)]);
    if (workerProcess.exitCode === null) workerProcess.kill('SIGKILL');
  }
  if (api) await api.close().catch(() => undefined);
  if (admin) await admin.end().catch(() => undefined);
  if (databaseCreated) {
    try {
      await owner.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
      await owner.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } catch {
      console.error('CRITICAL: disposable proxy database cleanup failed; inspect only local PostgreSQL databases with the vmms_cf_proxy_ prefix.');
    }
  }
  await owner.end().catch(() => undefined);
  const report = [
    '# Cloudflare frontend Worker to real VMMS API proxy check',
    '',
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Result: **${reportResult}** at phase \`${phase}\`.`,
    'Environment: local Cloudflare workerd frontend Worker, real Fastify API in Node.js, disposable loopback PostgreSQL database, and a synthetic in-memory quarantine store. No customer data, remote database, provider account, production secret, DNS or deployment used.',
    '',
    '## Checks',
    '',
    ...(findings.length ? findings.map((finding) => `- ${finding}`) : ['- The test stopped before completing an application scenario. See the sanitized command output.']),
    '',
    '## Limits',
    '',
    '- The test used a synthetic OIDC provider and did not authenticate with Google or another live identity provider.',
    '- The evidence store was in-memory and the scanner was disabled. This proves request streaming and application quarantine state through the Worker, not S3/R2 durability, malware scanning, accepted downloads, backup or restore.',
    '- Both API and Worker were bound to loopback. This does not prove private remote-origin ingress, Cloudflare account configuration, production upload limits, remote Hyperdrive pooling, cost, region, failover or rollback.',
    '- The direct Fastify-in-workerd experiment remains documented separately as incompatible with the current router startup. This result supports hosting the web Worker separately from the Node API; it does not claim the API itself runs on Workers.',
    '',
    '## Sanitized Worker output',
    '',
    '```text',
    safeWorkerLog() || '(no Wrangler output captured)',
    '```',
    '',
  ].join('\n');
  await writeFile(reportPath, report, 'utf8');
}
