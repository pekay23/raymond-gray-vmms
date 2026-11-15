import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Config } from './config.js';

const logoutEvent = 'http://schemas.openid.net/event/backchannel-logout';
const discoverySchema = z.object({ issuer: z.url(), jwks_uri: z.url() });
const claimsSchema = z.object({
  iss: z.string().url(),
  aud: z.union([z.string(), z.array(z.string())]),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.string().min(1).max(255),
  events: z.record(z.string(), z.unknown()),
  sub: z.string().min(1).max(255).optional(),
  sid: z.string().min(1).max(255).optional(),
  nonce: z.never().optional(),
}).passthrough();

export type VerifiedLogout = {
  issuer: string;
  clientId: string;
  subject?: string;
  sessionId?: string;
  issuedAt: Date;
  expiresAt: Date;
  jtiHash: string;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const discoveryCache = new Map<string, { expiresAt: number; keys: Promise<ReturnType<typeof createRemoteJWKSet>> }>();

async function remoteKeys(config: Config) {
  const cached=discoveryCache.get(config.OIDC_ISSUER);
  if(cached&&cached.expiresAt>Date.now()) return cached.keys;
  const issuer = new URL(config.OIDC_ISSUER);
  const discoveryUrl = new URL(`${issuer.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`, issuer.origin);
  const keys=fetch(discoveryUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    .then(async response=>{
      if (!response.ok) throw new Error('OIDC discovery is unavailable.');
      const metadata = discoverySchema.parse(await response.json());
      if (metadata.issuer !== config.OIDC_ISSUER) throw new Error('OIDC discovery issuer mismatch.');
      const jwksUrl=new URL(metadata.jwks_uri);
      const developmentHttp=config.NODE_ENV!=='production'&&new Set(['localhost','127.0.0.1']).has(issuer.hostname)&&jwksUrl.protocol==='http:'&&new Set(['localhost','127.0.0.1']).has(jwksUrl.hostname);
      if ((jwksUrl.protocol!=='https:'&&!developmentHttp)||jwksUrl.username||jwksUrl.password||jwksUrl.search||jwksUrl.hash) throw new Error('OIDC signing keys must use an exact secure URL.');
      return createRemoteJWKSet(jwksUrl, { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 300000 });
    });
  const entry={expiresAt:Date.now()+10*60*1000,keys};
  discoveryCache.set(config.OIDC_ISSUER,entry);
  try { return await keys; }
  catch(error) { if(discoveryCache.get(config.OIDC_ISSUER)===entry) discoveryCache.delete(config.OIDC_ISSUER); throw error; }
}

export async function verifyBackchannelLogout(token: string, config: Config): Promise<VerifiedLogout> {
  const keys = await remoteKeys(config);
  const { protectedHeader, payload } = await jwtVerify(token, keys, {
    issuer: config.OIDC_ISSUER,
    audience: config.OIDC_CLIENT_ID,
    algorithms: ['RS256'],
    clockTolerance: 60,
    maxTokenAge: '5 minutes',
  });
  if (protectedHeader.typ !== 'logout+jwt') throw new Error('Invalid logout token type.');
  const claims = claimsSchema.parse(payload);
  if (claims.nonce !== undefined) throw new Error('Logout tokens must not contain a nonce.');
  const eventKeys = Object.keys(claims.events);
  if (eventKeys.length !== 1 || eventKeys[0] !== logoutEvent || !claims.events[logoutEvent] || typeof claims.events[logoutEvent] !== 'object' || Array.isArray(claims.events[logoutEvent]) || Object.keys(claims.events[logoutEvent] as object).length !== 0) {
    throw new Error('Invalid back-channel logout event claim.');
  }
  if (!claims.sub && !claims.sid) throw new Error('Logout token has no session target.');
  const now = Math.floor(Date.now() / 1000);
  if (claims.iat > now + 60 || claims.exp <= now || claims.exp <= claims.iat || claims.exp - claims.iat > 600) throw new Error('Logout token is outside the accepted time window.');
  return {
    issuer: claims.iss,
    clientId: config.OIDC_CLIENT_ID,
    ...(claims.sub ? { subject: claims.sub } : {}),
    ...(claims.sid ? { sessionId: claims.sid } : {}),
    issuedAt: new Date(claims.iat * 1000),
    expiresAt: new Date(claims.exp * 1000),
    jtiHash: sha256(`${claims.iss}\n${config.OIDC_CLIENT_ID}\n${claims.jti}`),
  };
}
