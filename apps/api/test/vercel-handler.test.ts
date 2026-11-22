import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { dispatchVercelRequest } from '../src/vercel-handler.js';

test('Vercel adapter forwards the original Node request and response to Fastify', () => {
  const server = createServer();
  const request = { method: 'GET', url: '/api/v1/session' } as IncomingMessage;
  const response = {} as ServerResponse;
  let received: { request: IncomingMessage; response: ServerResponse } | undefined;
  server.on('request', (incoming, outgoing) => {
    received = { request: incoming, response: outgoing };
  });

  dispatchVercelRequest(server, request, response);

  assert.deepEqual(received, { request, response });
});
