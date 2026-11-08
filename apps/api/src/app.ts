import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { z } from 'zod';
import type { Config } from './config.js';
import { type Database, makePool, scoped, uuid } from './db.js';
import { ApiError } from './errors.js';
import { authorisedScope, issueCsrf, login, logout, requireCsrf, sessionView } from './identity.js';
import { completeOidcLogin, oidcBindingCookieName, startOidcLogin } from './oidc-login.js';
import { OidcClient, type OidcProvider } from './oidc-client.js';
import { complaintSchema, holdSchema, intakeSchema, taskSchema } from './schemas.js';
import { approveOwnerSchema, expireOwnerSchema, revokeOwnerSchema, transferOwnerSchema, approveVehicleOwnerAccess, expireVehicleOwnerAccess, revokeVehicleOwnerAccess, transferVehicleOwnerAccess } from './owner-access.js';
import { addComplaint, addTask, createIntake, detail, listWorkOrders, openHold } from './workshop.js';
import { beginEvidenceDownload, createEvidenceIntent, createEvidenceIntentSchema, createEvidenceServices, readEvidence, uploadEvidence, type EvidenceServices } from './evidence.js';
import { Readable } from 'node:stream';

export async function createApp(config:Config,pool:Database=makePool(config.DATABASE_URL),providedOidcProvider?:OidcProvider,providedEvidenceServices?:EvidenceServices) {
  const evidenceServices=providedEvidenceServices??createEvidenceServices();
  const role=await pool.query('SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  const runtime=z.object({rolname:z.string(),rolsuper:z.boolean(),rolbypassrls:z.boolean()}).parse(role.rows[0]);
  const owns=await pool.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tableowner=current_user");
  if (runtime.rolsuper||runtime.rolbypassrls||z.object({count:z.number()}).parse(owns.rows[0]).count>0) {
    throw new Error('The API must connect using a non-owner role without superuser or BYPASSRLS privileges.');
  }
  const app=Fastify({bodyLimit:65536,requestTimeout:15000,logger:config.NODE_ENV==='test'?false:{redact:['req.headers.cookie','req.headers.authorization','res.headers.set-cookie','password']}});
  app.addContentTypeParser('application/octet-stream',(_request,payload,done)=>done(null,payload));
  await app.register(cookie,{secret:config.SESSION_SECRET});
  app.addHook('onSend',async(_request,reply)=>{
    reply.header('Cache-Control','no-store');
    reply.header('X-Content-Type-Options','nosniff');
    reply.header('X-Frame-Options','DENY');
    reply.header('Referrer-Policy','same-origin');
  });
  app.setErrorHandler((error,request,reply)=>{
    if (error instanceof ApiError) {
      return reply.code(error.status).send({error:{code:error.code,message:error.message,...(error.currentVersion===undefined?{}:{currentVersion:error.currentVersion})}});
    }
    if (error instanceof z.ZodError) {
      const fields:Record<string,string[]>={};
      for (const issue of error.issues) {
        const key=issue.path.join('.')||'form';
        (fields[key]??=[]).push(issue.message);
      }
      return reply.code(400).send({error:{code:'VALIDATION',message:'Check the highlighted fields and try again.',fields}});
    }
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode==='number' && error.statusCode>=400&&error.statusCode<500) {
      return reply.code(error.statusCode).send({error:{code:'INVALID_REQUEST',message:'The request could not be accepted.'}});
    }
    request.log.error({requestId:request.id},'Request failed. Inspect correlated server diagnostics without logging sensitive payloads.');
    return reply.code(500).send({error:{code:'INTERNAL',message:'The request could not be completed. Your saved records have not been partially changed.'}});
  });
  app.get('/api/v1/health',async()=>{await pool.query('SELECT 1');return {status:'ready'};});
  app.get('/api/v1/session',async(request,reply)=>{issueCsrf(reply,config);return sessionView(pool,request);});
  if (config.NODE_ENV==='test') app.post('/api/v1/session',async(request,reply)=>login(pool,request,reply,config));
  if (config.NODE_ENV!=='test'||providedOidcProvider) {
    const oidcProvider=providedOidcProvider??new OidcClient(config);
    app.get('/api/v1/auth/oidc/start',async(_request,reply)=>{
      const flow=await startOidcLogin({pool,config,provider:oidcProvider});
      reply.setCookie(flow.cookie.name,flow.cookie.value,{path:flow.cookie.path,signed:true,httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'lax',maxAge:5*60});
      return reply.redirect(flow.authorizationUrl.href);
    });
    app.get('/api/v1/auth/oidc/callback',{logLevel:'silent'},async(request,reply)=>{
      const state=z.object({state:z.string().optional()}).safeParse(request.query).data?.state;
      const cookieName=state?oidcBindingCookieName(state):undefined;
      try {
        await completeOidcLogin({pool,request,reply,config,provider:oidcProvider});
        return reply.redirect(config.WEB_ORIGIN);
      } catch(error) {
        if (error instanceof ApiError&&error.code==='ACCOUNT_NOT_APPROVED') {
          const destination=new URL(config.WEB_ORIGIN);destination.searchParams.set('signin','not-approved');
          return reply.redirect(destination.href);
        }
        if (error instanceof ApiError&&error.code==='OIDC_LOGIN_FAILED') {
          const destination=new URL(config.WEB_ORIGIN);destination.searchParams.set('signin','failed');
          return reply.redirect(destination.href);
        }
        throw error;
      } finally {
        if (cookieName) reply.clearCookie(cookieName,{path:new URL(config.OIDC_CALLBACK_URL).pathname,secure:config.NODE_ENV==='production',sameSite:'lax'});
      }
    });
  }
  app.delete('/api/v1/session',async(request,reply)=>logout(pool,request,reply,config));
  app.post('/api/v1/sites/:siteId/evidence/intents',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,true);
    const commandId=uuid.parse(request.headers['idempotency-key']);
    return createEvidenceIntent(pool,scope,commandId,createEvidenceIntentSchema.parse(request.body),evidenceServices);
  });
  app.put('/api/v1/sites/:siteId/evidence/intents/:intentId/content',{bodyLimit:evidenceServices.maxUploadBytes},async(request,reply)=>{
    requireCsrf(request,config);
    const {siteId,intentId}=z.object({siteId:uuid,intentId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,true);
    const contentLength=z.coerce.number().int().positive().parse(request.headers['content-length']);
    const result=await uploadEvidence(pool,scope,intentId,request.body as Readable,contentLength,evidenceServices);
    return reply.code(202).send(result);
  });
  app.get('/api/v1/sites/:siteId/evidence/:evidenceId',async request=>{
    const {siteId,evidenceId}=z.object({siteId:uuid,evidenceId:uuid}).parse(request.params);
    return readEvidence(pool,await authorisedScope(pool,request,siteId),evidenceId);
  });
  app.get('/api/v1/sites/:siteId/evidence/:evidenceId/download',async(request,reply)=>{
    const {siteId,evidenceId}=z.object({siteId:uuid,evidenceId:uuid}).parse(request.params);
    const scopedUser=await authorisedScope(pool,request,siteId);
    const record=await beginEvidenceDownload(pool,scopedUser,evidenceId,request.id);
    if(!evidenceServices.store) throw new ApiError(503,'EVIDENCE_STORAGE_UNAVAILABLE','Evidence storage is not configured.');
    const safeName=record.evidence.displayName.replace(/[\r\n"\\]/g,'_').slice(0,180);
    return reply.type(record.evidence.mediaType).header('Content-Disposition',`attachment; filename="${safeName}"`).send(Readable.fromWeb(await evidenceServices.store.readAccepted(record.acceptedKey)));
  });
  app.get('/api/v1/sites/:siteId/work-orders',async(request)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const {q}=z.object({q:z.string().trim().max(200).default('')}).parse(request.query);
    return listWorkOrders(pool,await authorisedScope(pool,request,siteId),q);
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return scoped(pool,await authorisedScope(pool,request,siteId),client=>detail(client,id));
  });
  app.post('/api/v1/sites/:siteId/intake-drafts',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,true);
    return createIntake(pool,scope,uuid.parse(request.headers['idempotency-key']),intakeSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/complaints',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return addComplaint(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,complaintSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/tasks',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return addTask(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,taskSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/holds',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return openHold(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,holdSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/vehicles/:vehicleId/owner-access/approve',async request=>{
    requireCsrf(request,config);
    const {siteId,vehicleId}=z.object({siteId:uuid,vehicleId:uuid}).parse(request.params);
    return approveVehicleOwnerAccess(pool,await authorisedScope(pool,request,siteId),uuid.parse(request.headers['idempotency-key']),vehicleId,approveOwnerSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/owner-access/:accessScopeId/relationships/:relationshipId/revoke',async request=>{
    requireCsrf(request,config);
    const {siteId,accessScopeId,relationshipId}=z.object({siteId:uuid,accessScopeId:uuid,relationshipId:uuid}).parse(request.params);
    return revokeVehicleOwnerAccess(pool,await authorisedScope(pool,request,siteId),uuid.parse(request.headers['idempotency-key']),accessScopeId,relationshipId,revokeOwnerSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/owner-access/:accessScopeId/relationships/:relationshipId/expire',async request=>{
    requireCsrf(request,config);
    const {siteId,accessScopeId,relationshipId}=z.object({siteId:uuid,accessScopeId:uuid,relationshipId:uuid}).parse(request.params);
    return expireVehicleOwnerAccess(pool,await authorisedScope(pool,request,siteId),uuid.parse(request.headers['idempotency-key']),accessScopeId,relationshipId,expireOwnerSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/owner-access/:accessScopeId/relationships/:relationshipId/transfer',async request=>{
    requireCsrf(request,config);
    const {siteId,accessScopeId,relationshipId}=z.object({siteId:uuid,accessScopeId:uuid,relationshipId:uuid}).parse(request.params);
    return transferVehicleOwnerAccess(pool,await authorisedScope(pool,request,siteId),uuid.parse(request.headers['idempotency-key']),accessScopeId,relationshipId,transferOwnerSchema.parse(request.body));
  });
  app.addHook('onClose',async()=>{await pool.end();});
  return app;
}
