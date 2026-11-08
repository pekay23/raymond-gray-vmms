import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Database, Scope } from './db.js';
import { uuid } from './db.js';
import { ApiError } from './errors.js';

function derive(password:string,salt:string):Promise<Buffer> {
  return new Promise((resolve,reject)=>scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(key)));
}
const personSchema=z.object({id:uuid,displayName:z.string()});
const siteSchema=z.object({id:uuid,name:z.string(),code:z.string(),canWrite:z.boolean()});
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

export async function currentUser(pool:Database,request:FastifyRequest) {
  const sessionToken=token(request);
  if (!sessionToken) return undefined;
  const found=await pool.query(`SELECT u.id,u.display_name AS "displayName" FROM staff_sessions s JOIN staff_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`,[digest(sessionToken)]);
  return found.rows.length ? personSchema.parse(found.rows[0]) : undefined;
}

export async function sessionView(pool:Database,request:FastifyRequest) {
  const user=await currentUser(pool,request);
  if (!user) return {authenticated:false};
  return staffSession(pool,user);
}

async function staffSession(pool:Database,user:{id:string;displayName:string}) {
  const sites=await pool.query(`SELECT s.id,s.name,s.code,m.can_write AS "canWrite" FROM memberships m JOIN sites s ON s.id=m.site_id WHERE m.user_id=$1 AND m.active ORDER BY s.name`,[user.id]);
  return {authenticated:true as const,user:personSchema.parse(user),sites:z.array(siteSchema).parse(sites.rows)};
}

export async function issueSession(pool:Database,request:FastifyRequest,reply:FastifyReply,config:Config,staffUserId:string) {
  const found=await pool.query('SELECT id,display_name AS "displayName" FROM staff_users WHERE id=$1 AND active',[staffUserId]);
  const user=z.object({id:uuid,displayName:z.string()}).optional().parse(found.rows[0]);
  if (!user) throw new ApiError(403,'ACCOUNT_NOT_APPROVED','Your identity is not approved for VMMS access. Contact your service-centre administrator.');
  const old=token(request);
  const newToken=randomBytes(32).toString('hex');
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    if (old) await client.query('DELETE FROM staff_sessions WHERE token_hash=$1',[digest(old)]);
    await client.query("INSERT INTO staff_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[digest(newToken),user.id]);
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  reply.setCookie(sessionCookie,newToken,{path:'/api/v1',signed:true,httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',maxAge:8*60*60});
  issueCsrf(reply,config);
  return staffSession(pool,user);
}

export async function login(pool:Database,request:FastifyRequest,reply:FastifyReply,config:Config) {
  requireCsrf(request,config);
  const body=z.object({username:z.string().trim().min(1).max(100),password:z.string().min(1).max(1000)}).strict().parse(request.body);
  const username=body.username.toLowerCase();
  for (const [key,limit] of [[`account:${username}:${request.ip}`,10],[`ip:${request.ip}`,60]] satisfies [string,number][]) {
    const attempts=await pool.query(`INSERT INTO login_attempts(bucket,failures,window_start) VALUES($1,1,now()) ON CONFLICT(bucket) DO UPDATE SET failures=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE login_attempts.failures+1 END,window_start=CASE WHEN login_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END RETURNING failures`,[digest(key)]);
    if (z.object({failures:z.number()}).parse(attempts.rows[0]).failures>limit) throw new ApiError(429,'LOGIN_THROTTLED','Too many sign-in attempts. Wait 15 minutes before trying again.');
  }
  const found=await pool.query('SELECT id,password_hash,active FROM staff_users WHERE username=$1',[username]);
  const candidate=z.object({id:uuid,password_hash:z.string().nullable(),active:z.boolean()}).optional().parse(found.rows[0]);
  const dummy='scrypt:00000000000000000000000000000000:'+ '0'.repeat(128);
  const valid=await verifyPassword(body.password,candidate?.password_hash??dummy);
  if (!valid || !candidate?.active) throw new ApiError(401,'INVALID_CREDENTIALS','The username or password is incorrect.');
  return issueSession(pool,request,reply,config,candidate.id);
}

export async function logout(pool:Database,request:FastifyRequest,reply:FastifyReply,config:Config) {
  requireCsrf(request,config);
  const old=token(request);
  if (old) await pool.query('DELETE FROM staff_sessions WHERE token_hash=$1',[digest(old)]);
  reply.clearCookie(sessionCookie,{path:'/api/v1'});
  issueCsrf(reply,config);
  return {authenticated:false};
}

export async function authorisedScope(pool:Database,request:FastifyRequest,siteId:string,write=false):Promise<Scope> {
  const person=await currentUser(pool,request);
  if (!person) throw new ApiError(401,'SESSION_REQUIRED','Sign in to continue.');
  const found=await pool.query(`SELECT s.organisation_id AS "organisationId",m.can_write AS "canWrite" FROM memberships m JOIN sites s ON s.id=m.site_id WHERE m.user_id=$1 AND m.site_id=$2 AND m.active`,[person.id,siteId]);
  if (!found.rows.length) throw new ApiError(403,'SITE_FORBIDDEN','You do not have active access to this site.');
  const membership=z.object({organisationId:uuid,canWrite:z.boolean()}).parse(found.rows[0]);
  if (write&&!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site membership does not permit changes.');
  return {actorId:person.id,organisationId:membership.organisationId,siteId};
}
