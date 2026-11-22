import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { createApp, fastifyServerOptions } from '../../src/routes.js';
import { readConfig } from '../../src/config.js';

let appPromise: Promise<FastifyInstance> | undefined;

function getApp() {
  appPromise ??= (async () => {
    const config = readConfig();
    const app = Fastify(fastifyServerOptions(config));
    await createApp(config, undefined, undefined, undefined, undefined, undefined, app);
    await app.ready();
    console.info('VMMS API request handler initialized', { stage: config.VMMS_DEPLOYMENT_STAGE ?? config.NODE_ENV });
    return app;
  })().catch(error => {
    appPromise = undefined;
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    console.error('VMMS API request handler initialization failed', {
      name: error instanceof Error ? error.name : typeof error,
      code,
    });
    throw error;
  });
  return appPromise;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  response.setHeader('Cache-Control', 'no-store');
  try {
    const app = await getApp();
    app.server.emit('request', request, response);
  } catch {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ error: { code: 'API_UNAVAILABLE', message: 'The service is temporarily unavailable.' } }));
  }
}
