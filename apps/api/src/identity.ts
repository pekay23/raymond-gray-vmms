import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import { scoped, type Database, type Scope } from './db.js';
import { uuid } from './db.js';
import { ApiError } from './errors.js';

function derive(password:string,salt:string):Promise<Buffer> {
  return new Promise((resolve,reject)=>scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(key)));
}
const personSchema=z.object({id:uuid,displayName:z.string()});
const siteSchema=z.object({id:uuid,name:z.string(),code:z.string(),timeZone:z.string().min(1).max(64),canWrite:z.boolean(),roleCodes:z.array(z.string())});
const sessionCookie='vmms_session';
const csrfCookie='vmms_csrf';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

export async function hashPassword(password:string):Promise<string> {
  const salt=randomBytes(16).toString('hex');
  const key=await derive(password,salt);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password:string,stored:string) {
  const parsed=z.tuple([z.literal('scrypt'),z.string().regex(/^[0-9a-f]{32}$/),z.string().regex(/^[0-9a-f]{128}$/)]).safeParse(stored.split(':'));
  if (!parsed.success) return false;
  const [,salt,encoded]=parsed.data;
  const actual=await derive(password,salt);
  return timingSafeEqual(actual,Buffer.from(encoded,'hex'));
}

function token(request:FastifyRequest):string|undefined {
  const encoded=request.cookies[sessionCookie];
  if (!encoded) return undefined;
  const unsigned=request.unsignCookie(encoded);
  return unsigned.valid && unsigned.value ? unsigned.value : undefined;
}

export function issueCsrf(reply:FastifyReply,config:Config) {
  reply.setCookie(csrfCookie,randomBytes(32).toString('hex'),{path:'/',signed:true,httpOnly:false,secure:config.NODE_ENV==='production',sameSite:'strict'});
}

export function requireCsrf(request:FastifyRequest,config:Config) {
  const cookie=request.cookies[csrfCookie];
  const header=request.headers['x-csrftoken'];
  if (request.headers.origin !== config.WEB_ORIGIN || !cookie || typeof header!=='string' || !request.unsignCookie(cookie).valid) {
    throw new ApiError(403,'CSRF_REQUIRED','Refresh this page and try again. A valid same-origin security token is required.');
  }
  const left=Buffer.from(cookie),right=Buffer.from(header);
  if (left.length!==right.length || !timingSafeEqual(left,right)) throw new ApiError(403,'CSRF_REQUIRED','Refresh this page and try again. A valid security token is required.');
}

export type StaffSessionPrincipal={id:string;displayName:string;tokenHash:string};

export async function currentUser(pool:Database,request:FastifyRequest):Promise<StaffSessionPrincipal|undefined> {
  const sessionToken=token(request);
  if (!sessionToken) return undefined;
  const tokenHash=digest(sessionToken);
  const found=await pool.query('SELECT staff_user_id AS id,display_name AS "displayName" FROM public.current_staff_session($1)',[tokenHash]);
  const person=found.rows.length?personSchema.parse(found.rows[0]):undefined;
  return person?{...person,tokenHash}:undefined;
}

export async function sessionView(pool:Database,request:FastifyRequest) {
  const user=await currentUser(pool,request);
  if (!user) return {authenticated:false};
  return staffSession(pool,user);
}

async function staffSession(pool:Database,user:StaffSessionPrincipal) {
  const memberships=await pool.query(`SELECT site_id AS id,organisation_id AS "organisationId",site_name AS name,site_code AS code,site_time_zone AS "timeZone",can_write AS "canWrite"
    FROM public.current_staff_session_sites($1)`,[user.tokenHash]);
  const sites=await Promise.all(memberships.rows.map(async membership=>{
    const site=z.object({id:uuid,organisationId:uuid,name:z.string(),code:z.string(),timeZone:z.string().min(1).max(64),canWrite:z.boolean()}).parse(membership);
    const roleCodes=await scoped(pool,{actorId:user.id,organisationId:site.organisationId,siteId:site.id},async client=>{
      const current=await client.query('SELECT public.lock_membership($1,$2) AS can_write',[user.id,site.id]);
      if (current.rows[0]?.can_write==null) return [];
      const roles=await client.query(`SELECT DISTINCT p.role_code
        FROM public.staff_role_placements p
        JOIN public.staff_role_profiles r ON r.code=p.role_code
        JOIN public.staff_users u ON u.id=p.staff_user_id
        WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3
          AND p.state='active' AND r.active AND u.active ORDER BY p.role_code`,
      [site.organisationId,site.id,user.id]);
      return roles.rows.map(row=>z.object({role_code:z.string()}).parse(row).role_code);
    });
    return {...site,roleCodes};
  }));
  return {authenticated:true as const,user:personSchema.parse(user),sites:z.array(siteSchema).parse(sites)};
}

export async function issueSession(pool:Database,request:FastifyRequest,reply:FastifyReply,config:Config,staffUserId:string,oidc?:{issuer:string;subject:string;sessionId?:string;issuedAt:number}) {
  const found=await pool.query('SELECT staff_user_id AS id,display_name AS "displayName" FROM public.active_staff_user($1)',[staffUserId]);
  const user=z.object({id:uuid,displayName:z.string()}).optional().parse(found.rows[0]);
  if (!user) throw new ApiError(403,'ACCOUNT_NOT_APPROVED','Your identity is not approved for VMMS access. Contact your service-centre administrator.');
  const old=token(request);
  const newToken=randomBytes(32).toString('hex');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const oidcValues=oidc?{
      issuer:oidc.issuer,clientId:config.OIDC_CLIENT_ID,
      subjectHash:digest(oidc.subject),sessionHash:oidc.sessionId?digest(oidc.sessionId):null,
      issuedAt:new Date(oidc.issuedAt*1000),
    }:undefined;
    if (oidcValues) {
      const check=await client.query('SELECT public.oidc_login_is_revoked($1,$2,$3,$4,$5) AS revoked',[oidcValues.issuer,oidcValues.clientId,oidcValues.subjectHash,oidcValues.sessionHash,oidcValues.issuedAt]);
      if (z.object({revoked:z.boolean()}).parse(check.rows[0]).revoked) throw new ApiError(401,'OIDC_LOGIN_FAILED','Sign-in could not be completed. Try again.');
    }
    if (old) await client.query('SELECT public.revoke_staff_session($1)',[digest(old)]);
    await client.query('SELECT public.create_staff_session($1,$2,$3,$4,$5,$6,$7)',[
      digest(newToken),user.id,oidcValues?.issuer??null,oidcValues?.clientId??null,
      oidcValues?.subjectHash??null,oidcValues?.sessionHash??null,oidcValues?.issuedAt??null,
    ]);
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  reply.setCookie(sessionCookie,newToken,{path:'/api/v1',signed:true,httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',maxAge:8*60*60});
  issueCsrf(reply,config);
  return staffSession(pool,{...user,tokenHash:digest(newToken)});
}

export async function login(pool:Database,credentialPool:Database,request:FastifyRequest,reply:FastifyReply,config:Config) {
  requireCsrf(request,config);
  const body=z.object({username:z.string().trim().min(1).max(100),password:z.string().min(1).max(1000)}).strict().parse(request.body);
  const username=body.username.toLowerCase();
  for (const [key,limit] of [[`account:${username}:${request.ip}`,10],[`ip:${request.ip}`,60]] satisfies [string,number][]) {
    const attempts=await pool.query(`INSERT INTO login_attempts(bucket,failures,window_start) VALUES($1,1,now()) ON CONFLICT(bucket) DO UPDATE SET failures=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE login_attempts.failures+1 END,window_start=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING failures`,[digest(key)]);
    if (z.object({failures:z.number()}).parse(attempts.rows[0]).failures>limit) throw new ApiError(429,'LOGIN_THROTTLED','Too many sign-in attempts. Wait 15 minutes before trying again.');
  }
  const found=await credentialPool.query('SELECT id,password_hash,active FROM staff_users WHERE username=$1',[username]);
  const candidate=z.object({id:uuid,password_hash:z.string().nullable(),active:z.boolean()}).optional().parse(found.rows[0]);
  const dummy='scrypt:00000000000000000000000000000000:'+ '0'.repeat(128);
  const valid=await verifyPassword(body.password,candidate?.password_hash??dummy);
  if (!valid || !candidate?.active) throw new ApiError(401,'INVALID_CREDENTIALS','The username or password is incorrect.');
  return issueSession(pool,request,reply,config,candidate.id);
}

export async function logout(pool:Database,request:FastifyRequest,reply:FastifyReply,config:Config) {
  requireCsrf(request,config);
  const old=token(request);
  if (old) await pool.query('SELECT public.revoke_staff_session($1)',[digest(old)]);
  reply.clearCookie(sessionCookie,{path:'/api/v1'});
  issueCsrf(reply,config);
  return {authenticated:false};
}

export async function authorisedScope(pool:Database,request:FastifyRequest,siteId:string,write=false,access:'workforce'|'operator-account'='workforce'):Promise<Scope> {
  const person=await currentUser(pool,request);
  if (!person) throw new ApiError(401,'SESSION_REQUIRED','Sign in to continue.');
  const found=await pool.query('SELECT organisation_id AS "organisationId",can_write AS "canWrite" FROM public.current_staff_site_access($1,$2)',[person.tokenHash,siteId]);
  if (!found.rows.length) throw new ApiError(403,'SITE_FORBIDDEN','You do not have active access to this site.');
  const membership=z.object({organisationId:uuid,canWrite:z.boolean()}).parse(found.rows[0]);
  if (write&&!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site membership does not permit changes.');
  const scope={actorId:person.id,organisationId:membership.organisationId,siteId};
  if(access==='workforce') {
    const accountOnlyOperator=await scoped(pool,scope,async client=>{
      const current=await client.query('SELECT public.lock_membership($1,$2) AS can_write',[person.id,siteId]);
      if(current.rows[0]?.can_write==null)throw new ApiError(403,'SITE_FORBIDDEN','You do not have active access to this site.');
      const result=await client.query(`SELECT EXISTS(
        SELECT 1 FROM public.staff_role_placements p
        WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3
          AND p.state='active' AND p.role_code='vmms-operator'
      ) AND NOT EXISTS (
        SELECT 1 FROM public.staff_role_placements p
        WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3
          AND p.state='active' AND p.role_code<>'vmms-operator'
      ) AS denied`,[scope.organisationId,scope.siteId,scope.actorId]);
      return z.object({denied:z.boolean()}).parse(result.rows[0]).denied;
    });
    if(accountOnlyOperator)throw new ApiError(403,'WORK_ROLE_REQUIRED','The VMMS Operator account is limited to account administration.');
  }
  return scope;
}
