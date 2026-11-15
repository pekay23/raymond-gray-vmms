import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Database } from './db.js';
import type { OidcProvider } from './oidc-client.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const stateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const destinationSchema = z.enum(['signed-out', 'staff', 'owner']);
const cookieName = (state: string) => `vmms_oidc_logout_${state.slice(0, 16)}`;

export type RpLogoutStart = {
  logoutUrl: URL;
  state: string;
  browserBinding: string;
  cookieName: string;
  cookiePath: string;
};

export type RpLogoutDestination = z.infer<typeof destinationSchema>;

function requireTrustedLogoutUrl(url: URL, config: Config, state: string) {
  const issuer = new URL(config.OIDC_ISSUER);
  const localDevelopment = config.NODE_ENV !== 'production' && new Set(['localhost', '127.0.0.1']).has(issuer.hostname);
  const parameters = [...url.searchParams.entries()];
  const exactParameterNames = new Set(['client_id', 'post_logout_redirect_uri', 'state']);
  if (url.origin !== issuer.origin
    || (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:'))
    || url.username || url.password || url.hash
    || url.searchParams.get('client_id') !== config.OIDC_CLIENT_ID
    || url.searchParams.get('post_logout_redirect_uri') !== config.OIDC_LOGOUT_CALLBACK_URL
    || url.searchParams.get('state') !== state
    || url.searchParams.has('id_token_hint')
    || url.searchParams.has('sid')
    || parameters.length !== exactParameterNames.size
    || parameters.some(([name]) => !exactParameterNames.has(name))) {
    throw new Error('The identity provider returned an invalid sign-out URL.');
  }
  return url;
}

export async function startRpLogout(input: {
  pool: Database;
  config: Config;
  provider: OidcProvider;
  destination: RpLogoutDestination;
}): Promise<RpLogoutStart> {
  const state = randomBytes(32).toString('base64url');
  const browserBinding = randomBytes(32).toString('base64url');
  const stateHash = digest(state);
  const bindingHash = digest(browserBinding);
  await input.pool.query('SELECT public.expire_oidc_rp_logout_transactions()');
  await input.pool.query('SELECT public.create_oidc_rp_logout_transaction($1,$2,$3)', [stateHash, bindingHash, destinationSchema.parse(input.destination)]);
  try {
    const logoutUrl = requireTrustedLogoutUrl(
      await input.provider.createLogoutUrl({ state, postLogoutRedirectUri: input.config.OIDC_LOGOUT_CALLBACK_URL }),
      input.config,
      state,
    );
    return {
      logoutUrl,
      state,
      browserBinding,
      cookieName: cookieName(state),
      cookiePath: new URL(input.config.OIDC_LOGOUT_CALLBACK_URL).pathname,
    };
  } catch (error) {
    await input.pool.query('SELECT public.cancel_oidc_rp_logout_transaction($1,$2)', [stateHash, bindingHash]);
    throw error;
  }
}

export async function completeRpLogout(input: {
  pool: Database;
  request: FastifyRequest;
  state: unknown;
}): Promise<RpLogoutDestination | undefined> {
  const parsedState = stateSchema.safeParse(input.state);
  if (!parsedState.success) return undefined;
  const state = parsedState.data;
  const encoded = input.request.cookies[cookieName(state)];
  if (!encoded) return undefined;
  const binding = input.request.unsignCookie(encoded);
  if (!binding.valid || !binding.value) return undefined;
  const consumed = await input.pool.query(
    'SELECT public.consume_oidc_rp_logout_transaction($1,$2) AS destination',
    [digest(state), digest(binding.value)],
  );
  const transaction = z.object({ destination: destinationSchema }).optional().parse(consumed.rows[0]);
  return transaction?.destination;
}

export function rpLogoutCookieName(state: unknown): string | undefined {
  const parsed = stateSchema.safeParse(state);
  return parsed.success ? cookieName(parsed.data) : undefined;
}
