import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { ApiError } from './errors.js';
import { issueSession } from './identity.js';
import { newAuthorizationParameters, type OidcProvider } from './oidc-client.js';

const callbackParameters = z.record(z.string(),z.string());
const statePattern=/^[A-Za-z0-9_-]{32,128}$/;
const supportedParameters=new Set(['state','code','error','error_description','error_uri','iss','session_state']);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const bindingCookieName=(state:string)=>`vmms_oidc_${state.slice(0,16)}`;
const loginFailure=()=>new ApiError(401,'OIDC_LOGIN_FAILED','Sign-in could not be completed. Try again.');

export type OidcLoginStart={authorizationUrl:URL;cookie:{name:string;value:string;path:string}};

export async function startOidcLogin(input:{pool:Database;config:Config;provider:OidcProvider}):Promise<OidcLoginStart> {
  const parameters=newAuthorizationParameters();
  const binding=randomBytes(32).toString('base64url');
  const expiresAt=new Date(Date.now()+5*60*1000);
  await input.pool.query('DELETE FROM oidc_login_transactions WHERE expires_at <= now()');
  await input.pool.query(
    'INSERT INTO oidc_login_transactions(state_hash,browser_binding_hash,nonce,code_verifier,expires_at) VALUES($1,$2,$3,$4,$5)',
    [digest(parameters.state),digest(binding),parameters.nonce,parameters.codeVerifier,expiresAt],
  );
  try {
    const authorizationUrl=await input.provider.createAuthorizationUrl(parameters);
    return {authorizationUrl,cookie:{name:bindingCookieName(parameters.state),value:binding,path:new URL(input.config.OIDC_CALLBACK_URL).pathname}};
  } catch(error) {
    await input.pool.query('DELETE FROM oidc_login_transactions WHERE state_hash=$1',[digest(parameters.state)]);
    throw error;
  }
}

export async function completeOidcLogin(input:{pool:Database;request:FastifyRequest;reply:FastifyReply;config:Config;provider:OidcProvider}) {
  const parsed=callbackParameters.safeParse(input.request.query);
  if (!parsed.success || Object.keys(parsed.data).some(key=>!supportedParameters.has(key))) throw loginFailure();
  const state=parsed.data.state;
  if (typeof state!=='string'||!statePattern.test(state)) throw loginFailure();

  const cookieName=bindingCookieName(state);
  const encoded=input.request.cookies[cookieName];
  if (!encoded) throw loginFailure();
  const binding=input.request.unsignCookie(encoded);
  if (!binding.valid || !binding.value) throw loginFailure();

  const consumed=await input.pool.query(
    'DELETE FROM oidc_login_transactions WHERE state_hash=$1 AND browser_binding_hash=$2 AND expires_at>now() RETURNING nonce,code_verifier AS "codeVerifier"',
    [digest(state),digest(binding.value)],
  );
  const transaction=z.object({nonce:z.string(),codeVerifier:z.string()}).optional().parse(consumed.rows[0]);
  if (!transaction) throw loginFailure();
  if (parsed.data.error || !parsed.data.code) throw loginFailure();

  const callbackUrl=new URL(input.config.OIDC_CALLBACK_URL);
  for (const [key,value] of Object.entries(parsed.data)) callbackUrl.searchParams.set(key,value);
  const subject=await input.provider.exchangeAuthorizationCode({
    state,
    nonce:transaction.nonce,
    codeVerifier:transaction.codeVerifier,
    callbackUrl,
  });
  if (subject.issuer!==input.config.OIDC_ISSUER) throw loginFailure();

  const identity=await input.pool.query(
    'SELECT u.id FROM staff_identities i JOIN staff_users u ON u.id=i.staff_user_id WHERE i.issuer=$1 AND i.subject=$2 AND u.active',
    [subject.issuer,subject.subject],
  );
  const row=z.object({id:z.string().uuid()}).optional().parse(identity.rows[0]);
  if (!row) throw new ApiError(403,'ACCOUNT_NOT_APPROVED','Your identity is not approved for VMMS access. Contact your service-centre administrator.');
  return issueSession(input.pool,input.request,input.reply,input.config,row.id);
}

export function oidcBindingCookieName(state:string):string|undefined {
  return statePattern.test(state)?bindingCookieName(state):undefined;
}
