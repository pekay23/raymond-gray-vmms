import { httpServerHandler } from 'cloudflare:node';
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { createApp } from './routes.js';
import type { Config } from './config.js';
import { makePool } from './db.js';
import type { EvidenceServices, PrivateEvidenceStore } from './evidence.js';
import type { OidcProvider } from './oidc-client.js';

interface SpikeEnv {
  HYPERDRIVE: { connectionString: string };
  VMMS_SPIKE_ENABLE: string;
}

type SpikeRuntime = {
  app: FastifyInstance;
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
};

type MemoryStoreState = { lastQuarantinedBytes: number };

let runtimePromise: Promise<SpikeRuntime> | undefined;
const storeState: MemoryStoreState = { lastQuarantinedBytes: 0 };

function createSpikeConfig(connectionString: string): Config {
  return {
    DATABASE_URL: connectionString,
    SESSION_SECRET: 'local-cloudflare-spike-secret-only-00000000',
    WEB_ORIGIN: 'http://127.0.0.1:5173',
    OIDC_ISSUER: 'http://127.0.0.1:8080/realms/vmms-spike',
    OIDC_CLIENT_ID: 'vmms-worker-spike',
    OIDC_REQUIRE_MFA_ASSURANCE: false,
    OIDC_CALLBACK_URL: 'http://127.0.0.1:8787/api/v1/auth/oidc/callback',
    OIDC_LOGOUT_CALLBACK_URL: 'http://127.0.0.1:8787/api/v1/auth/oidc/logout/callback',
    TRUSTED_PROXY_CIDRS: [],
    PORT: 4100,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    STAFF_MESSAGES_ENABLED: false,
  };
}

function createSyntheticOidcProvider(): OidcProvider {
  return {
    async createLogoutUrl(input) { const url=new URL('/logout','http://127.0.0.1:8080'); url.searchParams.set('client_id','vmms-spike'); url.searchParams.set('post_logout_redirect_uri',input.postLogoutRedirectUri); url.searchParams.set('state',input.state); return url; },
    async createAuthorizationUrl() {
      throw new Error('OIDC is intentionally unavailable in the local Worker spike.');
    },
    async exchangeAuthorizationCode() {
      throw new Error('OIDC is intentionally unavailable in the local Worker spike.');
    },
  };
}

function createMemoryEvidenceServices(): EvidenceServices {
  const objects = new Map<string, Uint8Array>();
  const store: PrivateEvidenceStore = {
    async putQuarantine(key, body, sizeBytes) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        chunks.push(bytes);
        total += bytes.byteLength;
      }
      if (total !== sizeBytes) throw new Error('The local quarantine store received a different byte count.');
      objects.set(key, Buffer.concat(chunks));
      storeState.lastQuarantinedBytes = total;
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
    async delete(key) {
      objects.delete(key);
    },
  };
  return {
    store,
    scanner: null,
    maxUploadBytes: 12 * 1024 * 1024,
    allowedMediaTypes: new Set(['image/png']),
    async close() {
      objects.clear();
      storeState.lastQuarantinedBytes = 0;
    },
  };
}

async function createRuntime(env: SpikeEnv): Promise<SpikeRuntime> {
  if (env.VMMS_SPIKE_ENABLE !== 'true') throw new Error('The local Worker spike is disabled.');
  if (!env.HYPERDRIVE.connectionString) throw new Error('The disposable local Hyperdrive connection is missing.');
  const pool = makePool(env.HYPERDRIVE.connectionString);
  const evidence = createMemoryEvidenceServices();
  let app: FastifyInstance | undefined;
  try {
    app = await createApp(createSpikeConfig(env.HYPERDRIVE.connectionString), pool, createSyntheticOidcProvider(), evidence);
    app.get('/__spike/probe', async () => ({ lastQuarantinedBytes: storeState.lastQuarantinedBytes }));
    await app.ready();
    const adapter = httpServerHandler(app.server);
    return {
      app,
      async fetch(request) {
        const response = await adapter.fetch!(request, {} as never, {} as never);
        return response;
      },
      close: () => app!.close(),
    };
  } catch (error) {
    if (app) await app.close().catch(() => undefined);
    else {
      await evidence.close().catch(() => undefined);
      await pool.end().catch(() => undefined);
    }
    throw error;
  }
}

export default {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    try {
      runtimePromise ??= createRuntime(env);
      const runtime = await runtimePromise;
      return await runtime.fetch(request);
    } catch (error) {
      runtimePromise = undefined;
      void error;
      return Response.json({ error: { code: 'LOCAL_SPIKE_STARTUP_FAILED', message: 'The local API Worker could not start.' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
