import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { z } from 'zod';
import type { Config } from './config.js';
import { type Database, makePool, uuid } from './db.js';
import { ApiError } from './errors.js';
import { authorisedScope, currentUser, issueCsrf, login, logout, requireCsrf, sessionView } from './identity.js';
import { completeOidcLogin, oidcBindingCookieName, OidcLoginFailure, startOidcLogin, startOwnerOidcLogin } from './oidc-login.js';
import { currentOwnerAccount, logoutOwner, ownerOidcStartSchema, ownerSessionView } from './owner-identity.js';
import { listCurrentOwnerVehicles } from './owner-data.js';
import { addPdiObservation, addPdiObservationSchema, readVehicleSalesHistory, recordSalesDelivery, recordSalesDeliverySchema } from './sales-deliveries.js';
import { createDeliveryPreparation, createDeliveryPreparationSchema, linkDeliveryPreparation, linkDeliveryPreparationSchema } from './delivery-preparations.js';
import { OidcClient, type OidcProvider } from './oidc-client.js';
import { complaintSchema, diagnosticFindingInputSchema, holdSchema, intakeFactCommandSchema, intakeSchema, leadAssignmentSchema, supervisorHandoffSchema, taskSchema, workPlanCommandSchema } from './schemas.js';
import { approveOwnerSchema, expireOwnerSchema, revokeOwnerSchema, transferOwnerSchema, approveVehicleOwnerAccess, expireVehicleOwnerAccess, revokeVehicleOwnerAccess, transferVehicleOwnerAccess } from './owner-access.js';
import { issueOwnerInvitation, issueOwnerInvitationSchema, revokeOwnerInvitation, revokeOwnerInvitationSchema } from './owner-invitations.js';
import { recordOperationsReview } from './workshop.js';
import { operationsReviewCommandSchema } from './schemas.js';
import { addComplaint, addTask, assignTeamLead, createIntake, createWorkPlanRevision, findClientsAtSite, findPartiesAtSite, findVehicleAtSite, handoffToSupervisor, listEligibleSupervisors, listEligibleTeamLeads, listWorkOrders, openHold } from './workshop.js';
import { beginEvidenceDownload, createEvidenceIntent, createEvidenceIntentSchema, createEvidenceServices, readEvidence, readEvidenceIntent, uploadEvidence, type EvidenceServices } from './evidence.js';
import { attachWorkOrderEvidence, attachWorkOrderEvidenceSchema, createWorkOrderEvidenceIntent, workOrderEvidenceIntentInputSchema } from './work-order-evidence.js';
import { recordDiagnosticFinding } from './diagnostics.js';
import { recordIntakeFact } from './intake-facts.js';
import { Readable } from 'node:stream';
import { addVehicleLearningComment, listVehicleLearning, listVehicleLearningLibrary, listVehicleLearningReviewQueue, readVehicleLearningActivity, revokeVehicleLearningShare, reviewVehicleLearning, saveVehicleLearning } from './vehicle-learning.js';
import { consumeAttempt } from './attempt-limiter.js';
import { verifyBackchannelLogout, type VerifiedLogout } from './oidc-logout.js';
import { completeRpLogout, rpLogoutCookieName, startRpLogout } from './oidc-rp-logout.js';
import { createHash, randomUUID } from 'node:crypto';
import { readWorkOrderDetail } from './work-order-reads.js';
import { readWorkOrderChecklists } from './work-order-checklists.js';
import { assignExistingRole, endRolePlacement, readHeadOverview, readSiteOrganogram } from './workforce.js';
import { listStaffAccountProvisioningRequests, requestStaffAccountProvisioning, staffAccountProvisioningRequestInputSchema } from './staff-account-admin.js';
import { listStaffMessages, markStaffMessageRead, sendStaffMessage } from './staff-messages.js';
import { listControlledDocuments, prepareControlledDocumentDownload } from './controlled-documents.js';
import { assignWorkPlanTasks, readTaskAllocations, taskAllocationCommandSchema } from './work-order-task-allocations.js';
import { readMyAssignedTasks } from './my-assigned-tasks.js';
import { readMyTaskActivity, readSupervisorTaskActivity, recordMyTaskActivity, taskActivityInputSchema } from './work-order-task-activity.js';
import { readMyTaskWorkEntries, readMyTaskWorkEvidenceOptions, recordMyTaskWorkEntry, taskWorkEntryInputSchema } from './work-order-task-work-entries.js';
import { createMyTaskEvidenceIntent, taskEvidenceIntentInputSchema } from './work-order-task-evidence.js';
import { readWorkOrderServiceReport } from './work-order-service-report.js';
import { readWorkOrderSourceReports, recordWorkOrderSourceReport, sourceReportInputSchema } from './work-order-source-reports.js';
import { assignRequestSchema, assignServiceRequest, claimRequestSchema, claimServiceRequest, closeRequestSchema, closeServiceRequest, contactAttemptSchema, correctContactSchema, correctServiceRequestContact, createServiceRequest, linkRequestSchema, linkServiceRequestToWorkOrder, listRequestAssignees, listServiceRequests, listWorkOrderRequests, readServiceRequest, readServiceRequestContacts, readServiceRequestStatusHistory, recordServiceRequestContact, reopenRequestSchema, reopenServiceRequest, serviceRequestInputSchema, unlinkRequestSchema, unlinkServiceRequest } from './service-requests.js';
import { listFinanceConfigurationDrafts, saveFinanceConfigurationDraft } from './finance-configuration.js';
import { readMyActiveTaskLaborSession, startMyTaskLaborSession, stopMyTaskLaborSession } from './work-order-task-labor.js';

async function clearBrowserSessions(pool: Database, request: FastifyRequest, reply: FastifyReply, config: Config) {
  const staffCookie=request.cookies.vmms_session;
  const ownerCookie=request.cookies.vmms_owner_session;
  const staffUnsigned=staffCookie?request.unsignCookie(staffCookie):undefined;
  const ownerUnsigned=ownerCookie?request.unsignCookie(ownerCookie):undefined;
  const staffHash=staffUnsigned?.valid&&staffUnsigned.value?createHash('sha256').update(staffUnsigned.value).digest('hex'):undefined;
  const ownerHash=ownerUnsigned?.valid&&ownerUnsigned.value?createHash('sha256').update(ownerUnsigned.value).digest('hex'):undefined;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    if(staffHash) await client.query('SELECT public.revoke_staff_session($1)',[staffHash]);
    if(ownerHash) await client.query('SELECT public.revoke_vehicle_owner_session($1)',[ownerHash]);
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  reply.clearCookie('vmms_session',{path:'/api/v1'});
  reply.clearCookie('vmms_owner_session',{path:'/api/v1/owner'});
  issueCsrf(reply,config);
}

export async function createApp(config:Config,pool:Database=makePool(config.DATABASE_URL),providedOidcProvider?:OidcProvider,providedEvidenceServices?:EvidenceServices,providedLogoutVerifier?:(token:string,config:Config)=>Promise<VerifiedLogout>,testCredentialPool?:Database) {
  const role=await pool.query('SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
  const runtime=z.object({rolname:z.string(),rolsuper:z.boolean(),rolbypassrls:z.boolean()}).parse(role.rows[0]);
  const owns=await pool.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public' AND tableowner=current_user");
  if (runtime.rolsuper||runtime.rolbypassrls||z.object({count:z.number()}).parse(owns.rows[0]).count>0) {
    throw new Error('The API must connect using a non-owner role without superuser or BYPASSRLS privileges.');
  }
  const app=Fastify({bodyLimit:65536,requestTimeout:15000,trustProxy:config.TRUSTED_PROXY_CIDRS.length?config.TRUSTED_PROXY_CIDRS:false,requestIdHeader:false,genReqId:()=>randomUUID(),logger:config.NODE_ENV==='test'?false:{redact:['req.headers.cookie','req.headers.authorization','res.headers.set-cookie','password'],serializers:{req:request=>({method:request.method,route:request.routeOptions.url??'unmatched'})}}});
  app.addContentTypeParser('application/octet-stream',(_request,payload,done)=>done(null,payload));
  app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_request,body,done)=>{
    const form=new URLSearchParams(typeof body==='string'?body:body.toString());
    const names=[...form.keys()];
    if (names.length!==1||names[0]!=='logout_token') return done(Object.assign(new Error('Invalid logout form.'),{statusCode:400}));
    done(null,{logout_token:form.get('logout_token')});
  });
  await app.register(cookie,{secret:config.SESSION_SECRET});
  // Passing a service bundle transfers its lifecycle to this app, just like the pool.
  const evidenceServices=providedEvidenceServices??createEvidenceServices();
  app.addHook('onClose',async()=>{
    const results=await Promise.allSettled([
      Promise.resolve().then(()=>evidenceServices.close()),
      Promise.resolve().then(()=>pool.end()),
    ]);
    if(results.some(result=>result.status==='rejected')) throw new Error('VMMS API resources did not close cleanly.');
  });
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
    const diagnostic = process.env.NODE_ENV === 'production'
      ? {requestId:request.id}
      : error instanceof Error
        ? {requestId:request.id,errorName:error.name,errorMessage:error.message,stack:error.stack}
        : {requestId:request.id,errorType:typeof error};
    request.log.error(diagnostic,'Request failed.');
    return reply.code(500).send({error:{code:'INTERNAL',message:'The request could not be completed. Your saved records have not been partially changed.'}});
  });
  app.get('/api/v1/health',async()=>{await pool.query('SELECT 1');return {status:'ready'};});
  app.get('/api/v1/session',async(request,reply)=>{issueCsrf(reply,config);return sessionView(pool,request);});
  app.get('/api/v1/owner/session',async(request,reply)=>ownerSessionView(pool,request,reply,config));
  app.get('/api/v1/owner/vehicles',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    return listCurrentOwnerVehicles(pool,request);
  });
  app.post('/api/v1/auth/oidc/backchannel-logout', {logLevel: 'silent'}, async (request, reply) => {
    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/x-www-form-urlencoded' && contentType !== 'application/json') {
      return reply.code(415).send({error: {code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send a form-encoded or JSON logout token.'}});
    }
    await consumeAttempt(pool, config, `oidc-logout-network:${request.ip}`, 300, 60);
    const bodySchema = z.object({logout_token: z.string().min(1).max(16384)}).strict();
    const body = bodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({error: {code: 'INVALID_LOGOUT_TOKEN', message: 'The logout request could not be accepted.'}});
    let event;
    try { event = await (providedLogoutVerifier ?? verifyBackchannelLogout)(body.data.logout_token, config); }
    catch { return reply.code(400).send({error: {code: 'INVALID_LOGOUT_TOKEN', message: 'The logout request could not be accepted.'}}); }
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    await pool.query('SELECT public.process_oidc_logout($1,$2,$3,$4,$5,$6,$7)', [
      event.issuer, event.clientId, event.subject ? hash(event.subject) : null, event.sessionId ? hash(event.sessionId) : null,
      event.issuedAt, event.jtiHash, event.expiresAt,
    ]);
    return reply.code(200).send();
  });

  if (config.NODE_ENV === 'test' && testCredentialPool) {
    if (testCredentialPool===pool) throw new Error('Test password login must use a credential pool separate from the API runtime pool.');
    app.post('/api/v1/session',async(request,reply)=>login(pool,testCredentialPool,request,reply,config));
  }
  if (config.NODE_ENV!=='test'||providedOidcProvider) {
    const oidcProvider=providedOidcProvider??new OidcClient(config);
    app.post('/api/v1/auth/oidc/logout',async(request,reply)=>{
      reply.header('Cache-Control','no-store');
      requireCsrf(request,config);
      const input=z.object({destination:z.enum(['signed-out','staff','owner']).default('signed-out')}).strict().parse(request.body??{});
      await consumeAttempt(pool,config,`oidc-rp-logout-network:${request.ip}`,30,15*60);
      const [staff,owner]=await Promise.all([currentUser(pool,request),currentOwnerAccount(pool,request)]);
      if(!staff&&!owner) throw new ApiError(401,'SESSION_REQUIRED','Sign in before ending the shared account session.');
      await clearBrowserSessions(pool,request,reply,config);
      try {
        const flow=await startRpLogout({pool,config,provider:oidcProvider,destination:input.destination});
        reply.setCookie(flow.cookieName,flow.browserBinding,{path:flow.cookiePath,signed:true,httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'lax',maxAge:5*60});
        return {localSignedOut:true as const,centralLogout:'started' as const,logoutUrl:flow.logoutUrl.href};
      } catch {
        return {localSignedOut:true as const,centralLogout:'unavailable' as const,logoutUrl:null};
      }
    });
    app.get('/api/v1/auth/oidc/logout/callback',{logLevel:'silent'},async(request,reply)=>{
      reply.header('Cache-Control','no-store');
      const query=z.object({state:z.string()}).strict().safeParse(request.query);
      const state=query.success?query.data.state:undefined;
      const cookieName=rpLogoutCookieName(state);
      let destination:'signed-out'|'staff'|'owner'|undefined;
      try {
        if(state) destination=await completeRpLogout({pool,request,state});
      } finally {
        if(cookieName) reply.clearCookie(cookieName,{path:new URL(config.OIDC_LOGOUT_CALLBACK_URL).pathname,secure:config.NODE_ENV==='production',sameSite:'lax'});
      }
      if(destination==='staff'||destination==='owner') {
        const target=new URL('/',config.WEB_ORIGIN);
        target.searchParams.set('audience',destination);
        return reply.code(303).redirect(target.href);
      }
      const target=new URL('/signed-out',config.WEB_ORIGIN);
      if(destination!=='signed-out') target.searchParams.set('central','unavailable');
      return reply.code(303).redirect(target.href);
    });
    app.get('/api/v1/auth/oidc/start',async(request,reply)=>{
      await consumeAttempt(pool,config,`staff-oidc-network:${request.ip}`,60,15*60);
      const flow=await startOidcLogin({pool,config,provider:oidcProvider});
      reply.setCookie(flow.cookie.name,flow.cookie.value,{path:flow.cookie.path,signed:true,httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'lax',maxAge:5*60});
      return reply.redirect(flow.authorizationUrl.href);
    });
    app.get('/api/v1/auth/oidc/callback',{logLevel:'silent'},async(request,reply)=>{
      const state=z.object({state:z.string().optional()}).safeParse(request.query).data?.state;
      const cookieName=state?oidcBindingCookieName(state):undefined;
      try {
        const completed=await completeOidcLogin({pool,request,reply,config,provider:oidcProvider});
        if (completed.audience==='staff') return reply.redirect(config.WEB_ORIGIN);
        const destination=new URL(config.WEB_ORIGIN);
        destination.searchParams.set('audience','owner');
        return reply.redirect(destination.href);
      } catch(error) {
        if (error instanceof OidcLoginFailure) {
          const destination=new URL(config.WEB_ORIGIN);
          destination.searchParams.set('signin',error.code==='ACCOUNT_NOT_APPROVED'?'not-approved':'failed');
          if (error.audience==='owner') destination.searchParams.set('audience','owner');
          return reply.redirect(destination.href);
        }
        throw error;
      } finally {
        if (cookieName) reply.clearCookie(cookieName,{path:new URL(config.OIDC_CALLBACK_URL).pathname,secure:config.NODE_ENV==='production',sameSite:'lax'});
      }
    });
  }
  app.delete('/api/v1/session',async(request,reply)=>logout(pool,request,reply,config));
  app.delete('/api/v1/owner/session',async(request,reply)=>logoutOwner(pool,request,reply,config));
  app.delete('/api/v1/owner/session/browser',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    requireCsrf(request,config);
    await clearBrowserSessions(pool,request,reply,config);
    return {authenticated:false};
  });
  if (config.NODE_ENV!=='test'||providedOidcProvider) {
    const oidcProvider=providedOidcProvider??new OidcClient(config);
    app.post('/api/v1/owner/auth/oidc/start',async(request,reply)=>{
      requireCsrf(request,config);
      const input=ownerOidcStartSchema.parse(request.body??{});
      await consumeAttempt(pool,config,`owner-oidc-network:${request.ip}`,60,15*60);
      if (input.claimToken) await consumeAttempt(pool,config,`owner-oidc-claim:${input.claimToken}`,5,15*60);
      const flow=await startOwnerOidcLogin({pool,config,provider:oidcProvider,claimToken:input.claimToken});
      reply.setCookie(flow.cookie.name,flow.cookie.value,{path:flow.cookie.path,signed:true,httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'lax',maxAge:5*60});
      return {authorizationUrl:flow.authorizationUrl.href};
    });
  }
  app.post('/api/v1/sites/:siteId/evidence/intents',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,true);
    const commandId=uuid.parse(request.headers['idempotency-key']);
    const input=createEvidenceIntentSchema.parse(request.body);
    if(input.purpose==='work-order') throw new ApiError(400,'WORK_ORDER_EVIDENCE_ROUTE_REQUIRED','Create work-order evidence through its work-order record.');
    return createEvidenceIntent(pool,scope,commandId,input,evidenceServices);
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/evidence/intents',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,true);
    return createWorkOrderEvidenceIntent(pool,scope,uuid.parse(request.headers['idempotency-key']),id,workOrderEvidenceIntentInputSchema.parse(request.body),evidenceServices);
  });
  app.get('/api/v1/sites/:siteId/evidence/intents/:intentId',async request=>{
    const {siteId,intentId}=z.object({siteId:uuid,intentId:uuid}).parse(request.params);
    return readEvidenceIntent(pool,await authorisedScope(pool,request,siteId),intentId);
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
  app.get('/api/v1/sites/:siteId/documents',async(request,reply)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const query=z.object({q:z.string().trim().max(200).default(''),page:z.coerce.number().int().min(1).max(1_000_000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)}).strict().parse(request.query);
    const scope=await authorisedScope(pool,request,siteId,false,'operator-account');
    reply.header('Cache-Control','no-store');
    return listControlledDocuments(pool,scope,request.id,query);
  });
  app.get('/api/v1/sites/:siteId/documents/:documentId/download',async(request,reply)=>{
    const {siteId,documentId}=z.object({siteId:uuid,documentId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,false,'operator-account');
    const document=await prepareControlledDocumentDownload(pool,scope,documentId,request.id);
    if(!evidenceServices.store) throw new ApiError(503,'EVIDENCE_STORAGE_UNAVAILABLE','Document storage is not configured.');
    const safeName=document.displayName.replace(/[\x00-\x1f\x7f"\\]/g,'_').slice(0,180);
    return reply.type(document.mediaType)
      .header('Cache-Control','no-store')
      .header('X-Content-Type-Options','nosniff')
      .header('Content-Security-Policy','sandbox')
      .header('Content-Disposition',`attachment; filename="${safeName}"`)
      .send(Readable.fromWeb(await evidenceServices.store.readAccepted(document.acceptedKey)));
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/evidence',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return attachWorkOrderEvidence(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,attachWorkOrderEvidenceSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/work-orders',async(request)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const {q,queue,page,pageSize}=z.object({
      q:z.string().trim().max(200).default(''),
      queue:z.enum(['all','operations','awaiting-operations','held','awaiting-lead','assigned','team-lead','supervisor']).default('all'),
      page:z.coerce.number().int().min(1).max(1_000_000).default(1),
      pageSize:z.coerce.number().int().min(1).max(100).default(25),
    }).parse(request.query);
    return listWorkOrders(pool,await authorisedScope(pool,request,siteId),q,request.id,queue,page,pageSize);
  });
  app.get('/api/v1/sites/:siteId/my-tasks',async request=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const {q,page,pageSize}=z.object({
      q:z.string().trim().max(120).default(''),
      page:z.coerce.number().int().min(1).max(10000).default(1),
      pageSize:z.coerce.number().int().min(1).max(50).default(25),
    }).parse(request.query);
    return readMyAssignedTasks(pool,await authorisedScope(pool,request,siteId,false),request.id,page,pageSize,q);
  });
  app.get('/api/v1/sites/:siteId/my-task-labor-session',async(request,reply)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const result=await readMyActiveTaskLaborSession(pool,await authorisedScope(pool,request,siteId,false),request.id);
    reply.header('Cache-Control','no-store');
    return result;
  });
  app.post('/api/v1/sites/:siteId/my-tasks/:workOrderId/:taskId/labor/start',async request=>{
    requireCsrf(request,config);
    const {siteId,workOrderId,taskId}=z.object({siteId:uuid,workOrderId:uuid,taskId:uuid}).parse(request.params);
    return startMyTaskLaborSession(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),workOrderId,taskId,request.body);
  });
  app.post('/api/v1/sites/:siteId/my-task-labor-sessions/:sessionId/stop',async request=>{
    requireCsrf(request,config);
    const {siteId,sessionId}=z.object({siteId:uuid,sessionId:uuid}).parse(request.params);
    return stopMyTaskLaborSession(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),sessionId,request.body);
  });
  app.get('/api/v1/sites/:siteId/my-tasks/:workOrderId/:taskId/activity',async request=>{
    const {siteId,workOrderId,taskId}=z.object({siteId:uuid,workOrderId:uuid,taskId:uuid}).parse(request.params);
    return readMyTaskActivity(pool,await authorisedScope(pool,request,siteId,false),workOrderId,taskId,request.id);
  });
  app.post('/api/v1/sites/:siteId/my-tasks/:workOrderId/:taskId/activity',async request=>{
    requireCsrf(request,config);
    const {siteId,workOrderId,taskId}=z.object({siteId:uuid,workOrderId:uuid,taskId:uuid}).parse(request.params);
    return recordMyTaskActivity(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),workOrderId,taskId,taskActivityInputSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/my-tasks/:workOrderId/:taskId/work-entries',async request=>{
    const {siteId,workOrderId,taskId}=z.object({siteId:uuid,workOrderId:uuid,taskId:uuid}).parse(request.params);
    const {page,pageSize}=z.object({
      page:z.coerce.number().int().min(1).max(10000).default(1),
      pageSize:z.coerce.number().int().min(1).max(50).default(25),
    }).strict().parse(request.query);
    return readMyTaskWorkEntries(pool,await authorisedScope(pool,request,siteId),workOrderId,taskId,request.id,page,pageSize);
  });
  app.post('/api/v1/sites/:siteId/my-tasks/:workOrderId/:taskId/evidence/intents',async request=>{
    requireCsrf(request,config);
    const {siteId,workOrderId,taskId}=z.object({siteId:uuid,workOrderId:uuid,taskId:uuid}).parse(request.params);
    return createMyTaskEvidenceIntent(
      pool,
      await authorisedScope(pool,request,siteId,true),
      uuid.parse(request.headers['idempotency-key']),
      workOrderId,
      taskId,
      taskEvidenceIntentInputSchema.parse(request.body),
      evidenceServices,
    );
  });
  app.get('/api/v1/sites/:siteId/my-tasks/:workOrderId/:taskId/work-evidence',async request=>{
    const {siteId,workOrderId,taskId}=z.object({siteId:uuid,workOrderId:uuid,taskId:uuid}).parse(request.params);
    const {page,pageSize}=z.object({
      page:z.coerce.number().int().min(1).max(10000).default(1),
      pageSize:z.coerce.number().int().min(1).max(50).default(25),
    }).strict().parse(request.query);
    return readMyTaskWorkEvidenceOptions(pool,await authorisedScope(pool,request,siteId),workOrderId,taskId,request.id,page,pageSize);
  });
  app.post('/api/v1/sites/:siteId/my-tasks/:workOrderId/:taskId/work-entries',async request=>{
    requireCsrf(request,config);
    const {siteId,workOrderId,taskId}=z.object({siteId:uuid,workOrderId:uuid,taskId:uuid}).parse(request.params);
    return recordMyTaskWorkEntry(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),workOrderId,taskId,taskWorkEntryInputSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return readWorkOrderDetail(pool,await authorisedScope(pool,request,siteId),id,request.id);
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id/checklists',async(request,reply)=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    const query=z.object({page:z.coerce.number().int().min(1).max(10_000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)}).strict().parse(request.query);
    reply.header('Cache-Control','no-store');
    return readWorkOrderChecklists(pool,await authorisedScope(pool,request,siteId),id,request.id,query);
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id/service-report',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    const query=z.object({
      page:z.coerce.number().int().min(1).max(10000).default(1),
      expectedVersion:z.coerce.number().int().positive().optional(),
      expectedTotal:z.coerce.number().int().nonnegative().optional(),
    }).strict().superRefine((value,context)=>{
      if(value.page===1&&(value.expectedVersion!==undefined||value.expectedTotal!==undefined)) context.addIssue({code:'custom',message:'Continuation values are only valid after page one.'});
      if(value.page>1&&(value.expectedVersion===undefined||value.expectedTotal===undefined)) context.addIssue({code:'custom',message:'Continuation pages require the first page version and entry count.'});
    }).parse(request.query);
    return readWorkOrderServiceReport(pool,await authorisedScope(pool,request,siteId),id,request.id,query.page,query.expectedVersion,query.expectedTotal);
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id/source-reports',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return readWorkOrderSourceReports(pool,await authorisedScope(pool,request,siteId),id,request.id);
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/source-reports',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return recordWorkOrderSourceReport(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,sourceReportInputSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id/service-requests',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    const query=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(25)}).strict().parse(request.query);
    return listWorkOrderRequests(pool,await authorisedScope(pool,request,siteId),id,request.id,query.page,query.pageSize);
  });
  app.get('/api/v1/sites/:siteId/vehicles/lookup',async request=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const {vin}=z.object({vin:z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/)}).parse(request.query);
    return findVehicleAtSite(pool,await authorisedScope(pool,request,siteId),vin,request.id);
  });
  app.get('/api/v1/sites/:siteId/vehicles/:vehicleId/sales-history',async request=>{
    const {siteId,vehicleId}=z.object({siteId:uuid,vehicleId:uuid}).parse(request.params);
    return readVehicleSalesHistory(pool,await authorisedScope(pool,request,siteId),vehicleId,request.id);
  });
  app.post('/api/v1/sites/:siteId/sales-deliveries',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    return recordSalesDelivery(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),recordSalesDeliverySchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/delivery-preparations',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    return createDeliveryPreparation(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),createDeliveryPreparationSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/delivery-preparations/:preparationId/link-delivery',async request=>{
    requireCsrf(request,config);
    const {siteId,preparationId}=z.object({siteId:uuid,preparationId:uuid}).parse(request.params);
    return linkDeliveryPreparation(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),preparationId,linkDeliveryPreparationSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/sales-deliveries/:deliveryId/pdi-observations',async request=>{
    requireCsrf(request,config);
    const {siteId,deliveryId}=z.object({siteId:uuid,deliveryId:uuid}).parse(request.params);
    return addPdiObservation(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),deliveryId,addPdiObservationSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/clients/lookup',async request=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const {q}=z.object({q:z.string().trim().min(2).max(120)}).parse(request.query);
    return findClientsAtSite(pool,await authorisedScope(pool,request,siteId),q,request.id);
  });
  app.get('/api/v1/sites/:siteId/parties/lookup',async request=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const {q}=z.object({q:z.string().trim().min(2).max(120)}).parse(request.query);
    return findPartiesAtSite(pool,await authorisedScope(pool,request,siteId),q,request.id);
  });
  app.get('/api/v1/sites/:siteId/service-requests',async request=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const query=z.object({filter:z.enum(['all','mine','overdue','due-today','unscheduled','linked','closed']).default('all'),page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(25)}).strict().parse(request.query);
    return listServiceRequests(pool,await authorisedScope(pool,request,siteId),request.id,query.filter,query.page,query.pageSize);
  });
  app.post('/api/v1/sites/:siteId/service-requests',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    return createServiceRequest(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),serviceRequestInputSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/service-requests/:id',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return readServiceRequest(pool,await authorisedScope(pool,request,siteId),id,request.id);
  });
  app.get('/api/v1/sites/:siteId/service-requests/:id/contacts',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    const query=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(25)}).strict().parse(request.query);
    return readServiceRequestContacts(pool,await authorisedScope(pool,request,siteId),id,request.id,query.page,query.pageSize);
  });
  app.get('/api/v1/sites/:siteId/service-requests/:id/status-history',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    const query=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(25)}).strict().parse(request.query);
    return readServiceRequestStatusHistory(pool,await authorisedScope(pool,request,siteId),id,request.id,query.page,query.pageSize);
  });
  app.post('/api/v1/sites/:siteId/service-requests/:id/close',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return closeServiceRequest(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,closeRequestSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/service-requests/:id/reopen',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return reopenServiceRequest(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,reopenRequestSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/service-requests/:id/contacts',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return recordServiceRequestContact(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,contactAttemptSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/service-requests/:id/contact-corrections',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return correctServiceRequestContact(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,correctContactSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/service-requests/:id/claim',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return claimServiceRequest(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,claimRequestSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/service-requests/:id/assignment',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return assignServiceRequest(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,assignRequestSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/service-requests/:id/assignees',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    const query=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(25)}).strict().parse(request.query);
    return listRequestAssignees(pool,await authorisedScope(pool,request,siteId),id,request.id,query.page,query.pageSize);
  });
  app.post('/api/v1/sites/:siteId/service-requests/:id/link-job',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return linkServiceRequestToWorkOrder(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,linkRequestSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/service-requests/:id/correct-job-link',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return unlinkServiceRequest(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,unlinkRequestSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/service-requests/:id/reception',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    const input=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(500),intake:intakeSchema}).strict().parse(request.body);
    return createIntake(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),input.intake,{requestId:id,expectedVersion:input.expectedVersion,reason:input.reason});
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
  app.post('/api/v1/sites/:siteId/work-orders/:id/diagnostic-findings',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return recordDiagnosticFinding(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,diagnosticFindingInputSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/intake-facts',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return recordIntakeFact(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,intakeFactCommandSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/holds',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return openHold(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,holdSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id/eligible-team-leads',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return listEligibleTeamLeads(pool,await authorisedScope(pool,request,siteId),id);
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/operations-review',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return recordOperationsReview(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,operationsReviewCommandSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/team-lead-assignment',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return assignTeamLead(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,leadAssignmentSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/supervisor-handoff',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return handoffToSupervisor(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,supervisorHandoffSchema.parse(request.body));
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/work-plan-revisions',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return createWorkPlanRevision(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,workPlanCommandSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id/task-allocations',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return readTaskAllocations(pool,await authorisedScope(pool,request,siteId,false),id,request.id);
  });
  app.post('/api/v1/sites/:siteId/work-orders/:id/task-allocations',async request=>{
    requireCsrf(request,config);
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return assignWorkPlanTasks(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),id,taskAllocationCommandSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id/task-activity',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    const {page,pageSize}=z.object({
      page:z.coerce.number().int().min(1).max(10000).default(1),
      pageSize:z.coerce.number().int().min(1).max(50).default(25),
    }).parse(request.query);
    return readSupervisorTaskActivity(pool,await authorisedScope(pool,request,siteId,false),id,request.id,page,pageSize);
  });
  app.get('/api/v1/sites/:siteId/work-orders/:id/eligible-supervisors',async request=>{
    const {siteId,id}=z.object({siteId:uuid,id:uuid}).parse(request.params);
    return listEligibleSupervisors(pool,await authorisedScope(pool,request,siteId),id);
  });
  app.get('/api/v1/sites/:siteId/staff/organogram',async request=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const {page,pageSize}=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(50)}).parse(request.query);
    return readSiteOrganogram(pool,await authorisedScope(pool,request,siteId),request.id,page,pageSize);
  });
  app.get('/api/v1/sites/:siteId/workforce/overview',async request=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    return readHeadOverview(pool,await authorisedScope(pool,request,siteId),request.id);
  });
  app.post('/api/v1/sites/:siteId/staff/role-placements',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,true);
    const body=z.object({staffUserId:uuid,roleCode:z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),reportsToPlacementId:uuid.nullable().default(null),expectedVersion:z.number().int().nonnegative(),reason:z.string().trim().min(1).max(500)}).strict().parse(request.body);
    return assignExistingRole(pool,scope,uuid.parse(request.headers['idempotency-key']),body);
  });
  app.post('/api/v1/sites/:siteId/staff/role-placements/:placementId/end',async request=>{
    requireCsrf(request,config);
    const {siteId,placementId}=z.object({siteId:uuid,placementId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,true);
    const body=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict().parse(request.body);
    return endRolePlacement(pool,scope,uuid.parse(request.headers['idempotency-key']),placementId,body);
  });
  app.get('/api/v1/sites/:siteId/staff/account-provisioning-requests',async(request,reply)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const query=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(25)}).parse(request.query);
    const result=await listStaffAccountProvisioningRequests(pool,await authorisedScope(pool,request,siteId,false,'operator-account'),request.id,query.page,query.pageSize);
    reply.header('Cache-Control','no-store');
    return result;
  });
  app.post('/api/v1/sites/:siteId/staff/account-provisioning-requests',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,true,'operator-account');
    return requestStaffAccountProvisioning(pool,scope,uuid.parse(request.headers['idempotency-key']),staffAccountProvisioningRequestInputSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/staff/messages',async(request,reply)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const query=z.object({page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(25)}).parse(request.query);
    const result=await listStaffMessages(pool,await authorisedScope(pool,request,siteId),request.id,query.page,query.pageSize,config.STAFF_MESSAGES_ENABLED);
    reply.header('Cache-Control','no-store');
    return result;
  });
  app.post('/api/v1/sites/:siteId/staff/messages',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId,true);
    return sendStaffMessage(pool,scope,uuid.parse(request.headers['idempotency-key']),request.body,config.STAFF_MESSAGES_ENABLED);
  });
  app.post('/api/v1/sites/:siteId/staff/messages/:messageId/read',async request=>{
    requireCsrf(request,config);
    const {siteId,messageId}=z.object({siteId:uuid,messageId:uuid}).parse(request.params);
    return markStaffMessageRead(pool,await authorisedScope(pool,request,siteId),uuid.parse(request.headers['idempotency-key']),messageId);
  });
  app.get('/api/v1/sites/:siteId/vehicle-learning',async(request,reply)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const result=await listVehicleLearning(pool,await authorisedScope(pool,request,siteId));
    reply.header('Cache-Control','no-store');
    return result;
  });
  app.get('/api/v1/sites/:siteId/vehicle-learning/library',async(request,reply)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const result=await listVehicleLearningLibrary(pool,await authorisedScope(pool,request,siteId),request.id,request.query);
    reply.header('Cache-Control','no-store');
    return result;
  });
  app.get('/api/v1/sites/:siteId/vehicle-learning/review-queue',async(request,reply)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const result=await listVehicleLearningReviewQueue(pool,await authorisedScope(pool,request,siteId),request.id);
    reply.header('Cache-Control','no-store');
    return result;
  });
  app.post('/api/v1/sites/:siteId/vehicle-learning',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    return saveVehicleLearning(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),request.body);
  });
  app.get('/api/v1/sites/:siteId/vehicle-learning/:entryId/activity',async request=>{
    const {siteId,entryId}=z.object({siteId:uuid,entryId:uuid}).parse(request.params);
    return readVehicleLearningActivity(pool,await authorisedScope(pool,request,siteId),request.id,entryId);
  });
  app.post('/api/v1/sites/:siteId/vehicle-learning/:entryId/comments',async request=>{
    requireCsrf(request,config);
    const {siteId,entryId}=z.object({siteId:uuid,entryId:uuid}).parse(request.params);
    return addVehicleLearningComment(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),entryId,request.body);
  });
  app.post('/api/v1/sites/:siteId/vehicle-learning/:entryId/reviews',async request=>{
    requireCsrf(request,config);
    const {siteId,entryId}=z.object({siteId:uuid,entryId:uuid}).parse(request.params);
    return reviewVehicleLearning(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),entryId,request.body);
  });
  app.post('/api/v1/sites/:siteId/vehicle-learning/:entryId/library-share/revocations',async request=>{
    requireCsrf(request,config);
    const {siteId,entryId}=z.object({siteId:uuid,entryId:uuid}).parse(request.params);
    return revokeVehicleLearningShare(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),entryId,request.body);
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
  app.post('/api/v1/sites/:siteId/owner-access/invitations',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const scope=await authorisedScope(pool,request,siteId);
    const input=issueOwnerInvitationSchema.parse(request.body);
    return issueOwnerInvitation(pool,config,scope,uuid.parse(request.headers['idempotency-key']),input);
  });
  app.post('/api/v1/sites/:siteId/owner-access/invitations/:invitationId/revoke',async request=>{
    requireCsrf(request,config);
    const {siteId,invitationId}=z.object({siteId:uuid,invitationId:uuid}).parse(request.params);
    return revokeOwnerInvitation(pool,await authorisedScope(pool,request,siteId),uuid.parse(request.headers['idempotency-key']),invitationId,revokeOwnerInvitationSchema.parse(request.body));
  });
  app.get('/api/v1/sites/:siteId/finance/configuration-drafts',async(request,reply)=>{
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    const query=z.object({page:z.coerce.number().int().min(1).max(100_000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(25)}).strict().parse(request.query);
    const result=await listFinanceConfigurationDrafts(pool,await authorisedScope(pool,request,siteId),request.id,query);
    reply.header('Cache-Control','no-store');
    return result;
  });
  app.post('/api/v1/sites/:siteId/finance/configuration-drafts',async request=>{
    requireCsrf(request,config);
    const {siteId}=z.object({siteId:uuid}).parse(request.params);
    return saveFinanceConfigurationDraft(pool,await authorisedScope(pool,request,siteId,true),uuid.parse(request.headers['idempotency-key']),request.body);
  });
  return app;
}
