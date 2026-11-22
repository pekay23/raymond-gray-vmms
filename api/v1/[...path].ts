import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatchVercelRequest } from '../../apps/api/dist/vercel-handler.js';
import { readConfig } from '../../apps/api/dist/config.js';
import { createApp } from '../../apps/api/dist/routes.js';

let appPromise: ReturnType<typeof createApp> | undefined;

function getApp() {
  appPromise ??= (async () => {
    const config = readConfig();
    const app = await createApp(config);
    await app.ready();
    return app;
  })().catch((error: unknown) => {
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
    dispatchVercelRequest(app.server, request, response);
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
