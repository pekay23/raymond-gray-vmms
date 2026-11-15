import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { ApiError } from './errors.js';
import { issueCsrf, requireCsrf } from './identity.js';

const ownerSessionCookie = 'vmms_owner_session';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function ownerToken(request: FastifyRequest): string | undefined {
  const encoded = request.cookies[ownerSessionCookie];
  if (!encoded) return undefined;
  const unsigned = request.unsignCookie(encoded);
  return unsigned.valid && unsigned.value ? unsigned.value : undefined;
}

export function ownerSessionHash(request: FastifyRequest): string | undefined {
  const sessionToken = ownerToken(request);
  return sessionToken ? digest(sessionToken) : undefined;
}

export async function currentOwnerAccount(pool: Database, request: FastifyRequest) {
  const sessionHash = ownerSessionHash(request);
  if (!sessionHash) return undefined;
  const found = await pool.query('SELECT owner_account_id AS "ownerAccountId",organisation_id AS "organisationId",site_id AS "siteId" FROM public.current_vehicle_owner_session($1)', [sessionHash]);
  return found.rowCount ? z.object({ ownerAccountId: z.uuid(), organisationId: z.uuid(), siteId: z.uuid() }).parse(found.rows[0]) : undefined;
}

export async function ownerSessionView(pool: Database, request: FastifyRequest, reply: FastifyReply, config: Config) {
  issueCsrf(reply, config);
  const account = await currentOwnerAccount(pool, request);
  return account ? { authenticated: true as const, audience: 'owner' as const } : { authenticated: false as const };
}

export async function issueOwnerSession(
  pool: Database,
  reply: FastifyReply,
  config: Config,
  identity: { issuer: string; subject: string; sessionId?: string; issuedAt: number },
  claimTokenHash?: string,
) {
  const sessionToken = randomBytes(32).toString('hex');
  const sessionHash = digest(sessionToken);
  const subjectHash=digest(identity.subject);
  const sessionHashFromProvider=identity.sessionId?digest(identity.sessionId):null;
  const issuedAt=new Date(identity.issuedAt*1000);
  const result = claimTokenHash
    ? await pool.query('SELECT public.claim_vehicle_owner_invitation_with_oidc($1,$2,$3,$4,$5,$6,$7,$8) AS id', [claimTokenHash,identity.issuer,identity.subject,subjectHash,sessionHash,sessionHashFromProvider,issuedAt,config.OIDC_CLIENT_ID])
    : await pool.query('SELECT public.create_vehicle_owner_session_with_oidc($1,$2,$3,$4,$5,$6,$7) AS id', [identity.issuer,identity.subject,subjectHash,sessionHash,sessionHashFromProvider,issuedAt,config.OIDC_CLIENT_ID]);
  const account = z.object({ id: z.uuid().nullable() }).parse(result.rows[0]);
  if (!account.id) throw new ApiError(403, 'ACCOUNT_NOT_APPROVED', 'This identity is not currently approved for vehicle-owner access.');
  reply.setCookie(ownerSessionCookie, sessionToken, {
    path: '/api/v1/owner',
    signed: true,
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60,
  });
  issueCsrf(reply, config);
  return { authenticated: true as const, audience: 'owner' as const };
}

export async function logoutOwner(pool: Database, request: FastifyRequest, reply: FastifyReply, config: Config) {
  requireCsrf(request, config);
  const sessionToken = ownerToken(request);
  if (sessionToken) await pool.query('SELECT public.revoke_vehicle_owner_session($1)', [digest(sessionToken)]);
  reply.clearCookie(ownerSessionCookie, { path: '/api/v1/owner' });
  issueCsrf(reply, config);
  return { authenticated: false as const };
}

export const ownerOidcStartSchema = z.object({
  claimToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/).optional(),
}).strict();
