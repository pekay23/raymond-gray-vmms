import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { z } from 'zod';
import { startEvidenceBrowserRuntime } from '../apps/api/test/support/evidence-browser-runtime.ts';
import { evidenceIntentStatusSchema } from '../apps/api/src/evidence.ts';

const realServices = process.argv.includes('--real-services');
if (!process.argv.includes('--run')) {
  process.stdout.write('Opt-in only: node --import tsx scripts/evidence-browser-recovery.mjs --run\n');
  process.exit(0);
}

const root = fileURLToPath(new URL('../', import.meta.url));
loadEnv({ path: resolve(root, '.env'), quiet: true });
const output = resolve(root, realServices ? 'docs/verification/browser-evidence-recovery-real' : 'docs/verification/browser-evidence-recovery');
const pdf = Buffer.from('%PDF-1.4\nSynthetic browser recovery evidence\n%%EOF\n');
const fixture = { name: 'synthetic-browser-evidence.pdf', mimeType: 'application/pdf', buffer: pdf };
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStoredFile(name, content) {
  const filename = Buffer.from(name, 'utf8');
  const checksum = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16); central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const directorySize = central.length + filename.length;
  const directoryOffset = local.length + filename.length + content.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, filename, content, central, filename, end]);
}

const eicarZip = {
  name: 'synthetic-eicar-scanner-check.zip',
  mimeType: 'application/zip',
  buffer: zipStoredFile('eicar.com', Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')),
};
const sha256 = createHash('sha256').update(pdf).digest('hex');
const checks = [];
const errors = [];
const report = {
  startedAt: new Date().toISOString(), result: 'RUNNING',
  backend: 'real-fastify-postgresql',
  store: realServices ? 'isolated-s3mock' : 'synthetic-memory',
  scanner: realServices ? 'configured-clamav' : 'synthetic-hash',
  checks, errors,
  limitations: [
    ...(realServices ? ['Production storage/IAM, retention and backup remain untested'] : ['S3 and ClamAV adapters untested']),
    'Physical devices and staff UAT untested',
    'Approval, posting and release workflows untested',
  ],
};
let phase = 'startup';
let runtime, vite, browser, creator, page, webOrigin;
let failed = false;
const uuid = z.uuid();
const intentSchema = z.object({ id: uuid });
const uploadSchema = z.object({ evidenceId: uuid, state: z.literal('pending'), sha256: z.string(), sizeBytes: z.number() });
const detailSchema = z.object({ id: uuid, version: z.number().int(), evidence: z.array(z.object({ evidenceId: uuid, state: z.string(), attachedAt: z.string().nullable(), sha256: z.string() })) });
const intentStatusSchema = evidenceIntentStatusSchema;
const draftSchema = z.object({ intentId: uuid.nullable(), intentCommandId: uuid, displayName: z.string(), declaredMediaType: z.string(), expectedBytes: z.number(), savedAt: z.string() }).strict();
const check = (name, facts = {}) => { checks.push({ name, result: 'VERIFIED', ...facts }); process.stdout.write(`VERIFIED: ${name}\n`); };

async function json(response, schema, status = 200) {
  const body = await response.json();
  assert.equal(response.status(), status, `Unexpected HTTP status during ${phase}: ${JSON.stringify(body)}`);
  return schema.parse(body);
}

async function login(context, actor) {
  const initial = await context.request.get(`${webOrigin}/api/v1/session`);
  assert.equal(initial.status(), 200, 'Session bootstrap failed.');
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf, 'Session bootstrap did not issue CSRF cookie.');
  const response = await context.request.post(`${webOrigin}/api/v1/session`, {
    headers: { Origin: webOrigin, 'X-CSRFToken': decodeURIComponent(csrf.value) },
    data: { username: actor.username, password: actor.password },
  });
  await json(response, z.object({ authenticated: z.literal(true) }));
}

async function mutate(context, path, data, commandId = randomUUID()) {
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf);
  return context.request.post(`${webOrigin}/api/v1${path}`, {
    headers: { Origin: webOrigin, 'X-CSRFToken': decodeURIComponent(csrf.value), 'Idempotency-Key': commandId }, data,
  });
}

async function createOrder(index) {
  const response = await mutate(creator, `/sites/${runtime.siteId}/intake-drafts`, {
    client: { kind: 'new', partyKind: 'organisation', name: `Synthetic Browser Client ${index}`, phone: '', email: '' },
    owner: { kind: 'new', partyKind: 'person', name: `Synthetic Browser Owner ${index}`, phone: '', email: '' },
    visitContact: { kind: 'new', name: 'Synthetic Browser Contact', phone: '+233200000001', email: '' },
    vehicle: { kind: 'new', vin: `WVWZZZ1JZXW${String(index).padStart(6, '0')}`, registration: `BROWSER-${index}`, make: 'Synthetic', model: 'Fixture EV' },
    odometerKm: 12000, socPercent: 42, powertrainClass: 'EV', warrantyStatus: 'unknown', warrantyConfirmationNote: '', complaint: 'Synthetic evidence recovery verification',
  });
  return (await json(response, z.object({ id: uuid }))).id;
}

function orderPath(orderId) { return `/sites/${runtime.siteId}/work-orders/${orderId}`; }
function intentPath(intentId, siteId = runtime.siteId) { return `/sites/${siteId}/evidence/intents/${intentId}`; }
function evidencePath(evidenceId, siteId = runtime.siteId) { return `/sites/${siteId}/evidence/${evidenceId}`; }
async function get(context, path) { return context.request.get(`${webOrigin}/api/v1${path}`); }
async function detail(context, orderId) { return json(await get(context, orderPath(orderId)), detailSchema); }
function draftKey(orderId) { return `vmms:evidence-draft:v1:${runtime.actors.creator.id}:${runtime.siteId}:${orderId}`; }
async function draft(orderId) {
  const value = await page.evaluate(key => sessionStorage.getItem(key), draftKey(orderId));
  return value === null ? null : draftSchema.parse(JSON.parse(value));
}
async function openOrder(orderId) {
  await page.goto(`${webOrigin}${orderPath(orderId)}`);
  await page.getByRole('heading', { name: 'Evidence', exact: true }).waitFor();
}
async function selectWithRecovery(file = fixture) {
  await page.getByRole('checkbox', { name: /Keep this upload/ }).check();
  await page.getByLabel('Choose a file', { exact: true }).setInputFiles(file);
}
async function assertResponsive(name) {
  const viewport = page.viewportSize();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.equal(width, viewport.width, 'Evidence recovery page has horizontal overflow.');
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
}

async function newContext() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(20000);
  context.on('page', tab => tab.on('pageerror', () => errors.push({ phase, kind: 'pageerror' })));
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === webOrigin) await route.continue();
    else { errors.push({ phase, kind: 'unexpected-outbound-request' }); await route.abort('blockedbyclient'); }
  });
  return context;
}

async function provePrivate(intentId, evidenceId, orderId, peer, otherTenant) {
  assert.equal((await get(peer, intentPath(intentId))).status(), 404, 'Same-site peer recovered creator pointer.');
  assert.equal((await get(otherTenant, intentPath(intentId, runtime.otherSiteId))).status(), 404, 'Other tenant recovered creator pointer.');
  assert.equal((await detail(peer, orderId)).evidence.length, 0, 'Peer can see staged evidence.');
  for (const [context, siteId] of [[peer, runtime.siteId], [otherTenant, runtime.otherSiteId]]) {
    assert.equal((await get(context, evidencePath(evidenceId, siteId))).status(), 404, 'Staged metadata escaped creator scope.');
    assert.equal((await get(context, `${evidencePath(evidenceId, siteId)}/download`)).status(), 404, 'Private download escaped scope.');
  }
  assert.equal((await get(creator, `${evidencePath(evidenceId)}/download`)).status(), 404, 'Unlinked evidence was downloadable.');
}

async function scanAttachDownload(orderId, evidenceId) {
  const pending = await mutate(creator, `${orderPath(orderId)}/evidence`, { expectedVersion: 1, evidenceId });
  await json(pending, z.object({ error: z.object({ code: z.literal('EVIDENCE_NOT_ACCEPTED') }) }), 409);
  assert.equal(await runtime.scanNext(), true, 'Worker did not process the queued scan.');
  assert.equal(await runtime.scanNext(), false, 'Unexpected extra scan job.');
  const status = await json(await get(creator, evidencePath(evidenceId)), z.object({ state: z.literal('accepted'), sha256: z.string() }));
  assert.equal(status.sha256, sha256);
  assert.equal((await get(creator, `${evidencePath(evidenceId)}/download`)).status(), 404, 'Accepted unlinked evidence was downloadable.');
  await page.getByRole('button', { name: 'Refresh work order', exact: true }).click();
  await page.getByText('Security check passed', { exact: true }).waitFor();
  const attachRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1${orderPath(orderId)}/evidence`);
  const attachResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1${orderPath(orderId)}/evidence`);
  await page.getByRole('button', { name: /^Attach .+ to work order$/ }).click();
  const attachmentCommandId = (await attachRequest).headers()['idempotency-key'];
  uuid.parse(attachmentCommandId);
  const updated = await json(await attachResponse, detailSchema);
  assert.equal(updated.version, 2);
  assert.equal(updated.evidence.length, 1);
  assert(updated.evidence[0].attachedAt, 'The evidence link is not durable.');
  const downloadUrl = await page.getByRole('link', { name: /^Download .+$/ }).getAttribute('href');
  assert(downloadUrl);
  const download = await creator.request.get(`${webOrigin}${downloadUrl}`);
  assert.equal(download.status(), 200);
  assert.match(download.headers()['cache-control'], /no-store/);
  assert.equal(download.headers()['content-type'], 'application/pdf');
  assert.deepEqual(await download.body(), pdf);
  const replay = await mutate(creator, `${orderPath(orderId)}/evidence`, { expectedVersion: 1, evidenceId }, attachmentCommandId);
  assert.equal((await json(replay, detailSchema)).version, 2);
  const facts = await runtime.inspect(orderId, attachmentCommandId);
  assert.deepEqual(facts, { evidence: 1, jobs: 1, attempts: 1, links: 1, events: 1, receipts: 1, outbox: 1, access: 1, version: 2 });
  return facts;
}

async function uploadEvidenceForOrder(orderId, file = fixture) {
  await openOrder(orderId);
  await selectWithRecovery(file);
  const contentResponse = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/content'));
  await page.getByRole('button', { name: 'Upload evidence', exact: true }).click();
  const uploaded = await json(await contentResponse, uploadSchema, 202);
  await page.getByText('The upload is private and waiting for its security check.', { exact: true }).waitFor();
  return uploaded;
}

try {
  await mkdir(output, { recursive: true });
  await unlink(resolve(output, 'failure.png')).catch(error => {
    if (error?.code !== 'ENOENT') throw error;
  });
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
  phase = 'isolated-runtime';
  runtime = await startEvidenceBrowserRuntime({
    migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL,
    runtimeDatabaseUrl: process.env.DATABASE_URL,
    webOrigin: 'http://127.0.0.1:1',
    ...(realServices ? { evidenceMode: 'configured' } : {}),
  });
  process.stdout.write(`LOCAL: isolated database ${runtime.databaseName}; teardown verifies its original OID.\n`);
  phase = 'vite';
  vite = await createServer({ root: resolve(root, 'apps/web'), configFile: resolve(root, 'apps/web/vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': { target: runtime.apiOrigin, changeOrigin: false } } } });
  await vite.listen();
  webOrigin = new URL(vite.resolvedUrls.local[0]).origin;
  assert.equal(new URL(webOrigin).hostname, '127.0.0.1');
  runtime.setWebOrigin(webOrigin);
  phase = 'browser';
  browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
  report.browser = `Chromium ${browser.version()}`;
  creator = await newContext();
  const peer = await newContext(), otherTenant = await newContext();
  for (const [context, actor] of [[creator, runtime.actors.creator], [peer, runtime.actors.peer], [otherTenant, runtime.actors.otherTenant]]) await login(context, actor);
  page = await creator.newPage();

  phase = 'committed-response-loss';
  const orderId = await createOrder(1);
  await openOrder(orderId);
  await selectWithRecovery();
  let putCount = 0, intentCount = 0;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PUT' && path.endsWith('/content')) putCount++;
    if (request.method() === 'POST' && path.endsWith('/evidence/intents')) intentCount++;
  });
  const intentResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1${orderPath(orderId)}/evidence/intents`);
  let committedUpload;
  const statusPattern = '**/api/v1/sites/*/evidence/intents/*';
  const interruptStatusLookup = route => route.request().method() === 'GET' ? route.abort('failed') : route.fallback();
  await page.route(statusPattern, interruptStatusLookup);
  await page.route('**/api/v1/sites/*/evidence/intents/*/content', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const forwarded = await route.fetch({ timeout: 15000, maxRetries: 0 });
    committedUpload = await json(forwarded, uploadSchema, 202);
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Upload evidence', exact: true }).click();
  const intentId = (await json(await intentResponse, intentSchema)).id;
  await page.getByText('The upload could not be confirmed.', { exact: false }).waitFor();
  assert(committedUpload, 'Fault injection did not observe a committed upload.');
  const evidenceId = committedUpload.evidenceId;
  assert.equal(committedUpload.sha256, sha256);
  assert.equal(committedUpload.sizeBytes, pdf.length);
  const recovered = await json(await get(creator, intentPath(intentId)), intentStatusSchema);
  assert.equal(recovered.state, 'completed');
  assert.equal(recovered.evidenceId, evidenceId);
  const saved = await draft(orderId);
  assert(saved && saved.intentId === intentId);
  await provePrivate(intentId, evidenceId, orderId, peer, otherTenant);
  await page.unroute(statusPattern, interruptStatusLookup);
  await page.reload();
  await page.getByText('The upload reached the server.', { exact: false }).waitFor();
  await page.getByText(fixture.name, { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Choose a file', { exact: true }).inputValue(), '');
  assert.equal(await draft(orderId), null);
  assert.equal(putCount, 1); assert.equal(intentCount, 1);
  const pendingFacts = await runtime.inspect(orderId);
  assert.equal(pendingFacts.evidence, 1); assert.equal(pendingFacts.jobs, 1); assert.equal(pendingFacts.attempts, 0); assert.equal(pendingFacts.links, 0);
  check('Committed response loss recovers after reload without resending bytes; staged evidence and pointer remain creator-only', { orderId, intentId, evidenceId, sha256 });
  phase = 'scan-and-attach';
  const facts = await scanAttachDownload(orderId, evidenceId);
  assert.equal((await detail(peer, orderId)).evidence[0]?.evidenceId, evidenceId);
  assert.equal((await get(peer, intentPath(intentId))).status(), 404);
  assert.equal((await get(otherTenant, `${evidencePath(evidenceId, runtime.otherSiteId)}/download`)).status(), 404);
  const anonymous = await newContext();
  assert.equal((await get(anonymous, `${evidencePath(evidenceId)}/download`)).status(), 401);
  check('Real scan, explicit attach, idempotent replay, download hash, access audit and normal linked visibility pass', facts);
  await assertResponsive('attached-desktop');

  phase = 'interrupted-issued-intent';
  const interruptedOrderId = await createOrder(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await openOrder(interruptedOrderId);
  await selectWithRecovery();
  const interruptedIntentResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1${orderPath(interruptedOrderId)}/evidence/intents`);
  await page.route('**/api/v1/sites/*/evidence/intents/*/content', route => route.abort('failed'), { times: 1 });
  await page.getByRole('button', { name: 'Upload evidence', exact: true }).click();
  const interruptedIntentId = (await json(await interruptedIntentResponse, intentSchema)).id;
  await page.getByText('The upload could not be confirmed.', { exact: false }).waitFor();
  const originalDraft = await draft(interruptedOrderId);
  assert(originalDraft);
  assert.equal((await json(await get(creator, intentPath(interruptedIntentId)), intentStatusSchema)).state, 'issued');
  assert.equal((await runtime.inspect(interruptedOrderId)).evidence, 0);
  await page.reload();
  await page.getByText('An upload was interrupted', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Choose a file', { exact: true }).inputValue(), '');
  const beforeMismatch = { putCount, intentCount };
  await page.getByLabel('Choose a file', { exact: true }).setInputFiles({ ...fixture, name: 'different-file.pdf' });
  await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
  await page.getByText('Choose the same file name, type and size to resume this upload.', { exact: false }).waitFor();
  assert.equal(putCount, beforeMismatch.putCount); assert.equal(intentCount, beforeMismatch.intentCount);
  await assertResponsive('interrupted-phone');
  await page.getByLabel('Choose a file', { exact: true }).setInputFiles(fixture);
  const resumedResponse = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1${intentPath(interruptedIntentId)}/content`);
  await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
  const resumed = await json(await resumedResponse, uploadSchema, 202);
  await page.getByText('The upload is private and waiting for its security check.', { exact: true }).waitFor();
  assert.equal(intentCount, beforeMismatch.intentCount);
  assert.equal(putCount, beforeMismatch.putCount + 1);
  assert.equal(originalDraft.intentId, interruptedIntentId);
  assert.equal(resumed.sha256, sha256);
  await provePrivate(interruptedIntentId, resumed.evidenceId, interruptedOrderId, peer, otherTenant);
  const resumedFacts = await scanAttachDownload(interruptedOrderId, resumed.evidenceId);
  check('Issued-intent interruption requires reselection, rejects mismatch and resumes the same intent through scan and attach', { orderId: interruptedOrderId, intentId: interruptedIntentId, evidenceId: resumed.evidenceId, ...resumedFacts });
  await assertResponsive('attached-phone');

  phase = 'unavailable-scan-state';
  const delayedOrderId = await createOrder(3);
  const delayedUpload = await uploadEvidenceForOrder(delayedOrderId);
  await runtime.scanNext('unavailable');
  assert.equal((await detail(creator, delayedOrderId)).evidence[0]?.state, 'quarantined');
  await page.getByRole('button', { name: 'Refresh work order', exact: true }).click();
  await page.getByText('Security check delayed', { exact: true }).waitFor();
  await page.getByText('The security check could not finish. This file stays private and unavailable.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Attach .+ to work order$/ }).count(), 0);
  assert.equal((await get(creator, `${evidencePath(delayedUpload.evidenceId)}/download`)).status(), 404);
  await json(await mutate(creator, `${orderPath(delayedOrderId)}/evidence`, { expectedVersion: 1, evidenceId: delayedUpload.evidenceId }), z.object({ error: z.object({ code: z.literal('EVIDENCE_NOT_ACCEPTED') }) }), 409);
  await assertResponsive('delayed-scan-phone');
  check('Unavailable scan stays private and delayed; staff cannot attach or download it', { orderId: delayedOrderId, evidenceId: delayedUpload.evidenceId });
  await runtime.makeScanRetryAvailable(delayedUpload.evidenceId);
  assert.equal(await runtime.scanNext('clean'), true, 'The scheduled retry did not become available.');
  assert.equal((await detail(creator, delayedOrderId)).evidence[0]?.state, 'accepted');
  await page.getByRole('button', { name: 'Refresh work order', exact: true }).click();
  await page.getByText('Security check passed', { exact: true }).waitFor();
  check('A scheduled clean retry changes the delayed file to accepted without attaching it automatically', { orderId: delayedOrderId, evidenceId: delayedUpload.evidenceId });

  phase = 'rejected-scan-state';
  const rejectedOrderId = await createOrder(4);
  const rejectedUpload = await uploadEvidenceForOrder(rejectedOrderId, realServices ? eicarZip : fixture);
  await runtime.scanNext('infected');
  assert.equal((await detail(creator, rejectedOrderId)).evidence[0]?.state, 'rejected');
  await page.getByRole('button', { name: 'Refresh work order', exact: true }).click();
  await page.getByText('Not accepted', { exact: true }).waitFor();
  await page.getByText('The security check did not approve this file.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Attach .+ to work order$/ }).count(), 0);
  assert.equal((await get(creator, `${evidencePath(rejectedUpload.evidenceId)}/download`)).status(), 404);
  await json(await mutate(creator, `${orderPath(rejectedOrderId)}/evidence`, { expectedVersion: 1, evidenceId: rejectedUpload.evidenceId }), z.object({ error: z.object({ code: z.literal('EVIDENCE_NOT_ACCEPTED') }) }), 409);
  await assertResponsive('rejected-scan-phone');
  check('Rejected scan explains the outcome and remains unavailable, unattached and undownloadable', { orderId: rejectedOrderId, evidenceId: rejectedUpload.evidenceId });

  phase = 'stale-attachment-recovery';
  const staleOrderId = await createOrder(5);
  const staleUpload = await uploadEvidenceForOrder(staleOrderId);
  await runtime.scanNext('clean');
  await page.getByRole('button', { name: 'Refresh work order', exact: true }).click();
  await page.getByText('Security check passed', { exact: true }).waitFor();
  let beforeConcurrentUpdate = await detail(creator, staleOrderId);
  let reviewRecorded = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reviewResponse = await mutate(creator, `${orderPath(staleOrderId)}/operations-review`, { expectedVersion: beforeConcurrentUpdate.version, notes: 'Synthetic concurrent update for stale attachment recovery.' });
    const reviewBody = await reviewResponse.json();
    if (reviewResponse.status() === 409 && reviewBody?.error?.code === 'STALE_VERSION') {
      beforeConcurrentUpdate = await detail(creator, staleOrderId);
      continue;
    }
    assert.equal(reviewResponse.status(), 200, `Concurrent Operations review failed: ${JSON.stringify(reviewBody)}`);
    const reviewed = z.object({ workOrderId: uuid, version: z.number().int() }).parse(reviewBody);
    assert.equal(reviewed.version, beforeConcurrentUpdate.version + 1);
    reviewRecorded = true;
    break;
  }
  assert(reviewRecorded, 'Could not record the concurrent Operations review after refreshing stale versions.');
  const staleAttachResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1${orderPath(staleOrderId)}/evidence`);
  await page.getByRole('button', { name: `Attach ${fixture.name} to work order` }).click();
  await json(await staleAttachResponse, z.object({ error: z.object({ code: z.literal('STALE_VERSION') }) }), 409);
  await page.getByText('This work order changed. Refresh it and review the latest information before attaching evidence.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Evidence', exact: true }).waitFor();
  await page.getByText('Security check passed', { exact: true }).waitFor();
  const refreshedOrder = await detail(creator, staleOrderId);
  assert.equal(refreshedOrder.version, beforeConcurrentUpdate.version + 1);
  const retryButton = page.getByRole('button', { name: `Attach ${fixture.name} to work order` });
  await retryButton.waitFor();
  const retryRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1${orderPath(staleOrderId)}/evidence`);
  const retryResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1${orderPath(staleOrderId)}/evidence`);
  await retryButton.click();
  const retryCommandId = (await retryRequest).headers()['idempotency-key'];
  uuid.parse(retryCommandId);
  const attachedAfterRefresh = await json(await retryResponse, detailSchema);
  assert.equal(attachedAfterRefresh.version, beforeConcurrentUpdate.version + 2);
  assert.equal(attachedAfterRefresh.evidence.length, 1);
  assert(attachedAfterRefresh.evidence[0].attachedAt);
  const staleFacts = await runtime.inspect(staleOrderId, retryCommandId);
  assert.equal(staleFacts.links, 1); assert.equal(staleFacts.events, 1); assert.equal(staleFacts.receipts, 1); assert.equal(staleFacts.version, beforeConcurrentUpdate.version + 2);
  await page.getByText('Evidence attached to the work order.', { exact: true }).waitFor();
  await assertResponsive('stale-attachment-phone');
  check('A stale attachment is denied, the page refreshes the work order, and one retry attaches exactly once', { orderId: staleOrderId, evidenceId: staleUpload.evidenceId, ...staleFacts });

  assert.deepEqual(errors, [], 'Unexpected browser errors or outbound requests.');
  report.result = 'VERIFIED';
} catch (error) {
  failed = true;
  report.result = 'FAILED';
  const failure = { phase, kind: error instanceof Error ? error.name : 'unknown' };
  if (error instanceof Error) failure.location = error.stack?.split('\n').find(line => line.includes('evidence-browser-recovery.mjs:') && line.trim().startsWith('at '))?.trim();
  if (error instanceof assert.AssertionError) failure.message = error.message;
  errors.push(failure);
  process.stderr.write(`FAILED: ${phase} (${failure.kind})\n`);
  if (failure.location) process.stderr.write(`${failure.location}\n`);
  if (failure.message) process.stderr.write(`${failure.message}\n`);
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  phase = 'teardown';
  for (const [name, resource] of [['browser', browser], ['vite', vite], ['isolated-runtime', runtime]]) {
    if (!resource) continue;
    try { await resource.close(); }
    catch (error) {
      failed = true; report.result = 'FAILED';
      errors.push({ phase, kind: 'cleanup-failed', resource: name, ...(name === 'isolated-runtime' ? { databaseName: runtime.databaseName } : {}) });
      process.stderr.write(`FAILED: cleanup ${name}\n`);
      if (error instanceof assert.AssertionError) process.stderr.write(`${error.message}\n`);
    }
  }
  report.finishedAt = new Date().toISOString();
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (failed) process.exitCode = 1;
}
