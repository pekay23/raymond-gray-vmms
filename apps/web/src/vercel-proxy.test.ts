import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import proxyHandler from '../api/proxy.js';

let upstream: ReturnType<typeof createServer>;
let frontend: ReturnType<typeof createServer>;
let upstreamOrigin: string;
let frontendOrigin: string;
let received: { url: string; cookie?: string; origin?: string; bypass?: string } | undefined;

function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  });
}

before(async () => {
  upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
    received = {
      url: request.url ?? '',
      cookie: request.headers.cookie,
      origin: request.headers.origin,
      bypass: request.headers['x-vercel-protection-bypass'],
    };
    response.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': ['vmms_csrf=token; Path=/; SameSite=Lax', 'vmms_session=session; Path=/; HttpOnly; SameSite=Lax'],
    });
    response.end(JSON.stringify({ ok: true }));
  });
  upstreamOrigin = await listen(upstream);

  process.env.VMMS_API_ORIGIN = upstreamOrigin;
  process.env.VMMS_API_PROTECTION_BYPASS = 'server-only-preview-secret';
  process.env.VMMS_DEPLOYMENT_STAGE = 'staging';
  frontend = createServer((request, response) => void proxyHandler(request, response));
  frontendOrigin = await listen(frontend);
});

after(async () => {
  delete process.env.VMMS_API_ORIGIN;
  delete process.env.VMMS_API_PROTECTION_BYPASS;
  delete process.env.VMMS_DEPLOYMENT_STAGE;
  frontend.close();
  upstream.close();
  await Promise.all([once(frontend, 'close'), once(upstream, 'close')]);
});

test('Vercel proxy restores the VMMS API path, forwards browser credentials and returns separate cookies', async () => {
  const response = await fetch(`${frontendOrigin}/api/proxy?__vmms_proxy_path=health&check=1`, {
    headers: {
      cookie: 'vmms_session=synthetic-session',
      origin: 'https://vmms-preview.example',
      'x-vercel-protection-bypass': 'spoofed-client-value',
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(received?.url, '/api/v1/health?check=1');
  assert.equal(received?.cookie, 'vmms_session=synthetic-session');
  assert.equal(received?.origin, 'https://vmms-preview.example');
  assert.equal(received?.bypass, 'server-only-preview-secret');
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.match(cookies[0] ?? '', /^vmms_csrf=/);
  assert.match(cookies[1] ?? '', /^vmms_session=/);
});

test('Vercel proxy rejects ambiguous rewritten path parameters', async () => {
  received = undefined;
  const response = await fetch(`${frontendOrigin}/api/proxy?__vmms_proxy_path=health&__vmms_proxy_path=other`);

  assert.equal(response.status, 400);
  assert.equal(received, undefined);
});

test('Vercel rewrite requests retain their original API pathname', async () => {
  const response = await fetch(`${frontendOrigin}/api/v1/health?__vmms_proxy_path=health&check=2`);

  assert.equal(response.status, 200);
  assert.equal(received?.url, '/api/v1/health?check=2');
});
