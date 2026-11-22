import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/** Forward a Vercel Node function request into Fastify without opening a listener. */
export function dispatchVercelRequest(
  server: Pick<Server, 'emit'>,
  request: IncomingMessage,
  response: ServerResponse,
) {
  server.emit('request', request, response);
}
