import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const webRoot = resolve(root, 'apps/web');
const apiPort = await freePort();
const webPort = await freePort();
const apiRequests = [];
let workerProcess;
let log = '';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
  return address.port;
}

const api = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  apiRequests.push({
    url: request.url,
    method: request.method,
    cookie: request.headers.cookie,
    origin: request.headers.origin,
    csrf: request.headers['x-csrftoken'],
    forwardedFor: request.headers['x-forwarded-for'],
    forwarded: request.headers.forwarded,
    cfConnectingIp: request.headers['cf-connecting-ip'],
    internalUser: request.headers['x-internal-user'],
    body,
  });

  if (request.url === '/api/v1/auth/oidc/start') {
    response.writeHead(302, {
      location: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic',
      'set-cookie': ['vmms_csrf=synthetic; Path=/; SameSite=Strict', 'vmms_session=synthetic; Path=/; HttpOnly; SameSite=Strict'],
      'cache-control': 'no-store',
    });
    response.end();
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
  response.end(JSON.stringify({ status: 'synthetic-upstream' }));
});

function sanitizedLog() {
  return log.replace(/http:\/\/127\.0\.0\.1:\d+/g, '[local origin]').slice(-3000);
}

async function waitForWorker(origin) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (workerProcess.exitCode !== null) throw new Error(`Wrangler exited early (${workerProcess.exitCode}).`);
    try {
      const response = await fetch(origin);
      if (response.status === 200) return;
    } catch {}
    await delay(250);
  }
  throw new Error('Wrangler did not start within 90 seconds.');
}

try {
  api.listen(apiPort, '127.0.0.1');
  await once(api, 'listening');
  const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  const cleanEnv = Object.fromEntries(
    ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH']
      .filter(key => process.env[key]).map(key => [key, process.env[key]]),
  );
  cleanEnv.WRANGLER_SEND_METRICS = 'false';
  workerProcess = spawn(process.execPath, [
    wrangler, 'dev', '--config', 'wrangler.jsonc', '--ip', '127.0.0.1', '--port', String(webPort), '--inspector-port', '0',
    '--var', `VMMS_API_ORIGIN:http://127.0.0.1:${apiPort}`,
  ], { cwd: webRoot, env: cleanEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  workerProcess.stdout.on('data', chunk => { log = (log + chunk.toString()).slice(-8000); });
  workerProcess.stderr.on('data', chunk => { log = (log + chunk.toString()).slice(-8000); });

  const origin = `http://127.0.0.1:${webPort}`;
  await waitForWorker(origin);

  const request = await fetch(`${origin}/api/v1/session?scope=synthetic`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'vmms_session=synthetic-session',
      origin,
      'x-csrftoken': 'synthetic-csrf',
      'x-forwarded-for': '203.0.113.9',
      forwarded: 'for=203.0.113.9;proto=https',
      'cf-connecting-ip': '203.0.113.9',
      connection: 'x-internal-user',
      'x-internal-user': 'spoofed',
    },
    body: JSON.stringify({ action: 'preview' }),
  });
  assert.equal(request.status, 200);
  assert.equal(request.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await request.json(), { status: 'synthetic-upstream' });
  assert.deepEqual(apiRequests.at(-1), {
    url: '/api/v1/session?scope=synthetic',
    method: 'POST',
    cookie: 'vmms_session=synthetic-session',
    origin,
    csrf: 'synthetic-csrf',
    forwardedFor: undefined,
    forwarded: undefined,
    cfConnectingIp: undefined,
    internalUser: undefined,
    body: JSON.stringify({ action: 'preview' }),
  });

  const login = await fetch(`${origin}/api/v1/auth/oidc/start`, { method: 'POST', redirect: 'manual' });
  assert.equal(login.status, 302);
  assert.equal(new URL(login.headers.get('location')).hostname, 'accounts.google.com');
  const setCookies = login.headers.getSetCookie?.().join('\n') ?? login.headers.get('set-cookie') ?? '';
  assert.match(setCookies, /vmms_csrf=synthetic/);
  assert.match(setCookies, /vmms_session=synthetic/);
  assert.equal(apiRequests.at(-1)?.url, '/api/v1/auth/oidc/start');

  const deepPage = await fetch(`${origin}/sites/synthetic/overview`);
  assert.equal(deepPage.status, 200);
  assert.match(deepPage.headers.get('content-type') ?? '', /text\/html/);

  console.log(JSON.stringify({
    result: 'passed',
    checks: [
      'workerd served the SPA deep route',
      'same-origin API route reached only the fixed loopback upstream',
      'method, path, query, body, cookie, Origin, and CSRF header were preserved',
      'client supplied forwarded address was removed',
      'forwarded, CF-Connecting-IP and Connection-nominated headers were removed',
      'API response is non-cacheable',
      'OIDC redirect and both Set-Cookie values returned to the browser without following the redirect',
    ],
    upstreamRequests: apiRequests.length,
    productionLimit: 'Synthetic loopback only; no production origin, auth provider, database, uploads, Cloudflare account, or DNS tested.',
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ result: 'failed', error: error instanceof Error ? error.message : String(error), wranglerLog: sanitizedLog() }, null, 2));
  process.exitCode = 1;
} finally {
  if (workerProcess && workerProcess.exitCode === null) {
    workerProcess.kill();
    await Promise.race([once(workerProcess, 'exit'), delay(5000)]);
  }
  if (api.listening) await new Promise((resolveClose, rejectClose) => api.close(error => error ? rejectClose(error) : resolveClose()));
}
