import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { ApiError } from './errors.js';
import { issueSession } from './identity.js';
import { issueOwnerSession } from './owner-identity.js';
import { newAuthorizationParameters, type OidcProvider } from './oidc-client.js';

const callbackParameters = z.record(z.string(),z.string());
const statePattern=/^[A-Za-z0-9_-]{32,128}$/;
const supportedParameters=new Set(['state','code','error','error_description','error_uri','iss','session_state']);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const bindingCookieName=(state:string)=>`vmms_oidc_${state.slice(0,16)}`;
export class OidcLoginFailure extends ApiError {
  constructor(readonly audience:'staff'|'owner',code:'ACCOUNT_NOT_APPROVED'|'OIDC_LOGIN_FAILED') {
    super(code==='ACCOUNT_NOT_APPROVED'?403:401,code,code==='ACCOUNT_NOT_APPROVED'
      ? audience==='owner'?'This identity is not approved for vehicle-owner access.':'Your identity is not approved for VMMS access. Contact your service-centre administrator.'
      : 'Sign-in could not be completed. Try again.');
  }
}
const loginFailure=(audience:'staff'|'owner'='staff')=>new OidcLoginFailure(audience,'OIDC_LOGIN_FAILED');

export type OidcLoginStart={authorizationUrl:URL;cookie:{name:string;value:string;path:string}};

async function startLogin(input:{pool:Database;config:Config;provider:OidcProvider},loginIntent:'staff'|'owner',ownerInvitationTokenHash?:string):Promise<OidcLoginStart> {
  const parameters=newAuthorizationParameters();
  const binding=randomBytes(32).toString('base64url');
  await input.pool.query('SELECT public.expire_oidc_login_transactions()');
  await input.pool.query(
    'SELECT public.create_oidc_login_transaction($1,$2,$3,$4,$5,$6)',
    [digest(parameters.state),digest(binding),parameters.nonce,parameters.codeVerifier,loginIntent,ownerInvitationTokenHash??null],
  );
  try {
    const authorizationUrl=await input.provider.createAuthorizationUrl(parameters);
    return {authorizationUrl,cookie:{name:bindingCookieName(parameters.state),value:binding,path:new URL(input.config.OIDC_CALLBACK_URL).pathname}};
  } catch(error) {
    await input.pool.query('SELECT public.cancel_oidc_login_transaction($1,$2)',[digest(parameters.state),digest(binding)]);
    throw error;
  }
}

export function startOidcLogin(input:{pool:Database;config:Config;provider:OidcProvider}) {
  return startLogin(input,'staff');
}

export function startOwnerOidcLogin(input:{pool:Database;config:Config;provider:OidcProvider;claimToken?:string|undefined}) {
  const token=input.claimToken;
  const parsed=token===undefined?undefined:z.string().regex(/^[A-Za-z0-9_-]{43,128}$/).safeParse(token);
  if (parsed&&!parsed.success) throw loginFailure();
  return startLogin(input,'owner',token===undefined?undefined:digest(token));
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
    'SELECT nonce,code_verifier AS "codeVerifier",login_intent AS "loginIntent",owner_invitation_token_hash AS "ownerInvitationTokenHash" FROM public.consume_oidc_login_transaction($1,$2)',
    [digest(state),digest(binding.value)],
  );
  const transaction=z.object({nonce:z.string(),codeVerifier:z.string(),loginIntent:z.enum(['staff','owner']),ownerInvitationTokenHash:z.string().regex(/^[0-9a-f]{64}$/).nullable()}).optional().parse(consumed.rows[0]);
  if (!transaction) throw loginFailure();
  if (parsed.data.error || !parsed.data.code) throw loginFailure(transaction.loginIntent);

  const callbackUrl=new URL(input.config.OIDC_CALLBACK_URL);
  for (const [key,value] of Object.entries(parsed.data)) callbackUrl.searchParams.set(key,value);
  let subject:{issuer:string;subject:string;sessionId?:string;issuedAt:number};
  try {
    subject=await input.provider.exchangeAuthorizationCode({
      state,
      nonce:transaction.nonce,
      codeVerifier:transaction.codeVerifier,
      callbackUrl,
    });
  } catch {
    throw loginFailure(transaction.loginIntent);
  }
  if (subject.issuer!==input.config.OIDC_ISSUER) throw loginFailure(transaction.loginIntent);

  if (transaction.loginIntent==='owner') {
    try {
      await issueOwnerSession(input.pool,input.reply,input.config,subject,transaction.ownerInvitationTokenHash??undefined);
    } catch(error) {
      if (error instanceof ApiError&&error.code==='ACCOUNT_NOT_APPROVED') throw new OidcLoginFailure('owner','ACCOUNT_NOT_APPROVED');
      throw error;
    }
    return {audience:'owner' as const};
  }

  const identity=await input.pool.query(
    'SELECT staff_user_id AS id FROM public.resolve_active_staff_identity($1,$2)',
    [subject.issuer,subject.subject],
  );
  const row=z.object({id:z.string().uuid()}).optional().parse(identity.rows[0]);
  if (!row) throw new OidcLoginFailure('staff','ACCOUNT_NOT_APPROVED');
  try {
    await issueSession(input.pool,input.request,input.reply,input.config,row.id,subject);
  } catch(error) {
    if (error instanceof ApiError&&error.code==='OIDC_LOGIN_FAILED') throw loginFailure('staff');
    throw error;
  }
  return {audience:'staff' as const};
}

export function oidcBindingCookieName(state:string):string|undefined {
  return statePattern.test(state)?bindingCookieName(state):undefined;
}
