import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { proxyApi } from '../src/worker.js';

const forwardedPathParameter = '__vmms_proxy_path';

export default async function handler(incoming: IncomingMessage, outgoing: ServerResponse) {
  try {
    const url = new URL(incoming.url ?? '/', 'https://vmms.invalid');
    const paths = url.searchParams.getAll(forwardedPathParameter);
    let path: string;
    if (url.pathname === '/api/proxy' && paths.length === 1) {
      path = paths[0] ?? '';
    } else if ((url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) && paths.length <= 1) {
      path = url.pathname === '/api/v1' ? '' : url.pathname.slice('/api/v1/'.length);
    } else {
      outgoing.statusCode = 400;
      outgoing.setHeader('Cache-Control', 'no-store');
      outgoing.end('Invalid API proxy route.');
      return;
    }

    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '.' || part === '..')) {
      outgoing.statusCode = 400;
      outgoing.setHeader('Cache-Control', 'no-store');
      outgoing.end('Invalid API proxy path.');
      return;
    }
    url.pathname = path ? `/api/v1/${path}` : '/api/v1';
    url.searchParams.delete(forwardedPathParameter);

    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(', '));
    }

    const method = incoming.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD'
      ? undefined
      : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
    const request = new Request(url, {
      method,
      headers,
      ...(body ? { body, duplex: 'half' as const } : {}),
    });

    const response = await proxyApi(
      request,
      process.env.VMMS_API_ORIGIN,
      process.env.VMMS_API_PROTECTION_BYPASS,
      process.env.VMMS_DEPLOYMENT_STAGE ?? process.env.NODE_ENV,
    );
    outgoing.statusCode = response.status;
    for (const [name, value] of response.headers) {
      if (name !== 'set-cookie') outgoing.setHeader(name, value);
    }
    const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
    if (cookies?.length) outgoing.setHeader('set-cookie', cookies);
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
    else outgoing.end();
  } catch {
    if (outgoing.headersSent) {
      outgoing.destroy();
      return;
    }
    outgoing.statusCode = 503;
    outgoing.setHeader('Cache-Control', 'no-store');
    outgoing.setHeader('Content-Type', 'application/json; charset=utf-8');
    outgoing.setHeader('X-Content-Type-Options', 'nosniff');
    outgoing.end(JSON.stringify({ error: { code: 'API_PROXY_UNAVAILABLE', message: 'The VMMS service could not be reached.' } }));
  }
}
