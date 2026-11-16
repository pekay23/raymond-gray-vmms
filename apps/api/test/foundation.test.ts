import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { createHash,createHmac,randomBytes,randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { lockWorkOrderRoot, runStaffCommand } from '../src/commands.js';
import { makePool,scoped } from '../src/db.js';
import { hashPassword } from '../src/identity.js';
import { staffMessageSchema } from '../src/staff-messages.js';
import { detailSchema } from '../src/schemas.js';
import { controlledDocumentListSchema } from '../src/controlled-documents.js';
import { readWorkOrderChecklists } from '../src/work-order-checklists.js';
import { checklistOutcomeInputSchema, validateOutcomeAgainstItemRules } from '../src/work-order-checklist-outcomes.js';
import { createVehicleLearningAssessment } from '../src/vehicle-learning-assessment.js';
import { assignServiceRequest, claimServiceRequest, closeServiceRequest, contactAttemptSchema, correctServiceRequestContact, createServiceRequest, linkServiceRequestToWorkOrder, listRequestAssignees, listServiceRequests, listWorkOrderRequests, readServiceRequest, readServiceRequestContacts, readServiceRequestStatusHistory, recordServiceRequestContact, reopenServiceRequest, serviceRequestInputSchema, unlinkServiceRequest } from '../src/service-requests.js';
import { assignTeamLead, handoffToSupervisor } from '../src/workshop.js';
import type { Config } from '../src/config.js';
import type { OidcProvider } from '../src/oidc-client.js';
import type { VerifiedLogout } from '../src/oidc-logout.js';
import type { EvidenceServices } from '../src/evidence.js';

loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
const ownerUrl=z.url().parse(process.env.MIGRATION_DATABASE_URL);
const runtimeUrl=z.url().parse(process.env.DATABASE_URL);
const name=`vmms_test_${process.pid}_${randomBytes(4).toString('hex')}`;
const owner=new pg.Pool({connectionString:ownerUrl});
const testOwnerUrl=new URL(ownerUrl);testOwnerUrl.pathname=`/${name}`;
const testRuntimeUrl=new URL(runtimeUrl);testRuntimeUrl.pathname=`/${name}`;
const admin=new pg.Pool({connectionString:testOwnerUrl.toString()});
const runtime=makePool(testRuntimeUrl.toString());
const orgA=randomUUID(),orgB=randomUUID(),siteA=randomUUID(),siteA2=randomUUID(),siteB=randomUUID(),actorA=randomUUID(),actorB=randomUUID(),operatorA=randomUUID(),reader=randomUUID(),workerA=randomUUID(),workforceConcurrencyUser=randomUUID(),ownerAccountA=randomUUID(),ownerAccountB=randomUUID(),ownerAccountC=randomUUID(),ownerEvidence=randomUUID(),documentId=randomUUID(),documentRevisionId=randomUUID(),documentEvidenceId=randomUUID(),documentIntentId=randomUUID(),draftDocumentId=randomUUID(),draftRevisionId=randomUUID(),draftEvidenceId=randomUUID(),draftIntentId=randomUUID();
const learningReviewer=randomUUID(),learningReviewerPlacementId=randomUUID(),learningReviewerGrantId=randomUUID();
const password='Synthetic-test-account-7392';
const origin='http://127.0.0.1:5173';
const config:Config={DATABASE_URL:testRuntimeUrl.toString(),SESSION_SECRET:'test-session-secret-must-be-at-least-32-characters',WEB_ORIGIN:origin,OIDC_ISSUER:'http://localhost:8080/realms/raymond-gray-dev',OIDC_CLIENT_ID:'vmms-web-dev',OIDC_CALLBACK_URL:'http://127.0.0.1:4100/api/v1/auth/oidc/callback',OIDC_LOGOUT_CALLBACK_URL:'http://127.0.0.1:4100/api/v1/auth/oidc/logout/callback',TRUSTED_PROXY_CIDRS:['127.0.0.1'],PORT:4100,HOST:'127.0.0.1',NODE_ENV:'test',STAFF_MESSAGES_ENABLED:true};
let app:Awaited<ReturnType<typeof createApp>>;
let jarA:Record<string,string>={},jarB:Record<string,string>={};
let learningReviewerJar:Record<string,string>={};
let operatorPlacementId:string;
let orderA:z.infer<typeof detailSchema>;
let orderB:z.infer<typeof detailSchema>;
let hscPlacementId:string;
let crossSitePlacementId:string;
let crossSiteSameOrgPlacementId:string;
let inactiveAccountManagerPlacementId:string;
let inactiveMembershipManagerPlacementId:string;
let logoutEventForTest:VerifiedLogout|undefined;
let rpLogoutProviderUnavailable=false;
let oidcIssuedAtOverride:number|undefined;
let oidcSessionIdOverride:string|undefined;
const testEvidenceServices:EvidenceServices={store:null,scanner:null,maxUploadBytes:10*1024*1024,allowedMediaTypes:new Set(),close:async()=>{}};

function updateCookies(jar:Record<string,string>,values:string|string[]|undefined) {
  for (const header of typeof values==='string'?[values]:values??[]) {
    const pair=header.split(';')[0];
    if (!pair) continue;
    const divider=pair.indexOf('=');
    if (divider>0) jar[pair.slice(0,divider)]=pair.slice(divider+1);
  }
}

function headers(jar:Record<string,string>,key=randomUUID()) {
  return {cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '),origin,'x-csrftoken':decodeURIComponent(jar.vmms_csrf??''),'idempotency-key':key};
}

const testOidcProvider:OidcProvider={
  async createLogoutUrl(input) { if(rpLogoutProviderUnavailable) throw new Error('Synthetic identity provider outage.'); const url=new URL('/logout','http://localhost:8080'); url.searchParams.set('client_id',config.OIDC_CLIENT_ID); url.searchParams.set('post_logout_redirect_uri',input.postLogoutRedirectUri); url.searchParams.set('state',input.state); return url; },
  async createAuthorizationUrl(input) {
    const url=new URL('http://localhost:8080/realms/raymond-gray-dev/protocol/openid-connect/auth');
    url.searchParams.set('state',input.state);url.searchParams.set('nonce',input.nonce);url.searchParams.set('code_challenge','synthetic-pkce-challenge');
    return url;
  },
  async exchangeAuthorizationCode(input) {
    const code=input.callbackUrl.searchParams.get('code');
    const subjects:Record<string,string>={'synthetic-code':'synthetic-advisor-subject','stale-code':'synthetic-advisor-subject','unmapped-code':'unmapped-subject','owner-a-code':'synthetic-owner-a','owner-b-code':'synthetic-owner-b','owner-c-code':'synthetic-owner-c'};
    assert.ok(code&&subjects[code]);
    assert.equal(input.callbackUrl.searchParams.get('state'),input.state);
    assert.equal(input.codeVerifier.length>=43,true);
    return {issuer:config.OIDC_ISSUER,subject:subjects[code] as string,sessionId:oidcSessionIdOverride??`synthetic-session-${code==='stale-code'?'synthetic-code':code}`,issuedAt:oidcIssuedAtOverride??Math.floor(Date.now()/1000)};
  },
};

async function startOidc() {
  const response=await app.inject({url:'/api/v1/auth/oidc/start'});
  assert.equal(response.statusCode,302,response.body);
  const authorization=new URL(response.headers.location!);
  const state=authorization.searchParams.get('state');
  assert.ok(state);
  const jar:Record<string,string>={};updateCookies(jar,response.headers['set-cookie']);
  return {state,jar};
}

async function completeOidc(state:string,jar:Record<string,string>,code='synthetic-code') {
  const response=await app.inject({url:`/api/v1/auth/oidc/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,headers:{cookie:Object.entries(jar).map(([key,value])=>`${key}=${value}`).join('; ')}});
  return response;
}

async function startOwnerOidc(claimToken?:string) {
  const jar:Record<string,string>={};
  const session=await app.inject({url:'/api/v1/owner/session'});updateCookies(jar,session.headers['set-cookie']);
  const response=await app.inject({method:'POST',url:'/api/v1/owner/auth/oidc/start',headers:headers(jar),payload:claimToken?{claimToken}:{}});
  assert.equal(response.statusCode,200,response.body);
  const authorizationUrl=new URL((response.json() as {authorizationUrl:string}).authorizationUrl);
  const state=authorizationUrl.searchParams.get('state');assert.ok(state);
  assert.equal(response.headers['cache-control'],'no-store');
  updateCookies(jar,response.headers['set-cookie']);
  return {state,jar};
}

async function completeOwnerOidc(state:string,jar:Record<string,string>,code='owner-b-code') {
  return app.inject({url:`/api/v1/auth/oidc/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`,headers:{cookie:Object.entries(jar).map(([key,value])=>`${key}=${value}`).join('; ')}});
}

let signInSequence=0;
async function signIn(username:string) {
  const jar:Record<string,string>={};
  const session=await app.inject({method:'GET',url:'/api/v1/session'});
  updateCookies(jar,session.headers['set-cookie']);
  const testIp=`198.51.100.${++signInSequence}`;
  const response=await app.inject({method:'POST',url:'/api/v1/session',headers:{...headers(jar),'x-forwarded-for':testIp},payload:{username,password}});
  assert.equal(response.statusCode,200,response.body);
  updateCookies(jar,response.headers['set-cookie']);
  return jar;
}

function intake(vin='WVWZZZ1JZXW000001') {
  return {client:{kind:'new' as const,partyKind:'organisation' as const,name:'Synthetic Showroom',phone:'',email:''},owner:{kind:'new' as const,partyKind:'person' as const,name:'Synthetic Vehicle Owner',phone:'',email:''},visitContact:{kind:'new' as const,name:'Synthetic Visit Contact',phone:'+233200000000',email:''},vehicle:{kind:'new' as const,vin,registration:'DEV-100',make:'Development',model:'EV',variant:'Touring',powertrain:'Battery electric'},odometerKm:12000,socPercent:42,powertrainClass:'EV' as const,warrantyStatus:'unknown' as const,warrantyConfirmationNote:'',complaint:'Customer reports intermittent charging.'};
}

async function create(jar:Record<string,string>,siteId:string,vin:string,key=randomUUID()) {
  return app.inject({method:'POST',url:`/api/v1/sites/${siteId}/intake-drafts`,headers:headers(jar,key),payload:intake(vin)});
}

before(async()=>{
  if (!(await owner.query("SELECT 1 FROM pg_roles WHERE rolname='vmms_runtime'")).rows.length) {
    await owner.query("CREATE ROLE vmms_runtime LOGIN PASSWORD 'vmms_runtime_local_development_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  }
  await owner.query(`CREATE DATABASE ${name}`);
  const migrations=new URL('../migrations/',import.meta.url);
  for(const migration of (await readdir(migrations)).filter(file=>file.endsWith('.sql')).sort()) {
    await admin.query(await readFile(new URL(migration,migrations),'utf8'));
  }
  await admin.query('INSERT INTO organisations(id,name) VALUES($1,$2),($3,$4)',[orgA,'Synthetic A',orgB,'Synthetic B']);
  await admin.query('INSERT INTO sites(id,organisation_id,code,name) VALUES($1,$2,$3,$4),($5,$2,$6,$7),($8,$9,$10,$11)',[siteA,orgA,'A','Site A',siteA2,'A2','Site A2',siteB,orgB,'B','Site B']);
  const hash=await hashPassword(password);
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4),($8,$9,$10,$4),($11,$12,$13,$4),($14,$15,$16,$4),($17,$18,$19,$4)',[actorA,'test-advisor-a','Advisor A',hash,actorB,'test-advisor-b','Advisor B',reader,'test-reader','Reader',workerA,'test-worker-a','Worker A',operatorA,'test-operator-a','Operator A',workforceConcurrencyUser,'test-workforce-concurrency','Workforce Concurrency']);
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[learningReviewer,'test-learning-reviewer','Synthetic Learning Reviewer',hash]);
  await admin.query('INSERT INTO staff_identities(issuer,subject,staff_user_id) VALUES($1,$2,$3)',[config.OIDC_ISSUER,'synthetic-advisor-subject',actorA]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true),($1,$3,true),($4,$5,true),($6,$2,false),($7,$2,true),($8,$2,true),($9,$2,true)',[actorA,siteA,siteA2,actorB,siteB,reader,workerA,operatorA,workforceConcurrencyUser]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true)',[learningReviewer,siteA]);
  hscPlacementId=randomUUID();
  await admin.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')`,[hscPlacementId,orgA,siteA]);
  await admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
    VALUES($1,$2,$3,$4,'head-service-centre',$4,$4)`,[hscPlacementId,orgA,siteA,actorA]);
  await admin.query(`INSERT INTO staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,state,changed_by)
    VALUES($1,$2,$3,1,$4,'head-service-centre','active',$4)`,[orgA,siteA,hscPlacementId,actorA]);
  await admin.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')`,[learningReviewerPlacementId,orgA,siteA]);
  await admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
    VALUES($1,$2,$3,$4,'technician-engineer-trainee',$5,$5)`,[learningReviewerPlacementId,orgA,siteA,learningReviewer,actorA]);
  await admin.query(`INSERT INTO staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,state,changed_by)
    VALUES($1,$2,$3,1,$4,'technician-engineer-trainee','active',$5)`,[orgA,siteA,learningReviewerPlacementId,learningReviewer,actorA]);
  await admin.query(`INSERT INTO staff_authority_grants(id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from)
    VALUES($1,$2,$3,$4,'vehicle-learning.review',1,$5,'Synthetic isolated test grant only',now()-interval '1 minute')`,
  [learningReviewerGrantId,orgA,siteA,learningReviewer,actorA]);
  operatorPlacementId=randomUUID();
  await admin.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')`,[operatorPlacementId,orgA,siteA]);
  await admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
    VALUES($1,$2,$3,$4,'vmms-operator',$4,$4)`,[operatorPlacementId,orgA,siteA,operatorA]);
  crossSitePlacementId=randomUUID();
  await admin.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')`,[crossSitePlacementId,orgB,siteB]);
  await admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
    VALUES($1,$2,$3,$4,'supervisor',$4,$4)`,[crossSitePlacementId,orgB,siteB,actorB]);
  await admin.query(`INSERT INTO staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,state,changed_by)
    VALUES($1,$2,$3,1,$4,'supervisor','active',$4)`,[orgB,siteB,crossSitePlacementId,actorB]);
  const inactiveAccountManagerUser=randomUUID();inactiveAccountManagerPlacementId=randomUUID();
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash,active) VALUES($1,$2,$3,$4,false)',[inactiveAccountManagerUser,`test-inactive-manager-${inactiveAccountManagerUser}`,'Synthetic Inactive Account Manager',hash]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write,active) VALUES($1,$2,true,true)',[inactiveAccountManagerUser,siteA]);
  await admin.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')`,[inactiveAccountManagerPlacementId,orgA,siteA]);
  await admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
    VALUES($1,$2,$3,$4,'supervisor',$5,$5)`,[inactiveAccountManagerPlacementId,orgA,siteA,inactiveAccountManagerUser,actorA]);
  await admin.query(`INSERT INTO staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,state,changed_by)
    VALUES($1,$2,$3,1,$4,'supervisor','active',$5)`,[orgA,siteA,inactiveAccountManagerPlacementId,inactiveAccountManagerUser,actorA]);
  const inactiveMembershipManagerUser=randomUUID();inactiveMembershipManagerPlacementId=randomUUID();
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[inactiveMembershipManagerUser,`test-inactive-membership-${inactiveMembershipManagerUser}`,'Synthetic Inactive Membership Manager',hash]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write,active) VALUES($1,$2,true,false)',[inactiveMembershipManagerUser,siteA]);
  await admin.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')`,[inactiveMembershipManagerPlacementId,orgA,siteA]);
  await admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
    VALUES($1,$2,$3,$4,'supervisor',$5,$5)`,[inactiveMembershipManagerPlacementId,orgA,siteA,inactiveMembershipManagerUser,actorA]);
  await admin.query(`INSERT INTO staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,state,changed_by)
    VALUES($1,$2,$3,1,$4,'supervisor','active',$5)`,[orgA,siteA,inactiveMembershipManagerPlacementId,inactiveMembershipManagerUser,actorA]);
  const sameOrgCrossSiteManagerUser=randomUUID();
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[sameOrgCrossSiteManagerUser,`test-cross-site-manager-${sameOrgCrossSiteManagerUser}`,'Synthetic Same-Organization Cross-Site Manager',hash]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true)',[sameOrgCrossSiteManagerUser,siteA2]);
  crossSiteSameOrgPlacementId=randomUUID();
  await admin.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')`,[crossSiteSameOrgPlacementId,orgA,siteA2]);
  await admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
    VALUES($1,$2,$3,$4,'supervisor',$5,$5)`,[crossSiteSameOrgPlacementId,orgA,siteA2,sameOrgCrossSiteManagerUser,actorA]);
  await admin.query(`INSERT INTO staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,state,changed_by)
    VALUES($1,$2,$3,1,$4,'supervisor','active',$5)`,[orgA,siteA2,crossSiteSameOrgPlacementId,sameOrgCrossSiteManagerUser,actorA]);
  await admin.query(`INSERT INTO evidence_records(id,organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,purpose_kind,display_name,declared_media_type,quarantine_key,accepted_key) VALUES($1,$2,$3,'accepted',$4,'application/pdf',128,$5,'legacy','synthetic-owner-approval.pdf','application/pdf',$6,$7)`,[ownerEvidence,orgA,siteA,'a'.repeat(64),actorA,`quarantine/${orgA}/${siteA}/${ownerEvidence}`,`accepted/${orgA}/${siteA}/${ownerEvidence}`]);
  await admin.query(`INSERT INTO evidence_scan_attempts(id,organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code,scanned_at) VALUES($1,$2,$3,$4,1,'clean',$5,'synthetic-test','1','clean',now())`,[randomUUID(),orgA,siteA,ownerEvidence,'a'.repeat(64)]);
  await admin.query(`INSERT INTO evidence_upload_intents(id,organisation_id,site_id,created_by,command_id,purpose_kind,target_id,display_name,declared_media_type,expected_bytes,state,expires_at)
    VALUES($1,$2,$3,$4,$5,'procedure-reference',$6,'Synthetic library fixture.pdf','application/pdf',128,'completed',now()+interval '1 day'),
      ($7,$2,$3,$4,$8,'procedure-reference',$9,'Synthetic draft fixture.pdf','application/pdf',128,'completed',now()+interval '1 day')`,
  [documentIntentId,orgA,siteA,actorA,randomUUID(),documentId,draftIntentId,randomUUID(),draftDocumentId]);
  await admin.query(`INSERT INTO evidence_records(id,organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,purpose_kind,target_id,display_name,declared_media_type,quarantine_key,accepted_key,upload_intent_id)
    VALUES($1,$2,$3,'accepted',$4,'application/pdf',128,$5,'procedure-reference',$6,'Synthetic library fixture.pdf','application/pdf',$7,$8,$9),
      ($10,$2,$3,'accepted',$11,'application/pdf',128,$5,'procedure-reference',$12,'Synthetic draft fixture.pdf','application/pdf',$13,$14,$15)`,
  [documentEvidenceId,orgA,siteA,'b'.repeat(64),actorA,documentId,`quarantine/${documentEvidenceId}`,`accepted/${documentEvidenceId}`,documentIntentId,
    draftEvidenceId,'c'.repeat(64),draftDocumentId,`quarantine/${draftEvidenceId}`,`accepted/${draftEvidenceId}`,draftIntentId]);
  await admin.query(`INSERT INTO evidence_scan_attempts(id,organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code,scanned_at)
    VALUES($1,$2,$3,$4,1,'clean',$5,'synthetic-test','1','clean',now()),($6,$2,$3,$7,1,'clean',$8,'synthetic-test','1','clean',now())`,
  [randomUUID(),orgA,siteA,documentEvidenceId,'b'.repeat(64),randomUUID(),draftEvidenceId,'c'.repeat(64)]);
  await admin.query(`INSERT INTO controlled_documents(id,organisation_id,site_id,reference,created_by)
    VALUES($1,$2,$3,'SYN-DOC-001',$4),($5,$2,$3,'SYN-DOC-002',$4)`,[documentId,orgA,siteA,actorA,draftDocumentId]);
  await admin.query(`INSERT INTO controlled_document_revisions(id,organisation_id,site_id,document_id,revision,alias,title,document_owner,status,effective_from,review_due_at,evidence_id,created_by)
    VALUES($1,$2,$3,$4,'1.0','Workshop safety','Synthetic library fixture','Synthetic document owner','effective',now()-interval '1 day',now()+interval '30 days',$5,$6),
      ($7,$2,$3,$8,'1.0',NULL,'Synthetic draft fixture','Synthetic document owner','draft',NULL,NULL,$9,$6)`,
  [documentRevisionId,orgA,siteA,documentId,documentEvidenceId,actorA,draftRevisionId,draftDocumentId,draftEvidenceId]);
  await admin.query('INSERT INTO vehicle_owner_accounts(id,organisation_id,issuer,subject) VALUES($1,$2,$3,$4),($5,$2,$3,$6),($7,$2,$3,$8)',[ownerAccountA,orgA,config.OIDC_ISSUER,'synthetic-owner-a',ownerAccountB,'synthetic-owner-b',ownerAccountC,'synthetic-owner-c']);
  await admin.query('INSERT INTO owner_access_approver_grants(id,organisation_id,site_id,staff_user_id,capability,granted_by,evidence_record_id,reason,valid_from,valid_until) VALUES($1,$2,$3,$4,\'vehicle-owner-access.manage\',$4,$5,\'Synthetic test-only approval authority\',now()-interval \'1 minute\',now()+interval \'1 day\')',[randomUUID(),orgA,siteA,actorA,ownerEvidence]);
  app=await createApp(config,runtime,testOidcProvider,testEvidenceServices,async token=>{
    if(token!=='synthetic-signed-logout'||!logoutEventForTest) throw new Error('Invalid synthetic logout token.');
    return logoutEventForTest;
  },admin);
    jarA=await signIn('test-advisor-a');jarB=await signIn('test-advisor-b');learningReviewerJar=await signIn('test-learning-reviewer');
});

test('vehicle learning review is separately granted, site-scoped and version-bound',async()=>{
  const base=`/api/v1/sites/${siteA}/vehicle-learning`;
  const assessment=createVehicleLearningAssessment();
  assessment.preliminary.vehicleType={state:'hypothesis',answer:'BEV',confidence:'medium',citations:[{kind:'visual',sourceTitle:'Synthetic exterior view',revisionOrDate:'2026-11-14',pageOrSection:'front view'}],uncertainty:'Badge alone is not confirmation.'};
  assessment.technicalFindings['driven-axles']={state:'documentary-confirmed',answer:'Rear axle',confidence:'medium',citations:[{kind:'oem-document',sourceTitle:'Synthetic service information',revisionOrDate:'rev 1',pageOrSection:'Drive layout'}],uncertainty:''};
  assessment.systems['hv-traction-battery']={state:'unknown',nonInvasiveLocationOrSource:'',notes:'No safe source checked yet.',confidence:'not-assessed',citations:[],uncertainty:'Requires approved documentation.'};
  assessment.learnerQuestions='Which approved source can confirm the axle?';
  const body={id:null,expectedVersion:null,title:'Synthetic drivetrain exercise',makeModel:'Sample model',assessment,status:'draft'};
  const createKey=randomUUID();
  const created=await app.inject({method:'POST',url:base,headers:headers(jarA,createKey),payload:body});
  assert.equal(created.statusCode,200,created.body);
  assert.equal(created.json().version,1);
  assert.equal(created.json().assessment.technicalFindings['driven-axles'].answer,'Rear axle');
  assert.equal(created.json().assessment.systems['hv-traction-battery'].state,'unknown');
  assert.equal(created.json().powertrain,'BEV');
  const replay=await app.inject({method:'POST',url:base,headers:headers(jarA,createKey),payload:body});
  assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,created.json().id);
  const stale=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:{...body,id:created.json().id,expectedVersion:2,title:'stale overwrite'}});
  assert.equal(stale.statusCode,409,stale.body);
  const update=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:{...body,id:created.json().id,expectedVersion:1,title:'Revised drivetrain exercise'}});
  assert.equal(update.statusCode,200,update.body);assert.equal(update.json().version,2);
  const noRoleJar=await signIn('test-reader');
  const noRoleRead=await app.inject({url:base,headers:headers(noRoleJar)});
  assert.equal(noRoleRead.statusCode,403,noRoleRead.body);assert.equal(noRoleRead.json().error.code,'AFTER_SALES_ROLE_REQUIRED');
    const noRoleLibrary=await app.inject({url:`${base}/library`,headers:headers(noRoleJar)});
    assert.equal(noRoleLibrary.statusCode,403,noRoleLibrary.body);
  const hidden=await scoped(runtime,{actorId:reader,organisationId:orgA,siteId:siteA},async client=>client.query('SELECT count(*)::int AS count FROM public.vehicle_learning_entries WHERE id=$1',[created.json().id]));
  assert.equal(hidden.rows[0]?.count,0);
  const crossSite=await app.inject({url:base,headers:headers(jarB)});
  assert.equal(crossSite.statusCode,403,crossSite.body);
  const activityPath=`${base}/${created.json().id}/activity`;
  const activity=await app.inject({url:activityPath,headers:headers(jarA)});
  assert.equal(activity.statusCode,200,activity.body);
  assert.deepEqual(activity.json().revisions.map((revision:{revisionNumber:number})=>revision.revisionNumber),[1,2]);
  assert.equal(activity.json().revisions[0].title,body.title);assert.equal(activity.json().revisions[1].title,'Revised drivetrain exercise');
  assert.equal(activity.json().revisions[0].assessment.technicalFindings['driven-axles'].answer,'Rear axle');
  assert.equal(activity.json().revisions[1].assessment.preliminary.vehicleType.state,'hypothesis');
  const invalidAssessment=structuredClone(assessment);
  invalidAssessment.technicalFindings['driven-axles']={state:'diagnostic-confirmed',answer:'Rear axle',confidence:'high',citations:[],uncertainty:''};
  const invalid=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:{...body,assessment:invalidAssessment}});
  assert.equal(invalid.statusCode,400,'diagnostic confirmation without an approved diagnostic-data source must fail');
  const commentPath=`${base}/${created.json().id}/comments`;
  const commentBody={revisionNumber:1,body:'The initial drive-axle assumption is still unconfirmed.'};
  const commentKey=randomUUID();
  const comment=await app.inject({method:'POST',url:commentPath,headers:headers(jarA,commentKey),payload:commentBody});
  assert.equal(comment.statusCode,200,comment.body);assert.equal(comment.json().revisionNumber,1);
  const commentReplay=await app.inject({method:'POST',url:commentPath,headers:headers(jarA,commentKey),payload:commentBody});
  assert.equal(commentReplay.statusCode,200,commentReplay.body);assert.equal(commentReplay.json().id,comment.json().id);
  const changedCommentReplay=await app.inject({method:'POST',url:commentPath,headers:headers(jarA,commentKey),payload:{...commentBody,body:'Changed content must conflict.'}});
  assert.equal(changedCommentReplay.statusCode,409,changedCommentReplay.body);
  const submitted=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:{...body,id:created.json().id,expectedVersion:2,status:'submitted'}});
  assert.equal(submitted.statusCode,200,submitted.body);assert.equal(submitted.json().status,'submitted');
  assert.equal(submitted.json().version,3);
    assert.equal(submitted.json().reviewDecision,null);
  const submittedComment=await app.inject({method:'POST',url:commentPath,headers:headers(jarA),payload:{revisionNumber:3,body:'Submitted version is ready for review.'}});
  assert.equal(submittedComment.statusCode,200,submittedComment.body);
  const completeActivity=await app.inject({url:activityPath,headers:headers(jarA)});
  assert.equal(completeActivity.statusCode,200,completeActivity.body);
  assert.deepEqual(completeActivity.json().comments.map((item:{revisionNumber:number})=>item.revisionNumber),[1,3]);
    const reviewQueuePath=`${base}/review-queue`;
    const noGrantQueue=await app.inject({url:reviewQueuePath,headers:headers(jarA)});
    assert.equal(noGrantQueue.statusCode,403,noGrantQueue.body);assert.equal(noGrantQueue.json().error.code,'LEARNING_REVIEW_REQUIRED');
    const reviewQueue=await app.inject({url:reviewQueuePath,headers:headers(learningReviewerJar)});
    assert.equal(reviewQueue.statusCode,200,reviewQueue.body);
    assert.deepEqual(reviewQueue.json().items.map((item:{id:string;version:number})=>({id:item.id,version:item.version})),[{id:created.json().id,version:3}]);
    const reviewerActivity=await app.inject({url:activityPath,headers:headers(learningReviewerJar)});
    assert.equal(reviewerActivity.statusCode,200,reviewerActivity.body);
    assert.deepEqual(reviewerActivity.json().revisions.map((revision:{revisionNumber:number})=>revision.revisionNumber),[3],
      'Reviewers see only submitted revisions, not earlier private drafts.');
    assert.deepEqual(reviewerActivity.json().comments.map((item:{revisionNumber:number})=>item.revisionNumber),[3]);
    const draftRevisionComment=await app.inject({method:'POST',url:commentPath,headers:headers(learningReviewerJar),payload:{revisionNumber:1,body:'Cannot comment on a private draft.'}});
    assert.equal(draftRevisionComment.statusCode,404,draftRevisionComment.body);
    const reviewerComment=await app.inject({method:'POST',url:commentPath,headers:headers(learningReviewerJar),payload:{revisionNumber:3,body:'Synthetic reviewer asks for a clearer source citation.'}});
    assert.equal(reviewerComment.statusCode,200,reviewerComment.body);
    assert.equal(reviewerComment.json().commenterId,learningReviewer);
    const reviewsPath=`${base}/${created.json().id}/reviews`;
    const reviewAttempts=await Promise.all([
      app.inject({method:'POST',url:reviewsPath,headers:headers(learningReviewerJar),payload:{expectedVersion:3,decision:'changes-requested',reason:'Clarify the supporting source for the driven axle.'}}),
      app.inject({method:'POST',url:reviewsPath,headers:headers(learningReviewerJar),payload:{expectedVersion:3,decision:'changes-requested',reason:'Add the source section for the driven axle.'}}),
    ]);
    const changesRequested=reviewAttempts.find(response=>response.statusCode===200);
    const duplicateReview=reviewAttempts.find(response=>response.statusCode===409);
    assert(changesRequested,'Exactly one concurrent review decision must be saved.');
    assert(duplicateReview,'A second decision on the same revision must conflict.');
    assert.equal(changesRequested.statusCode,200,changesRequested.body);
    assert.equal(changesRequested.json().decision,'changes-requested');
    assert.equal(changesRequested.json().shareWithAfterSales,false);
    const privateLibrary=await app.inject({url:`${base}/library`,headers:headers(jarA)});
    assert.deepEqual(privateLibrary.json().items,[],'A requested-changes revision is not shared.');
    const afterReviewQueue=await app.inject({url:reviewQueuePath,headers:headers(learningReviewerJar)});
    assert.deepEqual(afterReviewQueue.json().items,[],'A revision with a decision leaves the review queue.');
    const authorList=await app.inject({url:base,headers:headers(jarA)});
    assert.equal(authorList.json().items[0]?.reviewDecision,'changes-requested');
    const reviseAndResubmit=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:{...body,id:created.json().id,expectedVersion:3,title:'Clarified drivetrain exercise',status:'submitted'}});
    assert.equal(reviseAndResubmit.statusCode,200,reviseAndResubmit.body);
    assert.equal(reviseAndResubmit.json().version,4);
    assert.equal(reviseAndResubmit.json().reviewDecision,null);
    const resubmittedQueue=await app.inject({url:reviewQueuePath,headers:headers(learningReviewerJar)});
    assert.deepEqual(resubmittedQueue.json().items.map((item:{version:number})=>item.version),[4]);
    const reviewed=await app.inject({method:'POST',url:reviewsPath,headers:headers(learningReviewerJar),payload:{expectedVersion:4,decision:'reviewed-learning-record',reason:'The learner recorded uncertainty and cited a source for later checking.',shareWithAfterSales:true}});
    assert.equal(reviewed.statusCode,200,reviewed.body);
    assert.equal(reviewed.json().decision,'reviewed-learning-record');
    assert.equal(reviewed.json().shareWithAfterSales,true);
    const library=await app.inject({url:`${base}/library?q=sample&page=1&pageSize=10`,headers:headers(jarA)});
    assert.equal(library.statusCode,200,library.body);
    assert.equal(library.json().total,1);
    assert.equal(library.json().canManageSharing,false);
    assert.equal(library.json().items[0].assessment.technicalFindings['driven-axles'].answer,'Rear axle');
    assert.deepEqual(Object.keys(library.json().items[0]).sort(),['assessment','entryId','makeModel','reviewedAt','revisionNumber','title']);
    assert.equal('comments' in library.json().items[0],false);
    const reviewerLibrary=await app.inject({url:`${base}/library`,headers:headers(learningReviewerJar)});
    assert.equal(reviewerLibrary.json().total,1,'A reviewer can read the same-site shared learning note.');
    assert.equal(reviewerLibrary.json().canManageSharing,true);
    const runtimeLibrary=await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query('SELECT count(*)::int AS count FROM public.vehicle_learning_library_entries WHERE entry_id=$1',[created.json().id]));
    assert.equal(runtimeLibrary.rows[0]?.count,1,'RLS permits the author only through active after-sales site placement.');
    const unscopedLibrary=await scoped(runtime,{actorId:reader,organisationId:orgA,siteId:siteA},client=>client.query('SELECT count(*)::int AS count FROM public.vehicle_learning_library_entries WHERE entry_id=$1',[created.json().id]));
    assert.equal(unscopedLibrary.rows[0]?.count,0,'RLS hides library rows from a roleless identity.');
    const revokePath=`${base}/${created.json().id}/library-share/revocations`;
    const noGrantRevoke=await app.inject({method:'POST',url:revokePath,headers:headers(jarA),payload:{revisionNumber:4,reason:'A staff member without review authority cannot remove shared notes.'}});
    assert.equal(noGrantRevoke.statusCode,403,noGrantRevoke.body);
    const revokeKey=randomUUID();
    const revoked=await app.inject({method:'POST',url:revokePath,headers:headers(learningReviewerJar,revokeKey),payload:{revisionNumber:4,reason:'Synthetic privacy-correction test.'}});
    assert.equal(revoked.statusCode,200,revoked.body);
    const revocationAudit=await admin.query(`SELECT revoker_id AS "revokerId",revoker_grant_id AS "grantId",
      revoker_grant_revision AS "grantRevision",reason FROM public.vehicle_learning_library_revocations WHERE id=$1`,[revoked.json().id]);
    assert.deepEqual(revocationAudit.rows[0],{revokerId:learningReviewer,grantId:learningReviewerGrantId,grantRevision:1,reason:'Synthetic privacy-correction test.'});
    const revokeReplay=await app.inject({method:'POST',url:revokePath,headers:headers(learningReviewerJar,revokeKey),payload:{revisionNumber:4,reason:'Synthetic privacy-correction test.'}});
    assert.equal(revokeReplay.statusCode,200,revokeReplay.body);assert.equal(revokeReplay.json().id,revoked.json().id);
    const hiddenAgain=await app.inject({url:`${base}/library`,headers:headers(jarA)});
    assert.equal(hiddenAgain.json().total,0,'A reviewer can withdraw visibility without deleting the immutable reviewed snapshot.');
    const revokedRuntime=await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query('SELECT count(*)::int AS count FROM public.vehicle_learning_library_entries WHERE entry_id=$1',[created.json().id]));
    assert.equal(revokedRuntime.rows[0]?.count,0,'RLS hides a revoked library snapshot.');
    const fullyReviewed=await app.inject({url:base,headers:headers(jarA)});
    assert.equal(fullyReviewed.json().items[0]?.reviewDecision,'reviewed-learning-record');
    const finalActivity=await app.inject({url:activityPath,headers:headers(jarA)});
    assert.deepEqual(finalActivity.json().reviews.map((item:{revisionNumber:number;decision:string})=>[item.revisionNumber,item.decision]),
      [[3,'changes-requested'],[4,'reviewed-learning-record']]);
  const hiddenHistory=await scoped(runtime,{actorId:reader,organisationId:orgA,siteId:siteA},async client=>client.query(`SELECT
    (SELECT count(*)::int FROM public.vehicle_learning_entry_revisions WHERE entry_id=$1) AS revisions,
    (SELECT count(*)::int FROM public.vehicle_learning_comments WHERE entry_id=$1) AS comments`,[created.json().id]));
  assert.deepEqual(hiddenHistory.rows[0],{revisions:0,comments:0});
    const changed=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:{...body,id:created.json().id,expectedVersion:4,title:'reviewed edits blocked'}});
  assert.equal(changed.statusCode,409,changed.body);
    const selfNote=await app.inject({method:'POST',url:base,headers:headers(learningReviewerJar),payload:{...body,id:null,expectedVersion:null,title:'Synthetic reviewer self-review denial',status:'submitted'}});
    assert.equal(selfNote.statusCode,200,selfNote.body);
    const selfReview=await app.inject({method:'POST',url:`${base}/${selfNote.json().id}/reviews`,headers:headers(learningReviewerJar),payload:{expectedVersion:1,decision:'reviewed-learning-record',reason:'A reviewer cannot review their own exercise.'}});
    assert.equal(selfReview.statusCode,403,selfReview.body);assert.equal(selfReview.json().error.code,'LEARNING_SELF_REVIEW');
    const grantRevoked=await admin.query(`INSERT INTO staff_authority_grants
      (id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from,revoked_at,revoked_by,revocation_reason)
      VALUES($1,$2,$3,$4,'vehicle-learning.review',2,$5,'Synthetic test revocation record',now()-interval '1 minute',now(),$5,'Synthetic test grant revoked')`,
    [randomUUID(),orgA,siteA,learningReviewer,actorA]);
    assert.equal(grantRevoked.rowCount,1);
    const revokedQueue=await app.inject({url:reviewQueuePath,headers:headers(learningReviewerJar)});
    assert.equal(revokedQueue.statusCode,403,revokedQueue.body);
  const event=await admin.query(`SELECT event_type,aggregate_type FROM public.domain_events WHERE aggregate_id=$1 ORDER BY aggregate_version`,[created.json().id]);
    assert.deepEqual(event.rows,[{event_type:'vehicle-learning.saved',aggregate_type:'vehicle-learning-entry'},{event_type:'vehicle-learning.saved',aggregate_type:'vehicle-learning-entry'},{event_type:'vehicle-learning.submitted',aggregate_type:'vehicle-learning-entry'},{event_type:'vehicle-learning.submitted',aggregate_type:'vehicle-learning-entry'}]);
  const immutable=await assert.rejects(scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query('UPDATE public.vehicle_learning_entry_revisions SET title=$1 WHERE entry_id=$2',[`tampered`,created.json().id])));
  assert.equal(immutable,undefined);
  const immutableAssessment=await assert.rejects(scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query("UPDATE public.vehicle_learning_entry_revisions SET assessment=assessment||'{}'::jsonb WHERE entry_id=$1",[created.json().id])));
  assert.equal(immutableAssessment,undefined);
  await admin.query(`CREATE FUNCTION public.fail_vehicle_learning_outbox_test() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic vehicle-learning outbox failure'; END $$`);
  await admin.query(`CREATE TRIGGER fail_vehicle_learning_outbox_test BEFORE INSERT ON public.outbox
    FOR EACH ROW WHEN (NEW.payload->>'eventType'='vehicle-learning.saved')
    EXECUTE FUNCTION public.fail_vehicle_learning_outbox_test()`);
  try {
    const rollbackKey=randomUUID();
    const rollback=await app.inject({method:'POST',url:base,headers:headers(jarA,rollbackKey),payload:{...body,title:'Synthetic learning rollback sentinel'}});
    assert.equal(rollback.statusCode,500,rollback.body);
    const projection=await admin.query('SELECT count(*)::int AS count FROM public.vehicle_learning_entries WHERE title=$1',['Synthetic learning rollback sentinel']);
    const receipt=await admin.query('SELECT count(*)::int AS count FROM public.command_receipts WHERE actor_id=$1 AND command_id=$2',[actorA,rollbackKey]);
    const snapshots=await admin.query('SELECT count(*)::int AS count FROM public.vehicle_learning_entry_revisions WHERE title=$1',['Synthetic learning rollback sentinel']);
    assert.equal(projection.rows[0]?.count,0);assert.equal(receipt.rows[0]?.count,0);assert.equal(snapshots.rows[0]?.count,0);
  } finally {
    await admin.query('DROP TRIGGER fail_vehicle_learning_outbox_test ON public.outbox');
    await admin.query('DROP FUNCTION public.fail_vehicle_learning_outbox_test()');
  }
});

test('controlled-document library exposes only current effective site documents to active workspace roles',async()=>{
  const path=`/api/v1/sites/${siteA}/documents`;
  const response=await app.inject({url:path,headers:{cookie:Object.entries(jarA).map(([key,value])=>`${key}=${value}`).join('; ')}});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.headers['cache-control'],'no-store');
  const page=controlledDocumentListSchema.parse(response.json());
  assert.equal(page.documents.length,1);
  assert.equal(page.documents[0]?.documentId,documentId);
  assert.equal(page.documents[0]?.title,'Synthetic library fixture');
  assert.equal(page.documents[0]?.revision,'1.0');
  assert.equal(page.pagination.totalItems,1);

  const search=await app.inject({url:`${path}?q=workshop%20safety&page=1&pageSize=5`,headers:{cookie:Object.entries(jarA).map(([key,value])=>`${key}=${value}`).join('; ')}});
  assert.equal(search.statusCode,200,search.body);
  assert.equal(controlledDocumentListSchema.parse(search.json()).documents[0]?.documentId,documentId);
  const wrongSite=await app.inject({url:`/api/v1/sites/${siteB}/documents`,headers:{cookie:Object.entries(jarA).map(([key,value])=>`${key}=${value}`).join('; ')}});
  assert.equal(wrongSite.statusCode,403);
  const ownerOnly=await app.inject({url:path,headers:{cookie:'vmms_owner_session=synthetic-owner-session'}});
  assert.equal(ownerOnly.statusCode,401);
  const noWorkspaceRole=await signIn('test-reader');
  const roleDenied=await app.inject({url:path,headers:{cookie:Object.entries(noWorkspaceRole).map(([key,value])=>`${key}=${value}`).join('; ')}});
  assert.equal(roleDenied.statusCode,403);

  const draftMetadata=await app.inject({url:`/api/v1/sites/${siteA}/evidence/${draftEvidenceId}`,headers:{cookie:Object.entries(jarA).map(([key,value])=>`${key}=${value}`).join('; ')}});
  assert.equal(draftMetadata.statusCode,404,'draft evidence must not be readable through the generic evidence route');
  const readerEvents=await admin.query('SELECT document_id,revision_id,actor_id,action FROM controlled_document_read_events WHERE organisation_id=$1 AND site_id=$2 AND document_id=$3 ORDER BY created_at',[orgA,siteA,documentId]);
  assert.equal(readerEvents.rowCount,2);
  assert.deepEqual(readerEvents.rows.map(row=>row.action),['catalog-read','catalog-read']);
  assert(readerEvents.rows.every(row=>row.actor_id===actorA&&row.revision_id===documentRevisionId));
  await assert.rejects(runtime.query('UPDATE controlled_documents SET reference=reference WHERE id=$1',[documentId]),/permission denied/i);
  await assert.rejects(runtime.query('DELETE FROM controlled_document_read_events WHERE document_id=$1',[documentId]),/permission denied/i);

  const procedureBytes=Buffer.from('%PDF-1.4 synthetic controlled procedure fixture');
  const acceptedKey=`accepted/${documentEvidenceId}`;
  const fileStore:EvidenceServices['store']={
    async putQuarantine(){throw new Error('Unexpected upload in read-only document test.');},
    async readQuarantine(){throw new Error('Unexpected quarantine read in document test.');},
    async promoteAccepted(){throw new Error('Unexpected promotion in read-only document test.');},
    async readAccepted(key){
      assert.equal(key,acceptedKey);
      const bytes=new Uint8Array(procedureBytes);
      return new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);controller.close();}});
    },
    async delete(){throw new Error('Unexpected deletion in read-only document test.');},
  };
  assert.ok(fileStore);
  const downloadServices:EvidenceServices={store:fileStore,scanner:null,maxUploadBytes:1024,allowedMediaTypes:new Set(['application/pdf']),close:async()=>{}};
  const downloadApp=await createApp(config,makePool(testRuntimeUrl.toString()),testOidcProvider,downloadServices);
  try {
    const cookies={cookie:Object.entries(jarA).map(([key,value])=>`${key}=${value}`).join('; ')};
    const download=await downloadApp.inject({url:`/api/v1/sites/${siteA}/documents/${documentId}/download`,headers:cookies});
    assert.equal(download.statusCode,200,download.body);
    assert.deepEqual(download.rawPayload,procedureBytes);
    assert.equal(download.headers['cache-control'],'no-store');
    assert.equal(download.headers['x-content-type-options'],'nosniff');
    assert.equal(download.headers['content-security-policy'],'sandbox');
    assert.match(String(download.headers['content-disposition']),/attachment; filename="Synthetic library fixture\.pdf"/);
    const draftDownload=await downloadApp.inject({url:`/api/v1/sites/${siteA}/documents/${draftDocumentId}/download`,headers:cookies});
    assert.equal(draftDownload.statusCode,404);
  } finally {
    await downloadApp.close();
  }
  const readEvents=await admin.query('SELECT action FROM controlled_document_read_events WHERE document_id=$1 ORDER BY created_at',[documentId]);
  assert.deepEqual(readEvents.rows.map(row=>row.action),['catalog-read','catalog-read','file-download']);
  const evidenceEvents=await admin.query('SELECT action FROM evidence_access_events WHERE evidence_id=$1',[documentEvidenceId]);
  assert.deepEqual(evidenceEvents.rows.map(row=>row.action),['download-started']);
});

test('checklist templates stay read-only and cannot become effective without an effective source',async()=>{
  const templateId=randomUUID();
  await admin.query(`INSERT INTO public.workshop_checklist_template_revisions
    (id,organisation_id,site_id,template_code,revision,kind,vehicle_make,vehicle_model,vehicle_variant,powertrain,items)
    VALUES($1,$2,$3,'SYNTHETIC-PDI',1,'pdi','Synthetic Make','Synthetic Model','Synthetic Variant','BEV',$4::jsonb)`,
  [templateId,orgA,siteA,JSON.stringify([{id:'item-1',label:'Synthetic check'}])]);
  const visible=await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query(
    'SELECT count(*)::int AS count FROM public.workshop_checklist_template_revisions WHERE id=$1',[templateId]));
  assert.equal(visible.rows[0]?.count,1);
  await assert.rejects(scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query(
    `INSERT INTO public.workshop_checklist_template_revisions
      (id,organisation_id,site_id,template_code,revision,kind,vehicle_make,vehicle_model,vehicle_variant,powertrain,items)
     VALUES($1,$2,$3,'RUNTIME-ATTEMPT',1,'pdi','Synthetic Make','Synthetic Model','Synthetic Variant','BEV',$4::jsonb)`,
    [randomUUID(),orgA,siteA,JSON.stringify([{id:'item-1',label:'Synthetic check'}])])),/permission denied/i);
  await assert.rejects(admin.query(`INSERT INTO public.workshop_checklist_template_decisions
    (organisation_id,site_id,template_revision_id,decision,decided_by,grant_snapshot,basis,effective_from)
    VALUES($1,$2,$3,'effective',$4,'{}'::jsonb,'Synthetic source-free activation attempt',now())`,
  [orgA,siteA,templateId,actorA]),{code:'23514'});
  const decisions=await admin.query('SELECT count(*)::int AS count FROM public.workshop_checklist_template_decisions WHERE template_revision_id=$1',[templateId]);
  assert.equal(decisions.rows[0]?.count,0);
});

test('runtime cannot claim or complete evidence scans or forge accepted evidence',async()=>{
  await assert.rejects(runtime.query('SELECT * FROM public.claim_evidence_scan_job($1)',[120]),/permission denied/i);
  await assert.rejects(runtime.query(`SELECT public.complete_evidence_scan_job($1,$2,'clean',$3,'forged','1','clean',now())`,[randomUUID(),randomUUID(),'a'.repeat(64)]),/permission denied/i);
  await assert.rejects(runtime.query(`UPDATE evidence_records SET scan_state='accepted' WHERE id=$1`,[ownerEvidence]),/permission denied/i);
});

test('shared OIDC login binds tabs, issues a local session, consumes state once, and honours disablement and revocation',async()=>{
  const first=await startOidc();
  const second=await startOidc();
  const firstCookie=Object.keys(first.jar)[0];const secondCookie=Object.keys(second.jar)[0];
  assert.ok(firstCookie);assert.ok(secondCookie);assert.notEqual(firstCookie,secondCookie);

  const wrongBrowser=await completeOidc(second.state,first.jar);
  assert.equal(new URL(wrongBrowser.headers.location!).searchParams.get('signin'),'failed');
  const accepted=await completeOidc(second.state,second.jar);
  assert.equal(accepted.statusCode,302);
  assert.equal(accepted.headers.location,origin);
  const sessionJar:Record<string,string>={};updateCookies(sessionJar,accepted.headers['set-cookie']);
  assert.ok(sessionJar.vmms_session);
  assert.ok(sessionJar.vmms_csrf);
  const sessionHeaders=typeof accepted.headers['set-cookie']==='string'?[accepted.headers['set-cookie']]:accepted.headers['set-cookie']??[];
  const localSessionCookie=sessionHeaders.find(value=>value.startsWith('vmms_session='));
  assert.ok(localSessionCookie);assert.match(localSessionCookie,/HttpOnly/i);assert.match(localSessionCookie,/SameSite=Strict/i);assert.match(localSessionCookie,/Path=\/api\/v1/i);
  assert.equal(accepted.body,'');
  const current=await app.inject({url:'/api/v1/session',headers:{cookie:Object.entries(sessionJar).map(([key,value])=>`${key}=${value}`).join('; ')}});
  assert.equal(current.json().authenticated,true);
  assert.ok(current.json().sites.every((site:{timeZone?:string})=>site.timeZone==='Africa/Accra'),'The authenticated site projection must expose the configured canonical timezone.');
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-orders`,headers:{cookie:Object.entries(sessionJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).statusCode,200);
  assert.equal((await app.inject({url:`/api/v1/sites/${siteB}/work-orders`,headers:{cookie:Object.entries(sessionJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).statusCode,403);

  const activeBefore=await admin.query('SELECT active FROM staff_users WHERE id=$1',[actorA]);
  assert.equal(activeBefore.rows[0]?.active,true);
  try {
    await admin.query('UPDATE staff_users SET active=false WHERE id=$1',[actorA]);
    const disabledSession=await app.inject({url:'/api/v1/session',headers:{cookie:Object.entries(sessionJar).map(([key,value])=>`${key}=${value}`).join('; ')}});
    assert.equal(disabledSession.json().authenticated,false);
    assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-orders`,headers:{cookie:Object.entries(sessionJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).statusCode,401);
  } finally {
    await admin.query('UPDATE staff_users SET active=$2 WHERE id=$1',[actorA,activeBefore.rows[0].active]);
  }

  const signedOut=await app.inject({method:'DELETE',url:'/api/v1/session',headers:headers(sessionJar)});
  assert.equal(signedOut.statusCode,200,signedOut.body);
  const revokedSession=await app.inject({url:'/api/v1/session',headers:{cookie:Object.entries(sessionJar).map(([key,value])=>`${key}=${value}`).join('; ')}});
  assert.equal(revokedSession.json().authenticated,false);
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-orders`,headers:{cookie:Object.entries(sessionJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).statusCode,401);

  const replay=await completeOidc(second.state,second.jar);
  assert.equal(new URL(replay.headers.location!).searchParams.get('signin'),'failed');
  const unmappedFlow=await startOidc();
  const unmapped=await completeOidc(unmappedFlow.state,unmappedFlow.jar,'unmapped-code');
  assert.equal(new URL(unmapped.headers.location!).searchParams.get('signin'),'not-approved');
  assert.ok(first.state.length>=32);
});

test('RP-initiated browser sign-out clears local sessions first and consumes a bound callback once',async()=>{
  const staffFlow=await startOidc();
  const staffLogin=await completeOidc(staffFlow.state,staffFlow.jar);
  const staffJar:Record<string,string>={};updateCookies(staffJar,staffLogin.headers['set-cookie']);
  const ownerFlow=await startOwnerOidc();
  const ownerLogin=await completeOwnerOidc(ownerFlow.state,ownerFlow.jar);
  const ownerJar:Record<string,string>={...ownerFlow.jar};updateCookies(ownerJar,ownerLogin.headers['set-cookie']);
  const browserJar={...staffJar,...ownerJar};

  const legacyQueryLogout=await app.inject({url:'/api/v1/auth/oidc/logout?iss=http%3A%2F%2Flocalhost%3A8080%2Frealms%2Fraymond-gray-dev&sid=forged'});
  assert.equal(legacyQueryLogout.statusCode,404,'Unsigned sid-driven GET logout must no longer exist.');
  const csrfDenied=await app.inject({method:'POST',url:'/api/v1/auth/oidc/logout',headers:{cookie:Object.entries(browserJar).map(([key,value])=>`${key}=${value}`).join('; '),origin}});
  assert.equal(csrfDenied.statusCode,403);
  const invalidDestination=await app.inject({method:'POST',url:'/api/v1/auth/oidc/logout',headers:headers(browserJar),payload:{destination:'https://attacker.example'}});
  assert.equal(invalidDestination.statusCode,400);
  assert.equal((await app.inject({url:'/api/v1/session',headers:{cookie:Object.entries(browserJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).json().authenticated,true);

  const started=await app.inject({method:'POST',url:'/api/v1/auth/oidc/logout',headers:headers(browserJar),payload:{destination:'staff'}});
  assert.equal(started.statusCode,200,started.body);
  assert.deepEqual(started.json().centralLogout,'started');
  const logoutUrl=new URL(started.json().logoutUrl);
  const state=logoutUrl.searchParams.get('state');
  assert.ok(state);
  assert.equal(state.length,43);
  assert.equal(logoutUrl.searchParams.get('client_id'),config.OIDC_CLIENT_ID);
  assert.equal(logoutUrl.searchParams.get('post_logout_redirect_uri'),config.OIDC_LOGOUT_CALLBACK_URL);
  assert.equal(logoutUrl.searchParams.has('sid'),false);
  assert.equal(logoutUrl.searchParams.has('id_token_hint'),false);
  updateCookies(browserJar,started.headers['set-cookie']);
  assert.equal((await app.inject({url:'/api/v1/session',headers:{cookie:Object.entries(browserJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).json().authenticated,false);
  assert.equal((await app.inject({url:'/api/v1/owner/session',headers:{cookie:Object.entries(browserJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).json().authenticated,false);

  const bindingName=`vmms_oidc_logout_${state.slice(0,16)}`;
  const bindingValue=browserJar[bindingName];
  assert.ok(bindingValue);
  const callbackCookie=Object.entries(browserJar).map(([key,value])=>`${key}=${value}`).join('; ');
  const callback=await app.inject({url:`/api/v1/auth/oidc/logout/callback?state=${encodeURIComponent(state)}`,headers:{cookie:callbackCookie}});
  assert.equal(callback.statusCode,303);
  assert.equal(callback.headers.location,`${origin}/?audience=staff`);
  const clearedCookies=typeof callback.headers['set-cookie']==='string'?[callback.headers['set-cookie']]:callback.headers['set-cookie']??[];
  assert.ok(clearedCookies.some(value=>value.startsWith(`${bindingName}=`)&&/Max-Age=0/i.test(value)));
  const replay=await app.inject({url:`/api/v1/auth/oidc/logout/callback?state=${encodeURIComponent(state)}`,headers:{cookie:`${bindingName}=${bindingValue}`}});
  assert.equal(replay.statusCode,303);
  assert.equal(replay.headers.location,`${origin}/signed-out?central=unavailable`);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.oidc_rp_logout_transactions WHERE state_hash=$1',[createHash('sha256').update(state).digest('hex')])).rows[0]?.count,0);
});

test('RP sign-out preserves local revocation when the identity provider is unavailable',async()=>{
  const flow=await startOidc();
  const login=await completeOidc(flow.state,flow.jar);
  const jar:Record<string,string>={};updateCookies(jar,login.headers['set-cookie']);
  rpLogoutProviderUnavailable=true;
  try {
    const response=await app.inject({method:'POST',url:'/api/v1/auth/oidc/logout',headers:headers(jar),payload:{destination:'signed-out'}});
    assert.equal(response.statusCode,200,response.body);
    assert.deepEqual(response.json(),{localSignedOut:true,centralLogout:'unavailable',logoutUrl:null});
    updateCookies(jar,response.headers['set-cookie']);
    assert.equal((await app.inject({url:'/api/v1/session',headers:{cookie:Object.entries(jar).map(([key,value])=>`${key}=${value}`).join('; ')}})).json().authenticated,false);
  } finally { rpLogoutProviderUnavailable=false; }
});

test('central logout revokes the exact staff and owner sessions and blocks callback resurrection',async()=>{
  const flow=await startOidc();
  const completed=await completeOidc(flow.state,flow.jar);
  assert.equal(completed.statusCode,302,completed.body);
  const staffJar:Record<string,string>={};updateCookies(staffJar,completed.headers['set-cookie']);
  const subject='synthetic-advisor-subject';
  const providerSession='synthetic-session-synthetic-code';
  const issuedAt=Math.floor(Date.now()/1000);
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  const matchingOwnerHash=hash(randomUUID());
  const otherSessionHash=hash(randomUUID());
  const otherSubjectHash=hash(randomUUID());
  const otherSubjectSessionHash=hash(randomUUID());
  await admin.query(`INSERT INTO owner_sessions(token_hash,organisation_id,site_id,owner_account_id,expires_at,oidc_issuer,oidc_client_id,oidc_subject_hash,oidc_session_hash,oidc_issued_at)
    VALUES($1,$2,$3,$4,now()+interval '8 hours',$5,$6,$7,$8,to_timestamp($9)),($10,$2,$3,$4,now()+interval '8 hours',$5,$6,$7,$11,to_timestamp($9)),($12,$2,$3,$4,now()+interval '8 hours',$5,$6,$13,$8,to_timestamp($9))`,[
    matchingOwnerHash,orgA,siteA,ownerAccountA,config.OIDC_ISSUER,config.OIDC_CLIENT_ID,hash(subject),hash(providerSession),issuedAt,
    otherSessionHash,hash('different-provider-session'),otherSubjectSessionHash,otherSubjectHash,
  ]);
  logoutEventForTest={issuer:config.OIDC_ISSUER,clientId:config.OIDC_CLIENT_ID,subject,sessionId:providerSession,issuedAt:new Date(issuedAt*1000),expiresAt:new Date((issuedAt+180)*1000),jtiHash:hash(randomUUID())};
  const body=new URLSearchParams({logout_token:'synthetic-signed-logout'});
  const response=await app.inject({method:'POST',url:'/api/v1/auth/oidc/backchannel-logout',headers:{'content-type':'application/x-www-form-urlencoded'},payload:body.toString()});
  assert.equal(response.statusCode,200,response.body);
  const staffRows=await admin.query('SELECT oidc_subject_hash FROM staff_sessions WHERE oidc_subject_hash=$1',[hash(subject)]);
  assert.equal(staffRows.rowCount,0);
  const ownerRows=await admin.query('SELECT token_hash FROM owner_sessions WHERE token_hash=ANY($1::text[])',[ [matchingOwnerHash,otherSessionHash,otherSubjectSessionHash] ]);
  assert.deepEqual(new Set(ownerRows.rows.map(row=>row.token_hash)),new Set([otherSessionHash,otherSubjectSessionHash]));
  assert.equal((await app.inject({url:'/api/v1/session',headers:{cookie:Object.entries(staffJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).json().authenticated,false);
  const barred=await runtime.query('SELECT public.oidc_login_is_revoked($1,$2,$3,$4,to_timestamp($5)) AS revoked',[config.OIDC_ISSUER,config.OIDC_CLIENT_ID,hash(subject),hash(providerSession),issuedAt]);
  assert.equal(barred.rows[0]?.revoked,true);
  const laterLogin=await runtime.query('SELECT public.oidc_login_is_revoked($1,$2,$3,$4,to_timestamp($5)) AS revoked',[config.OIDC_ISSUER,config.OIDC_CLIENT_ID,hash(subject),hash('new-provider-session'),issuedAt+2]);
  assert.equal(laterLogin.rows[0]?.revoked,false);
  oidcIssuedAtOverride=issuedAt;
  try {
    const staleFlow=await startOidc();
    const staleCallback=await completeOidc(staleFlow.state,staleFlow.jar,'stale-code');
    assert.equal(new URL(staleCallback.headers.location!).searchParams.get('signin'),'failed');
  } finally { oidcIssuedAtOverride=undefined; }
  const replay=await app.inject({method:'POST',url:'/api/v1/auth/oidc/backchannel-logout',headers:{'content-type':'application/x-www-form-urlencoded'},payload:body.toString()});
  assert.equal(replay.statusCode,200,replay.body);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM oidc_logout_receipts WHERE jti_hash=$1',[logoutEventForTest.jtiHash])).rows[0]?.count,1);
  const duplicateForm=await app.inject({method:'POST',url:'/api/v1/auth/oidc/backchannel-logout',headers:{'content-type':'application/x-www-form-urlencoded'},payload:'logout_token=one&logout_token=two'});
  assert.equal(duplicateForm.statusCode,400);
  const duplicateJson=await app.inject({method:'POST',url:'/api/v1/auth/oidc/backchannel-logout',headers:{'content-type':'application/json'},payload:'{"logout_token":"one","logout_token":"two"}'});
  assert.equal(duplicateJson.statusCode,400);
  const wrongMedia=await app.inject({method:'POST',url:'/api/v1/auth/oidc/backchannel-logout',headers:{'content-type':'text/plain'},payload:'logout_token=synthetic-signed-logout'});
  assert.equal(wrongMedia.statusCode,415);

  const subjectOnly='synthetic-subject-only';
  const subjectOldHash=hash(randomUUID()),subjectNewHash=hash(randomUUID()),sessionOnlyHash=hash(randomUUID());
  const subjectOldSid=hash('subject-old-sid'),subjectNewSid=hash('subject-new-sid'),sessionOnlySid=hash('session-only-sid');
  await admin.query(`INSERT INTO staff_sessions(token_hash,user_id,expires_at,oidc_issuer,oidc_client_id,oidc_subject_hash,oidc_session_hash,oidc_issued_at)
    VALUES($1,$2,now()+interval '8 hours',$3,$4,$5,$6,to_timestamp($7)),($8,$2,now()+interval '8 hours',$3,$4,$5,$9,to_timestamp($10)),($11,$2,now()+interval '8 hours',$3,$4,$12,$13,to_timestamp($7))`,[
    subjectOldHash,actorA,config.OIDC_ISSUER,config.OIDC_CLIENT_ID,hash(subjectOnly),subjectOldSid,issuedAt,
    subjectNewHash,subjectNewSid,issuedAt+5,sessionOnlyHash,hash('different-subject'),sessionOnlySid,
  ]);
  const subjectLogout=await runtime.query('SELECT public.process_oidc_logout($1,$2,$3,NULL,to_timestamp($4),$5,to_timestamp($6)) AS accepted',[
    config.OIDC_ISSUER,config.OIDC_CLIENT_ID,hash(subjectOnly),issuedAt+4,hash(randomUUID()),issuedAt+300,
  ]);
  assert.equal(subjectLogout.rows[0]?.accepted,true);
  const subjectSessions=await admin.query('SELECT token_hash FROM staff_sessions WHERE token_hash=ANY($1::text[])',[[subjectOldHash,subjectNewHash]]);
  assert.deepEqual(subjectSessions.rows.map(row=>row.token_hash),[subjectNewHash]);
  const sidLogout=await runtime.query('SELECT public.process_oidc_logout($1,$2,NULL,$3,to_timestamp($4),$5,to_timestamp($6)) AS accepted',[
    config.OIDC_ISSUER,config.OIDC_CLIENT_ID,sessionOnlySid,issuedAt,hash(randomUUID()),issuedAt+300,
  ]);
  assert.equal(sidLogout.rows[0]?.accepted,true);
  const sessionOnly=await admin.query('SELECT token_hash FROM staff_sessions WHERE token_hash=$1',[sessionOnlyHash]);
  assert.equal(sessionOnly.rowCount,0);
  assert.equal((await admin.query('SELECT token_hash FROM staff_sessions WHERE token_hash=$1',[subjectNewHash])).rowCount,1);

  const expiredReceipt=hash(randomUUID()),activeReceipt=hash(randomUUID());
  const expiredBarrier=hash(randomUUID()),activeBarrier=hash(randomUUID());
  await admin.query('INSERT INTO oidc_logout_receipts(jti_hash,expires_at) VALUES($1,now()-interval \'1 minute\'),($2,now()+interval \'1 hour\')',[expiredReceipt,activeReceipt]);
  await admin.query(`INSERT INTO oidc_revocation_barriers(issuer,client_id,target_type,target_hash,issued_at,expires_at)
    VALUES($1,$2,'subject',$3,now()-interval '1 hour',now()-interval '1 minute'),($1,$2,'subject',$4,now()-interval '1 hour',now()+interval '1 hour')`,[config.OIDC_ISSUER,config.OIDC_CLIENT_ID,expiredBarrier,activeBarrier]);
  await runtime.query('SELECT public.cleanup_oidc_logout_state()');
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM oidc_logout_receipts WHERE jti_hash=$1',[expiredReceipt])).rows[0]?.count,0);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM oidc_logout_receipts WHERE jti_hash=$1',[activeReceipt])).rows[0]?.count,1);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM oidc_revocation_barriers WHERE target_hash=$1',[expiredBarrier])).rows[0]?.count,0);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM oidc_revocation_barriers WHERE target_hash=$1',[activeBarrier])).rows[0]?.count,1);
});

test('attempt limits use forwarded addresses only behind a configured trusted proxy',async()=>{
  const peerBucket=(address:string)=>createHmac('sha256',config.SESSION_SECRET).update(`staff-oidc-network:${address}`).digest('hex');
  const trustedAddress='198.51.100.77';
  const trusted=await app.inject({url:'/api/v1/auth/oidc/start',remoteAddress:'127.0.0.1',headers:{'x-forwarded-for':trustedAddress}});
  assert.equal(trusted.statusCode,302,trusted.body);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM login_attempts WHERE bucket=$1',[peerBucket(trustedAddress)])).rows[0]?.count,1);

  const directAddress='203.0.113.44',forgedAddress='198.51.100.99';
  const untrusted=await app.inject({url:'/api/v1/auth/oidc/start',remoteAddress:directAddress,headers:{'x-forwarded-for':forgedAddress}});
  assert.equal(untrusted.statusCode,302,untrusted.body);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM login_attempts WHERE bucket=$1',[peerBucket(directAddress)])).rows[0]?.count,1);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM login_attempts WHERE bucket=$1',[peerBucket(forgedAddress)])).rows[0]?.count,0);
});

after(async()=>{
  if (app) await app.close(); else await runtime.end();
  await admin.end();
  await owner.query(`DROP DATABASE IF EXISTS ${name}`);
  await owner.end();
});

test('runs with a real non-owner role and fails closed without transaction scope',async()=>{
  const role=await runtime.query('SELECT current_user AS name');
  assert.equal(role.rows[0].name,'vmms_runtime');
  const rows=await runtime.query('SELECT id FROM work_orders');assert.equal(rows.rowCount,0);
  const response=await app.inject('/api/v1/health');assert.equal(response.statusCode,200);
});

test('runtime identity data grants are narrow and RLS context is trusted-app defense in depth',async()=>{
  const grants=await admin.query(`SELECT has_column_privilege('vmms_runtime','public.staff_users','password_hash','SELECT') AS password_hash,
    has_table_privilege('vmms_runtime','public.staff_sessions','SELECT') AS sessions,
    has_table_privilege('vmms_runtime','public.staff_identities','SELECT') AS identities,
    has_table_privilege('vmms_runtime','public.oidc_login_transactions','SELECT') AS oidc_transactions`);
  assert.deepEqual(grants.rows[0],{password_hash:false,sessions:false,identities:false,oidc_transactions:false});
  await assert.rejects(runtime.query('SELECT password_hash FROM public.staff_users LIMIT 1'));
  await assert.rejects(runtime.query('SELECT token_hash FROM public.staff_sessions LIMIT 1'));
  await assert.rejects(runtime.query('SELECT subject FROM public.staff_identities LIMIT 1'));
  await assert.rejects(runtime.query('SELECT code_verifier FROM public.oidc_login_transactions LIMIT 1'));
  assert.equal((await runtime.query('SELECT id FROM public.staff_users')).rowCount,0);
  assert.equal((await runtime.query('SELECT user_id FROM public.memberships')).rowCount,0);
  assert.equal((await runtime.query('SELECT id FROM public.sites')).rowCount,0);

  const client=await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.organisation_id',$1,true),set_config('app.site_id',$2,true),set_config('app.actor_id',$3,true)",[orgA,siteA,actorA]);
    assert.equal((await client.query('SELECT id FROM public.sites')).rowCount,1);
    const siteMembershipCount=(await admin.query('SELECT count(*)::int AS count FROM public.memberships WHERE site_id=$1',[siteA])).rows[0].count;
    assert.equal((await client.query('SELECT user_id FROM public.memberships')).rowCount,siteMembershipCount);
    assert.equal((await client.query('SELECT user_id FROM public.memberships WHERE site_id=$1',[siteB])).rowCount,0);
    await client.query('ROLLBACK');
  } finally { client.release(); }
  assert.equal((await runtime.query('SELECT id FROM public.sites')).rowCount,0,'Pooled connection must not retain caller scope.');
});

test('session identifies only permitted sites and prevents CSRF, forged actor and unauthenticated requests',async()=>{
  const session=await app.inject({url:'/api/v1/session',headers:headers(jarA)});
  const body=z.object({authenticated:z.literal(true),sites:z.array(z.object({id:z.string(),timeZone:z.string()}))}).parse(session.json());
  assert.deepEqual(new Set(body.sites.map(s=>s.id)),new Set([siteA,siteA2]));
  assert.ok(body.sites.every(site=>site.timeZone==='Africa/Accra'));
  const noToken=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:{cookie:headers(jarA).cookie,origin},payload:intake()});assert.equal(noToken.statusCode,403);
  const missing=await app.inject(`/api/v1/sites/${siteA}/work-orders`);assert.equal(missing.statusCode,401);
  const forged=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(jarA),payload:{...intake(),actorId:actorB}});assert.equal(forged.statusCode,400);
});

test('intake persists one visit, work order and C01 with all gates pending',async()=>{
  const baselineCounts=await admin.query('SELECT (SELECT count(*)::int FROM command_receipts WHERE site_id=$1) AS receipts,(SELECT count(*)::int FROM outbox WHERE site_id=$1) AS outbox',[siteA]);
  const baseline=z.object({receipts:z.number().int(),outbox:z.number().int()}).parse(baselineCounts.rows[0]);
  const response=await create(jarA,siteA,'WVWZZZ1JZXW000001');assert.equal(response.statusCode,200,response.body);
  orderA=detailSchema.parse(response.json());assert.equal(orderA.complaints.length,1);assert.equal(orderA.complaints[0]?.reference,'C01');
  assert.equal(orderA.client?.name,'Synthetic Showroom');
  assert.equal(orderA.owner?.name,'Synthetic Vehicle Owner');assert.equal(orderA.owner?.state,'reported');
  assert.equal(orderA.visitContact?.name,'Synthetic Visit Contact');assert.notEqual(orderA.client?.id,orderA.visitContact?.id);assert.notEqual(orderA.owner?.id,orderA.visitContact?.id);
  assert.match(orderA.reference,new RegExp(`^EV-${orderA.clientCode}-00001$`));assert.equal(orderA.clientBookingSequence,1);assert.equal(orderA.warrantyStatusAtBooking,'unknown');
  await assert.rejects(scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query('UPDATE work_orders SET reference=$1 WHERE id=$2',[`BAD-${orderA.reference}`,orderA.id])),/Issued booking identity is immutable/);
  for (const field of ['client_code_snapshot','powertrain_class','warranty_status_at_booking','warranty_confirmation_note'] as const) {
    const value=field==='client_code_snapshot'?'CHANGED':field==='powertrain_class'?'ICE':field==='warranty_status_at_booking'?'confirmed':'Changed after booking';
    await assert.rejects(scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query(`UPDATE work_orders SET ${field}=$1 WHERE id=$2`,[value,orderA.id])),/Issued booking identity is immutable/);
  }
  assert.equal(orderA.vehicle.variant,'Touring');assert.equal(orderA.vehicle.powertrain,'Battery electric');
  assert.equal(orderA.vehicleHistory.length,1);assert.equal(orderA.vehicleHistory[0]?.reference,orderA.reference);
  assert.equal(orderA.vehicleHistory[0]?.clientName,'Synthetic Showroom');assert.equal(orderA.vehicleHistory[0]?.reportedOwnerName,'Synthetic Vehicle Owner');
  const clientMatches=await app.inject({url:`/api/v1/sites/${siteA}/clients/lookup?q=${encodeURIComponent(orderA.clientCode!)}`,headers:headers(jarA)});
  assert.equal(clientMatches.statusCode,200,clientMatches.body);assert.equal(clientMatches.json()[0]?.id,orderA.client?.id);
  const partyMatches=await app.inject({url:`/api/v1/sites/${siteA}/parties/lookup?q=Synthetic%20Vehicle%20Owner`,headers:headers(jarA)});
  assert.equal(partyMatches.statusCode,200,partyMatches.body);assert.equal(partyMatches.json()[0]?.id,orderA.owner?.id);
  assert.deepEqual((await app.inject({url:`/api/v1/sites/${siteA2}/parties/lookup?q=Synthetic%20Vehicle%20Owner`,headers:headers(jarA)})).json(),[]);
  const otherSiteClientMatches=await app.inject({url:`/api/v1/sites/${siteA2}/clients/lookup?q=${encodeURIComponent(orderA.clientCode!)}`,headers:headers(jarA)});
  assert.equal(otherSiteClientMatches.statusCode,200,otherSiteClientMatches.body);assert.deepEqual(otherSiteClientMatches.json(),[]);
  const vehicleContact=await admin.query('SELECT customer_id FROM vehicles WHERE id=$1',[orderA.vehicle.id]);assert.equal(vehicleContact.rows[0].customer_id,null);
  assert.equal(orderA.gates.length,5);assert.ok(orderA.gates.every(g=>g.state==='pending'));assert.equal(orderA.history.length,1);
  const firstEvent=await admin.query('SELECT actor_id,event_type,aggregate_version,reason,previous_state,new_state FROM domain_events WHERE aggregate_id=$1',[orderA.id]);
  assert.equal(firstEvent.rows[0]?.reason,'Reception draft saved; payer, reported owner, and visit contact were recorded as separate identities. Owner remains unverified.');
  assert.deepEqual(Object.keys(firstEvent.rows[0]?.new_state??{}).sort(),['clientBookingSequence','clientCode','clientPartyId','complaintId','ownerPartyId','powertrainClass','vehicleId','version','visitContactPartyId','visitId','warrantyStatusAtBooking'].sort());
  const responseB=await create(jarB,siteB,'WVWZZZ1JZXW000001');assert.equal(responseB.statusCode,200,responseB.body);orderB=detailSchema.parse(responseB.json());
  const rows=await admin.query('SELECT (SELECT count(*) FROM visits WHERE site_id=$1)::int AS visits,(SELECT count(*) FROM work_orders WHERE site_id=$1)::int AS work_orders,(SELECT count(*) FROM command_receipts WHERE site_id=$1)::int AS receipts,(SELECT count(*) FROM outbox WHERE site_id=$1)::int AS outbox',[siteA]);
  assert.deepEqual(rows.rows[0],{visits:1,work_orders:1,receipts:baseline.receipts+1,outbox:baseline.outbox+1});
});

test('checklist availability is exact-vehicle scoped, staff-only, audited and fails closed without a source-backed approval',async()=>{
  const path=`/api/v1/sites/${siteA}/work-orders/${orderA.id}/checklists`;
  const priorReads=Number((await admin.query(`SELECT count(*)::int AS count FROM sensitive_read_events
    WHERE actor_id=$1 AND site_id=$2 AND action='work-order-checklists-read-prepared'`,[actorA,siteA])).rows[0]?.count);
  const response=await app.inject({url:path,headers:headers(jarA)});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(response.json().availableTemplates,[]);
  assert.match(response.json().unavailableReason,/No current approved checklist/);
  assert.equal(response.json().vehicle.variant,'Touring');
  const readEvent=await admin.query(`SELECT count(*)::int AS count FROM sensitive_read_events
    WHERE actor_id=$1 AND site_id=$2 AND action='work-order-checklists-read-prepared'`,[actorA,siteA]);
  assert.equal(readEvent.rows[0]?.count,priorReads+1);
  const readerJar=await signIn('test-reader');
  const denied=await app.inject({url:path,headers:headers(readerJar)});
  assert.equal(denied.statusCode,403,denied.body);

  const grantId=randomUUID(),templateId=randomUUID();
  const templateCode=`SYNTHETIC-CHECKLIST-${templateId}`;
  await admin.query(`INSERT INTO public.staff_authority_grants
    (id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from,valid_until)
    VALUES($1,$2,$3,$4,'work-order.checklist-template.publish',1,$4,'Synthetic test grant',now()-interval '1 minute',now()+interval '1 hour')`,
  [grantId,orgA,siteA,actorA]);
  await admin.query(`INSERT INTO public.workshop_checklist_template_revisions
    (id,organisation_id,site_id,template_code,revision,kind,vehicle_make,vehicle_model,vehicle_variant,powertrain,items)
    VALUES($1,$2,$3,$4,1,'pdi',$5,$6,$7,$8,$9::jsonb)`,
  [templateId,orgA,siteA,templateCode,orderA.vehicle.make,orderA.vehicle.model,orderA.vehicle.variant,orderA.vehicle.powertrain,JSON.stringify([{id:'visual-review',label:'Synthetic source-backed item'}])]);
  await admin.query(`INSERT INTO public.workshop_checklist_template_sources
    (organisation_id,site_id,template_revision_id,source_revision_id) VALUES($1,$2,$3,$4)`,
  [orgA,siteA,templateId,documentRevisionId]);
  await admin.query(`INSERT INTO public.workshop_checklist_template_decisions
    (organisation_id,site_id,template_revision_id,decision,decided_by,grant_snapshot,basis,effective_from)
    VALUES($1,$2,$3,'effective',$4,$5::jsonb,'Synthetic approved exact-vehicle source',now()-interval '1 minute')`,
  [orgA,siteA,templateId,actorA,JSON.stringify({id:grantId,capability:'work-order.checklist-template.publish',grant_revision:1,staff_user_id:actorA})]);
  const approved=await app.inject({url:path,headers:headers(jarA)});
  assert.equal(approved.statusCode,200,approved.body);
  assert.deepEqual(approved.json().availableTemplates.map((template:{code:string})=>template.code),[templateCode]);

  const invalidDocumentId=randomUUID(),invalidRevisionId=randomUUID(),invalidEvidenceId=randomUUID(),invalidIntentId=randomUUID();
  await admin.query(`INSERT INTO public.controlled_documents(id,organisation_id,site_id,reference,created_by)
    VALUES($1,$2,$3,$4,$5)`,[invalidDocumentId,orgA,siteA,`SYN-NULL-TARGET-${invalidDocumentId}`,actorA]);
  await admin.query(`INSERT INTO public.evidence_upload_intents
    (id,organisation_id,site_id,created_by,command_id,purpose_kind,target_id,display_name,declared_media_type,expected_bytes,state,expires_at)
    VALUES($1,$2,$3,$4,$5,'procedure-reference',NULL,'Synthetic missing-target source.pdf','application/pdf',128,'completed',now()+interval '1 day')`,
  [invalidIntentId,orgA,siteA,actorA,randomUUID()]);
  const invalidSha='d'.repeat(64);
  await admin.query(`INSERT INTO public.evidence_records
    (id,organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,purpose_kind,target_id,display_name,declared_media_type,quarantine_key,accepted_key,upload_intent_id)
    VALUES($1,$2,$3,'accepted',$4,'application/pdf',128,$5,'procedure-reference',NULL,'Synthetic missing-target source.pdf','application/pdf',$6,$7,$8)`,
  [invalidEvidenceId,orgA,siteA,invalidSha,actorA,`quarantine/${invalidEvidenceId}`,`accepted/${invalidEvidenceId}`,invalidIntentId]);
  await admin.query(`INSERT INTO public.evidence_scan_attempts
    (id,organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code,scanned_at)
    VALUES($1,$2,$3,$4,1,'clean',$5,'synthetic-test','1','clean',now())`,[randomUUID(),orgA,siteA,invalidEvidenceId,invalidSha]);
  await admin.query(`INSERT INTO public.controlled_document_revisions
    (id,organisation_id,site_id,document_id,revision,title,document_owner,status,effective_from,evidence_id,created_by)
    VALUES($1,$2,$3,$4,'1.0','Synthetic null-target source','Synthetic owner','effective',now()-interval '1 day',$5,$6)`,
  [invalidRevisionId,orgA,siteA,invalidDocumentId,invalidEvidenceId,actorA]);
  await assert.rejects(admin.query(`INSERT INTO public.workshop_checklist_template_sources
    (organisation_id,site_id,template_revision_id,source_revision_id) VALUES($1,$2,$3,$4)`,
  [orgA,siteA,templateId,invalidRevisionId]),{code:'23514'});
  const invalidTemplateId=randomUUID(),invalidTemplateCode=`SYNTHETIC-NULL-TARGET-${invalidTemplateId}`;
  await admin.query(`INSERT INTO public.workshop_checklist_template_revisions
    (id,organisation_id,site_id,template_code,revision,kind,vehicle_make,vehicle_model,vehicle_variant,powertrain,items)
    VALUES($1,$2,$3,$4,1,'pdi',$5,$6,$7,$8,$9::jsonb)`,
  [invalidTemplateId,orgA,siteA,invalidTemplateCode,orderA.vehicle.make,orderA.vehicle.model,orderA.vehicle.variant,orderA.vehicle.powertrain,JSON.stringify([{id:'invalid-source',label:'Must not become available'}])]);
  await admin.query(`INSERT INTO public.workshop_checklist_template_sources
    (organisation_id,site_id,template_revision_id,source_revision_id) VALUES($1,$2,$3,$4)`,
  [orgA,siteA,invalidTemplateId,invalidRevisionId]);
  await admin.query(`INSERT INTO public.workshop_checklist_template_decisions
    (organisation_id,site_id,template_revision_id,decision,decided_by,grant_snapshot,basis,effective_from)
    VALUES($1,$2,$3,'effective',$4,$5::jsonb,'Synthetic null-target source test',now()-interval '1 minute')`,
  [orgA,siteA,invalidTemplateId,actorA,JSON.stringify({id:grantId,capability:'work-order.checklist-template.publish',grant_revision:1,staff_user_id:actorA})]);
  const wrongEvidenceTarget=await app.inject({url:path,headers:headers(jarA)});
  assert.equal(wrongEvidenceTarget.statusCode,200,wrongEvidenceTarget.body);
  assert.deepEqual(wrongEvidenceTarget.json().availableTemplates.map((template:{code:string})=>template.code),[templateCode],
    'Evidence with a missing document target must not make its template available.');

  const salesUser=randomUUID(),salesPlacement=randomUUID();
  await admin.query('INSERT INTO public.staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,NULL)',
    [salesUser,`test-sales-checklist-${salesUser}`,'Synthetic Sales Checklist Reader']);
  await admin.query('INSERT INTO public.memberships(user_id,site_id,can_write) VALUES($1,$2,false)',[salesUser,siteA]);
  await admin.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
    VALUES($1,$2,$3,'staff-role-placement')`,[salesPlacement,orgA,siteA]);
  await admin.query(`INSERT INTO public.staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
    VALUES($1,$2,$3,$4,'sales-representative',$5,$5)`,[salesPlacement,orgA,siteA,salesUser,actorA]);
  await admin.query(`INSERT INTO public.staff_role_placement_history
    (organisation_id,site_id,placement_id,revision,staff_user_id,role_code,state,changed_by)
    VALUES($1,$2,$3,1,$4,'sales-representative','active',$5)`,[orgA,siteA,salesPlacement,salesUser,actorA]);
  await assert.rejects(readWorkOrderChecklists(runtime,{actorId:salesUser,organisationId:orgA,siteId:siteA},orderA.id,randomUUID(),{page:1,pageSize:25}),
    (error:unknown)=>(error as {code?:string}).code==='AFTER_SALES_ROLE_REQUIRED');
});

test('routine checklist outcomes require an assigned task and complete source binding',async()=>{
  const templateId=randomUUID(),checklistId=randomUUID(),itemId=randomUUID();
  await admin.query(`INSERT INTO public.workshop_checklist_template_revisions
    (id,organisation_id,site_id,template_code,revision,kind,vehicle_make,vehicle_model,vehicle_variant,powertrain,items)
    VALUES($1,$2,$3,$4,1,'pdi',$5,$6,$7,'BEV',$8::jsonb)`,
  [templateId,orgA,siteA,`SYNTHETIC-PDI-${templateId}`,orderA.vehicle.make,orderA.vehicle.model,orderA.vehicle.variant,JSON.stringify([{id:'underbody',label:'Synthetic checklist item'}])]);
  await admin.query(`INSERT INTO public.work_order_checklists
    (id,organisation_id,site_id,work_order_id,template_revision_id,kind,state,version,schedule_basis,odometer_at_start_km,vehicle_snapshot,created_by)
    VALUES($1,$2,$3,$4,$5,'pdi','draft',1,'unknown',$6,$7::jsonb,$8)`,
  [checklistId,orgA,siteA,orderA.id,templateId,orderA.odometerKm,JSON.stringify({vin:orderA.vehicle.vin,make:orderA.vehicle.make,model:orderA.vehicle.model,variant:orderA.vehicle.variant,powertrain:orderA.vehicle.powertrain}),actorA]);
  await admin.query(`INSERT INTO public.work_order_checklist_items
    (id,organisation_id,site_id,work_order_id,checklist_id,item_code,ordinal,definition_snapshot)
    VALUES($1,$2,$3,$4,$5,'underbody',1,$6::jsonb)`,
  [itemId,orgA,siteA,orderA.id,checklistId,JSON.stringify({label:'Synthetic checklist item'})]);
  await assert.rejects(admin.query(`INSERT INTO public.work_order_checklist_item_revisions
    (organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,revision,result,actor_id,actor_placement_id)
    VALUES($1,$2,$3,$4,$5,1,'not-checked',$6,$7)`,[orgA,siteA,orderA.id,checklistId,itemId,actorA,hscPlacementId]),{code:'23514'});
  await assert.rejects(admin.query(`INSERT INTO public.work_order_checklist_item_revisions
    (organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,revision,result,reason,actor_id,actor_placement_id)
    VALUES($1,$2,$3,$4,$5,1,'not-checked','Synthetic draft has no approved source',$6,$7)`,[orgA,siteA,orderA.id,checklistId,itemId,actorA,hscPlacementId]),{code:'23514'});
  const visible=await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query(
    `SELECT c.version,i.item_code,r.result,r.reason FROM public.work_order_checklists c
      JOIN public.work_order_checklist_items i ON i.organisation_id=c.organisation_id AND i.site_id=c.site_id AND i.work_order_id=c.work_order_id AND i.checklist_id=c.id
      JOIN public.work_order_checklist_item_revisions r ON r.organisation_id=i.organisation_id AND r.site_id=i.site_id AND r.work_order_id=i.work_order_id AND r.checklist_id=i.checklist_id AND r.checklist_item_id=i.id
      WHERE c.id=$1`,[checklistId]));
  assert.deepEqual(visible.rows,[],'PDI observations must not be written as workshop routine-maintenance outcomes.');
  await assert.rejects(scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query(
    `UPDATE public.work_order_checklists SET state='approved',version=version+1 WHERE id=$1`,[checklistId])),/permission denied/i);
  await assert.rejects(admin.query('UPDATE public.work_order_checklist_items SET item_code=$1 WHERE id=$2',['changed',itemId]),{code:'55000'});
  const outcomePath=`/api/v1/sites/${siteA}/my-tasks/${orderA.id}/${randomUUID()}/checklists/${checklistId}/items/${itemId}/outcomes`;
  const denied=await app.inject({method:'POST',url:outcomePath,headers:headers(jarA),payload:{
    expectedChecklistVersion:1,expectedWorkPlanRevisionId:randomUUID(),expectedAssignmentRevision:1,
    result:'not-checked',reason:'Synthetic assignment missing.',applicabilityReason:null,comments:null,measurement:null,evidenceIds:[],supersedesRevisionId:null,correctionReason:null,
  }});
  assert.equal(denied.statusCode,409,denied.body);
  assert.equal(denied.json().error.code,'CURRENT_TASK_ASSIGNMENT_REQUIRED');
});

test('checklist outcome rules accept only source-bound synthetic requirements and reject missing safeguards',async()=>{
  const valid=checklistOutcomeInputSchema.parse({expectedChecklistVersion:1,expectedWorkPlanRevisionId:randomUUID(),expectedAssignmentRevision:2,
    result:'completed',reason:null,applicabilityReason:null,comments:'Synthetic observed value.',
    measurement:{field:'tire-pressure',value:'240',unit:'kPa'},evidenceIds:[randomUUID()],supersedesRevisionId:null,correctionReason:null});
  assert.equal(validateOutcomeAgainstItemRules(valid,{id:'synthetic-pressure',label:'Synthetic configured measurement',
    requiredQualifications:['EV-MAINTENANCE-LEVEL-1'],evidenceRequired:true,measurementRule:{field:'tire-pressure',unit:'kPa',required:true}}).measurementRule?.unit,'kPa');
  assert.throws(()=>validateOutcomeAgainstItemRules({...valid,evidenceIds:[]},{id:'synthetic-pressure',requiredQualifications:['EV-MAINTENANCE-LEVEL-1'],evidenceRequired:true}),
    (error:unknown)=>(error as {code?:string}).code==='CHECKLIST_EVIDENCE_REQUIRED');
  assert.throws(()=>validateOutcomeAgainstItemRules({...valid,measurement:null},{id:'synthetic-pressure',requiredQualifications:['EV-MAINTENANCE-LEVEL-1'],measurementRule:{field:'tire-pressure',unit:'kPa',required:true}}),
    (error:unknown)=>(error as {code?:string}).code==='CHECKLIST_MEASUREMENT_REQUIRED');
  assert.throws(()=>validateOutcomeAgainstItemRules({...valid,result:'not-applicable',reason:'The procedure does not apply.',applicabilityReason:'Vehicle variant excludes this step.'},
    {id:'synthetic-pressure',requiredQualifications:['EV-MAINTENANCE-LEVEL-1']}),
    (error:unknown)=>(error as {code?:string}).code==='CHECKLIST_NOT_APPLICABLE_NOT_ALLOWED');
  assert.throws(()=>validateOutcomeAgainstItemRules(valid,{id:'synthetic-pressure'}),
    (error:unknown)=>(error as {code?:string}).code==='CHECKLIST_MODEL_RULES_INCOMPLETE');
  for (const result of ['completed','failed','not-checked','not-completed','blocked','not-applicable'] as const) {
    const candidate=checklistOutcomeInputSchema.parse({...valid,result,
      reason:result==='completed'?null:`Synthetic ${result} reason.`,
      applicabilityReason:result==='not-applicable'?'Synthetic applicability review.':null,
      measurement:null,evidenceIds:[]});
    assert.equal(validateOutcomeAgainstItemRules(candidate,{id:'synthetic-outcome',requiredQualifications:['EV-MAINTENANCE-LEVEL-1'],notApplicableAllowed:true}).id,'synthetic-outcome');
  }
  assert.equal(checklistOutcomeInputSchema.safeParse({...valid,result:'not-applicable',reason:'Needs an applicability reason.',applicabilityReason:null}).success,false);
});

test('repeat intake reuses explicitly selected same-site parties and rejects cross-site selection',async()=>{
  const repeatPayload={...intake('WVWZZZ1JZXW000001'),client:{kind:'existing' as const,partyId:orderA.client!.id},owner:{kind:'existing' as const,partyId:orderA.owner!.id},visitContact:{kind:'existing' as const,partyId:orderA.visitContact!.id},vehicle:{kind:'existing' as const,vehicleId:orderA.vehicle.id},complaint:'Synthetic repeat using explicit existing parties.'};
  const repeat=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(jarA),payload:repeatPayload});
  assert.equal(repeat.statusCode,200,repeat.body);const repeatOrder=detailSchema.parse(repeat.json());
  assert.equal(repeatOrder.owner?.id,orderA.owner?.id);assert.equal(repeatOrder.visitContact?.id,orderA.visitContact?.id);
  const accessScopes=await admin.query('SELECT count(*)::int AS count FROM vehicle_owner_access_scopes WHERE vehicle_id=$1',[orderA.vehicle.id]);assert.equal(accessScopes.rows[0].count,0);
  const irrelevantFields=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(jarA),payload:{...repeatPayload,salesRepresentative:'Not used',clientSatisfaction:'Not collected',communicationsConsent:true}});
  assert.equal(irrelevantFields.statusCode,400,irrelevantFields.body);
  assert.equal(irrelevantFields.json().error.code,'VALIDATION');
  const crossSiteParty=await app.inject({method:'POST',url:`/api/v1/sites/${siteA2}/intake-drafts`,headers:headers(jarA),payload:{...intake('WVWZZZ1JZXW000019'),owner:{kind:'existing',partyId:orderA.owner!.id}}});
  assert.equal(crossSiteParty.statusCode,404,crossSiteParty.body);
});

test('work-order detail reads append scoped metadata events for writable and read-only staff only',async()=>{
  const beforeCount=Number((await admin.query('SELECT count(*)::int AS count FROM work_order_read_events WHERE work_order_id=$1',[orderA.id])).rows[0]?.count);
  const readerJar=await signIn('test-reader');
  const first=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(jarA)});
  const second=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(readerJar)});
  assert.equal(first.statusCode,200,first.body);assert.equal(second.statusCode,200,second.body);
  const events=await admin.query('SELECT actor_id,action,projection_revision,work_order_version,request_id FROM work_order_read_events WHERE work_order_id=$1 ORDER BY created_at DESC LIMIT 2',[orderA.id]);
  assert.equal(events.rows.length,2);assert.deepEqual(new Set(events.rows.map(row=>row.actor_id)),new Set([actorA,reader]));
  assert.ok(events.rows.every(row=>row.action==='detail-read-prepared'&&row.projection_revision===1&&row.work_order_version===orderA.version));
  assert.notEqual(events.rows[0]?.request_id,events.rows[1]?.request_id);
  const denied=await app.inject({url:`/api/v1/sites/${siteB}/work-orders/${orderA.id}`,headers:headers(jarB)});
  assert.equal(denied.statusCode,404);
  const afterCount=Number((await admin.query('SELECT count(*)::int AS count FROM work_order_read_events WHERE work_order_id=$1',[orderA.id])).rows[0]?.count);
  assert.equal(afterCount,beforeCount+2);
  await assert.rejects(runtime.query('SELECT * FROM public.work_order_read_events'),/permission denied/i);
  await assert.rejects(runtime.query('UPDATE public.work_order_read_events SET action=action'),/permission denied/i);
  await assert.rejects(runtime.query('DELETE FROM public.work_order_read_events'),/permission denied/i);
  await admin.query(`CREATE FUNCTION public.fail_read_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`);
  await admin.query('CREATE TRIGGER fail_read_audit_test BEFORE INSERT ON public.work_order_read_events FOR EACH ROW EXECUTE FUNCTION public.fail_read_audit_test()');
  try {
    const failed=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(jarA)});
    assert.equal(failed.statusCode,500);assert.equal(JSON.stringify(failed.json()).includes('Synthetic Showroom'),false);
    const unchanged=Number((await admin.query('SELECT count(*)::int AS count FROM work_order_read_events WHERE work_order_id=$1',[orderA.id])).rows[0]?.count);
    assert.equal(unchanged,afterCount);
  } finally {
    await admin.query('DROP TRIGGER fail_read_audit_test ON public.work_order_read_events');
    await admin.query('DROP FUNCTION public.fail_read_audit_test()');
  }
});

test('staff queues and directory lookups audit returned metadata without retaining query values',async()=>{
  const readerJar=await signIn('test-reader');
  const searchSentinel='AUDIT-QUERY-SENTINEL-92741';
  const vinSentinel='WVWZZZ1JZXW000001';
  const clientQuery=orderA.client!.name;
  const ownerQuery=orderA.owner!.name;
  const before=Number((await admin.query('SELECT count(*)::int AS count FROM sensitive_read_events WHERE site_id=$1',[siteA])).rows[0]?.count);
  const actions=['work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared','party-lookup-read-prepared'];
  const requests=[
    {action:actions[0],path:`/api/v1/sites/${siteA}/work-orders?${new URLSearchParams({q:orderA.reference,pageSize:'100'})}`,count:1},
    {action:actions[1],path:`/api/v1/sites/${siteA}/vehicles/lookup?${new URLSearchParams({vin:vinSentinel})}`,count:1},
    {action:actions[2],path:`/api/v1/sites/${siteA}/clients/lookup?${new URLSearchParams({q:clientQuery})}`,count:1},
    {action:actions[3],path:`/api/v1/sites/${siteA}/parties/lookup?${new URLSearchParams({q:ownerQuery})}`,count:1},
    {action:actions[0],path:`/api/v1/sites/${siteA}/work-orders?${new URLSearchParams({q:searchSentinel})}`,count:0},
    {action:actions[1],path:`/api/v1/sites/${siteA}/vehicles/lookup?vin=01234567890123456`,count:0},
    {action:actions[2],path:`/api/v1/sites/${siteA}/clients/lookup?${new URLSearchParams({q:searchSentinel})}`,count:0},
    {action:actions[3],path:`/api/v1/sites/${siteA}/parties/lookup?${new URLSearchParams({q:searchSentinel})}`,count:0},
  ];
  for (const jar of [jarA,readerJar]) {
    for (const [index,request] of requests.entries()) {
      const response=await app.inject({url:request.path,headers:{...headers(jar),...(jar===jarA&&index===0?{'x-request-id':'caller-controlled-value','request-id':'also-caller-controlled'}:{})}});
      assert.equal(response.statusCode,200,response.body);
    }
  }
  const failedScope=await app.inject({url:`/api/v1/sites/${siteB}/clients/lookup?q=${encodeURIComponent(searchSentinel)}`,headers:headers(jarA)});
  assert.ok([403,404].includes(failedScope.statusCode),failedScope.body);
  const malformed=await app.inject({url:`/api/v1/sites/${siteA}/vehicles/lookup?vin=invalid`,headers:headers(readerJar)});
  assert.equal(malformed.statusCode,400);
  const unauthenticated=await app.inject({url:`/api/v1/sites/${siteA}/clients/lookup?q=${encodeURIComponent(searchSentinel)}`});
  assert.equal(unauthenticated.statusCode,401);
  const countAfter=Number((await admin.query('SELECT count(*)::int AS count FROM sensitive_read_events WHERE site_id=$1',[siteA])).rows[0]?.count);
  assert.equal(countAfter,before+requests.length*2);
  const events=await admin.query(`SELECT actor_id,action,projection_revision,result_count,request_id
    FROM sensitive_read_events WHERE site_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,[siteA,requests.length*2]);
  assert.equal(events.rows.length,requests.length*2);
  for (const event of events.rows) {
    const matching=requests.find(request=>request.action===event.action&&request.count===event.result_count);
    assert.ok(matching,`unexpected event ${JSON.stringify(event)}`);
    assert.equal(event.projection_revision,1);
    assert.match(event.request_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.ok([actorA,reader].includes(event.actor_id));
  }
  for (const request of requests) assert.equal(events.rows.filter(event=>event.action===request.action&&event.result_count===request.count).length,2);
  for (const actor of [actorA,reader]) assert.equal(events.rows.filter(event=>event.actor_id===actor).length,requests.length);
  assert.equal(new Set(events.rows.map(event=>event.request_id)).size,events.rows.length);
  assert.equal(JSON.stringify(events.rows).includes(searchSentinel),false);
  assert.equal(JSON.stringify(events.rows).includes(vinSentinel),false);
  assert.equal(JSON.stringify(events.rows).includes(clientQuery),false);
  assert.equal(JSON.stringify(events.rows).includes(ownerQuery),false);
  await assert.rejects(runtime.query('SELECT * FROM public.sensitive_read_events'),/permission denied/i);
  await assert.rejects(runtime.query('UPDATE public.sensitive_read_events SET action=action'),/permission denied/i);
  await assert.rejects(runtime.query('DELETE FROM public.sensitive_read_events'),/permission denied/i);
  await assert.rejects(runtime.query('TRUNCATE public.sensitive_read_events'),/permission denied/i);
  await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>assert.rejects(client.query(`INSERT INTO public.sensitive_read_events
    (organisation_id,site_id,actor_id,action,projection_revision,result_count,request_id,created_at)
    VALUES($1,$2,$3,'client-lookup-read-prepared',1,0,$4,now())`,[orgA,siteA,actorA,randomUUID()]),/permission denied/i));
  await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>assert.rejects(client.query(`INSERT INTO public.sensitive_read_events
    (organisation_id,site_id,actor_id,action,projection_revision,result_count,request_id)
    VALUES($1,$2,$3,'client-lookup-read-prepared',1,0,$4)`,[orgB,siteB,actorB,randomUUID()]),/row-level security/i));
  await admin.query(`CREATE FUNCTION public.fail_sensitive_read_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic sensitive read audit failure'; END $$`);
  await admin.query('CREATE TRIGGER fail_sensitive_read_audit_test AFTER INSERT ON public.sensitive_read_events FOR EACH ROW EXECUTE FUNCTION public.fail_sensitive_read_audit_test()');
  try {
    const failed=await app.inject({url:`/api/v1/sites/${siteA}/clients/lookup?${new URLSearchParams({q:clientQuery})}`,headers:headers(jarA)});
    assert.equal(failed.statusCode,500);
    assert.equal(JSON.stringify(failed.json()).includes(clientQuery),false);
    const unchanged=Number((await admin.query('SELECT count(*)::int AS count FROM sensitive_read_events WHERE site_id=$1',[siteA])).rows[0]?.count);
    assert.equal(unchanged,countAfter);
  } finally {
    await admin.query('DROP TRIGGER fail_sensitive_read_audit_test ON public.sensitive_read_events');
    await admin.query('DROP FUNCTION public.fail_sensitive_read_audit_test()');
  }
});

test('a site read waits for an in-flight membership revocation and then denies without auditing',async()=>{
  const readerJar=await signIn('test-reader');
  const before=Number((await admin.query('SELECT count(*)::int AS count FROM sensitive_read_events WHERE actor_id=$1 AND site_id=$2',[reader,siteA])).rows[0]?.count);
  const blocker=await admin.connect();
  let committed=false;
  let settled=false;
  let pendingRead:Promise<{statusCode:number;body:string}>|undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('UPDATE memberships SET active=false WHERE user_id=$1 AND site_id=$2',[reader,siteA]);
    const read=app.inject({url:`/api/v1/sites/${siteA}/clients/lookup?q=${encodeURIComponent(orderA.client!.name)}`,headers:headers(readerJar)}).then(response=>{settled=true;return response;});
    pendingRead=read;
    let waitingForRevocation=false;
    for (let attempt=0;attempt<200&&!waitingForRevocation;attempt++) {
      const waiting=await admin.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%lock_membership%'`);
      waitingForRevocation=Number(waiting.rows[0]?.count)>0;
      if (!waitingForRevocation) await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waitingForRevocation,true,'The authenticated read should acquire the membership lock inside its transaction.');
    assert.equal(settled,false,'The read must wait behind the pending membership update lock.');
    await blocker.query('COMMIT');
    committed=true;
    const denied=await read;
    assert.ok([401,403].includes(denied.statusCode),denied.body);
    const after=Number((await admin.query('SELECT count(*)::int AS count FROM sensitive_read_events WHERE actor_id=$1 AND site_id=$2',[reader,siteA])).rows[0]?.count);
    assert.equal(after,before);
  } finally {
    if (!committed) await blocker.query('ROLLBACK');
    if (!settled&&pendingRead) await pendingRead;
    await admin.query('UPDATE memberships SET active=true WHERE user_id=$1 AND site_id=$2',[reader,siteA]);
    blocker.release();
  }
});

test('work-order queue paginates the site-filtered result set and keeps search scope',async()=>{
  const extra=await create(jarA,siteA,'WVWZZZ1JZXW000121');assert.equal(extra.statusCode,200,extra.body);
  const first=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?page=1&pageSize=1`,headers:headers(jarA)});
  const second=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?page=2&pageSize=1`,headers:headers(jarA)});
  const parseList=(response:typeof first)=>z.object({items:z.array(z.object({id:z.string().uuid()})),pagination:z.object({page:z.number(),pageSize:z.number(),totalItems:z.number(),totalPages:z.number()})}).parse(response.json());
  const firstPage=parseList(first),secondPage=parseList(second);
  assert.equal(first.statusCode,200,first.body);assert.equal(second.statusCode,200,second.body);
  assert.equal(firstPage.pagination.page,1);assert.equal(secondPage.pagination.page,2);
  assert.equal(firstPage.pagination.pageSize,1);assert.equal(firstPage.pagination.totalItems,3);assert.equal(firstPage.pagination.totalPages,3);
  assert.equal(firstPage.items.length,1);assert.equal(secondPage.items.length,1);
  assert.notEqual(firstPage.items[0]?.id,secondPage.items[0]?.id);
  const filtered=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?q=${encodeURIComponent('WVWZZZ1JZXW000121')}&pageSize=25`,headers:headers(jarA)});
  assert.equal(filtered.statusCode,200,filtered.body);assert.deepEqual(filtered.json().items.map((item:{id:string})=>item.id),[detailSchema.parse(extra.json()).id]);
  const heldOrder=detailSchema.parse(extra.json());
  const held=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${heldOrder.id}/holds`,headers:headers(jarA),payload:{
    expectedVersion:heldOrder.version,scope:{kind:'workOrder'},category:'safety',severity:'stop',reason:'Synthetic queue filter hold.',source:'Synthetic queue filter test',
  }});
  assert.equal(held.statusCode,200,held.body);
  const heldQueue=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?queue=held`,headers:headers(jarA)});
  assert.equal(heldQueue.statusCode,200,heldQueue.body);
  assert.deepEqual(heldQueue.json().items.map((item:{id:string})=>item.id),[heldOrder.id]);
  const invalidQueue=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?queue=unknown`,headers:headers(jarA)});
  assert.equal(invalidQueue.statusCode,400);
  const otherSite=await app.inject({url:`/api/v1/sites/${siteA2}/work-orders?page=1&pageSize=1`,headers:headers(jarA)});
  assert.equal(otherSite.statusCode,200,otherSite.body);assert.equal(otherSite.json().pagination.totalItems,0);assert.deepEqual(otherSite.json().items,[]);
  const invalidPage=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?page=0`,headers:headers(jarA)});
  assert.equal(invalidPage.statusCode,400);
});

test('team lead assignment requires scoped Operations grant and active class qualification; replay is idempotent',async()=>{
  if(!orderA){
    const created=await create(jarA,siteA,'WVWZZZ1JZXW000321');
    assert.equal(created.statusCode,200,created.body);orderA=detailSchema.parse(created.json());
  }
  const lead=randomUUID();
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[lead,`test-lead-${lead}`,'Synthetic EV Lead',await hashPassword(password)]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true)',[lead,siteA]);
  if(orderA.complaints.length===0){
    const complaint=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/complaints`,headers:headers(jarA),payload:{expectedVersion:orderA.version,wording:'Synthetic proposed work for team-lead assignment coverage.'}});
    assert.equal(complaint.statusCode,200,complaint.body);orderA=detailSchema.parse(complaint.json());
  }
  const initialTask=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/tasks`,headers:headers(jarA),payload:{expectedVersion:orderA.version,complaintId:orderA.complaints[0]!.id,title:'Synthetic proposed inspection'}});
  assert.equal(initialTask.statusCode,200,initialTask.body);orderA=detailSchema.parse(initialTask.json());
  const reviewUrl=`/api/v1/sites/${siteA}/work-orders/${orderA.id}/operations-review`;
  const crossSiteReview=await app.inject({method:'POST',url:`/api/v1/sites/${siteB}/work-orders/${orderA.id}/operations-review`,headers:headers(jarB),payload:{expectedVersion:orderA.version,notes:'Cross-site synthetic review'}});
  assert.equal(crossSiteReview.statusCode,404,crossSiteReview.body);
  const reviewWithoutAuthority=await app.inject({method:'POST',url:reviewUrl,headers:headers(jarA),payload:{expectedVersion:orderA.version,notes:'Synthetic review'}});
  assert.equal(reviewWithoutAuthority.statusCode,403,reviewWithoutAuthority.body);assert.equal(reviewWithoutAuthority.json().error.code,'AUTHORITY_REQUIRED');
  const assignmentBeforeReview=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/team-lead-assignment`,headers:headers(jarA),payload:{expectedVersion:orderA.version,operationsReviewId:randomUUID(),leadUserId:lead,reason:'Synthetic operations assignment'}});
  assert.equal(assignmentBeforeReview.statusCode,409,assignmentBeforeReview.body);assert.equal(assignmentBeforeReview.json().error.code,'OPERATIONS_REVIEW_REQUIRED');
  await admin.query('INSERT INTO staff_authority_grants(id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from) VALUES($1,$2,$3,$4,$5,1,$6,$7,now()-interval \'1 minute\')',[randomUUID(),orgA,siteA,actorA,'work-order.operations-review',actorA,'Synthetic test-only review grant']);
  const reviewBody={expectedVersion:orderA.version,notes:'Synthetic Operations routing review'};
  const reviewCommandId=randomUUID();
  const reviewResponse=await app.inject({method:'POST',url:reviewUrl,headers:headers(jarA,reviewCommandId),payload:reviewBody});
  assert.equal(reviewResponse.statusCode,200,reviewResponse.body);
  const reviewResult=z.object({reviewId:z.string().uuid(),reviewedWorkOrderVersion:z.number(),version:z.number(),reviewerName:z.string()}).parse(reviewResponse.json());
  assert.equal(reviewResult.reviewedWorkOrderVersion,orderA.version+1);assert.equal(reviewResult.version,orderA.version+1);assert.equal(reviewResult.reviewerName,'Advisor A');
  const reviewReplay=await app.inject({method:'POST',url:reviewUrl,headers:headers(jarA,reviewCommandId),payload:reviewBody});
  assert.equal(reviewReplay.statusCode,200,reviewReplay.body);assert.deepEqual(reviewReplay.json(),reviewResponse.json());
  const changedReviewReplay=await app.inject({method:'POST',url:reviewUrl,headers:headers(jarA,reviewCommandId),payload:{...reviewBody,notes:'Changed replay must conflict'}});
  assert.equal(changedReviewReplay.statusCode,409,changedReviewReplay.body);
  const staleReview=await app.inject({method:'POST',url:reviewUrl,headers:headers(jarA),payload:{expectedVersion:orderA.version,notes:'Stale synthetic review'}});
  assert.equal(staleReview.statusCode,409,staleReview.body);assert.equal(staleReview.json().error.code,'STALE_VERSION');
  const reviewedDetail=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(jarA)});
  assert.equal(reviewedDetail.statusCode,200,reviewedDetail.body);assert.equal(reviewedDetail.json().operationsReview.isCurrent,true);assert.equal(reviewedDetail.json().canReviewOperations,true);
  const persistedReview=await admin.query('SELECT authority_decision,reviewed_work_order_version FROM work_order_operations_reviews WHERE id=$1',[reviewResult.reviewId]);
  assert.equal(persistedReview.rows[0].reviewed_work_order_version,reviewResult.reviewedWorkOrderVersion);
  assert.equal(persistedReview.rows[0].authority_decision.grant.capability,'work-order.operations-review');
  const assignmentVersion=orderA.version+1;
  orderA.version=assignmentVersion;
  const body={expectedVersion:assignmentVersion,operationsReviewId:reviewResult.reviewId,leadUserId:lead,reason:'Synthetic operations assignment'};
  const commandId=randomUUID();
  const url=`/api/v1/sites/${siteA}/work-orders/${orderA.id}/team-lead-assignment`;
  const candidatesUrl=`/api/v1/sites/${siteA}/work-orders/${orderA.id}/eligible-team-leads`;
  const hiddenCandidates=await app.inject({url:candidatesUrl,headers:headers(jarA)});
  assert.equal(hiddenCandidates.statusCode,200,hiddenCandidates.body);
  assert.deepEqual(hiddenCandidates.json(),{canAssign:false,blockReason:'authority-required',teamLeads:[]});
  const denied=await app.inject({method:'POST',url,headers:headers(jarA,commandId),payload:body});
  assert.equal(denied.statusCode,403,denied.body);assert.equal(denied.json().error.code,'AUTHORITY_REQUIRED');
  await assert.rejects(scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query('INSERT INTO staff_authority_grants(id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from) VALUES($1,$2,$3,$4,$5,1,$6,$7,now())',[randomUUID(),orgA,siteA,actorA,'work-order.assign-lead',actorA,'forbidden runtime grant mint'])),/permission denied/);
  await admin.query('INSERT INTO staff_authority_grants(id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from) VALUES($1,$2,$3,$4,$5,1,$6,$7,now()-interval \'1 minute\')',[randomUUID(),orgA,siteA,actorA,'work-order.assign-lead',actorA,'Synthetic test-only grant']);
  const unqualified=await app.inject({method:'POST',url,headers:headers(jarA,commandId),payload:body});
  assert.equal(unqualified.statusCode,409,unqualified.body);assert.equal(unqualified.json().error.code,'LEAD_NOT_QUALIFIED');
  await admin.query('INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes) VALUES($1,$2,$3,$4,\'EV-TEAM-LEAD\',1,\'accepted\',\'synthetic-test-evidence\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'ICE\'])',[randomUUID(),orgA,siteA,lead,actorA]);
  const wrongScope=await app.inject({method:'POST',url,headers:headers(jarA,commandId),payload:body});
  assert.equal(wrongScope.statusCode,409,wrongScope.body);assert.equal(wrongScope.json().error.code,'LEAD_NOT_QUALIFIED');
  await admin.query('INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes) VALUES($1,$2,$3,$4,\'EV-TEAM-LEAD\',2,\'accepted\',\'synthetic-test-evidence\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'])',[randomUUID(),orgA,siteA,lead,actorA]);
  await admin.query('INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes,restrictions) VALUES($1,$2,$3,$4,\'EV-TEAM-LEAD\',3,\'accepted\',\'synthetic-test-evidence\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'],$6)',[randomUUID(),orgA,siteA,lead,actorA,JSON.stringify(['requires-supervision'])]);
  const restricted=await app.inject({method:'POST',url,headers:headers(jarA,commandId),payload:body});
  assert.equal(restricted.statusCode,409,restricted.body);assert.equal(restricted.json().error.code,'LEAD_NOT_QUALIFIED');
  await admin.query('INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes) VALUES($1,$2,$3,$4,\'EV-TEAM-LEAD\',4,\'accepted\',\'synthetic-test-evidence\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'])',[randomUUID(),orgA,siteA,lead,actorA]);
  const readOnlyLead=randomUUID();
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[readOnlyLead,`test-read-only-lead-${readOnlyLead}`,'Synthetic Read-only EV Lead',await hashPassword(password)]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,false)',[readOnlyLead,siteA]);
  await admin.query('INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes) VALUES($1,$2,$3,$4,\'EV-TEAM-LEAD\',1,\'accepted\',\'synthetic-test-evidence\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'])',[randomUUID(),orgA,siteA,readOnlyLead,actorA]);
  const readOnlyAssignment=await app.inject({method:'POST',url,headers:headers(jarA),payload:{...body,leadUserId:readOnlyLead}});
  assert.equal(readOnlyAssignment.statusCode,409,readOnlyAssignment.body);assert.equal(readOnlyAssignment.json().error.code,'LEAD_NOT_QUALIFIED');
  const candidates=await app.inject({url:candidatesUrl,headers:headers(jarA)});
  assert.equal(candidates.statusCode,200,candidates.body);
  assert.deepEqual(candidates.json(),{canAssign:true,blockReason:null,teamLeads:[{id:lead,name:'Synthetic EV Lead',qualificationCode:'EV-TEAM-LEAD'}]});
  const crossSiteCandidates=await app.inject({url:`/api/v1/sites/${siteB}/work-orders/${orderA.id}/eligible-team-leads`,headers:headers(jarB)});
  assert.equal(crossSiteCandidates.statusCode,404,crossSiteCandidates.body);
  await admin.query('UPDATE memberships SET can_write=false WHERE user_id=$1 AND site_id=$2',[actorA,siteA]);
  try {
    await assert.rejects(assignTeamLead(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},randomUUID(),orderA.id,body),{code:'READ_ONLY'});
    const readOnlyCandidates=await app.inject({url:candidatesUrl,headers:headers(jarA)});
    assert.deepEqual(readOnlyCandidates.json(),{canAssign:false,blockReason:'authority-required',teamLeads:[]});
  } finally {
    await admin.query('UPDATE memberships SET can_write=true WHERE user_id=$1 AND site_id=$2',[actorA,siteA]);
  }
  const awaitingLeadQueue=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?queue=awaiting-lead`,headers:headers(jarA)});
  assert.equal(awaitingLeadQueue.statusCode,200,awaitingLeadQueue.body);
  assert(awaitingLeadQueue.json().items.some((item:{id:string})=>item.id===orderA.id),'Current Operations-reviewed work appears in the team-lead assignment drill-down.');
  const overviewBeforeAssignment=(await app.inject({url:`/api/v1/sites/${siteA}/workforce/overview`,headers:headers(jarA)})).json().workOrders;
  const awaitingOperationsBefore=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?queue=awaiting-operations`,headers:headers(jarA)});
  assert.equal(awaitingOperationsBefore.statusCode,200,awaitingOperationsBefore.body);
  assert.equal(awaitingOperationsBefore.json().items.some((item:{id:string})=>item.id===orderA.id),false);
  const assigned=await app.inject({method:'POST',url,headers:headers(jarA,commandId),payload:body});
  assert.equal(assigned.statusCode,200,assigned.body);assert.equal(assigned.json().leadUserId,lead);assert.equal(assigned.json().powertrainClass,'EV');
  const assignedQueue=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?queue=assigned`,headers:headers(jarA)});
  assert.equal(assignedQueue.statusCode,200,assignedQueue.body);
  assert(assignedQueue.json().items.some((item:{id:string})=>item.id===orderA.id),'The assigned work appears in the service-centre lead-assignment drill-down.');
  const noLongerAwaiting=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?queue=awaiting-lead`,headers:headers(jarA)});
  assert.equal(noLongerAwaiting.statusCode,200,noLongerAwaiting.body);
  assert.equal(noLongerAwaiting.json().items.some((item:{id:string})=>item.id===orderA.id),false);
  const awaitingOperationsAfter=await app.inject({url:`/api/v1/sites/${siteA}/work-orders?queue=awaiting-operations`,headers:headers(jarA)});
  assert.equal(awaitingOperationsAfter.statusCode,200,awaitingOperationsAfter.body);
  assert.equal(awaitingOperationsAfter.json().items.some((item:{id:string})=>item.id===orderA.id),false,'Lead assignment must not reclassify the job as awaiting Operations review.');
  const overviewAfterAssignment=(await app.inject({url:`/api/v1/sites/${siteA}/workforce/overview`,headers:headers(jarA)})).json().workOrders;
  assert.equal(overviewAfterAssignment.assignedToTeamLead,overviewBeforeAssignment.assignedToTeamLead+1);
  assert.equal(overviewAfterAssignment.awaitingTeamLead,overviewBeforeAssignment.awaitingTeamLead-1);
  assert.equal(overviewAfterAssignment.awaitingOperationsReview,overviewBeforeAssignment.awaitingOperationsReview);
  const replay=await app.inject({method:'POST',url,headers:headers(jarA,commandId),payload:body});
  assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json(),assigned.json());
  const changed=await app.inject({method:'POST',url,headers:headers(jarA,commandId),payload:{...body,reason:'Changed content'}});
  assert.equal(changed.statusCode,409,changed.body);
  const records=await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query('SELECT id,lead_user_id,powertrain_class,assigned_by,authority_decision,operations_review_id FROM work_order_lead_assignments WHERE work_order_id=$1',[orderA.id]));
  assert.equal(records.rowCount,1);assert.equal(records.rows[0].lead_user_id,lead);assert.equal(records.rows[0].assigned_by,actorA);assert.equal(records.rows[0].operations_review_id,reviewResult.reviewId);
  const assignmentDecision=records.rows[0].authority_decision;
  const sourceGrant=await admin.query("SELECT id,grant_revision,basis_reference FROM staff_authority_grants WHERE staff_user_id=$1 AND capability='work-order.assign-lead'",[actorA]);
  const sourceQualification=await admin.query("SELECT id,qualification_revision,evidence_reference FROM staff_qualifications WHERE staff_user_id=$1 AND qualification_code='EV-TEAM-LEAD' AND qualification_revision=4",[lead]);
  assert.equal(assignmentDecision.grant.id,sourceGrant.rows[0].id);
  assert.equal(assignmentDecision.grant.grant_revision,sourceGrant.rows[0].grant_revision);
  assert.equal(assignmentDecision.grant.basis_reference,sourceGrant.rows[0].basis_reference);
  assert.equal(assignmentDecision.qualification.id,sourceQualification.rows[0].id);
  assert.equal(assignmentDecision.qualification.qualification_revision,4);
  assert.equal(assignmentDecision.qualification.evidence_reference,sourceQualification.rows[0].evidence_reference);
  assert.ok(Number.isFinite(Date.parse(assignmentDecision.decidedAt)));
  const assignmentEvent=await admin.query("SELECT new_state->'authorityDecision' AS decision FROM domain_events WHERE aggregate_id=$1 AND event_type='operations.team-lead-assigned'",[orderA.id]);
  assert.deepEqual(assignmentEvent.rows[0].decision,assignmentDecision);

  const projected=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(jarA)});
  assert.equal(projected.statusCode,200,projected.body);assert.equal(projected.json().teamLeadAssignment.leadUserId,lead);assert.equal(projected.json().teamLeadAssignment.leadName,'Synthetic EV Lead');assert.equal(projected.json().operationsReview.isCurrent,false);
  orderA=detailSchema.parse(projected.json());
  const supervisor=randomUUID();
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[supervisor,`test-supervisor-${supervisor}`,'Synthetic EV Supervisor',await hashPassword(password)]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true)',[supervisor,siteA]);
  await admin.query('INSERT INTO staff_authority_grants(id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from) VALUES($1,$2,$3,$4,\'work-order.handoff-supervisor\',1,$5,$6,now()-interval \'1 minute\')',[randomUUID(),orgA,siteA,lead,actorA,'Synthetic test-only handoff grant']);
  await admin.query('INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes) VALUES($1,$2,$3,$4,\'EV-SUPERVISOR\',1,\'accepted\',\'synthetic-test-evidence\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'])',[randomUUID(),orgA,siteA,supervisor,actorA]);
  const supervisorJar=await signIn(`test-lead-${lead}`);
  const restrictedSupervisor=randomUUID();
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[restrictedSupervisor,`test-supervisor-${restrictedSupervisor}`,'Restricted EV Supervisor',await hashPassword(password)]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true)',[restrictedSupervisor,siteA]);
  await admin.query('INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes,restrictions) VALUES($1,$2,$3,$4,\'EV-SUPERVISOR\',1,\'accepted\',\'synthetic-test-evidence\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'],$6)',[randomUUID(),orgA,siteA,restrictedSupervisor,actorA,JSON.stringify(['requires-supervision'])]);
  const readOnlySupervisor=randomUUID();
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[readOnlySupervisor,`test-read-only-supervisor-${readOnlySupervisor}`,'Synthetic Read-only EV Supervisor',await hashPassword(password)]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,false)',[readOnlySupervisor,siteA]);
  await admin.query('INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes) VALUES($1,$2,$3,$4,\'EV-SUPERVISOR\',1,\'accepted\',\'synthetic-test-evidence\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'])',[randomUUID(),orgA,siteA,readOnlySupervisor,actorA]);
  const eligibleUrl=`/api/v1/sites/${siteA}/work-orders/${orderA.id}/eligible-supervisors`;
  const eligible=await app.inject({url:eligibleUrl,headers:headers(supervisorJar)});
  assert.equal(eligible.statusCode,200,eligible.body);assert.deepEqual(eligible.json(),{canHandoff:true,supervisors:[{id:supervisor,name:'Synthetic EV Supervisor',qualificationCode:'EV-SUPERVISOR'}]});
  const hiddenFromOtherStaff=await app.inject({url:eligibleUrl,headers:headers(jarA)});
  assert.equal(hiddenFromOtherStaff.statusCode,200,hiddenFromOtherStaff.body);assert.deepEqual(hiddenFromOtherStaff.json(),{canHandoff:false,supervisors:[]});
  const handoffUrl=`/api/v1/sites/${siteA}/work-orders/${orderA.id}/supervisor-handoff`;
  const planUrl=`/api/v1/sites/${siteA}/work-orders/${orderA.id}/work-plan-revisions`;
  const planPayload={expectedVersion:orderA.version,rationale:'Order the already proposed task for supervisor review.',taskIds:[orderA.tasks[0]!.id]};
  const unassignedPlan=await app.inject({method:'POST',url:planUrl,headers:headers(jarA),payload:planPayload});
  assert.equal(unassignedPlan.statusCode,403,unassignedPlan.body);assert.equal(unassignedPlan.json().error.code,'ASSIGNED_LEAD_REQUIRED');
  await admin.query('UPDATE memberships SET can_write=false WHERE user_id=$1 AND site_id=$2',[lead,siteA]);
  try {
    const readOnlyLeadEligibility=await app.inject({url:eligibleUrl,headers:headers(supervisorJar)});
    assert.equal(readOnlyLeadEligibility.statusCode,200,readOnlyLeadEligibility.body);assert.deepEqual(readOnlyLeadEligibility.json(),{canHandoff:false,supervisors:[]});
    const readOnlyDetail=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(supervisorJar)});
    assert.equal(readOnlyDetail.statusCode,200,readOnlyDetail.body);assert.equal(readOnlyDetail.json().canPrepareWorkPlan,false);assert.equal(readOnlyDetail.json().workPlanBlockReason,'site-write-required');
    const readOnlyPlan=await app.inject({method:'POST',url:planUrl,headers:headers(supervisorJar),payload:planPayload});
    assert.equal(readOnlyPlan.statusCode,403,readOnlyPlan.body);assert.equal(readOnlyPlan.json().error.code,'READ_ONLY');
  } finally {
    await admin.query('UPDATE memberships SET can_write=true WHERE user_id=$1 AND site_id=$2',[lead,siteA]);
  }
  const planWithoutGrant=await app.inject({method:'POST',url:planUrl,headers:headers(supervisorJar),payload:planPayload});
  assert.equal(planWithoutGrant.statusCode,403,planWithoutGrant.body);assert.equal(planWithoutGrant.json().error.code,'AUTHORITY_REQUIRED');
  await admin.query('INSERT INTO staff_authority_grants(id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from) VALUES($1,$2,$3,$4,\'work-order.prepare-work-plan\',1,$5,$6,now()-interval \'1 minute\')',[randomUUID(),orgA,siteA,lead,actorA,'Synthetic test-only plan grant']);
  const foreignTaskPlan=await app.inject({method:'POST',url:planUrl,headers:headers(supervisorJar),payload:{...planPayload,taskIds:[randomUUID()]}});
  assert.equal(foreignTaskPlan.statusCode,409,foreignTaskPlan.body);assert.equal(foreignTaskPlan.json().error.code,'PLAN_TASKS_CHANGED');
  const noPlanHandoff={expectedVersion:orderA.version,supervisorUserId:supervisor,workPlanRevisionId:randomUUID(),reason:'Synthetic handoff without a plan'};
  const noPlan=await app.inject({method:'POST',url:handoffUrl,headers:headers(supervisorJar),payload:noPlanHandoff});
  assert.equal(noPlan.statusCode,409,noPlan.body);assert.equal(noPlan.json().error.code,'WORK_PLAN_REQUIRED');
  const planKey=randomUUID();
  const planResponse=await app.inject({method:'POST',url:planUrl,headers:headers(supervisorJar,planKey),payload:planPayload});
  assert.equal(planResponse.statusCode,200,planResponse.body);
  const planResult=z.object({workOrderId:z.string().uuid(),workPlan:z.object({id:z.string().uuid(),revisionNumber:z.number(),workOrderVersion:z.number(),isCurrent:z.boolean(),tasks:z.array(z.object({taskId:z.string().uuid(),reference:z.string(),title:z.string()}))}),version:z.number()}).parse(planResponse.json());
  assert.equal(planResult.workPlan.isCurrent,true);assert.deepEqual(planResult.workPlan.tasks.map(task=>task.taskId),planPayload.taskIds);
  const planReplay=await app.inject({method:'POST',url:planUrl,headers:headers(supervisorJar,planKey),payload:planPayload});
  assert.equal(planReplay.statusCode,200,planReplay.body);assert.deepEqual(planReplay.json(),planResponse.json());
  const handoffBody={expectedVersion:planResult.version,supervisorUserId:supervisor,workPlanRevisionId:planResult.workPlan.id,reason:'Synthetic work plan and supervisor handoff'};
  const readOnlyHandoff=await app.inject({method:'POST',url:handoffUrl,headers:headers(supervisorJar),payload:{...handoffBody,supervisorUserId:readOnlySupervisor}});
  assert.equal(readOnlyHandoff.statusCode,409,readOnlyHandoff.body);assert.equal(readOnlyHandoff.json().error.code,'SUPERVISOR_NOT_QUALIFIED');
  const wrongPlanHandoff=await app.inject({method:'POST',url:handoffUrl,headers:headers(supervisorJar),payload:{...handoffBody,workPlanRevisionId:randomUUID()}});
  assert.equal(wrongPlanHandoff.statusCode,409,wrongPlanHandoff.body);assert.equal(wrongPlanHandoff.json().error.code,'WORK_PLAN_STALE');
  const wrongLead=await app.inject({method:'POST',url:handoffUrl,headers:headers(jarA),payload:handoffBody});
  assert.equal(wrongLead.statusCode,403,wrongLead.body);assert.equal(wrongLead.json().error.code,'ASSIGNED_LEAD_REQUIRED');
  await admin.query('UPDATE memberships SET can_write=false WHERE user_id=$1 AND site_id=$2',[lead,siteA]);
  try {
    await assert.rejects(handoffToSupervisor(runtime,{actorId:lead,organisationId:orgA,siteId:siteA},randomUUID(),orderA.id,handoffBody),{code:'READ_ONLY'});
  } finally {
    await admin.query('UPDATE memberships SET can_write=true WHERE user_id=$1 AND site_id=$2',[lead,siteA]);
  }
  const handoffKey=randomUUID();
  const handoff=await app.inject({method:'POST',url:handoffUrl,headers:headers(supervisorJar,handoffKey),payload:handoffBody});
  assert.equal(handoff.statusCode,200,handoff.body);assert.equal(handoff.json().supervisorUserId,supervisor);
  const handoffReplay=await app.inject({method:'POST',url:handoffUrl,headers:headers(supervisorJar,handoffKey),payload:handoffBody});
  assert.equal(handoffReplay.statusCode,200,handoffReplay.body);assert.deepEqual(handoffReplay.json(),handoff.json());
  const persistedHandoff=await admin.query('SELECT lead_assignment_id,authority_decision FROM work_order_supervisor_handoffs WHERE work_order_id=$1',[orderA.id]);
  assert.equal(persistedHandoff.rows[0].lead_assignment_id,records.rows[0].id);
  const handoffDecision=persistedHandoff.rows[0].authority_decision;
  assert.equal(handoffDecision.grant.capability,'work-order.handoff-supervisor');
  assert.equal(handoffDecision.grant.staff_user_id,lead);
  assert.equal(handoffDecision.grant.grant_revision,1);
  assert.equal(handoffDecision.qualification.staff_user_id,supervisor);
  assert.equal(handoffDecision.qualification.qualification_revision,1);
  assert.ok(Number.isFinite(Date.parse(handoffDecision.decidedAt)));

  const assignedSupervisor=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(supervisorJar)});
  assert.equal(assignedSupervisor.json().supervisorHandoff.supervisorUserId,supervisor);assert.equal(assignedSupervisor.json().supervisorHandoff.supervisorName,'Synthetic EV Supervisor');
  orderA=detailSchema.parse(assignedSupervisor.json());assert.equal(orderA.supervisorHandoff?.isCurrent,true);assert.equal(orderA.workPlan?.isCurrent,true);
  const replacementLead=randomUUID();
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[replacementLead,`test-lead-${replacementLead}`,'Synthetic Replacement Lead',await hashPassword(password)]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true)',[replacementLead,siteA]);
  await admin.query('INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes) VALUES($1,$2,$3,$4,\'EV-TEAM-LEAD\',1,\'accepted\',\'synthetic-test-evidence\',$5,now(),now()-interval \'1 minute\',now()+interval \'1 day\',ARRAY[\'EV\'])',[randomUUID(),orgA,siteA,replacementLead,actorA]);
  async function reviewFor(expectedVersion:number,notes:string) {
    const response=await app.inject({method:'POST',url:reviewUrl,headers:headers(jarA),payload:{expectedVersion,notes}});
    assert.equal(response.statusCode,200,response.body);
    return z.object({reviewId:z.string().uuid(),reviewedWorkOrderVersion:z.number()}).parse(response.json());
  }
  const replacementReview=await reviewFor(orderA.version,'Synthetic review before lead replacement');
  assert.equal(replacementReview.reviewedWorkOrderVersion,orderA.version+1);
  const oldLeadEligibility=await app.inject({url:eligibleUrl,headers:headers(supervisorJar)});
  assert.equal(oldLeadEligibility.statusCode,200,oldLeadEligibility.body);assert.deepEqual(oldLeadEligibility.json(),{canHandoff:false,supervisors:[]});
  const reassigned=await app.inject({method:'POST',url,headers:headers(jarA),payload:{expectedVersion:orderA.version+1,operationsReviewId:replacementReview.reviewId,leadUserId:replacementLead,reason:'Synthetic lead reassignment'}});
  assert.equal(reassigned.statusCode,200,reassigned.body);
  const afterReassignment=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(jarA)});
  assert.equal(afterReassignment.json().teamLeadAssignment.leadUserId,replacementLead);assert.equal(afterReassignment.json().supervisorHandoff,null);
  const formerLeadDenied=await app.inject({method:'POST',url:handoffUrl,headers:headers(supervisorJar),payload:{...handoffBody,expectedVersion:orderA.version+2}});
  assert.equal(formerLeadDenied.statusCode,403,formerLeadDenied.body);assert.equal(formerLeadDenied.json().error.code,'ASSIGNED_LEAD_REQUIRED');
  const returnReview=await reviewFor(orderA.version+2,'Synthetic review before returning a former lead');
  const returned=await app.inject({method:'POST',url,headers:headers(jarA),payload:{...body,expectedVersion:orderA.version+3,operationsReviewId:returnReview.reviewId,reason:'Original lead returns; old handoff must stay historical'}});
  assert.equal(returned.statusCode,200,returned.body);
  const afterReturn=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(jarA)});
  assert.equal(afterReturn.json().teamLeadAssignment.leadUserId,lead);
  assert.equal(afterReturn.json().supervisorHandoff,null,'Returning to a former lead cannot revive their historical handoff.');
  const returnedDetail=detailSchema.parse(afterReturn.json());
  const replacementPlan=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/work-plan-revisions`,headers:headers(supervisorJar),payload:{expectedVersion:returnedDetail.version,rationale:'Prepare a fresh plan for the returned assignment.',taskIds:[returnedDetail.tasks[0]!.id]}});
  assert.equal(replacementPlan.statusCode,200,replacementPlan.body);
  const replacementPlanBody=z.object({workPlan:z.object({id:z.string().uuid()}),version:z.number()}).parse(replacementPlan.json());
  const newHandoff=await app.inject({method:'POST',url:handoffUrl,headers:headers(supervisorJar),payload:{expectedVersion:replacementPlanBody.version,supervisorUserId:supervisor,workPlanRevisionId:replacementPlanBody.workPlan.id,reason:'Fresh handoff for the new assignment'}});
  assert.equal(newHandoff.statusCode,200,newHandoff.body);
  const handoffRows=await admin.query('SELECT lead_assignment_id,authority_decision FROM work_order_supervisor_handoffs WHERE work_order_id=$1 ORDER BY created_at,id',[orderA.id]);
  assert.equal(handoffRows.rowCount,2);
  assert.notEqual(handoffRows.rows[0].lead_assignment_id,handoffRows.rows[1].lead_assignment_id);
  assert.deepEqual(handoffRows.rows[0].authority_decision,handoffDecision,'New handoffs preserve the original authority decision.');
  const afterFresh=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(jarA)});
  assert.equal(afterFresh.json().supervisorHandoff.reason,'Fresh handoff for the new assignment');
  orderA=detailSchema.parse(afterFresh.json());


});

test('authority decision locks block concurrent registry revocation without granting runtime update rights',async()=>{
  const scope={actorId:actorA,organisationId:orgA,siteId:siteA};
  const lead=await admin.query('SELECT lead_user_id FROM work_order_lead_assignments WHERE work_order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[orderA.id]);
  await scoped(runtime,scope,async client=>{
    const grant=await client.query("SELECT public.lock_work_order_authority_grant('work-order.assign-lead') AS record");
    const reviewGrant=await client.query("SELECT public.lock_work_order_authority_grant('work-order.operations-review') AS record");
    const qualification=await client.query("SELECT public.lock_work_order_assignment_qualification($1,'EV-TEAM-LEAD','EV') AS record",[lead.rows[0].lead_user_id]);
    assert.ok(grant.rows[0].record);assert.ok(reviewGrant.rows[0].record);assert.ok(qualification.rows[0].record);
    for(const command of [
      {sql:'UPDATE staff_authority_grants SET valid_until=clock_timestamp() WHERE id=$1',id:grant.rows[0].record.id},
      {sql:'UPDATE staff_authority_grants SET valid_until=clock_timestamp() WHERE id=$1',id:reviewGrant.rows[0].record.id},
      {sql:"UPDATE staff_qualifications SET state='revoked' WHERE id=$1",id:qualification.rows[0].record.id},
    ]) {
      const revoker=await admin.connect();
      try {
        await revoker.query('BEGIN');
        await revoker.query("SET LOCAL lock_timeout='100ms'");
        await assert.rejects(revoker.query(command.sql,[command.id]),{code:'55P03'});
      } finally {
        await revoker.query('ROLLBACK');
        revoker.release();
      }
    }
    await client.query('SAVEPOINT denied_registry_write');
    await assert.rejects(client.query('UPDATE staff_authority_grants SET valid_until=clock_timestamp() WHERE id=$1',[grant.rows[0].record.id]),/permission denied/);
    await client.query('ROLLBACK TO SAVEPOINT denied_registry_write');
  });
});

test('command runner locks target roots before grants and rechecks grants before replay',async()=>{
  const scope={actorId:actorA,organisationId:orgA,siteId:siteA};
  const grantResult=await admin.query(`SELECT id,valid_until FROM staff_authority_grants
    WHERE staff_user_id=$1 AND site_id=$2 AND capability='work-order.operations-review'
      AND revoked_at IS NULL AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now())
    ORDER BY grant_revision DESC,id LIMIT 1`,[actorA,siteA]);
  assert.equal(grantResult.rowCount,1,'Synthetic operations-review grant must be active.');
  const grant=grantResult.rows[0] as {id:string;valid_until:Date|null};
  const created=await create(jarA,siteA,'WVWZZZ1JZXW000030');assert.equal(created.statusCode,200,created.body);
  const target=detailSchema.parse(created.json());
  const rootBlocker=await admin.connect();
  const deniedKey=randomUUID();
  await rootBlocker.query('BEGIN');
  await rootBlocker.query('SELECT id FROM work_orders WHERE id=$1 FOR UPDATE',[target.id]);
  const reviewUrl=`/api/v1/sites/${siteA}/work-orders/${target.id}/operations-review`;
  const denied=app.inject({method:'POST',url:reviewUrl,headers:headers(jarA,deniedKey),payload:{expectedVersion:target.version,notes:'Race test: grant expired while target root was locked.'}});
  let waitingForRoot=false;
  try {
    for(let attempt=0;attempt<100;attempt++) {
      const activity=await admin.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND position('SELECT id FROM work_orders WHERE organisation_id=' in query)>0) AS waiting`);
      if(activity.rows[0]?.waiting){waitingForRoot=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    await admin.query('UPDATE staff_authority_grants SET valid_until=clock_timestamp() WHERE id=$1',[grant.id]);
    await rootBlocker.query('COMMIT');
    const deniedResponse=await denied;
    assert.equal(waitingForRoot,true,'The API command must be observed waiting on the target root before grant expiry.');
    assert.equal(deniedResponse.statusCode,403,deniedResponse.body);
    assert.equal(deniedResponse.json().error.code,'AUTHORITY_REQUIRED');
  } finally {
    await rootBlocker.query('ROLLBACK').catch(()=>undefined);
    rootBlocker.release();
    await admin.query('UPDATE staff_authority_grants SET valid_until=$1 WHERE id=$2',[grant.valid_until,grant.id]);
  }
  const deniedReceipts=await admin.query('SELECT count(*)::int AS count FROM command_receipts WHERE command_id=$1',[deniedKey]);
  assert.equal(deniedReceipts.rows[0].count,0,'Authority denial must not create an idempotency receipt.');
  const deniedEvents=await admin.query("SELECT count(*)::int AS count FROM domain_events WHERE aggregate_id=$1 AND event_type='operations.work-order-reviewed'",[target.id]);
  assert.equal(deniedEvents.rows[0].count,0,'Authority denial must not create a domain event.');

  const commandId=randomUUID();
  let signalAuthorized!:()=>void;
  let releaseCommand!:()=>void;
  const authorized=new Promise<void>(resolve=>{signalAuthorized=resolve;});
  const held=new Promise<void>(resolve=>{releaseCommand=resolve;});
  const resultSchema=z.object({version:z.number().int(),authorityDecision:z.object({id:z.string()}).passthrough()});
  const command=runStaffCommand(runtime,{
    scope,commandId,operation:'test.grant-revocation-serialization',targetAggregateId:target.id,payload:{},responseSchema:resultSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,target.id),
    authorize:async client=>{
      const result=await client.query("SELECT public.lock_work_order_authority_grant('work-order.operations-review') AS grant");
      const record=result.rows[0]?.grant as {id:string}|null;
      if(!record) throw new Error('The operations-review grant is not active.');
      signalAuthorized();
      await held;
    },
    apply:async client=>{
      const current=await client.query('SELECT version FROM work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[orgA,siteA,target.id]);
      const version=Number(current.rows[0]?.version);
      await client.query('UPDATE work_orders SET version=version+1 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[orgA,siteA,target.id]);
      const authority=await client.query("SELECT public.lock_work_order_authority_grant('work-order.operations-review') AS grant");
      return {aggregateId:target.id,aggregateType:'work-order',version:version+1,previous:{version},next:{version:version+1,authorityDecision:authority.rows[0]?.grant},reason:'Test command recorded under the locked Operations grant.'};
    },
    project:async(_client,mutation)=>resultSchema.parse(mutation.next),
  });
  await authorized;
  const revoker=await admin.connect();
  try {
    await revoker.query('BEGIN');
    await revoker.query("SET LOCAL lock_timeout='100ms'");
    await assert.rejects(revoker.query('UPDATE staff_authority_grants SET valid_until=clock_timestamp() WHERE id=$1',[grant.id]),{code:'55P03'});
  } finally {
    await revoker.query('ROLLBACK');
    revoker.release();
  }
  releaseCommand();
  const accepted=await command;
  assert.equal(accepted.authorityDecision.id,grant.id);
  assert.equal(accepted.version,target.version+1);
  await admin.query('UPDATE staff_authority_grants SET valid_until=clock_timestamp() WHERE id=$1',[grant.id]);
  try {
    await assert.rejects(runStaffCommand(runtime,{
      scope,commandId,operation:'test.grant-revocation-serialization',targetAggregateId:target.id,payload:{},responseSchema:resultSchema,
      lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,target.id),
      authorize:async client=>{
        const current=await client.query("SELECT public.lock_work_order_authority_grant('work-order.operations-review') AS grant");
        if(!current.rows[0]?.grant) throw new Error('Current grant required before receipt lookup.');
      },
      apply:async()=>{throw new Error('Replay must not apply.');},
      project:async()=>{throw new Error('Replay must use the stored response.');},
    }),/Current grant required before receipt lookup/);
  } finally {
    await admin.query('UPDATE staff_authority_grants SET valid_until=$1 WHERE id=$2',[grant.valid_until,grant.id]);
  }
  const receipt=await admin.query('SELECT response FROM command_receipts WHERE command_id=$1',[commandId]);
  assert.equal(receipt.rowCount,1);
  assert.deepEqual(resultSchema.parse(receipt.rows[0]?.response),accepted);
  const ledger=await admin.query(`SELECT
      (SELECT count(*)::int FROM domain_events WHERE aggregate_id=$1 AND event_type='test.grant-revocation-serialization') AS events,
      (SELECT count(*)::int FROM command_receipts WHERE command_id=$2) AS receipts,
      (SELECT count(*)::int FROM outbox o JOIN domain_events e ON e.id=o.event_id WHERE e.aggregate_id=$1 AND e.event_type='test.grant-revocation-serialization') AS outbox`,[target.id,commandId]);
  assert.deepEqual(ledger.rows[0],{events:1,receipts:1,outbox:1});
  const finalVersion=await admin.query('SELECT version FROM work_orders WHERE id=$1',[target.id]);
  assert.equal(finalVersion.rows[0]?.version,accepted.version,'The authorized command must commit one canonical version.');
});

test('site-local VIN lookup supports an explicit repeat visit without changing vehicle association',async()=>{
  const first=await create(jarA,siteA,'WVWZZZ1JZXW000011');assert.equal(first.statusCode,200,first.body);
  const original=detailSchema.parse(first.json());
  const originalAssociation=await admin.query('SELECT customer_id FROM vehicles WHERE id=$1',[original.vehicle.id]);
  const lookup=await app.inject({url:`/api/v1/sites/${siteA}/vehicles/lookup?vin=${original.vehicle.vin}`,headers:headers(jarA)});
  assert.equal(lookup.statusCode,200,lookup.body);assert.equal(lookup.json().id,original.vehicle.id);assert.equal(lookup.json().variant,'Touring');assert.equal(lookup.json().powertrain,'Battery electric');
  const otherSite=await app.inject({url:`/api/v1/sites/${siteA2}/vehicles/lookup?vin=${original.vehicle.vin}`,headers:headers(jarA)});
  assert.equal(otherSite.statusCode,200,otherSite.body);assert.equal(otherSite.json(),null);
  const replayBody={...intake(),client:{kind:'existing' as const,partyId:original.client!.id},visitContact:{kind:'new' as const,name:'Different Visit Contact',phone:'+233200000099',email:''},vehicle:{kind:'existing' as const,vehicleId:original.vehicle.id},powertrainClass:'ICE' as const,warrantyStatus:'confirmed' as const,warrantyConfirmationNote:'Synthetic warranty portal confirmation 2026-11-08',complaint:'A later visit with a separate contact.'};
  const repeat=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(jarA),payload:replayBody});
  assert.equal(repeat.statusCode,200,repeat.body);
  const next=detailSchema.parse(repeat.json());assert.equal(next.vehicle.id,original.vehicle.id);assert.equal(next.visitContact?.name,'Different Visit Contact');assert.equal(next.client?.name,'Synthetic Showroom');assert.equal(next.client?.id,original.client?.id);assert.equal(next.clientBookingSequence,2);assert.equal(next.powertrainClass,'ICE');assert.equal(next.warrantyStatusAtBooking,'confirmed');assert.equal(next.reference,`ICE-${original.clientCode}-00002W`);
  assert.equal(next.vehicleHistory.length,2);assert.ok(next.vehicleHistory.some(visit=>visit.id===original.id));assert.ok(next.vehicleHistory.some(visit=>visit.id===next.id));
  assert.ok(next.gates.every(g=>g.state==='pending'));
  const afterAssociation=await admin.query('SELECT customer_id FROM vehicles WHERE id=$1',[original.vehicle.id]);
  assert.deepEqual(afterAssociation.rows[0],originalAssociation.rows[0]);
  const visits=await admin.query('SELECT count(*)::int AS count FROM visits WHERE vehicle_id=$1 AND site_id=$2',[original.vehicle.id,siteA]);
  assert.equal(visits.rows[0].count,2);
  const foreignVisitId=randomUUID(),foreignOrderId=randomUUID();
  const foreignReference=`RG-2026-CROSS-${randomUUID()}`;
  await admin.query('INSERT INTO visits(id,organisation_id,site_id,vehicle_id) VALUES($1,$2,$3,$4)',[foreignVisitId,orgA,siteA2,original.vehicle.id]);
  await admin.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'work-order')",[foreignOrderId,orgA,siteA2]);
  await admin.query('INSERT INTO work_orders(id,organisation_id,site_id,visit_id,customer_id,vehicle_id,reference,odometer_km) VALUES($1,$2,$3,$4,NULL,$5,$6,$7)',[foreignOrderId,orgA,siteA2,foreignVisitId,original.vehicle.id,foreignReference,13000]);
  try {
    const sameSiteDetail=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${next.id}`,headers:headers(jarA)});
    assert.equal(sameSiteDetail.statusCode,200,sameSiteDetail.body);assert.equal(detailSchema.parse(sameSiteDetail.json()).vehicleHistory.length,2);
    const otherSiteDetail=await app.inject({url:`/api/v1/sites/${siteA2}/work-orders/${foreignOrderId}`,headers:headers(jarA)});
    assert.equal(otherSiteDetail.statusCode,200,otherSiteDetail.body);
    const otherSiteHistory=detailSchema.parse(otherSiteDetail.json()).vehicleHistory;
    assert.equal(otherSiteHistory.length,1);assert.equal(otherSiteHistory[0]?.reference,foreignReference);
  } finally {
    await admin.query('ALTER TABLE work_order_read_events DISABLE TRIGGER work_order_read_events_immutable');
    await admin.query('DELETE FROM work_order_read_events WHERE work_order_id=$1',[foreignOrderId]);
    await admin.query('ALTER TABLE work_order_read_events ENABLE TRIGGER work_order_read_events_immutable');
    await admin.query('DELETE FROM work_orders WHERE id=$1',[foreignOrderId]);
    await admin.query('DELETE FROM aggregate_roots WHERE id=$1',[foreignOrderId]);
    await admin.query('DELETE FROM visits WHERE id=$1',[foreignVisitId]);
  }
});

test('concurrent client bookings allocate unique consecutive cross-powertrain references',async()=>{
  const seed=await create(jarA,siteA,'WVWZZZ1JZXW000021');assert.equal(seed.statusCode,200,seed.body);
  const clientId=detailSchema.parse(seed.json()).client!.id;
  const [first,second]=await Promise.all([
    app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(jarA),payload:{...intake('WVWZZZ1JZXW000022'),client:{kind:'existing',partyId:clientId},powertrainClass:'EV'}}),
    app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(jarA),payload:{...intake('WVWZZZ1JZXW000023'),client:{kind:'existing',partyId:clientId},powertrainClass:'HYB'}}),
  ]);
  assert.equal(first.statusCode,200,first.body);assert.equal(second.statusCode,200,second.body);
  const sequences=[detailSchema.parse(first.json()).clientBookingSequence,detailSchema.parse(second.json()).clientBookingSequence].sort();
  assert.deepEqual(sequences,[2,3]);
  assert.notEqual(first.json().reference,second.json().reference);
});

test('booking references encode confirmed powertrain and warranty-at-creation snapshots',async()=>{
  const seed=await create(jarA,siteA,'WVWZZZ1JZXW000024');assert.equal(seed.statusCode,200,seed.body);
  const clientId=detailSchema.parse(seed.json()).client!.id;
  const cases=[
    {vin:'WVWZZZ1JZXW000025',powertrainClass:'EV' as const,warrantyStatus:'not-confirmed' as const,note:'',sequence:2,suffix:''},
    {vin:'WVWZZZ1JZXW000026',powertrainClass:'HYB' as const,warrantyStatus:'unknown' as const,note:'',sequence:3,suffix:''},
    {vin:'WVWZZZ1JZXW000027',powertrainClass:'ICE' as const,warrantyStatus:'confirmed' as const,note:'Synthetic confirmation recorded at booking.',sequence:4,suffix:'W'},
  ];
  for(const item of cases){
    const response=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(jarA),payload:{...intake(item.vin),client:{kind:'existing',partyId:clientId},powertrainClass:item.powertrainClass,warrantyStatus:item.warrantyStatus,warrantyConfirmationNote:item.note}});
    assert.equal(response.statusCode,200,response.body);
    const order=detailSchema.parse(response.json());
    assert.equal(order.clientBookingSequence,item.sequence);
    assert.equal(order.warrantyStatusAtBooking,item.warrantyStatus);
    assert.equal(order.reference,`${item.powertrainClass}-${order.clientCode}-${String(item.sequence).padStart(5,'0')}${item.suffix}`);
  }
});

test('owner access approval, replay, transfer and revocation require the site capability and preserve revisions',async()=>{
  const authority=await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},async client=>(await client.query('SELECT public.lock_vehicle_owner_access_authority($1,$2) AS allowed',[actorA,siteA])).rows[0]?.allowed);assert.equal(authority,true);
  const approveUrl=`/api/v1/sites/${siteA}/vehicles/${orderA.vehicle.id}/owner-access/approve`;
  const commandId=randomUUID();
  const approval={expectedVersion:0,ownerAccountId:ownerAccountA,evidenceRecordId:ownerEvidence,reason:'Synthetic approved access for lifecycle verification.'};
  const approved=await app.inject({method:'POST',url:approveUrl,headers:headers(jarA,commandId),payload:approval});
  assert.equal(approved.statusCode,200,approved.body);
  const first=approved.json() as {accessScopeId:string;version:number;relationships:Array<{relationshipId:string;ownerAccountId:string;state:string;revision:number;currentlyValid:boolean}>};
  assert.equal(first.version,1);assert.equal(first.relationships.length,1);assert.equal(first.relationships[0]?.ownerAccountId,ownerAccountA);assert.equal(first.relationships[0]?.state,'approved');assert.equal(first.relationships[0]?.currentlyValid,true);
  const replay=await app.inject({method:'POST',url:approveUrl,headers:headers(jarA,commandId),payload:approval});
  assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json(),first);
  const conflict=await app.inject({method:'POST',url:approveUrl,headers:headers(jarA,commandId),payload:{...approval,reason:'Changed content'}});assert.equal(conflict.statusCode,409);

  const readerJar=await signIn('test-reader');
  const denied=await app.inject({method:'POST',url:approveUrl,headers:headers(readerJar),payload:approval});assert.equal(denied.statusCode,403,denied.body);
  const wrongSite=await app.inject({method:'POST',url:`/api/v1/sites/${siteA2}/vehicles/${orderA.vehicle.id}/owner-access/approve`,headers:headers(jarA),payload:approval});assert.equal(wrongSite.statusCode,403,wrongSite.body);
  const wrongOrganisation=await app.inject({method:'POST',url:`/api/v1/sites/${siteB}/vehicles/${orderA.vehicle.id}/owner-access/approve`,headers:headers(jarA),payload:approval});assert.equal(wrongOrganisation.statusCode,403,wrongOrganisation.body);

  const prior=first.relationships[0];assert.ok(prior);
  const transfer=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/owner-access/${first.accessScopeId}/relationships/${prior.relationshipId}/transfer`,headers:headers(jarA),payload:{expectedVersion:1,newOwnerAccountId:ownerAccountB,evidenceRecordId:ownerEvidence,reason:'Synthetic transfer of the approved relationship.'}});
  assert.equal(transfer.statusCode,200,transfer.body);
  const moved=transfer.json() as typeof first;
  assert.equal(moved.version,2);assert.equal(moved.relationships.find(item=>item.ownerAccountId===ownerAccountA)?.state,'transferred');assert.equal(moved.relationships.find(item=>item.ownerAccountId===ownerAccountB)?.state,'approved');

  const incoming=moved.relationships.find(item=>item.ownerAccountId===ownerAccountB);assert.ok(incoming);
  const revoked=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/owner-access/${first.accessScopeId}/relationships/${incoming.relationshipId}/revoke`,headers:headers(jarA),payload:{expectedVersion:2,evidenceRecordId:ownerEvidence,reason:'Synthetic revocation of the incoming owner access.'}});
  assert.equal(revoked.statusCode,200,revoked.body);
  const ended=revoked.json() as typeof first;
  assert.equal(ended.version,3);assert.equal(ended.relationships.find(item=>item.ownerAccountId===ownerAccountB)?.state,'revoked');assert.equal(ended.relationships.find(item=>item.ownerAccountId===ownerAccountB)?.currentlyValid,false);
  const ledger=await admin.query(`SELECT (SELECT count(*) FROM vehicle_owner_revisions WHERE organisation_id=$2 AND site_id=$3 AND relationship_id IN (SELECT id FROM vehicle_owner_relationships WHERE access_scope_id=$1))::int AS revisions,(SELECT count(*) FROM domain_events WHERE aggregate_id=$1 AND aggregate_type='vehicle-owner-access')::int AS events,(SELECT count(*) FROM outbox o JOIN domain_events e ON e.id=o.event_id WHERE e.aggregate_id=$1)::int AS outbox`,[first.accessScopeId,orgA,siteA]);
  assert.deepEqual(ledger.rows[0],{revisions:4,events:3,outbox:3});
});

test('owner OIDC starts apply privacy-preserving atomic claim and network throttles',async()=>{
  const claimToken='A'.repeat(43);
  const responses=await Promise.all(Array.from({length:7},async(_,index)=>{
    const jar:Record<string,string>={};
    const session=await app.inject({url:'/api/v1/owner/session'});updateCookies(jar,session.headers['set-cookie']);
    return app.inject({
      method:'POST',url:'/api/v1/owner/auth/oidc/start',headers:{...headers(jar),'x-forwarded-for':`198.51.100.${index+1}`},payload:{claimToken},
    });
  }));
  assert.deepEqual(responses.map(response=>response.statusCode).sort(),[200,200,200,200,200,429,429]);
  for(const limited of responses.filter(response=>response.statusCode===429)){
    assert.deepEqual(limited.json(),{error:{code:'TOO_MANY_ATTEMPTS',message:'Too many attempts. Wait before trying again.'}});
    assert.equal(limited.headers['set-cookie'],undefined);
  }
  const stored=await admin.query('SELECT bucket FROM login_attempts');
  const rawDigest=createHash('sha256').update(claimToken).digest('hex');
  assert.ok(stored.rows.length>0);
  assert.equal(stored.rows.some(row=>row.bucket===claimToken||row.bucket===rawDigest),false);
});

test('owner invitations are identity-bound, single-use, replay-safe and revocable',async()=>{
  const created=await create(jarA,siteA,'WVWZZZ1JZXW000008');assert.equal(created.statusCode,200,created.body);
  const order=detailSchema.parse(created.json());
  const approved=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/vehicles/${order.vehicle.id}/owner-access/approve`,headers:headers(jarA),payload:{expectedVersion:0,ownerAccountId:ownerAccountA,evidenceRecordId:ownerEvidence,reason:'Synthetic invitation relationship approval.'}});
  assert.equal(approved.statusCode,200,approved.body);
  const ownerAccess=approved.json() as {accessScopeId:string;relationships:Array<{relationshipId:string;ownerAccountId:string}>};
  const ownerARelationship=ownerAccess.relationships.find(item=>item.ownerAccountId===ownerAccountA);assert.ok(ownerARelationship);

  const issueKeys=[randomUUID(),randomUUID()];
  const issuePayload={ownerAccountId:ownerAccountA,evidenceRecordId:ownerEvidence,reason:'Synthetic owner portal invitation.',expiresInHours:2};
  const issueUrl=`/api/v1/sites/${siteA}/owner-access/invitations`;
  const concurrent=await Promise.all(issueKeys.map(key=>app.inject({method:'POST',url:issueUrl,headers:headers(jarA,key),payload:issuePayload})));
  assert.deepEqual(concurrent.map(response=>response.statusCode).sort(),[200,409]);
  const winnerIndex=concurrent.findIndex(response=>response.statusCode===200);assert.ok(winnerIndex>=0);
  const issueKey=issueKeys[winnerIndex] as ReturnType<typeof randomUUID>;const issued=concurrent[winnerIndex];assert.ok(issued);
  const invitation=issued.json() as {invitationId:string;ownerAccountId:string;status:string;expiresAt:string;claimToken:string};
  assert.equal(invitation.ownerAccountId,ownerAccountA);assert.equal(invitation.status,'issued');
  assert.ok(invitation.claimToken.length>=40);assert.ok(Date.parse(invitation.expiresAt)>Date.now());
  const stored=await admin.query('SELECT token_hash,claimed_at,revoked_at FROM vehicle_owner_invitations WHERE id=$1',[invitation.invitationId]);
  assert.equal(stored.rows[0]?.token_hash,createHash('sha256').update(invitation.claimToken).digest('hex'));
  assert.equal(stored.rows[0]?.claimed_at,null);assert.equal(stored.rows[0]?.revoked_at,null);

  const replay=await app.inject({method:'POST',url:issueUrl,headers:headers(jarA,issueKey),payload:issuePayload});
  assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().invitationId,invitation.invitationId);assert.equal('claimToken' in replay.json(),false);
  const duplicate=await app.inject({method:'POST',url:issueUrl,headers:headers(jarA),payload:issuePayload});
  assert.equal(duplicate.statusCode,409);assert.equal((duplicate.json() as {error:{code:string}}).error.code,'INVITATION_ALREADY_ISSUED');

  const wrongIdentity=await startOwnerOidc(invitation.claimToken);
  const rejected=await completeOwnerOidc(wrongIdentity.state,wrongIdentity.jar,'owner-b-code');
  assert.equal(new URL(rejected.headers.location!).searchParams.get('signin'),'not-approved');
  assert.equal(new URL(rejected.headers.location!).searchParams.get('audience'),'owner');
  assert.equal((await admin.query('SELECT claimed_at FROM vehicle_owner_invitations WHERE id=$1',[invitation.invitationId])).rows[0]?.claimed_at,null);

  const claim=await startOwnerOidc(invitation.claimToken);
  const claimed=await completeOwnerOidc(claim.state,claim.jar,'owner-a-code');
  assert.equal(claimed.statusCode,302);
  assert.equal(new URL(claimed.headers.location!).searchParams.get('audience'),'owner');
  const ownerJar:Record<string,string>={};updateCookies(ownerJar,claimed.headers['set-cookie']);
  assert.ok(ownerJar.vmms_owner_session);assert.ok(ownerJar.vmms_csrf);assert.equal(ownerJar.vmms_session,undefined);
  const ownerSetCookies=typeof claimed.headers['set-cookie']==='string'?[claimed.headers['set-cookie']]:claimed.headers['set-cookie']??[];
  const ownerCookie=ownerSetCookies.find(value=>value.startsWith('vmms_owner_session='));
  assert.ok(ownerCookie);assert.match(ownerCookie,/HttpOnly/i);assert.match(ownerCookie,/SameSite=Strict/i);assert.match(ownerCookie,/Path=\/api\/v1\/owner/i);
  assert.equal((await admin.query('SELECT claimed_at FROM vehicle_owner_invitations WHERE id=$1',[invitation.invitationId])).rows[0]?.claimed_at instanceof Date,true);
  assert.equal((await app.inject({url:'/api/v1/owner/session',headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} })).json().authenticated,true);
  const staffCannotReadOwnerVehicles=await app.inject({url:'/api/v1/owner/vehicles',headers:headers(jarA)});
  assert.equal(staffCannotReadOwnerVehicles.statusCode,401,staffCannotReadOwnerVehicles.body);
  const ownerVehicleList=await app.inject({url:'/api/v1/owner/vehicles',headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} });
  assert.equal(ownerVehicleList.statusCode,200,ownerVehicleList.body);
  assert.equal(ownerVehicleList.headers['cache-control'],'no-store');
  const ownerVehicleBody=ownerVehicleList.json() as {vehicles:Array<{id:string;registration:string;make:string;model:string}>};
  assert.deepEqual(ownerVehicleBody.vehicles,[{id:order.vehicle.id,registration:order.vehicle.registration,make:order.vehicle.make,model:order.vehicle.model}]);
  assert.deepEqual(Object.keys(ownerVehicleBody.vehicles[0]!).sort(),['id','make','model','registration']);
  const ownerReadEvents=await admin.query('SELECT organisation_id,site_id,owner_account_id,action,projection_revision,result_count,request_id,created_at FROM owner_vehicle_read_events WHERE owner_account_id=$1',[ownerAccountA]);
  assert.equal(ownerReadEvents.rowCount,1);
  assert.deepEqual(ownerReadEvents.rows[0],{organisation_id:orgA,site_id:siteA,owner_account_id:ownerAccountA,action:'owner-vehicle-list-read-prepared',projection_revision:1,result_count:1,request_id:ownerReadEvents.rows[0]?.request_id,created_at:ownerReadEvents.rows[0]?.created_at});
  assert.match(String(ownerReadEvents.rows[0]?.request_id),/^[0-9a-f-]{36}$/i);
  assert.ok(ownerReadEvents.rows[0]?.created_at instanceof Date);
  for (const statement of [
    'SELECT * FROM owner_vehicle_read_events',
    "INSERT INTO owner_vehicle_read_events(organisation_id,site_id,owner_account_id,action,projection_revision,result_count,request_id) VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','owner-vehicle-list-read-prepared',1,0,gen_random_uuid())",
    'UPDATE owner_vehicle_read_events SET result_count=0',
    'DELETE FROM owner_vehicle_read_events',
    'TRUNCATE owner_vehicle_read_events',
  ]) await assert.rejects(runtime.query(statement),/permission denied/i);
  const functionOwner=(await admin.query("SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='vmms_owner_read_audit_function_owner'")).rows[0];
  assert.deepEqual(functionOwner,{rolcanlogin:false,rolsuper:false,rolbypassrls:false});
  await admin.query('REVOKE INSERT ON owner_vehicle_read_events FROM vmms_owner_read_audit_function_owner');
  try {
    const failedOwnerRead=await app.inject({url:'/api/v1/owner/vehicles',headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} });
    assert.equal(failedOwnerRead.statusCode,500,failedOwnerRead.body);
    assert.equal(failedOwnerRead.body.includes(order.vehicle.registration??''),false);
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM owner_vehicle_read_events WHERE owner_account_id=$1',[ownerAccountA])).rows[0]?.count,1);
  } finally {
    await admin.query('GRANT INSERT (organisation_id,site_id,owner_account_id,action,projection_revision,result_count,request_id) ON owner_vehicle_read_events TO vmms_owner_read_audit_function_owner');
  }
  assert.equal((await app.inject({url:'/api/v1/session',headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} })).json().authenticated,false);
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-orders`,headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} })).statusCode,401);
  const ownerStaffBoundary=[
    await app.inject({url:`/api/v1/sites/${siteA}/workforce/overview`,headers:headers(ownerJar)}),
    await app.inject({url:`/api/v1/sites/${siteA}/evidence/${ownerEvidence}/download`,headers:headers(ownerJar)}),
    await app.inject({url:`/api/v1/sites/${siteA}/documents/${documentId}/download`,headers:headers(ownerJar)}),
    await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${order.id}/complaints`,headers:headers(ownerJar),payload:{expectedVersion:order.version,wording:'Synthetic owner-to-staff mutation attempt.'}}),
    await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/vehicles/${order.vehicle.id}/owner-access/approve`,headers:headers(ownerJar),payload:{expectedVersion:0,ownerAccountId:ownerAccountB,evidenceRecordId:ownerEvidence,reason:'Synthetic owner-to-staff approval attempt.'}}),
  ];
  assert.deepEqual(ownerStaffBoundary.map(response=>response.statusCode),[401,401,401,401,401]);
  for(const response of ownerStaffBoundary){
    assert.equal(response.body.includes(order.vehicle.registration??''),false,'Owner denial responses must not expose staff vehicle details.');
    assert.equal(response.body.includes(order.vehicle.vin),false,'Owner denial responses must not expose staff vehicle identifiers.');
  }
  const staffOrderAfterOwnerWrite=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${order.id}`,headers:headers(jarA)});
  assert.equal(staffOrderAfterOwnerWrite.statusCode,200,staffOrderAfterOwnerWrite.body);
  assert.equal(detailSchema.parse(staffOrderAfterOwnerWrite.json()).version,order.version,'Owner write attempts must not change the staff work order.');
  await assert.rejects(runtime.query('SELECT * FROM owner_sessions'),/permission denied/i);

  const secondOrderResponse=await create(jarA,siteA,'WVWZZZ1JZXW000019');assert.equal(secondOrderResponse.statusCode,200,secondOrderResponse.body);
  const secondOrder=detailSchema.parse(secondOrderResponse.json());
  const secondApproval=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/vehicles/${secondOrder.vehicle.id}/owner-access/approve`,headers:headers(jarA),payload:{expectedVersion:0,ownerAccountId:ownerAccountB,evidenceRecordId:ownerEvidence,reason:'Synthetic second owner vehicle approval.'}});
  assert.equal(secondApproval.statusCode,200,secondApproval.body);
  const secondInvite=await app.inject({method:'POST',url:issueUrl,headers:headers(jarA),payload:{ownerAccountId:ownerAccountB,evidenceRecordId:ownerEvidence,reason:'Synthetic second owner portal invitation.',expiresInHours:2}});
  assert.equal(secondInvite.statusCode,200,secondInvite.body);
  const secondClaim=await startOwnerOidc((secondInvite.json() as {claimToken:string}).claimToken);
  const secondClaimed=await completeOwnerOidc(secondClaim.state,secondClaim.jar,'owner-b-code');
  assert.equal(secondClaimed.statusCode,302);
  const secondOwnerJar:Record<string,string>={};updateCookies(secondOwnerJar,secondClaimed.headers['set-cookie']);
  const secondOwnerVehicles=await app.inject({url:'/api/v1/owner/vehicles',headers:{cookie:`vmms_owner_session=${secondOwnerJar.vmms_owner_session}`} });
  assert.equal(secondOwnerVehicles.statusCode,200,secondOwnerVehicles.body);
  assert.deepEqual((secondOwnerVehicles.json() as {vehicles:Array<{id:string}>}).vehicles.map(vehicle=>vehicle.id),[secondOrder.vehicle.id]);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM owner_vehicle_read_events WHERE owner_account_id=$1 AND site_id=$2',[ownerAccountB,siteA])).rows[0]?.count,1);
  const firstOwnerVehiclesAfterSecondGrant=await app.inject({url:'/api/v1/owner/vehicles',headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} });
  assert.deepEqual((firstOwnerVehiclesAfterSecondGrant.json() as {vehicles:Array<{id:string}>}).vehicles.map(vehicle=>vehicle.id),[order.vehicle.id]);
  const guessedVehicleFilter=await app.inject({url:`/api/v1/owner/vehicles?vehicleId=${secondOrder.vehicle.id}&vin=${encodeURIComponent(secondOrder.vehicle.vin)}`,headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} });
  assert.equal(guessedVehicleFilter.statusCode,200,guessedVehicleFilter.body);
  assert.deepEqual(guessedVehicleFilter.json(),ownerVehicleList.json(),'Client-supplied IDs and VIN filters must not expand the authenticated owner projection.');
  const visibleVehiclePath=await app.inject({url:`/api/v1/owner/vehicles/${secondOrder.vehicle.id}`,headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} });
  const guessedVehiclePath=await app.inject({url:`/api/v1/owner/vehicles/${randomUUID()}`,headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} });
  assert.equal(visibleVehiclePath.statusCode,404);
  assert.equal(guessedVehiclePath.statusCode,visibleVehiclePath.statusCode,'A real but unauthorized vehicle ID must not be distinguishable from a guessed ID.');

  const otherSiteEvidence=randomUUID();
  await admin.query(`INSERT INTO evidence_records(id,organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,purpose_kind,display_name,declared_media_type,quarantine_key,accepted_key)
    VALUES($1,$2,$3,'accepted',$4,'application/pdf',128,$5,'legacy','Synthetic other-site owner approval.pdf','application/pdf',$6,$7)`,
  [otherSiteEvidence,orgA,siteA2,'d'.repeat(64),actorA,`quarantine/${orgA}/${siteA2}/${otherSiteEvidence}`,`accepted/${orgA}/${siteA2}/${otherSiteEvidence}`]);
  await admin.query(`INSERT INTO evidence_scan_attempts(id,organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code,scanned_at)
    VALUES($1,$2,$3,$4,1,'clean',$5,'synthetic-test','1','clean',now())`,[randomUUID(),orgA,siteA2,otherSiteEvidence,'d'.repeat(64)]);
  await admin.query(`INSERT INTO owner_access_approver_grants(id,organisation_id,site_id,staff_user_id,capability,granted_by,evidence_record_id,reason,valid_from,valid_until)
    VALUES($1,$2,$3,$4,'vehicle-owner-access.manage',$4,$5,'Synthetic test-only other-site approval authority',now()-interval '1 minute',now()+interval '1 day')`,
  [randomUUID(),orgA,siteA2,actorA,otherSiteEvidence]);
  const otherSiteApproval=await app.inject({method:'POST',url:`/api/v1/sites/${siteA2}/vehicles/${order.vehicle.id}/owner-access/approve`,headers:headers(jarA),payload:{expectedVersion:0,ownerAccountId:ownerAccountB,evidenceRecordId:otherSiteEvidence,reason:'Synthetic site-isolation verification.'}});
  assert.equal(otherSiteApproval.statusCode,200,otherSiteApproval.body);
  const otherSiteInvite=await app.inject({method:'POST',url:`/api/v1/sites/${siteA2}/owner-access/invitations`,headers:headers(jarA),payload:{ownerAccountId:ownerAccountB,evidenceRecordId:otherSiteEvidence,reason:'Synthetic site-bound invitation.',expiresInHours:2}});
  assert.equal(otherSiteInvite.statusCode,200,otherSiteInvite.body);
  const otherSiteClaim=await startOwnerOidc((otherSiteInvite.json() as {claimToken:string}).claimToken);
  oidcSessionIdOverride=`synthetic-site-a2-session-${randomUUID()}`;
  const otherSiteClaimed=await completeOwnerOidc(otherSiteClaim.state,otherSiteClaim.jar,'owner-b-code');
  oidcSessionIdOverride=undefined;
  assert.equal(otherSiteClaimed.statusCode,302);
  const otherSiteOwnerJar:Record<string,string>={};updateCookies(otherSiteOwnerJar,otherSiteClaimed.headers['set-cookie']);
  const siteA2Vehicles=await app.inject({url:'/api/v1/owner/vehicles',headers:{cookie:`vmms_owner_session=${otherSiteOwnerJar.vmms_owner_session}`} });
  assert.equal(siteA2Vehicles.statusCode,200,siteA2Vehicles.body);
  assert.deepEqual((siteA2Vehicles.json() as {vehicles:Array<{id:string}>}).vehicles.map(vehicle=>vehicle.id),[order.vehicle.id]);
  const siteAVehiclesAfterOtherSiteGrant=await app.inject({url:'/api/v1/owner/vehicles',headers:{cookie:`vmms_owner_session=${secondOwnerJar.vmms_owner_session}`} });
  assert.equal(siteAVehiclesAfterOtherSiteGrant.statusCode,200,siteAVehiclesAfterOtherSiteGrant.body);
  assert.deepEqual((siteAVehiclesAfterOtherSiteGrant.json() as {vehicles:Array<{id:string}>}).vehicles.map(vehicle=>vehicle.id),[secondOrder.vehicle.id]);

  const ownerReplay=await startOwnerOidc(invitation.claimToken);
  const replayed=await completeOwnerOidc(ownerReplay.state,ownerReplay.jar,'owner-a-code');
  assert.equal(new URL(replayed.headers.location!).searchParams.get('signin'),'not-approved');
  assert.equal(new URL(replayed.headers.location!).searchParams.get('audience'),'owner');
  const recovery=await startOwnerOidc();
  const recovered=await completeOwnerOidc(recovery.state,recovery.jar,'owner-a-code');
  assert.equal(new URL(recovered.headers.location!).searchParams.get('audience'),'owner');
  const recoveryJar:Record<string,string>={};updateCookies(recoveryJar,recovered.headers['set-cookie']);
  assert.ok(recoveryJar.vmms_owner_session);assert.equal(recoveryJar.vmms_session,undefined);
  assert.ok(recoveryJar.vmms_owner_session);assert.ok(recoveryJar.vmms_csrf);
  const sharedBrowserJar:Record<string,string>={...await signIn('test-advisor-a'),vmms_owner_session:recoveryJar.vmms_owner_session,vmms_csrf:recoveryJar.vmms_csrf};
  const deniedSharedLogout=await app.inject({method:'DELETE',url:'/api/v1/owner/session/browser',headers:{cookie:headers(sharedBrowserJar).cookie,origin}});
  assert.equal(deniedSharedLogout.statusCode,403,'Shared-browser sign-out requires a valid CSRF token.');
  const logout=await app.inject({method:'DELETE',url:'/api/v1/owner/session/browser',headers:headers(sharedBrowserJar)});
  assert.equal(logout.statusCode,200,logout.body);
  assert.ok((logout.headers['set-cookie'] as string[]).some(value=>value.startsWith('vmms_session=;')&&value.includes('Path=/api/v1')));
  assert.ok((logout.headers['set-cookie'] as string[]).some(value=>value.startsWith('vmms_owner_session=;')&&value.includes('Path=/api/v1/owner')));
  assert.equal(logout.headers['cache-control'],'no-store');
  assert.equal((await app.inject({method:'DELETE',url:'/api/v1/owner/session/browser',headers:headers(sharedBrowserJar)})).statusCode,200,'Repeating browser sign-out is safe.');
  assert.deepEqual((await app.inject({url:'/api/v1/session',headers:{cookie:Object.entries(sharedBrowserJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).json(),{authenticated:false});
  const afterLogout=await app.inject({url:'/api/v1/owner/session',headers:{cookie:Object.entries(recoveryJar).map(([key,value])=>`${key}=${value}`).join('; ')}});
  assert.equal(afterLogout.json().authenticated,false);

  const revokeIssue=await app.inject({method:'POST',url:issueUrl,headers:headers(jarA),payload:issuePayload});
  assert.equal(revokeIssue.statusCode,200,revokeIssue.body);
  const revokeInvitation=revokeIssue.json() as {invitationId:string};
  const revokeKey=randomUUID();
  const revokeUrl=`/api/v1/sites/${siteA}/owner-access/invitations/${revokeInvitation.invitationId}/revoke`;
  const revokePayload={expectedVersion:1,evidenceRecordId:ownerEvidence,reason:'Synthetic invitation was superseded.'};
  const revoked=await app.inject({method:'POST',url:revokeUrl,headers:headers(jarA,revokeKey),payload:revokePayload});
  assert.equal(revoked.statusCode,200,revoked.body);assert.equal(revoked.json().status,'revoked');
  const revokeReplay=await app.inject({method:'POST',url:revokeUrl,headers:headers(jarA,revokeKey),payload:revokePayload});
  assert.deepEqual(revokeReplay.json(),revoked.json());
  assert.ok((await admin.query('SELECT revoked_at FROM vehicle_owner_invitations WHERE id=$1',[revokeInvitation.invitationId])).rows[0]?.revoked_at);

  await assert.rejects(
    scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query('UPDATE vehicle_owner_invitations SET token_hash=$1 WHERE id=$2',['0'.repeat(64),invitation.invitationId])),
    error=>error instanceof Error&&'code' in error&&error.code==='42501',
  );
  const events=await admin.query("SELECT count(*)::int AS count FROM domain_events WHERE aggregate_id=$1 AND aggregate_type='vehicle-owner-invitation'",[revokeInvitation.invitationId]);
  assert.equal(events.rows[0]?.count,2);

  const finalKey=randomUUID();
  const finalIssue=await app.inject({method:'POST',url:issueUrl,headers:headers(jarA,finalKey),payload:issuePayload});
  assert.equal(finalIssue.statusCode,200,finalIssue.body);
  for(let retry=0;retry<7;retry++){
    const replayedIssue=await app.inject({method:'POST',url:issueUrl,headers:headers(jarA,finalKey),payload:issuePayload});
    assert.equal(replayedIssue.statusCode,200,replayedIssue.body);
    assert.equal('claimToken' in replayedIssue.json(),false);
  }
  const revokeOwnerAccess=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/owner-access/${ownerAccess.accessScopeId}/relationships/${ownerARelationship.relationshipId}/revoke`,headers:headers(jarA),payload:{expectedVersion:1,evidenceRecordId:ownerEvidence,reason:'Synthetic revocation before owner vehicle-list recheck.'}});
  assert.equal(revokeOwnerAccess.statusCode,200,revokeOwnerAccess.body);
  const ownerListAfterRevocation=await app.inject({url:'/api/v1/owner/vehicles',headers:{cookie:`vmms_owner_session=${ownerJar.vmms_owner_session}`} });
  assert.equal(ownerListAfterRevocation.statusCode,401,ownerListAfterRevocation.body);
  assert.deepEqual(ownerListAfterRevocation.json(),{error:{code:'OWNER_SESSION_REQUIRED',message:'Your vehicle access is no longer available. Sign in again or contact your service centre.'}});
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM owner_vehicle_read_events WHERE owner_account_id=$1',[ownerAccountA])).rows[0]?.count,3);
});

test('owner access expires at the UTC interval boundary and then records an explicit expiry revision',async()=>{
  const expiresAt=new Date(Date.now()+1800).toISOString();
  const approve=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/vehicles/${orderA.vehicle.id}/owner-access/approve`,headers:headers(jarA),payload:{expectedVersion:3,ownerAccountId:ownerAccountC,evidenceRecordId:ownerEvidence,reason:'Synthetic short-lived owner access.',validUntil:expiresAt}});
  assert.equal(approve.statusCode,200,approve.body);
  const summary=approve.json() as {accessScopeId:string;version:number;relationships:Array<{relationshipId:string;ownerAccountId:string;state:string;currentlyValid:boolean}>};
  assert.equal(summary.version,4);const relation=summary.relationships.find(item=>item.ownerAccountId===ownerAccountC);assert.ok(relation);assert.equal(relation.currentlyValid,true);
  const early=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/owner-access/${summary.accessScopeId}/relationships/${relation.relationshipId}/expire`,headers:headers(jarA),payload:{expectedVersion:4}});assert.equal(early.statusCode,409);
  await new Promise(resolve=>setTimeout(resolve,1900));
  const expired=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/owner-access/${summary.accessScopeId}/relationships/${relation.relationshipId}/expire`,headers:headers(jarA),payload:{expectedVersion:4}});
  assert.equal(expired.statusCode,200,expired.body);const result=expired.json() as typeof summary;
  assert.equal(result.version,5);assert.equal(result.relationships.find(item=>item.ownerAccountId===ownerAccountC)?.state,'expired');assert.equal(result.relationships.find(item=>item.ownerAccountId===ownerAccountC)?.currentlyValid,false);
});

test('owner command outbox failure rolls back scope, relationship, revision, event and receipt',async()=>{
  const created=await create(jarA,siteA,'WVWZZZ1JZXW000006');assert.equal(created.statusCode,200,created.body);
  const order=detailSchema.parse(created.json());
  const counts=()=>admin.query(`SELECT (SELECT count(*) FROM vehicle_owner_access_scopes)::int AS scopes,(SELECT count(*) FROM vehicle_owner_relationships)::int AS relationships,(SELECT count(*) FROM vehicle_owner_revisions)::int AS revisions,(SELECT count(*) FROM aggregate_roots)::int AS roots,(SELECT count(*) FROM domain_events)::int AS events,(SELECT count(*) FROM command_receipts)::int AS receipts`);
  const baseline=await counts();
  await admin.query("CREATE FUNCTION fail_test_owner_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic owner outbox failure'; END $$");
  await admin.query('CREATE TRIGGER fail_test_owner_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION fail_test_owner_outbox()');
  try {
    const response=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/vehicles/${order.vehicle.id}/owner-access/approve`,headers:headers(jarA),payload:{expectedVersion:0,ownerAccountId:ownerAccountA,evidenceRecordId:ownerEvidence,reason:'This approval must roll back.'}});
    assert.equal(response.statusCode,500,response.body);
  } finally {
    await admin.query('DROP TRIGGER fail_test_owner_outbox ON outbox');await admin.query('DROP FUNCTION fail_test_owner_outbox()');
  }
  assert.deepEqual((await counts()).rows,baseline.rows);
});

test('aggregate registry and ledger enforce root type, event version and outbox linkage',async()=>{
  const event=(await admin.query('SELECT id,aggregate_version FROM domain_events WHERE aggregate_id=$1 AND aggregate_type=$2',[orderA.id,'work-order'])).rows[0] as {id:string;aggregate_version:number};
  assert.ok(event);
  await assert.rejects(
    admin.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'work-order')",[orderA.id,orgA,siteA]),
    error=>error instanceof Error&&'code' in error&&error.code==='23505',
  );
  await assert.rejects(
    admin.query("INSERT INTO domain_events(id,organisation_id,site_id,aggregate_id,aggregate_type,aggregate_version,actor_id,event_type,reason,previous_state,new_state) VALUES($1,$2,$3,$4,'work-order',99,$5,'test.event','Synthetic site FK check','{}','{}')",[randomUUID(),orgA,siteA2,orderA.id,actorA]),
    error=>error instanceof Error&&'code' in error&&error.code==='23503',
  );
  await assert.rejects(
    admin.query('INSERT INTO outbox(id,organisation_id,site_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',[randomUUID(),orgA,siteA,event.id,'{}']),
    error=>error instanceof Error&&'code' in error&&error.code==='23505',
  );
  await assert.rejects(
    scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query(
      "INSERT INTO domain_events(id,organisation_id,site_id,aggregate_id,aggregate_type,aggregate_version,actor_id,event_type,reason,previous_state,new_state) VALUES($1,$2,$3,$4,'vehicle-owner-relationship',99,$5,'test.event','Synthetic FK check','{}','{}')",
      [randomUUID(),orgA,siteA,orderA.id,actorA],
    )),
    error=>error instanceof Error&&'code' in error&&error.code==='23503',
  );
  await assert.rejects(
    scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query(
      "INSERT INTO domain_events(id,organisation_id,site_id,aggregate_id,aggregate_type,aggregate_version,actor_id,event_type,reason,previous_state,new_state) VALUES($1,$2,$3,$4,'work-order',$5,$6,'test.event','Synthetic unique check','{}','{}')",
      [randomUUID(),orgA,siteA,orderA.id,event.aggregate_version,actorA],
    )),
    error=>error instanceof Error&&'code' in error&&error.code==='23505',
  );
  await assert.rejects(
    scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query(
      'INSERT INTO outbox(id,organisation_id,site_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(),orgA,siteA,randomUUID(),'{}'],
    )),
    error=>error instanceof Error&&'code' in error&&error.code==='23503',
  );
});

test('simultaneous replay commits once and changed payload key reuse conflicts',async()=>{
  const key=randomUUID(),vin='WVWZZZ1JZXW000002';
  const [a,b]=await Promise.all([create(jarA,siteA,vin,key),create(jarA,siteA,vin,key)]);
  assert.equal(a.statusCode,200,a.body);assert.equal(b.statusCode,200,b.body);assert.deepEqual(a.json(),b.json());
  const changed=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(jarA,key),payload:{...intake(vin),complaint:'Changed intent'}});assert.equal(changed.statusCode,409);
  const counts=await admin.query('SELECT count(*)::int AS count FROM work_orders w JOIN vehicles v ON v.id=w.vehicle_id WHERE w.site_id=$1 AND v.vin=$2',[siteA,vin]);assert.equal(counts.rows[0].count,1);
  const aggregateId=detailSchema.parse(a.json()).id;
  const eventCount=await admin.query('SELECT count(*)::int AS count FROM outbox o JOIN domain_events e ON e.id=o.event_id WHERE e.aggregate_id=$1',[aggregateId]);assert.equal(eventCount.rows[0].count,1);
});

test('command replay rechecks current write access before returning a receipt',async()=>{
  const key=randomUUID(),vin='WVWZZZ1JZXW000005';
  const accepted=await create(jarA,siteA,vin,key);assert.equal(accepted.statusCode,200,accepted.body);
  await admin.query('UPDATE memberships SET can_write=false WHERE user_id=$1 AND site_id=$2',[actorA,siteA]);
  try {
    const replay=await create(jarA,siteA,vin,key);assert.equal(replay.statusCode,403,replay.body);
  } finally {
    await admin.query('UPDATE memberships SET can_write=true WHERE user_id=$1 AND site_id=$2',[actorA,siteA]);
  }
});

test('duplicate VIN does not duplicate customer identity or alter ownership',async()=>{
  const before=await admin.query('SELECT count(*)::int AS count FROM customers');
  const duplicate=await create(jarA,siteA2,'WVWZZZ1JZXW000001');assert.equal(duplicate.statusCode,409,duplicate.body);
  const after=await admin.query('SELECT count(*)::int AS count FROM customers');assert.equal(before.rows[0].count,after.rows[0].count);
});

test('C02 stays on same work order and replay precedes stale-version rejection',async()=>{
  const key=randomUUID();const payload={expectedVersion:orderA.version,wording:'Second independently recorded complaint.'};
  const a=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/complaints`,headers:headers(jarA,key),payload});assert.equal(a.statusCode,200,a.body);
  const b=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/complaints`,headers:headers(jarA,key),payload});assert.equal(b.statusCode,200,b.body);assert.deepEqual(a.json(),b.json());
  orderA=detailSchema.parse(a.json());assert.equal(orderA.complaints[1]?.reference,'C02');assert.equal(orderA.complaints.length,2);
  const visits=await admin.query('SELECT count(*)::int AS count FROM work_orders WHERE id=$1',[orderA.id]);assert.equal(visits.rows[0].count,1);
});

test('concurrent same-version mutations yield exactly one commit',async()=>{
  const version=orderA.version;
  const responses=await Promise.all(['A','B'].map(label=>app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/complaints`,headers:headers(jarA),payload:{expectedVersion:version,wording:`Concurrent complaint ${label}`}})));
  assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409]);
  const successful=responses.find(r=>r.statusCode===200);assert.ok(successful);orderA=detailSchema.parse(successful.json());assert.equal(orderA.version,version+1);
});

test('cross-site and cross-organisation IDs cannot read, mutate or inflate totals',async()=>{
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA2}/work-orders/${orderA.id}`,headers:headers(jarA)})).statusCode,404);
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderB.id}`,headers:headers(jarA)})).statusCode,404);
  assert.equal((await app.inject({url:`/api/v1/sites/${siteB}/work-orders`,headers:headers(jarA)})).statusCode,403);
  const list=await app.inject({url:`/api/v1/sites/${siteA2}/work-orders`,headers:headers(jarA)});
  assert.deepEqual(z.object({items:z.array(z.unknown()),totals:z.object({open:z.number(),held:z.number(),intakeDrafts:z.number()})}).parse(list.json()),{items:[],totals:{open:0,held:0,intakeDrafts:0}});
  const mutation=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderB.id}/complaints`,headers:headers(jarA),payload:{expectedVersion:1,wording:'Cannot write other tenant'}});assert.equal(mutation.statusCode,404);
});

test('planned task holds retain exact scope and do not prevent unrelated planning',async()=>{
  const tasksBefore=orderA.tasks.length;
  const complaint=orderA.complaints[0];assert.ok(complaint);
  const task=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/tasks`,headers:headers(jarA),payload:{expectedVersion:orderA.version,complaintId:complaint.id,title:'Investigate charging report'}});assert.equal(task.statusCode,200,task.body);orderA=detailSchema.parse(task.json());
  const taskId=orderA.tasks[0]?.id;assert.ok(taskId);
  const hold=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/holds`,headers:headers(jarA),payload:{expectedVersion:orderA.version,scope:{kind:'task',taskId},category:'parts',severity:'warning',reason:'Awaiting identification',source:'Advisor observation'}});assert.equal(hold.statusCode,200,hold.body);orderA=detailSchema.parse(hold.json());assert.equal(orderA.holds[0]?.taskId,taskId);
  const other=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/tasks`,headers:headers(jarA),payload:{expectedVersion:orderA.version,complaintId:complaint.id,title:'Plan unrelated visual assessment'}});assert.equal(other.statusCode,200,other.body);orderA=detailSchema.parse(other.json());assert.equal(orderA.tasks.length,tasksBefore+2);assert.ok(orderA.tasks.every(t=>t.state==='planned'));
});

test('diagnostic findings preserve inconclusive risk, stay append-only, and never advance work gates',async()=>{
  const created=await create(jarA,siteA,'WVWZZZ1JZXW000009');assert.equal(created.statusCode,200,created.body);
  let order=detailSchema.parse(created.json());
  const complaint=order.complaints[0];assert.ok(complaint);
  const planned=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${order.id}/tasks`,headers:headers(jarA),payload:{expectedVersion:order.version,complaintId:complaint.id,title:'Investigate charging report'}});
  assert.equal(planned.statusCode,200,planned.body);order=detailSchema.parse(planned.json());
  const task=order.tasks[0];assert.ok(task);
  const expectedVersion=order.version;
  const commandId=randomUUID();
  const payload={expectedVersion,complaintId:complaint.id,taskId:task.id,observedAt:new Date().toISOString(),summary:'Charging fault could not be reproduced during this visit.',certainty:{state:'inconclusive',explanation:'Intermittent symptom was not present under the available test conditions.'},residualRisk:'Underlying charging concern remains unresolved.',restrictions:'Do not represent the charging system as cleared.',observations:[{kind:'reproduction-attempt',conditions:'Two AC charging attempts at the workshop supply.',outcome:'No fault reproduced; customer report remains unverified.'}],evidenceIds:[]};
  const path=`/api/v1/sites/${siteA}/work-orders/${order.id}/diagnostic-findings`;
  const recorded=await app.inject({method:'POST',url:path,headers:headers(jarA,commandId),payload});
  assert.equal(recorded.statusCode,200,recorded.body);
  const result=detailSchema.parse(recorded.json());
  assert.equal(result.version,expectedVersion+1);
  assert.equal(result.diagnosticFindings.length,1);
  assert.deepEqual(result.diagnosticFindings[0]?.certainty,{state:'inconclusive',explanation:payload.certainty.explanation});
  assert.equal(result.diagnosticFindings[0]?.residualRisk,payload.residualRisk);
  assert.equal(result.diagnosticFindings[0]?.restrictions,payload.restrictions);
  assert.equal(result.tasks[0]?.state,'planned');
  assert.ok(result.gates.every(gate=>gate.state==='pending'));
  assert.equal(result.history.at(-1)?.action,'diagnostic.finding-recorded');

  const replay=await app.inject({method:'POST',url:path,headers:headers(jarA,commandId),payload});
  assert.equal(replay.statusCode,200,replay.body);
  assert.equal(detailSchema.parse(replay.json()).diagnosticFindings.length,1);
  const changed=await app.inject({method:'POST',url:path,headers:headers(jarA,commandId),payload:{...payload,summary:'Changed payload.'}});
  assert.equal(changed.statusCode,409,changed.body);

  const stale=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:{...payload,summary:'Stale attempt.'}});
  assert.equal(stale.statusCode,409,stale.body);
  const refreshed=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${order.id}`,headers:headers(jarA)});
  let current=detailSchema.parse(refreshed.json());
  assert.equal(current.version,expectedVersion+1);
  assert.equal(current.diagnosticFindings.length,1);
  const original=current.diagnosticFindings[0];assert.ok(original);
  const correctionPayload={...payload,expectedVersion:current.version,supersedesFindingId:original.id,summary:'Updated observation record with the same unresolved outcome.'};
  const correction=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:correctionPayload});
  assert.equal(correction.statusCode,200,correction.body);
  current=detailSchema.parse(correction.json());
  assert.equal(current.version,expectedVersion+2);
  assert.equal(current.diagnosticFindings.length,2);
  const preserved=current.diagnosticFindings.find(finding=>finding.id===original.id);
  const replacement=current.diagnosticFindings.find(finding=>finding.supersedesFindingId===original.id);
  assert.equal(preserved?.recordedBy,original.recordedBy);
  assert.equal(preserved?.recordedAt,original.recordedAt);
  assert.ok(replacement);
  assert.ok(current.gates.every(gate=>gate.state==='pending'));
  await assert.rejects(scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query('UPDATE diagnostic_findings SET summary=$1 WHERE id=$2',['forged',original.id])),error=>error instanceof Error&&'code' in error&&error.code==='42501');
});

test('invalid task relationship rolls back version and all command records',async()=>{
  const foreignComplaint=orderB.complaints[0];assert.ok(foreignComplaint);
  const counts=await admin.query('SELECT (SELECT count(*) FROM domain_events)::int AS events,(SELECT count(*) FROM command_receipts)::int AS receipts');
  const response=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/tasks`,headers:headers(jarA),payload:{expectedVersion:orderA.version,complaintId:foreignComplaint.id,title:'Invalid association'}});assert.equal(response.statusCode,404,response.body);
  const current=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}`,headers:headers(jarA)});assert.equal(detailSchema.parse(current.json()).version,orderA.version);
  const afterCounts=await admin.query('SELECT (SELECT count(*) FROM domain_events)::int AS events,(SELECT count(*) FROM command_receipts)::int AS receipts');assert.deepEqual(counts.rows,afterCounts.rows);
});

test('forced outbox failure rolls back customer, vehicle, visit, root, WO, event and receipt',async()=>{
  const counts=()=>admin.query(`SELECT (SELECT count(*) FROM customers)::int AS customers,(SELECT count(*) FROM vehicles)::int AS vehicles,(SELECT count(*) FROM visits)::int AS visits,(SELECT count(*) FROM aggregate_roots)::int AS roots,(SELECT count(*) FROM work_orders)::int AS jobs,(SELECT count(*) FROM domain_events)::int AS events,(SELECT count(*) FROM command_receipts)::int AS receipts`);
  const baseline=await counts();
  await admin.query("CREATE FUNCTION fail_test_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$");
  await admin.query('CREATE TRIGGER fail_test_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION fail_test_outbox()');
  try {assert.equal((await create(jarA,siteA,'WVWZZZ1JZXW000003')).statusCode,500);} finally {await admin.query('DROP TRIGGER fail_test_outbox ON outbox');await admin.query('DROP FUNCTION fail_test_outbox()');}
  assert.deepEqual((await counts()).rows,baseline.rows);
});

test('RLS isolates reads and scoped FKs, and pooled scope does not leak after commit',async()=>{
  await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},async client=>{
    assert.equal((await client.query('SELECT id FROM work_orders WHERE id=$1',[orderB.id])).rowCount,0);
    assert.equal((await client.query('SELECT id FROM aggregate_roots WHERE id=$1',[orderB.id])).rowCount,0);
    assert.equal((await client.query('SELECT id FROM domain_events WHERE aggregate_id=$1',[orderB.id])).rowCount,0);
    assert.equal((await client.query('SELECT id FROM outbox WHERE event_id IN (SELECT id FROM domain_events WHERE aggregate_id=$1)',[orderB.id])).rowCount,0);
    const visibleOwnerScopes=await client.query('SELECT id FROM vehicle_owner_access_scopes ORDER BY id');
    const expectedOwnerScopes=await admin.query('SELECT id FROM vehicle_owner_access_scopes WHERE organisation_id=$1 AND site_id=$2 ORDER BY id',[orgA,siteA]);
    assert.deepEqual(visibleOwnerScopes.rows.map(row=>row.id),expectedOwnerScopes.rows.map(row=>row.id));
    const visibleEvidence=await client.query('SELECT id FROM evidence_records ORDER BY id');
    const expectedEvidence=await admin.query('SELECT id FROM evidence_records WHERE organisation_id=$1 AND site_id=$2 ORDER BY id',[orgA,siteA]);
    assert.deepEqual(visibleEvidence.rows.map(row=>row.id),expectedEvidence.rows.map(row=>row.id));
    await assert.rejects(client.query('INSERT INTO tasks(id,organisation_id,site_id,work_order_id,complaint_id,ordinal,title) VALUES($1,$2,$3,$4,$5,99,$6)',[randomUUID(),orgA,siteA,orderA.id,orderB.complaints[0]?.id,'Cross-scope SQL link']),error=>error instanceof Error&&'code' in error&&error.code==='23503');
    throw new Error('roll back aborted synthetic foreign-key check');
  }).catch(error=>assert.match(error.message,/roll back aborted/));
  await scoped(runtime,{actorId:actorB,organisationId:orgB,siteId:siteB},async client=>{
    assert.equal((await client.query('SELECT id FROM vehicle_owner_access_scopes')).rowCount,0);
    assert.equal((await client.query('SELECT id FROM evidence_records')).rowCount,0);
    assert.equal((await client.query('SELECT id FROM vehicle_owner_accounts')).rowCount,0);
  });
  const unscoped=await runtime.query('SELECT id FROM work_orders');assert.equal(unscoped.rowCount,0);
});

test('runtime role cannot rewrite or delete event and idempotency history',async()=>{
  await assert.rejects(runtime.query("UPDATE domain_events SET reason='overwritten'"),error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query('DELETE FROM domain_events'),error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query("UPDATE command_receipts SET fingerprint='changed'"),error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query("UPDATE owner_access_approver_grants SET revoked_at=now()"),error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query("UPDATE evidence_records SET scan_state='rejected'"),error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query('UPDATE vehicle_owner_relationships SET owner_account_id=$1',[ownerAccountB]),error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query("UPDATE vehicle_owner_revisions SET reason='overwritten'"),error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query('UPDATE client_booking_counters SET last_sequence=0'),error=>error instanceof Error&&'code' in error&&error.code==='42501');
});

test('intake observations are attributed, correctable, idempotent, and do not pass G1',async()=>{
  const created=await create(jarA,siteA,'WVWZZZ1JZXW000099');assert.equal(created.statusCode,200,created.body);
  const initial=detailSchema.parse(created.json());
  const path=`/api/v1/sites/${siteA}/work-orders/${initial.id}/intake-facts`;
  const commandId=randomUUID();
  const payload={expectedVersion:initial.version,fact:{kind:'damage-observation',area:'left rear door',description:'Scrape visible before work begins.',evidenceIds:[]}};
  const recorded=await app.inject({method:'POST',url:path,headers:headers(jarA,commandId),payload});
  assert.equal(recorded.statusCode,200,recorded.body);
  const first=detailSchema.parse(recorded.json());
  assert.equal(first.version,initial.version+1);
  assert.equal(first.intakeFacts.length,1);
  assert.equal(first.intakeFacts[0]?.recordedBy,'Advisor A');
  assert.equal(first.intakeFacts[0]?.fact.kind,'damage-observation');
  assert.equal(first.intakeFacts[0]?.fact.kind==='damage-observation' ? first.intakeFacts[0].fact.description : '',payload.fact.description);
  assert.equal(first.intakeFacts[0]?.supersedesFactId,null);
  assert.ok(first.gates.every(gate=>gate.state==='pending'));
  assert.equal(first.history.at(-1)?.action,'intake.fact-recorded');

  const replay=await app.inject({method:'POST',url:path,headers:headers(jarA,commandId),payload});
  assert.equal(replay.statusCode,200,replay.body);
  assert.equal(detailSchema.parse(replay.json()).intakeFacts.length,1);
  const stale=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:{...payload,expectedVersion:initial.version}});
  assert.equal(stale.statusCode,409,stale.body);

  const correction=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:{expectedVersion:first.version,fact:{...payload.fact,description:'Scrape on the left rear door, recorded before work.'},supersedesFactId:first.intakeFacts[0]?.id,correctionReason:'Clarified the location wording.'}});
  assert.equal(correction.statusCode,200,correction.body);
  const corrected=detailSchema.parse(correction.json());
  assert.equal(corrected.intakeFacts.length,2);
  assert.equal(corrected.intakeFacts[0]?.fact.kind,'damage-observation');
  assert.ok(corrected.intakeFacts.some(fact=>fact.supersedesFactId===first.intakeFacts[0]?.id));
  assert.ok(corrected.gates.every(gate=>gate.state==='pending'));
  const branch=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:{expectedVersion:corrected.version,fact:{...payload.fact,description:'A competing correction.'},supersedesFactId:first.intakeFacts[0]?.id,correctionReason:'Attempt to branch the correction history.'}});
  assert.equal(branch.statusCode,409,branch.body);
  assert.equal(branch.json().error.code,'INTAKE_FACT_ALREADY_CORRECTED');
  await assert.rejects(scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},client=>client.query('UPDATE intake_facts SET correction_reason=$1 WHERE id=$2',['forged',first.intakeFacts[0]?.id])),error=>error instanceof Error&&'code' in error&&error.code==='42501');
});

test('membership lock function is narrowly scoped and grants no membership mutation rights',async()=>{
  const unscoped=await runtime.query('SELECT public.lock_membership($1,$2) AS allowed',[actorA,siteA]);
  assert.equal(unscoped.rows[0].allowed,null);
  await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},async client=>{
    const own=await client.query('SELECT public.lock_membership($1,$2) AS allowed',[actorA,siteA]);assert.equal(own.rows[0].allowed,true);
    const wrongActor=await client.query('SELECT public.lock_membership($1,$2) AS allowed',[actorB,siteA]);assert.equal(wrongActor.rows[0].allowed,null);
    const wrongSite=await client.query('SELECT public.lock_membership($1,$2) AS allowed',[actorA,siteA2]);assert.equal(wrongSite.rows[0].allowed,null);
  });
  await assert.rejects(runtime.query('UPDATE memberships SET active=true'),error=>error instanceof Error&&'code' in error&&error.code==='42501');
  const definition=await runtime.query("SELECT p.prosecdef,p.proconfig,EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lock_membership'");
  assert.deepEqual(definition.rows[0],{prosecdef:true,proconfig:['search_path=pg_catalog'],public_execute:false});
});

test('read-only account cannot mutate and revoked membership loses access',async()=>{
  const jar=await signIn('test-reader');
  assert.equal((await create(jar,siteA,'WVWZZZ1JZXW000004')).statusCode,403);
  await admin.query('UPDATE memberships SET active=false WHERE user_id=$1',[reader]);
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-orders`,headers:headers(jar)})).statusCode,403);
});

test('logout invalidates the server session and requires CSRF',async()=>{
  const jar=await signIn('test-reader');
  const rejected=await app.inject({method:'DELETE',url:'/api/v1/session',headers:{cookie:headers(jar).cookie}});assert.equal(rejected.statusCode,403);
  const success=await app.inject({method:'DELETE',url:'/api/v1/session',headers:headers(jar)});assert.equal(success.statusCode,200);
  const session=await app.inject({url:'/api/v1/session',headers:headers(jar)});assert.deepEqual(session.json(),{authenticated:false});
});

test('expired session is rejected by the server for reads and protected routes',async()=>{
  const jar=await signIn('test-reader');
  await admin.query("UPDATE staff_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[reader]);
  assert.deepEqual((await app.inject({url:'/api/v1/session',headers:headers(jar)})).json(),{authenticated:false});
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-orders`,headers:headers(jar)})).statusCode,401);
});

test('revoked server session is rejected by the server for reads and protected routes',async()=>{
  const jar=await signIn('test-reader');
  await admin.query('DELETE FROM staff_sessions WHERE user_id=$1',[reader]);
  assert.deepEqual((await app.inject({url:'/api/v1/session',headers:headers(jar)})).json(),{authenticated:false});
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-orders`,headers:headers(jar)})).statusCode,401);
});

test('login attempts are bounded without leaking account existence',async()=>{
  const jar:Record<string,string>={};
  updateCookies(jar,(await app.inject('/api/v1/session')).headers['set-cookie']);
  for(let attempt=0;attempt<10;attempt++) {
    const result=await app.inject({method:'POST',url:'/api/v1/session',headers:headers(jar),payload:{username:'nonexistent-person',password:'incorrect'}});assert.equal(result.statusCode,401);
  }
  const throttled=await app.inject({method:'POST',url:'/api/v1/session',headers:headers(jar),payload:{username:'nonexistent-person',password:'incorrect'}});assert.equal(throttled.statusCode,429);
});

test('staff OIDC starts are throttled before allocating login transactions',async()=>{
  const before=new Set((await admin.query('SELECT state_hash FROM oidc_login_transactions')).rows.map(row=>String(row.state_hash)));
  const responses=await Promise.all(Array.from({length:61},()=>app.inject({
    url:'/api/v1/auth/oidc/start',remoteAddress:'198.51.100.44',
  })));
  assert.deepEqual(responses.map(response=>response.statusCode).sort(),[...Array(60).fill(302),429]);
  const denied=responses.find(response=>response.statusCode===429);
  assert.ok(denied);
  assert.deepEqual(denied.json(),{error:{code:'TOO_MANY_ATTEMPTS',message:'Too many attempts. Wait before trying again.'}});
  assert.equal(denied.headers['set-cookie'],undefined,'A throttled request must not create a browser binding cookie.');
  const after=(await admin.query('SELECT state_hash FROM oidc_login_transactions')).rows.map(row=>String(row.state_hash));
  assert.equal(after.filter(stateHash=>!before.has(stateHash)).length,60,'Only permitted attempts should allocate OIDC transactions.');
  const bucket=await admin.query('SELECT bucket FROM login_attempts');
  assert.equal(bucket.rows.some(row=>row.bucket==='staff-oidc-network:198.51.100.44'),false,'The raw client address must not be stored.');
});

test('VMMS Operator queues site-scoped account requests without creating identities or workshop roles',async()=>{
  const operatorJar=await signIn('test-operator-a');
  const operatorSession=await app.inject({url:'/api/v1/session',headers:headers(operatorJar)});
  assert.equal(operatorSession.statusCode,200,operatorSession.body);
  assert.deepEqual(operatorSession.json().sites.find((site:{id:string})=>site.id===siteA)?.roleCodes,['vmms-operator']);
  const path=`/api/v1/sites/${siteA}/staff/account-provisioning-requests`;
  const body={email:'New.Staff@Example.test',displayName:'Synthetic New Staff',siteAccess:'read-only',reason:'Synthetic account setup test.'};
  const deniedHeadList=await app.inject({url:path,headers:headers(jarA)});
  assert.equal(deniedHeadList.statusCode,403,deniedHeadList.body);
  assert.equal(deniedHeadList.json().error.code,'OPERATOR_REQUIRED');
  const deniedHeadCreate=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:body});
  assert.equal(deniedHeadCreate.statusCode,403,deniedHeadCreate.body);
  assert.equal(deniedHeadCreate.json().error.code,'OPERATOR_REQUIRED');
  const deniedOperatorOrganogram=await app.inject({url:`/api/v1/sites/${siteA}/staff/organogram`,headers:headers(operatorJar)});
  assert.equal(deniedOperatorOrganogram.statusCode,403,deniedOperatorOrganogram.body);
  assert.equal(deniedOperatorOrganogram.json().error.code,'WORK_ROLE_REQUIRED');
  const deniedOperatorOverview=await app.inject({url:`/api/v1/sites/${siteA}/workforce/overview`,headers:headers(operatorJar)});
  assert.equal(deniedOperatorOverview.statusCode,403,deniedOperatorOverview.body);
  assert.equal(deniedOperatorOverview.json().error.code,'WORK_ROLE_REQUIRED');
  const deniedOperatorWorkOrders=await app.inject({url:`/api/v1/sites/${siteA}/work-orders`,headers:headers(operatorJar)});
  assert.equal(deniedOperatorWorkOrders.statusCode,403,deniedOperatorWorkOrders.body);
  assert.equal(deniedOperatorWorkOrders.json().error.code,'WORK_ROLE_REQUIRED');
  const deniedOperatorIntake=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(operatorJar),payload:{}});
  assert.equal(deniedOperatorIntake.statusCode,403,deniedOperatorIntake.body);
  assert.equal(deniedOperatorIntake.json().error.code,'WORK_ROLE_REQUIRED');
  const deniedOtherSite=await app.inject({url:`/api/v1/sites/${siteA2}/staff/account-provisioning-requests`,headers:headers(operatorJar)});
  assert.equal(deniedOtherSite.statusCode,403,deniedOtherSite.body);

  const commandId=randomUUID();
  const created=await app.inject({method:'POST',url:path,headers:headers(operatorJar,commandId),payload:body});
  assert.equal(created.statusCode,200,created.body);
  assert.equal(created.json().state,'queued');
  assert.equal(created.json().siteAccess,'read-only');
  assert.equal(created.json().displayName,body.displayName);
  assert.equal(JSON.stringify(created.json()).includes('New.Staff@Example.test'),false,'The idempotency receipt and command response must not expose the requested email.');
  const accountRequestId=created.json().id as string;
  const saved=await admin.query(`SELECT email,state,site_access,revision FROM staff_account_provisioning_requests
    WHERE organisation_id=$1 AND site_id=$2 AND id=$3`,[orgA,siteA,accountRequestId]);
  assert.deepEqual(saved.rows[0],{email:'new.staff@example.test',state:'queued',site_access:'read-only',revision:1});
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM staff_users WHERE display_name=$1',[body.displayName])).rows[0]?.count,0,'Queueing a request must not create a staff identity before shared-auth provisioning exists.');
  const ledger=await admin.query(`SELECT event.new_state,outbox.payload,receipt.response
    FROM domain_events event JOIN outbox ON outbox.event_id=event.id
    JOIN command_receipts receipt ON receipt.command_id=$4 AND receipt.actor_id=$5
    WHERE event.organisation_id=$1 AND event.site_id=$2 AND event.aggregate_id=$3`,[orgA,siteA,accountRequestId,commandId,operatorA]);
  assert.equal(ledger.rowCount,1);
  assert.equal(JSON.stringify(ledger.rows[0]).includes('new.staff@example.test'),false,'Audit, outbox and receipt data must not contain the requested email.');

  const replay=await app.inject({method:'POST',url:path,headers:headers(operatorJar,commandId),payload:body});
  assert.equal(replay.statusCode,200,replay.body);
  assert.equal(replay.json().id,accountRequestId);
  const conflict=await app.inject({method:'POST',url:path,headers:headers(operatorJar,commandId),payload:{...body,email:'different@example.test'}});
  assert.equal(conflict.statusCode,409,conflict.body);
  assert.equal(conflict.json().error.code,'IDEMPOTENCY_CONFLICT');
  const duplicate=await app.inject({method:'POST',url:path,headers:headers(operatorJar),payload:{...body,email:'new.staff@EXAMPLE.test'}});
  assert.equal(duplicate.statusCode,409,duplicate.body);
  assert.equal(duplicate.json().error.code,'ACCOUNT_REQUEST_EXISTS');
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM staff_account_provisioning_requests WHERE organisation_id=$1 AND site_id=$2',[orgA,siteA])).rows[0]?.count,1,'A second command ID must not queue the same site email twice.');

  const list=await app.inject({url:`${path}?page=1&pageSize=10`,headers:headers(operatorJar)});
  assert.equal(list.statusCode,200,list.body);
  assert.equal(list.json().requests[0]?.email,'new.staff@example.test');
  assert.equal(list.json().requests[0]?.id,accountRequestId);
  assert.equal(list.json().totalCount,1);
  const readAudit=await admin.query(`SELECT count(*)::int AS count FROM sensitive_read_events
    WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND action='staff-account-requests-read-prepared'`,[orgA,siteA,operatorA]);
  assert.equal(readAudit.rows[0]?.count,1);

  const operatorRoleWrite=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(operatorJar),payload:{staffUserId:actorA,roleCode:'service-advisor',expectedVersion:0,reason:'Synthetic Operator separation check.'}});
  assert.equal(operatorRoleWrite.statusCode,403,operatorRoleWrite.body);
  assert.equal(operatorRoleWrite.json().error.code,'WORK_ROLE_REQUIRED');
  const noGrant=await admin.query(`SELECT count(*)::int AS count FROM staff_authority_grants WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3`,[orgA,siteA,operatorA]);
  assert.equal(noGrant.rows[0]?.count,0);
});

test('an in-flight Operator account request rechecks the role after workforce serialization',async()=>{
  const operatorJar=await signIn('test-operator-a');
  const lock=await admin.connect();
  let transaction=false;
  let pendingRequest:Promise<unknown>|undefined;
  try {
    await lock.query('BEGIN');transaction=true;
    await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce:${orgA}:${siteA}`]);
    pendingRequest=app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/account-provisioning-requests`,headers:headers(operatorJar),payload:{
      email:'revoked.operator.request@example.test',displayName:'Synthetic Revoked Operator Request',siteAccess:'read-only',reason:'Verify role revocation serialization.',
    }});

    let waiting=false;
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
      const blocked=await admin.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`);
      if(Number(blocked.rows[0]?.count)>0){waiting=true;break;}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert(waiting,'The account command must be observed waiting on the shared workforce lock before role revocation.');

    const ended=await lock.query(`UPDATE staff_role_placements SET state='ended',revision=revision+1,updated_by=$4,updated_at=now()
      WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND role_code='vmms-operator' AND state='active' RETURNING id`,[orgA,siteA,operatorA,actorA]);
    assert.equal(ended.rowCount,1);
    await lock.query('COMMIT');transaction=false;

    const response=await pendingRequest as {statusCode:number;body:string;json:()=>{error:{code:string}}};
    assert.equal(response.statusCode,403,response.body);
    assert.equal(response.json().error.code,'OPERATOR_REQUIRED');
    assert.equal(Number((await admin.query(`SELECT count(*)::int AS count FROM staff_account_provisioning_requests
      WHERE organisation_id=$1 AND site_id=$2 AND email='revoked.operator.request@example.test'`,[orgA,siteA])).rows[0]?.count),0,
      'The request must not commit after the Operator placement ends.');
  } finally {
    if(transaction)await lock.query('ROLLBACK');
    lock.release();
    if(pendingRequest)await pendingRequest.catch(()=>undefined);
    await admin.query("UPDATE staff_role_placements SET state='active',revision=revision+1,updated_by=$2,updated_at=now() WHERE id=$1",[operatorPlacementId,actorA]);
  }
});

test('Head can assign existing site roles through an audited idempotent command',async()=>{
  const roleMutationLedger=async()=> (await admin.query(`SELECT
    (SELECT count(*)::int FROM staff_role_placements WHERE organisation_id=$1 AND site_id=$2) AS placements,
    (SELECT count(*)::int FROM staff_role_placement_history WHERE organisation_id=$1 AND site_id=$2) AS history,
    (SELECT count(*)::int FROM aggregate_roots WHERE organisation_id=$1 AND site_id=$2 AND aggregate_type='staff-role-placement') AS roots,
    (SELECT count(*)::int FROM domain_events WHERE organisation_id=$1 AND site_id=$2 AND event_type='workforce.role-assigned') AS events,
    (SELECT count(*)::int FROM outbox o JOIN domain_events e ON e.organisation_id=o.organisation_id AND e.site_id=o.site_id AND e.id=o.event_id
      WHERE e.organisation_id=$1 AND e.site_id=$2 AND e.event_type='workforce.role-assigned') AS outbox`,[orgA,siteA])).rows[0];
  const assertNoCommandReceipt=async(commandId:string)=>{
    const receipt=await admin.query('SELECT 1 FROM command_receipts WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND command_id=$4',[orgA,siteA,actorA,commandId]);
    assert.equal(receipt.rowCount,0,'A rejected role assignment must not persist an idempotency receipt.');
  };
  const organogram=await app.inject({url:`/api/v1/sites/${siteA}/staff/organogram`,headers:headers(jarA)});
  assert.equal(organogram.statusCode,200,organogram.body);
  assert.ok(organogram.json().roles.some((role:{code:string})=>role.code==='head-service-centre'));
  assert.ok(organogram.json().placements.some((placement:{role:{code:string}})=>placement.role.code==='head-service-centre'));
  assert.ok(organogram.json().staff.some((person:{id:string})=>person.id===actorA));
  const audit=await admin.query(`SELECT count(*)::int AS count FROM sensitive_read_events WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND action='workforce-organogram-read-prepared'`,[orgA,siteA,actorA]);
  assert.equal(audit.rows[0]?.count,1);
  const authorityBefore=await admin.query('SELECT count(*)::int AS count FROM staff_authority_grants WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3',[orgA,siteA,actorA]);

  const commandId=randomUUID();
  const body={staffUserId:actorA,roleCode:'service-advisor',reportsToPlacementId:null,expectedVersion:0,reason:'Synthetic test role assignment.'};
  const beforeAssignment=await roleMutationLedger();
  const assigned=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA,commandId),payload:body});
  assert.equal(assigned.statusCode,200,assigned.body);
  assert.equal(assigned.json().staffUserId,actorA);
  assert.equal(assigned.json().role.code,'service-advisor');
  assert.equal(assigned.json().revision,1);
  const afterAssignment=await roleMutationLedger();
  for (const field of ['placements','history','roots','events','outbox'] as const) {
    assert.equal(afterAssignment[field],beforeAssignment[field]+1,`A successful assignment must atomically add one ${field} record.`);
  }
  const assignmentReceipt=await admin.query('SELECT response FROM command_receipts WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND command_id=$4',[orgA,siteA,actorA,commandId]);
  assert.equal(assignmentReceipt.rowCount,1,'A successful assignment must persist exactly one idempotency receipt.');
  const assignmentEvent=await admin.query(`SELECT id,actor_id,aggregate_id,aggregate_type,aggregate_version,event_type,reason
    FROM domain_events WHERE organisation_id=$1 AND site_id=$2 AND aggregate_id=$3 AND event_type='workforce.role-assigned'`,[orgA,siteA,assigned.json().id]);
  assert.deepEqual(assignmentEvent.rows[0],{id:assignmentEvent.rows[0]?.id,actor_id:actorA,aggregate_id:assigned.json().id,aggregate_type:'staff-role-placement',aggregate_version:1,event_type:'workforce.role-assigned',reason:body.reason});
  const assignmentOutbox=await admin.query('SELECT event_id FROM outbox WHERE organisation_id=$1 AND site_id=$2 AND event_id=$3',[orgA,siteA,assignmentEvent.rows[0]?.id]);
  assert.equal(assignmentOutbox.rowCount,1,'The committed role event must have one outbox item.');
  const worker=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{staffUserId:workerA,roleCode:'technician-engineer-trainee',reportsToPlacementId:assigned.json().id,expectedVersion:0,reason:'Synthetic reporting test.'}});
  assert.equal(worker.statusCode,200,worker.body);
  const secondWorkerRole=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{staffUserId:workerA,roleCode:'quality-inspector',reportsToPlacementId:hscPlacementId,expectedVersion:0,reason:'Synthetic combined role test.'}});
  assert.equal(secondWorkerRole.statusCode,200,secondWorkerRole.body);
  const reportingUpdate=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{staffUserId:workerA,roleCode:'quality-inspector',reportsToPlacementId:assigned.json().id,expectedVersion:1,reason:'Synthetic reporting revision test.'}});
  assert.equal(reportingUpdate.statusCode,200,reportingUpdate.body);
  assert.equal(reportingUpdate.json().revision,2);
  assert.equal(reportingUpdate.json().reportsToPlacementId,assigned.json().id);
  const reportingHistory=await admin.query(`SELECT count(*)::int AS count FROM staff_role_placement_history WHERE organisation_id=$1 AND site_id=$2 AND placement_id=$3`,[orgA,siteA,secondWorkerRole.json().id]);
  assert.equal(reportingHistory.rows[0]?.count,2);
  const endManagerWithActiveReports=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements/${assigned.json().id}/end`,headers:headers(jarA),payload:{expectedVersion:assigned.json().revision,reason:'Synthetic active-report protection check.'}});
  assert.equal(endManagerWithActiveReports.statusCode,409,endManagerWithActiveReports.body);
  assert.equal(endManagerWithActiveReports.json().error.code,'ACTIVE_REPORTS_TO_ROLE');
  const unchangedManager=await admin.query(`SELECT state,revision FROM staff_role_placements WHERE organisation_id=$1 AND site_id=$2 AND id=$3`,[orgA,siteA,assigned.json().id]);
  assert.equal(unchangedManager.rows[0]?.state,'active');
  assert.equal(unchangedManager.rows[0]?.revision,assigned.json().revision);
  const unchangedManagerHistory=await admin.query(`SELECT count(*)::int AS count FROM staff_role_placement_history WHERE organisation_id=$1 AND site_id=$2 AND placement_id=$3`,[orgA,siteA,assigned.json().id]);
  assert.equal(unchangedManagerHistory.rows[0]?.count,1,'A denied end must not append role history.');
  const cycle=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{...body,reportsToPlacementId:worker.json().id,expectedVersion:1,reason:'Synthetic cycle rejection test.'}});
  assert.equal(cycle.statusCode,409,cycle.body);
  assert.equal(cycle.json().error.code,'REPORTING_CYCLE');
  const crossSiteCommandId=randomUUID();
  const beforeCrossSite=await roleMutationLedger();
  const crossSiteManager=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA,crossSiteCommandId),payload:{...body,roleCode:'quality-inspector',reportsToPlacementId:crossSiteSameOrgPlacementId,expectedVersion:0,reason:'Synthetic same-organization cross-site reporting denial.'}});
  assert.equal(crossSiteManager.statusCode,409,crossSiteManager.body);
  assert.equal(crossSiteManager.json().error.code,'REPORTING_MANAGER_UNAVAILABLE');
  assert.deepEqual(await roleMutationLedger(),beforeCrossSite,'A rejected cross-site manager link must not change placement, history, event, or outbox records.');
  await assertNoCommandReceipt(crossSiteCommandId);
  const crossOrganizationCommandId=randomUUID();
  const beforeCrossOrganization=await roleMutationLedger();
  const crossOrganizationManager=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA,crossOrganizationCommandId),payload:{...body,roleCode:'quality-inspector',reportsToPlacementId:crossSitePlacementId,expectedVersion:0,reason:'Synthetic cross-organization reporting denial.'}});
  assert.equal(crossOrganizationManager.statusCode,409,crossOrganizationManager.body);
  assert.equal(crossOrganizationManager.json().error.code,'REPORTING_MANAGER_UNAVAILABLE');
  assert.deepEqual(await roleMutationLedger(),beforeCrossOrganization,'A rejected cross-organization manager link must not change placement, history, event, or outbox records.');
  await assertNoCommandReceipt(crossOrganizationCommandId);
  const beforeReplay=await roleMutationLedger();
  const replay=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA,commandId),payload:body});
  assert.equal(replay.statusCode,200,replay.body);
  assert.equal(replay.json().id,assigned.json().id);
  assert.deepEqual(await roleMutationLedger(),beforeReplay,'Replaying an assignment must not duplicate its placement, history, event, or outbox.');
  const replayReceipt=await admin.query('SELECT 1 FROM command_receipts WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND command_id=$4',[orgA,siteA,actorA,commandId]);
  assert.equal(replayReceipt.rowCount,1,'Replaying an assignment must retain one idempotency receipt.');
  const events=await admin.query(`SELECT count(*)::int AS count FROM domain_events WHERE organisation_id=$1 AND site_id=$2 AND aggregate_id=$3 AND event_type='workforce.role-assigned'`,[orgA,siteA,assigned.json().id]);
  assert.equal(events.rows[0]?.count,1);
  const history=await admin.query(`SELECT count(*)::int AS count FROM staff_role_placement_history WHERE organisation_id=$1 AND site_id=$2 AND placement_id=$3`,[orgA,siteA,assigned.json().id]);
  assert.equal(history.rows[0]?.count,1);
  const endWorker=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements/${worker.json().id}/end`,headers:headers(jarA),payload:{expectedVersion:1,reason:'Synthetic role transition.'}});
  assert.equal(endWorker.statusCode,200,endWorker.body);
  assert.equal(endWorker.json().state,'ended');
  assert.equal(endWorker.json().revision,2);
  const workerHistory=await admin.query(`SELECT count(*)::int AS count FROM staff_role_placement_history WHERE organisation_id=$1 AND site_id=$2 AND placement_id=$3`,[orgA,siteA,worker.json().id]);
  assert.equal(workerHistory.rows[0]?.count,2);
  const inactiveCommandId=randomUUID();
  const beforeInactive=await roleMutationLedger();
  const inactiveManager=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA,inactiveCommandId),payload:{...body,roleCode:'quality-inspector',reportsToPlacementId:worker.json().id,expectedVersion:0,reason:'Synthetic inactive manager denial.'}});
  assert.equal(inactiveManager.statusCode,409,inactiveManager.body);
  assert.equal(inactiveManager.json().error.code,'REPORTING_MANAGER_UNAVAILABLE');
  assert.deepEqual(await roleMutationLedger(),beforeInactive,'A rejected ended-manager link must not change placement, history, event, or outbox records.');
  await assertNoCommandReceipt(inactiveCommandId);
  const inactiveAccountCommandId=randomUUID();
  const beforeInactiveAccount=await roleMutationLedger();
  const inactiveAccountResponse=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA,inactiveAccountCommandId),payload:{...body,roleCode:'quality-inspector',reportsToPlacementId:inactiveAccountManagerPlacementId,expectedVersion:0,reason:'Synthetic inactive manager account denial.'}});
  assert.equal(inactiveAccountResponse.statusCode,409,inactiveAccountResponse.body);
  assert.equal(inactiveAccountResponse.json().error.code,'REPORTING_MANAGER_UNAVAILABLE');
  assert.deepEqual(await roleMutationLedger(),beforeInactiveAccount,'An inactive manager account must not cause placement or ledger writes.');
  await assertNoCommandReceipt(inactiveAccountCommandId);
  const inactiveMembershipCommandId=randomUUID();
  const beforeInactiveMembership=await roleMutationLedger();
  const inactiveMembershipResponse=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA,inactiveMembershipCommandId),payload:{...body,roleCode:'quality-inspector',reportsToPlacementId:inactiveMembershipManagerPlacementId,expectedVersion:0,reason:'Synthetic inactive manager membership denial.'}});
  assert.equal(inactiveMembershipResponse.statusCode,409,inactiveMembershipResponse.body);
  assert.equal(inactiveMembershipResponse.json().error.code,'REPORTING_MANAGER_UNAVAILABLE');
  assert.deepEqual(await roleMutationLedger(),beforeInactiveMembership,'An inactive site membership must not cause placement or ledger writes.');
  await assertNoCommandReceipt(inactiveMembershipCommandId);
  const combined=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{...body,roleCode:'parts-inventory',expectedVersion:0,reason:'Synthetic combined role test.'}});
  assert.equal(combined.statusCode,200,combined.body);
  const combinedCount=await admin.query(`SELECT count(*)::int AS count FROM staff_role_placements WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND state='active'`,[orgA,siteA,actorA]);
  assert.equal(combinedCount.rows[0]?.count,3);
  const secondPage=await app.inject({url:`/api/v1/sites/${siteA}/staff/organogram?page=2&pageSize=1`,headers:headers(jarA)});
  assert.equal(secondPage.statusCode,200,secondPage.body);
  assert.equal(secondPage.json().page,2);
  const expectedPlacementCount=await admin.query('SELECT count(*)::int AS total FROM staff_role_placements WHERE organisation_id=$1 AND site_id=$2',[orgA,siteA]);
  assert.equal(secondPage.json().totalCount,expectedPlacementCount.rows[0]?.total);
  assert.equal(secondPage.json().placements.length,1);
  const refreshed=await app.inject({url:`/api/v1/sites/${siteA}/staff/organogram?page=1&pageSize=50`,headers:headers(jarA)});
  assert.equal(refreshed.statusCode,200,refreshed.body);
  const refreshedActor=refreshed.json().staff.find((person:{id:string})=>person.id===actorA);
  assert.ok(refreshedActor?.rolePlacements.some((placement:{roleCode:string})=>placement.roleCode==='service-advisor'));

  const stale=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:body});
  assert.equal(stale.statusCode,409,stale.body);
  assert.equal(stale.json().error.code,'STALE_VERSION');
  const operator=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{...body,roleCode:'vmms-operator'}});
  assert.equal(operator.statusCode,409,operator.body);
  assert.equal(operator.json().error.code,'ROLE_NOT_ASSIGNABLE');
  const noAuthorityFromRole=await admin.query('SELECT count(*)::int AS count FROM staff_authority_grants WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3',[orgA,siteA,actorA]);
  assert.equal(noAuthorityFromRole.rows[0]?.count,authorityBefore.rows[0]?.count);
  const selfElevation=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{...body,staffUserId:actorA,roleCode:'head-service-centre'}});
  assert.equal(selfElevation.statusCode,403,selfElevation.body);
  assert.equal(selfElevation.json().error.code,'SELF_ELEVATION_DENIED');
  const lastHead=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements/${hscPlacementId}/end`,headers:headers(jarA),payload:{expectedVersion:1,reason:'Synthetic last Head denial.'}});
  assert.equal(lastHead.statusCode,409,lastHead.body);
  assert.equal(lastHead.json().error.code,'LAST_HEAD_ROLE');
  const nonHead=await app.inject({method:'POST',url:`/api/v1/sites/${siteB}/staff/role-placements`,headers:headers(jarB),payload:{...body,staffUserId:actorB}});
  assert.equal(nonHead.statusCode,403,nonHead.body);
  assert.equal(nonHead.json().error.code,'ROLE_REQUIRED');
  const otherSite=await app.inject({url:`/api/v1/sites/${siteB}/staff/organogram`,headers:headers(jarA)});
  assert.equal(otherSite.statusCode,403,otherSite.body);
  const nonHeadRead=await app.inject({url:`/api/v1/sites/${siteB}/staff/organogram`,headers:headers(jarB)});
  assert.equal(nonHeadRead.statusCode,403,nonHeadRead.body);
  const concurrencyRole=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{
    staffUserId:workforceConcurrencyUser,roleCode:'technician-engineer-trainee',reportsToPlacementId:hscPlacementId,expectedVersion:0,reason:'Synthetic reporting concurrency fixture.'
  }});
  assert.equal(concurrencyRole.statusCode,200,concurrencyRole.body);
  const concurrentUpdates=await Promise.all([
    app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{
      staffUserId:actorA,roleCode:'service-advisor',reportsToPlacementId:concurrencyRole.json().id,expectedVersion:assigned.json().revision,reason:'Synthetic first side of concurrent reporting cycle test.'
    }}),
    app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{
      staffUserId:workforceConcurrencyUser,roleCode:'technician-engineer-trainee',reportsToPlacementId:assigned.json().id,expectedVersion:concurrencyRole.json().revision,reason:'Synthetic second side of concurrent reporting cycle test.'
    }}),
  ]);
  assert.deepEqual(concurrentUpdates.map(response=>response.statusCode).sort((left,right)=>left-right),[200,409]);
  assert.equal(concurrentUpdates.find(response=>response.statusCode===409)?.json().error.code,'REPORTING_CYCLE');
  const advisorState=await admin.query('SELECT revision FROM staff_role_placements WHERE id=$1',[assigned.json().id]);
  const resetAdvisor=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{
    staffUserId:actorA,roleCode:'service-advisor',reportsToPlacementId:null,expectedVersion:Number(advisorState.rows[0].revision),reason:'Restore synthetic test hierarchy after concurrency check.'
  }});
  assert.equal(resetAdvisor.statusCode,200,resetAdvisor.body);
  const concurrencyRoleState=await admin.query('SELECT revision FROM staff_role_placements WHERE id=$1',[concurrencyRole.json().id]);
  const resetConcurrencyRole=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{
    staffUserId:workforceConcurrencyUser,roleCode:'technician-engineer-trainee',reportsToPlacementId:hscPlacementId,expectedVersion:Number(concurrencyRoleState.rows[0].revision),reason:'Restore synthetic test hierarchy after concurrency check.'
  }});
  assert.equal(resetConcurrencyRole.statusCode,200,resetConcurrencyRole.body);
  const endedConcurrencyRole=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements/${concurrencyRole.json().id}/end`,headers:headers(jarA),payload:{expectedVersion:resetConcurrencyRole.json().revision,reason:'Close synthetic concurrency fixture role.'}});
  assert.equal(endedConcurrencyRole.statusCode,200,endedConcurrencyRole.body);
  await admin.query('UPDATE memberships SET active=false WHERE user_id=$1 AND site_id=$2',[workforceConcurrencyUser,siteA]);
  await admin.query('UPDATE staff_users SET active=false WHERE id=$1',[workforceConcurrencyUser]);
});

test('Head overview counts the current site stages, audits reads, and permits read-only Head access',async()=>{
  const url=(siteId:string)=>`/api/v1/sites/${siteId}/workforce/overview`;
  const headersA={...headers(jarA)};
  const baselineResponse=await app.inject({url:url(siteA),headers:headersA});
  assert.equal(baselineResponse.statusCode,200,baselineResponse.body);
  const baseline=baselineResponse.json();
  assert.equal(typeof baseline.asOf,'string');
  assert.ok(Number.isFinite(Date.parse(baseline.asOf)),'Overview timestamp must be a valid server-generated snapshot time.');

  const created=[] as Array<{id:string;version:number}>;
  for(let i=1;i<=4;i++) {
    const response=await create(jarA,siteA,`1HGCM82633A${String(100+i).padStart(6,'0')}`);
    assert.equal(response.statusCode,200,response.body);
    created.push(response.json());
  }
  const [awaitingLead,assigned,unreviewed,staleReview]=created;
  assert.ok(awaitingLead&&assigned&&unreviewed&&staleReview);
  await admin.query(`INSERT INTO holds(id,organisation_id,site_id,work_order_id,task_id,category,severity,reason,source,owner_id)
    VALUES($1,$2,$3,$4,NULL,'safety','stop','Synthetic overview hold.','Synthetic test fixture.', $5)`,
  [randomUUID(),orgA,siteA,awaitingLead.id,actorA]);

  const makeReview=async(workOrderId:string,version:number)=>{
    const id=randomUUID();
    const grantId=randomUUID();
    const authorityDecision={grant:{id:grantId,grant_revision:1},decidedAt:new Date().toISOString()};
    await admin.query(`INSERT INTO work_order_operations_reviews(id,organisation_id,site_id,work_order_id,reviewed_by,notes,reviewed_work_order_version,authority_decision)
      VALUES($1,$2,$3,$4,$5,'Synthetic overview fixture',$6,$7::jsonb)`,
    [id,orgA,siteA,workOrderId,actorA,version,JSON.stringify(authorityDecision)]);
    return id;
  };
  const addAssignment=async(workOrderId:string,reviewId:string,createdAt:string)=>{
    const authorityDecision={
      grant:{id:randomUUID(),grant_revision:1},
      qualification:{id:randomUUID(),qualification_revision:1},
      decidedAt:new Date().toISOString(),
    };
    await admin.query(`INSERT INTO work_order_lead_assignments(id,organisation_id,site_id,work_order_id,lead_user_id,powertrain_class,assigned_by,reason,operations_review_id,authority_decision,created_at)
      VALUES($1,$2,$3,$4,$5,'EV',$6,'Synthetic overview fixture',$7,$8::jsonb,$9::timestamptz)`,
    [randomUUID(),orgA,siteA,workOrderId,workerA,actorA,reviewId,JSON.stringify(authorityDecision),createdAt]);
  };

  // This order has a prior review/assignment, then a current review. Its latest assignment still points at the older review.
  await admin.query('UPDATE work_orders SET version=2 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[orgA,siteA,awaitingLead.id]);
  const oldReview=await makeReview(awaitingLead.id,1);
  await addAssignment(awaitingLead.id,oldReview,'2026-11-08T12:00:00Z');
  await makeReview(awaitingLead.id,2);
  const currentReview=await makeReview(assigned.id,assigned.version);
  await addAssignment(assigned.id,currentReview,'2026-11-08T12:01:00Z');
  await admin.query('UPDATE work_orders SET version=3 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[orgA,siteA,staleReview.id]);
  await makeReview(staleReview.id,1);
  await makeReview(staleReview.id,2);

  const auditBefore=Number((await admin.query(`SELECT count(*)::int AS count FROM sensitive_read_events
    WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND action='workforce-overview-read-prepared'`,[orgA,siteA,actorA])).rows[0]?.count);
  const overviewResponse=await app.inject({url:url(siteA),headers:headersA});
  assert.equal(overviewResponse.statusCode,200,overviewResponse.body);
  const overview=overviewResponse.json();
  assert.ok(Number.isFinite(Date.parse(overview.asOf)),'Overview timestamp must be a valid server-generated snapshot time.');
  assert.deepEqual(overview.workOrders,{
    active:baseline.workOrders.active+4,
    held:baseline.workOrders.held+1,
    awaitingOperationsReview:baseline.workOrders.awaitingOperationsReview+2,
    awaitingTeamLead:baseline.workOrders.awaitingTeamLead+1,
    assignedToTeamLead:baseline.workOrders.assignedToTeamLead+1,
  });
  assert.deepEqual(overview.staff,baseline.staff,'Adding work orders must not change site staffing counts.');
  const audit=await admin.query(`SELECT action,result_count FROM sensitive_read_events
    WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND action='workforce-overview-read-prepared' ORDER BY created_at DESC LIMIT 1`,[orgA,siteA,actorA]);
  assert.equal(Number((await admin.query(`SELECT count(*)::int AS count FROM sensitive_read_events
    WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND action='workforce-overview-read-prepared'`,[orgA,siteA,actorA])).rows[0]?.count),auditBefore+1);
  assert.deepEqual(audit.rows[0],{action:'workforce-overview-read-prepared',result_count:1});

  // Actor A has a separate site membership. Verify the second site's reporting fixture stays isolated from Site A's overview.
  const otherSiteHead=randomUUID();
  await admin.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')`,[otherSiteHead,orgA,siteA2]);
  await admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
    VALUES($1,$2,$3,$4,'head-service-centre',$4,$4)`,[otherSiteHead,orgA,siteA2,actorA]);
  await admin.query(`INSERT INTO staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,state,changed_by)
    VALUES($1,$2,$3,1,$4,'head-service-centre','active',$4)`,[orgA,siteA2,otherSiteHead,actorA]);
  const otherSiteResponse=await app.inject({url:url(siteA2),headers:headersA});
  assert.equal(otherSiteResponse.statusCode,200,otherSiteResponse.body);
  assert.deepEqual(otherSiteResponse.json().workOrders,{active:0,held:0,awaitingOperationsReview:0,awaitingTeamLead:0,assignedToTeamLead:0});
  assert.deepEqual(otherSiteResponse.json().staff,{active:2,activeRolePlacements:2});
  const nonHead=await app.inject({url:url(siteB),headers:headers(jarB)});
  assert.equal(nonHead.statusCode,403,nonHead.body);
  assert.equal(nonHead.json().error.code,'ROLE_REQUIRED');

  try {
    await admin.query('UPDATE memberships SET can_write=false WHERE user_id=$1 AND site_id=$2',[actorA,siteA]);
    const readOnlyDirectory=await app.inject({url:`/api/v1/sites/${siteA}/staff/organogram`,headers:headersA});
    assert.equal(readOnlyDirectory.statusCode,200,readOnlyDirectory.body);
    const readOnlyOverview=await app.inject({url:url(siteA),headers:headersA});
    assert.equal(readOnlyOverview.statusCode,200,readOnlyOverview.body);
    const blockedWrite=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/staff/role-placements`,headers:headers(jarA),payload:{
      staffUserId:actorA,roleCode:'service-advisor',reportsToPlacementId:null,expectedVersion:1,reason:'Synthetic read-only write denial.',
    }});
    assert.equal(blockedWrite.statusCode,403,blockedWrite.body);
    assert.equal(blockedWrite.json().error.code,'READ_ONLY');
  } finally {
    await admin.query('UPDATE memberships SET can_write=true WHERE user_id=$1 AND site_id=$2',[actorA,siteA]);
  }
});

test('internal staff messages are Head-sent, participant-only, immutable, no-store and membership-epoch scoped',async()=>{
  // Earlier authorization tests revoke this shared fixture. Restore the reader
  // before this independent security test so its RLS helper assertion checks
  // the active membership epoch rather than test execution order.
  await admin.query('UPDATE memberships SET active=true,can_write=false WHERE user_id=$1 AND site_id=$2',[reader,siteA]);
  const workerJar=await signIn('test-worker-a');
  const readerJar=await signIn('test-reader');
  const sameSiteCreated=await create(jarA,siteA,'WVWZZZ1JZXW111101');
  const otherSiteCreated=await create(jarA,siteA2,'WVWZZZ1JZXW111102');
  assert.equal(sameSiteCreated.statusCode,200,sameSiteCreated.body);
  assert.equal(otherSiteCreated.statusCode,200,otherSiteCreated.body);
  const sameSiteOrder=detailSchema.parse(sameSiteCreated.json());
  const otherSiteOrder=detailSchema.parse(otherSiteCreated.json());
  const base=`/api/v1/sites/${siteA}/staff/messages`;
  const epochs=await admin.query('SELECT user_id,site_id,membership_epoch FROM memberships WHERE (user_id=$1 AND site_id=$2) OR (user_id=$3 AND site_id=$2)',[reader,siteA,workerA]);
  const readerEpoch=epochs.rows.find(row=>row.user_id===reader)?.membership_epoch;
  const workerEpoch=epochs.rows.find(row=>row.user_id===workerA)?.membership_epoch;
  assert.ok(Number.isInteger(readerEpoch));
  assert.ok(Number.isInteger(workerEpoch));
  await scoped(runtime,{actorId:reader,organisationId:orgA,siteId:siteA},async client=>{
    const own=await client.query('SELECT public.staff_message_membership_is_current($1,$2,$3) AS current',[reader,siteA,readerEpoch]);
    assert.equal(own.rows[0]?.current,true,'The helper validates the scoped actor for RLS.');
    const activeOther=await client.query('SELECT public.staff_message_membership_is_current($1,$2,$3) AS current',[workerA,siteA,workerEpoch]);
    const missingOther=await client.query('SELECT public.staff_message_membership_is_current($1,$2,$3) AS current',[randomUUID(),siteA,workerEpoch]);
    assert.equal(activeOther.rows[0]?.current,false,'A guessed active user UUID yields no membership information.');
    assert.equal(missingOther.rows[0]?.current,false,'An unknown UUID yields the same result as an active non-actor.');
    const crossSite=await client.query('SELECT public.staff_message_membership_is_current($1,$2,$3) AS current',[reader,siteA2,readerEpoch]);
    assert.equal(crossSite.rows[0]?.current,false,'The helper denies a site other than the transaction-bound site.');
  });
  const messageBody={recipientUserIds:[workerA],workOrderId:sameSiteOrder.id,body:'Synthetic internal handover note.'};
  const blocked=await app.inject({method:'POST',url:base,headers:headers(workerJar),payload:{...messageBody,recipientUserIds:[actorA]}});
  assert.equal(blocked.statusCode,403,blocked.body);
  assert.equal(blocked.json().error.code,'ROLE_REQUIRED');

  const selfRecipient=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:{...messageBody,recipientUserIds:[actorA]}});
  assert.equal(selfRecipient.statusCode,400,selfRecipient.body);
  assert.equal(selfRecipient.json().error.code,'SELF_RECIPIENT');

  const count=async()=>admin.query(`SELECT
    (SELECT count(*)::int FROM staff_messages) AS messages,
    (SELECT count(*)::int FROM staff_message_recipients) AS recipients,
    (SELECT count(*)::int FROM domain_events) AS events,
    (SELECT count(*)::int FROM command_receipts) AS commands,
    (SELECT count(*)::int FROM outbox) AS outbox`);
  const beforeSend=await count();
  const key=randomUUID();
  const sent=await app.inject({method:'POST',url:base,headers:headers(jarA,key),payload:messageBody});
  assert.equal(sent.statusCode,200,sent.body);
  const sendReceipt=z.object({messageId:z.string().uuid(),createdAt:z.string().datetime({offset:true})}).parse(sent.json());
  const senderList=await app.inject({url:base,headers:headers(jarA)});
  assert.equal(senderList.statusCode,200,senderList.body);
  const item=staffMessageSchema.parse(senderList.json().items.find((message:{id:string})=>message.id===sendReceipt.messageId));
  assert.equal(item.createdAt,sendReceipt.createdAt);
  assert.equal(item.senderUserId,actorA);
  assert.equal(item.recipients.length,1);
  assert.equal(item.recipients[0]?.userId,workerA);
  assert.equal(item.body,messageBody.body);
  assert.equal(item.workOrderId,sameSiteOrder.id);
  assert.equal(item.workOrderReference,sameSiteOrder.reference);
  assert.equal(item.readAt,null);
  const replay=await app.inject({method:'POST',url:base,headers:headers(jarA,key),payload:messageBody});
  assert.equal(replay.statusCode,200,replay.body);
  assert.deepEqual(replay.json(),sendReceipt);
  assert.deepEqual((await count()).rows[0],{
    messages:Number(beforeSend.rows[0]?.messages)+1,
    recipients:Number(beforeSend.rows[0]?.recipients)+1,
    events:Number(beforeSend.rows[0]?.events)+1,
    commands:Number(beforeSend.rows[0]?.commands)+1,
    outbox:Number(beforeSend.rows[0]?.outbox)+1,
  });

  assert.equal(senderList.headers['cache-control'],'no-store');
  assert.equal(senderList.json().canSend,true);
  assert.equal(senderList.json().items[0].id,item.id);
  assert.equal(senderList.json().items[0].recipients[0].displayName,'Worker A');

  const recipientList=await app.inject({url:base,headers:headers(workerJar)});
  assert.equal(recipientList.statusCode,200,recipientList.body);
  assert.equal(recipientList.json().canSend,false);
  assert.equal(recipientList.json().items.length,1);
  assert.deepEqual(recipientList.json().items[0].recipients.map((person:{userId:string})=>person.userId),[workerA]);
  assert.equal(recipientList.json().items[0].body,messageBody.body);
  const unrelatedList=await app.inject({url:base,headers:headers(readerJar)});
  assert.equal(unrelatedList.statusCode,200,unrelatedList.body);
  assert.equal(unrelatedList.json().items.length,0);
  await scoped(runtime,{actorId:reader,organisationId:orgA,siteId:siteA},async client=>{
    assert.equal((await client.query('SELECT body FROM staff_messages WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[orgA,siteA,item.id])).rowCount,0,
      'Database row security withholds message content from an active same-site non-participant.');
  });
  assert.equal((await app.inject({url:base,headers:headers(jarB)})).statusCode,403);
  assert.equal((await app.inject({url:base,headers:headers(workerJar),query:{pageSize:'0'}})).statusCode,400);

  const mismatchedWorkOrder=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:{...messageBody,workOrderId:otherSiteOrder.id}});
  assert.equal(mismatchedWorkOrder.statusCode,404,mismatchedWorkOrder.body);

  const firstReadKey=randomUUID();
  const racingReadKey=randomUUID();
  const [read,racingRead]=await Promise.all([
    app.inject({method:'POST',url:`${base}/${item.id}/read`,headers:headers(workerJar,firstReadKey)}),
    app.inject({method:'POST',url:`${base}/${item.id}/read`,headers:headers(workerJar,racingReadKey)}),
  ]);
  assert.equal(read.statusCode,200,read.body);
  const receipt=z.object({messageId:z.string().uuid(),readAt:z.string().datetime({offset:true})}).parse(read.json());
  assert.equal(racingRead.statusCode,200,racingRead.body);
  assert.deepEqual(racingRead.json(),receipt,'Concurrent reads produce exactly one stable read receipt.');
  const receiptReplay=await app.inject({method:'POST',url:`${base}/${item.id}/read`,headers:headers(workerJar,firstReadKey)});
  assert.equal(receiptReplay.statusCode,200,receiptReplay.body);
  assert.deepEqual(receiptReplay.json(),receipt);
  const duplicateRead=await app.inject({method:'POST',url:`${base}/${item.id}/read`,headers:headers(workerJar)});
  assert.equal(duplicateRead.statusCode,200,duplicateRead.body);
  assert.deepEqual(duplicateRead.json(),receipt);
  const afterRead=await count();
  assert.equal(Number(afterRead.rows[0]?.events),Number(beforeSend.rows[0]?.events)+2);
  assert.equal(Number(afterRead.rows[0]?.outbox),Number(beforeSend.rows[0]?.outbox)+2);
  assert.equal(Number(afterRead.rows[0]?.commands),Number(beforeSend.rows[0]?.commands)+4);
  const recipientAfterRead=await app.inject({url:base,headers:headers(workerJar)});
  assert.equal(recipientAfterRead.json().items[0].readAt,receipt.readAt);
  const senderAfterRead=await app.inject({url:base,headers:headers(jarA)});
  assert.equal(senderAfterRead.json().items[0].recipients[0].readAt,receipt.readAt);

  await scoped(runtime,{actorId:reader,organisationId:orgA,siteId:siteA},async client=>{
    assert.equal((await client.query('SELECT id FROM staff_messages WHERE id=$1',[item.id])).rowCount,0);
    assert.equal((await client.query('SELECT message_id FROM staff_message_recipients WHERE message_id=$1',[item.id])).rowCount,0);
    assert.equal((await client.query('SELECT message_id FROM staff_message_read_receipts WHERE message_id=$1',[item.id])).rowCount,0);
  });
  await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},async client=>{
    await assert.rejects(client.query('UPDATE staff_messages SET version=version+1 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[orgA,siteA,item.id]),
      error=>error instanceof Error&&'code' in error&&error.code==='42501');
  });
  await scoped(runtime,{actorId:workerA,organisationId:orgA,siteId:siteA},async client=>{
    await assert.rejects(client.query('UPDATE staff_messages SET version=version+1 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[orgA,siteA,item.id]),
      error=>error instanceof Error&&'code' in error&&error.code==='42501',
      'A recipient cannot bypass the atomic read command to advance the message version.');
  });
  await scoped(runtime,{actorId:workerA,organisationId:orgA,siteId:siteA},async client=>{
    await assert.rejects(client.query(`INSERT INTO staff_message_read_receipts
      (organisation_id,site_id,message_id,sender_user_id,sender_membership_epoch,reader_user_id,reader_membership_epoch)
      SELECT organisation_id,site_id,id,sender_user_id,sender_membership_epoch,$4,$5
      FROM staff_messages WHERE organisation_id=$1 AND site_id=$2 AND id=$3`,[orgA,siteA,item.id,workerA,workerEpoch]),
      error=>error instanceof Error&&'code' in error&&error.code==='42501',
      'A recipient cannot create an unledgered read receipt directly.');
  });
  await assert.rejects(admin.query('UPDATE staff_messages SET body=$1 WHERE id=$2',['Synthetic altered content.',item.id]),/immutable/i);
  await assert.rejects(admin.query('DELETE FROM staff_message_recipients WHERE message_id=$1',[item.id]),/immutable/i);

  await admin.query('UPDATE memberships SET active=false WHERE user_id=$1 AND site_id=$2',[workerA,siteA]);
  await admin.query('UPDATE memberships SET active=true WHERE user_id=$1 AND site_id=$2',[workerA,siteA]);
  const reactivatedList=await app.inject({url:base,headers:headers(workerJar)});
  assert.equal(reactivatedList.statusCode,200,reactivatedList.body);
  assert.equal(reactivatedList.json().items.length,0,'A reactivated staff member must not regain access to pre-deactivation messages.');
  await scoped(runtime,{actorId:workerA,organisationId:orgA,siteId:siteA},async client=>{
    const oldFingerprint=createHash('sha256').update(JSON.stringify({operation:'workforce.message-read',messageId:item.id})).digest('hex');
    const oldReplay=await client.query(`SELECT * FROM public.record_staff_message_read($1,$2,$3,$4,$5)`,
      [item.id,firstReadKey,oldFingerprint,randomUUID(),randomUUID()]);
    assert.equal(oldReplay.rowCount,0,'The database function denies old read receipts after membership is reactivated at a new epoch.');
  });

  const messagesBeforeRevocationRace=Number((await admin.query('SELECT count(*)::int AS count FROM staff_messages')).rows[0]?.count);
  const revoker=await admin.connect();
  let revocationCommitted=false;
  let raceSettled=false;
  let racingSend:Promise<{statusCode:number;body:string}>|undefined;
  try {
    await revoker.query('BEGIN');
    await revoker.query('UPDATE memberships SET active=false WHERE user_id=$1 AND site_id=$2',[workerA,siteA]);
    const send=app.inject({method:'POST',url:base,headers:headers(jarA),payload:messageBody}).then(response=>{raceSettled=true;return response;});
    racingSend=send;
    let waitingForRevocation=false;
    for(let attempt=0;attempt<200&&!waitingForRevocation;attempt++) {
      const activity=await admin.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%lock_staff_message_recipient%'`);
      waitingForRevocation=Number(activity.rows[0]?.count)>0;
      if(!waitingForRevocation) await new Promise(resolve=>setTimeout(resolve,10));
    }
    assert.equal(waitingForRevocation,true,'The send must wait on the membership row while revocation is pending.');
    assert.equal(raceSettled,false,'The send must not pass the pending membership revocation.');
    await revoker.query('COMMIT');
    revocationCommitted=true;
    const deniedSend=await send;
    assert.equal(deniedSend.statusCode,400,deniedSend.body);
    assert.equal(deniedSend.json().error.code,'RECIPIENT_NOT_AVAILABLE');
    assert.equal(Number((await admin.query('SELECT count(*)::int AS count FROM staff_messages')).rows[0]?.count),messagesBeforeRevocationRace,'No message is committed for a recipient deactivated before send acquired its membership lock.');
    const storedEpochs=await admin.query('SELECT sender_membership_epoch,recipient_membership_epoch FROM staff_message_recipients WHERE message_id=$1 AND recipient_user_id=$2',[item.id,workerA]);
    const stored=storedEpochs.rows[0] as {sender_membership_epoch:number;recipient_membership_epoch:number};
    await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},async client=>{
      await assert.rejects(client.query(`INSERT INTO staff_message_recipients
        (organisation_id,site_id,message_id,sender_user_id,sender_membership_epoch,recipient_user_id,recipient_membership_epoch)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,[orgA,siteA,item.id,actorA,stored.sender_membership_epoch,workerA,stored.recipient_membership_epoch]),/row-level security/,
      'Direct runtime insertion cannot add a recipient while that membership is inactive.');
    });
  } finally {
    if(!revocationCommitted) await revoker.query('ROLLBACK');
    if(!raceSettled&&racingSend) await racingSend;
    await admin.query('UPDATE memberships SET active=true WHERE user_id=$1 AND site_id=$2',[workerA,siteA]);
    revoker.release();
  }
  const currentEpoch=await admin.query('SELECT membership_epoch FROM memberships WHERE user_id=$1 AND site_id=$2',[workerA,siteA]);
  const staleRecipientEpoch=Number(currentEpoch.rows[0]?.membership_epoch)-1;
  const senderEpoch=Number((await admin.query('SELECT sender_membership_epoch FROM staff_message_recipients WHERE message_id=$1 AND recipient_user_id=$2',[item.id,workerA])).rows[0]?.sender_membership_epoch);
  await scoped(runtime,{actorId:actorA,organisationId:orgA,siteId:siteA},async client=>{
    await assert.rejects(client.query(`INSERT INTO staff_message_recipients
      (organisation_id,site_id,message_id,sender_user_id,sender_membership_epoch,recipient_user_id,recipient_membership_epoch)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,[orgA,siteA,item.id,actorA,senderEpoch,workerA,staleRecipientEpoch]),/row-level security/,
    'Direct runtime insertion cannot use an old membership epoch after reactivation.');
  });

  config.STAFF_MESSAGES_ENABLED=false;
  try {
    const disabled=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:messageBody});
    assert.equal(disabled.statusCode,503,disabled.body);
    const disabledInbox=await app.inject({url:base,headers:headers(jarA)});
    assert.equal(disabledInbox.json().canSend,false);
  } finally { config.STAFF_MESSAGES_ENABLED=true; }
});

test('Supervisor task allocations stay scoped to the current handed-off plan and direct reports',async()=>{
  const created=await create(jarA,siteA,'WVWZZZ1JZXW000322');
  assert.equal(created.statusCode,200,created.body);
  let order=detailSchema.parse(created.json());
  const allocationLeadId=randomUUID(),allocationSupervisorId=randomUUID(),allocationRestrictedSupervisorId=randomUUID();
  const staffPasswordHash=await hashPassword(password);
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4),($8,$9,$10,$4)',[
    allocationLeadId,`test-allocation-lead-${allocationLeadId}`,'Synthetic Allocation Lead',staffPasswordHash,
    allocationSupervisorId,`test-allocation-supervisor-${allocationSupervisorId}`,'Synthetic Allocation Supervisor',
    allocationRestrictedSupervisorId,`test-allocation-restricted-${allocationRestrictedSupervisorId}`,'Synthetic Restricted Supervisor',
  ]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true),($3,$2,true),($4,$2,true)',[allocationLeadId,siteA,allocationSupervisorId,allocationRestrictedSupervisorId]);
  for (const [staffUserId,qualificationCode] of [[allocationLeadId,'EV-TEAM-LEAD'],[allocationSupervisorId,'EV-SUPERVISOR']] as const) {
    await admin.query(`INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes)
      VALUES($1,$2,$3,$4,$5,1,'accepted','synthetic-test-evidence',$6,now(),now()-interval '1 minute',now()+interval '1 day',ARRAY['EV'])`,
    [randomUUID(),orgA,siteA,staffUserId,qualificationCode,actorA]);
  }
  await admin.query(`INSERT INTO staff_qualifications(id,organisation_id,site_id,staff_user_id,qualification_code,qualification_revision,state,evidence_reference,assessed_by,assessed_at,valid_from,valid_until,powertrain_classes,restrictions)
    VALUES($1,$2,$3,$4,'EV-SUPERVISOR',1,'accepted','synthetic-test-evidence',$5,now(),now()-interval '1 minute',now()+interval '1 day',ARRAY['EV'],$6)`,
  [randomUUID(),orgA,siteA,allocationRestrictedSupervisorId,actorA,JSON.stringify(['requires-supervision'])]);
  async function grantAuthority(staffUserId:string,capability:string) {
    await admin.query(`INSERT INTO staff_authority_grants(id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from)
      SELECT $1,$2,$3,$4,$5,coalesce(max(grant_revision),0)+1,$6,'Synthetic isolated allocation test grant',now()-interval '1 minute'
      FROM staff_authority_grants WHERE organisation_id=$2 AND site_id=$3 AND staff_user_id=$4 AND capability=$5`,
    [randomUUID(),orgA,siteA,staffUserId,capability,actorA]);
  }
  await grantAuthority(actorA,'work-order.operations-review');
  await grantAuthority(actorA,'work-order.assign-lead');
  await grantAuthority(allocationLeadId,'work-order.prepare-work-plan');
  await grantAuthority(allocationLeadId,'work-order.handoff-supervisor');
  const taskResponse=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${order.id}/tasks`,headers:headers(jarA),payload:{expectedVersion:order.version,complaintId:order.complaints[0]!.id,title:'Synthetic allocation task'}});
  assert.equal(taskResponse.statusCode,200,taskResponse.body);order=detailSchema.parse(taskResponse.json());

  const reviewResponse=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${order.id}/operations-review`,headers:headers(jarA),payload:{expectedVersion:order.version,notes:'Synthetic task allocation Operations review'}});
  assert.equal(reviewResponse.statusCode,200,reviewResponse.body);
  const review=z.object({reviewId:z.string().uuid(),version:z.number()}).parse(reviewResponse.json());
  const leadResponse=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${order.id}/team-lead-assignment`,headers:headers(jarA),payload:{expectedVersion:review.version,operationsReviewId:review.reviewId,leadUserId:allocationLeadId,reason:'Synthetic allocation scenario lead'}});
  assert.equal(leadResponse.statusCode,200,leadResponse.body);
  const orderAfterLead=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${order.id}`,headers:headers(jarA)});
  assert.equal(orderAfterLead.statusCode,200,orderAfterLead.body);order=detailSchema.parse(orderAfterLead.json());

  async function createPlacement(staffUserId:string,roleCode:string,reportsToPlacementId:string|null) {
    const placementId=randomUUID();
    await admin.query(`INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')`,[placementId,orgA,siteA]);
    await admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,reports_to_placement_id,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,[placementId,orgA,siteA,staffUserId,roleCode,reportsToPlacementId,actorA]);
    return placementId;
  }
  async function createWorker(label:string,reportsToPlacementId:string,activeMembership=true) {
    const id=randomUUID();
    await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[id,`test-worker-${id}`,label,await hashPassword(password)]);
    await admin.query('INSERT INTO memberships(user_id,site_id,can_write,active) VALUES($1,$2,true,$3)',[id,siteA,activeMembership]);
    const placementId=await createPlacement(id,'technician-engineer-trainee',reportsToPlacementId);
    return {id,placementId};
  }
  const leadPlacementId=await createPlacement(allocationLeadId,'ev-team-lead',hscPlacementId);
  const supervisorPlacementId=await createPlacement(allocationSupervisorId,'supervisor',leadPlacementId);
  const technicianOne=await createWorker('Synthetic Direct Technician One',supervisorPlacementId);
  const technicianTwo=await createWorker('Synthetic Direct Technician Two',supervisorPlacementId);
  const inactiveTechnician=await createWorker('Synthetic Inactive Technician',supervisorPlacementId,false);
  const indirectTechnician=await createWorker('Synthetic Indirect Technician',leadPlacementId);
  const restrictedSupervisorPlacementId=await createPlacement(allocationRestrictedSupervisorId,'supervisor',leadPlacementId);
  await createPlacement(allocationRestrictedSupervisorId,'ev-team-lead',hscPlacementId);

  const leadSessionForPlan=await signIn(`test-allocation-lead-${allocationLeadId}`);
  const planResponse=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${order.id}/work-plan-revisions`,headers:headers(leadSessionForPlan),payload:{expectedVersion:order.version,rationale:'Synthetic current plan for allocation coverage.',taskIds:[order.tasks.at(-1)!.id]}});
  assert.equal(planResponse.statusCode,200,planResponse.body);
  const plan=z.object({workPlan:z.object({id:z.string().uuid()}),version:z.number()}).parse(planResponse.json());
  const handoffResponse=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${order.id}/supervisor-handoff`,headers:headers(leadSessionForPlan),payload:{expectedVersion:plan.version,supervisorUserId:allocationSupervisorId,workPlanRevisionId:plan.workPlan.id,reason:'Synthetic task allocation handoff'}});
  assert.equal(handoffResponse.statusCode,200,handoffResponse.body);
  const orderAfterHandoff=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${order.id}`,headers:headers(jarA)});
  assert.equal(orderAfterHandoff.statusCode,200,orderAfterHandoff.body);order=detailSchema.parse(orderAfterHandoff.json());

  const currentSupervisorJar=await signIn(`test-allocation-supervisor-${allocationSupervisorId}`);
  const restrictedJar=await signIn(`test-allocation-restricted-${allocationRestrictedSupervisorId}`);
  const allocationPath=`/api/v1/sites/${siteA}/work-orders/${order.id}/task-allocations`;
  const allocationView=await app.inject({url:allocationPath,headers:headers(currentSupervisorJar)});
  assert.equal(allocationView.statusCode,200,allocationView.body);
  assert.deepEqual(allocationView.json().assignees.map((staff:{staffUserId:string})=>staff.staffUserId),[technicianOne.id,technicianTwo.id]);
  assert.equal(allocationView.json().canAssign,true);
  assert.equal(allocationView.json().tasks.length,1);
  const otherSupervisorView=await app.inject({url:allocationPath,headers:headers(restrictedJar)});
  assert.equal(otherSupervisorView.statusCode,200,otherSupervisorView.body);assert.equal(otherSupervisorView.json().canAssign,false);
  assert.equal(otherSupervisorView.json().blockReason,'handoff-required');assert.deepEqual(otherSupervisorView.json().assignees,[]);
  const planRevisionId=z.string().uuid().parse(allocationView.json().planRevisionId);
  const assignedTaskId=order.tasks.at(-1)!.id;
  const assignmentBody={expectedVersion:order.version,planRevisionId,assignments:[{taskId:assignedTaskId,staffUserId:technicianOne.id}]};
  const wrongSupervisor=await app.inject({method:'POST',url:allocationPath,headers:headers(restrictedJar),payload:assignmentBody});
  assert.equal(wrongSupervisor.statusCode,403,wrongSupervisor.body);assert.equal(wrongSupervisor.json().error.code,'CURRENT_SUPERVISOR_REQUIRED');
  const notInPlan=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar),payload:{...assignmentBody,assignments:[{taskId:randomUUID(),staffUserId:technicianOne.id}]}});
  assert.equal(notInPlan.statusCode,409,notInPlan.body);assert.equal(notInPlan.json().error.code,'TASK_NOT_IN_CURRENT_PLAN');
  for (const staffUserId of [indirectTechnician.id,inactiveTechnician.id]) {
    const rejected=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar),payload:{...assignmentBody,assignments:[{taskId:assignedTaskId,staffUserId}]}});
    assert.equal(rejected.statusCode,409,rejected.body);assert.equal(rejected.json().error.code,'STAFF_ASSIGNMENT_INELIGIBLE');
  }
  const duplicateTask=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar),payload:{...assignmentBody,assignments:[{taskId:assignedTaskId,staffUserId:technicianOne.id},{taskId:assignedTaskId,staffUserId:technicianTwo.id}]}});
  assert.equal(duplicateTask.statusCode,400,duplicateTask.body);

  const firstAllocationKey=randomUUID();
  const firstAllocation=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar,firstAllocationKey),payload:assignmentBody});
  assert.equal(firstAllocation.statusCode,200,firstAllocation.body);assert.equal(firstAllocation.json().assignments[0].revision,1);
  const firstAllocationReplay=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar,firstAllocationKey),payload:assignmentBody});
  assert.equal(firstAllocationReplay.statusCode,200,firstAllocationReplay.body);assert.deepEqual(firstAllocationReplay.json(),firstAllocation.json());
  const staleAllocation=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar),payload:assignmentBody});
  assert.equal(staleAllocation.statusCode,409,staleAllocation.body);assert.equal(staleAllocation.json().error.code,'STALE_VERSION');
  order.version=firstAllocation.json().version;
  const allocationsAfterOne=await app.inject({url:allocationPath,headers:headers(currentSupervisorJar)});
  assert.equal(allocationsAfterOne.statusCode,200,allocationsAfterOne.body);assert.equal(allocationsAfterOne.json().canAssign,true);
  assert.equal(allocationsAfterOne.json().tasks[0].assigneeId,technicianOne.id);
  const secondAllocationBody={expectedVersion:order.version,planRevisionId,assignments:[{taskId:assignedTaskId,staffUserId:technicianTwo.id}]};
  const secondAllocation=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar),payload:secondAllocationBody});
  assert.equal(secondAllocation.statusCode,200,secondAllocation.body);assert.equal(secondAllocation.json().assignments[0].revision,2);
  order.version=secondAllocation.json().version;
  const formerAssigneeSession=await signIn(`test-worker-${technicianOne.id}`);
  const currentAssigneeSession=await signIn(`test-worker-${technicianTwo.id}`);
  const formerAssigneeTasks=await app.inject({url:`/api/v1/sites/${siteA}/my-tasks?page=1&pageSize=1`,headers:headers(formerAssigneeSession)});
  assert.equal(formerAssigneeTasks.statusCode,200,formerAssigneeTasks.body);
  assert.deepEqual(formerAssigneeTasks.json().items,[],'the previous assignee must lose visibility after reassignment');
  assert.equal(formerAssigneeTasks.json().pagination.totalItems,0);
  const currentAssigneeTasks=await app.inject({url:`/api/v1/sites/${siteA}/my-tasks?page=1&pageSize=1`,headers:headers(currentAssigneeSession)});
  assert.equal(currentAssigneeTasks.statusCode,200,currentAssigneeTasks.body);
  const currentTask=z.object({workOrderId:z.string().uuid(),bookingReference:z.string(),registration:z.string(),vehicleLabel:z.string(),taskId:z.string().uuid(),taskReference:z.string(),taskTitle:z.string(),supervisorName:z.string(),planRevisionNumber:z.number(),workPlanRevisionId:z.string().uuid(),assignmentRevision:z.number(),assignedAt:z.string()}).strict().parse(currentAssigneeTasks.json().items[0]);
  assert.equal(currentTask.workOrderId,order.id);
  assert.equal(currentTask.taskId,assignedTaskId);
  assert.equal(currentTask.assignmentRevision,2);
  assert.equal(currentTask.supervisorName,'Synthetic Allocation Supervisor');
  const activityPath=`/api/v1/sites/${siteA}/my-tasks/${order.id}/${assignedTaskId}/activity`;
  const activityBody={expectedWorkPlanRevisionId:currentTask.workPlanRevisionId,expectedAssignmentRevision:currentTask.assignmentRevision,entryType:'progress',progressState:'working',requestType:null,note:'Synthetic progress update for API verification.'};
  const activityKey=randomUUID();
  const activityWrite=await app.inject({method:'POST',url:activityPath,headers:headers(currentAssigneeSession,activityKey),payload:activityBody});
  assert.equal(activityWrite.statusCode,200,activityWrite.body);
  const activityReplay=await app.inject({method:'POST',url:activityPath,headers:headers(currentAssigneeSession,activityKey),payload:activityBody});
  assert.equal(activityReplay.statusCode,200,activityReplay.body);assert.deepEqual(activityReplay.json(),activityWrite.json());
  const changedReplay=await app.inject({method:'POST',url:activityPath,headers:headers(currentAssigneeSession,activityKey),payload:{...activityBody,note:'Changed content.'}});
  assert.equal(changedReplay.statusCode,409,changedReplay.body);assert.equal(changedReplay.json().error.code,'IDEMPOTENCY_CONFLICT');
  const activityRead=await app.inject({url:activityPath,headers:headers(currentAssigneeSession)});
  assert.equal(activityRead.statusCode,200,activityRead.body);assert.equal(activityRead.json().items.length,1);
  assert.equal(activityRead.json().items[0].note,activityBody.note);
  const formerActivityRead=await app.inject({url:activityPath,headers:headers(formerAssigneeSession)});
  assert.equal(formerActivityRead.statusCode,409,formerActivityRead.body);
  const acknowledgementBody={...activityBody,entryType:'acknowledgement',progressState:null,note:'Synthetic acknowledgement.'};
  const acknowledgement=await app.inject({method:'POST',url:activityPath,headers:headers(currentAssigneeSession),payload:acknowledgementBody});
  assert.equal(acknowledgement.statusCode,200,acknowledgement.body);
  const repeatedAcknowledgement=await app.inject({method:'POST',url:activityPath,headers:headers(currentAssigneeSession),payload:acknowledgementBody});
  assert.equal(repeatedAcknowledgement.statusCode,409,repeatedAcknowledgement.body);assert.equal(repeatedAcknowledgement.json().error.code,'ALREADY_ACKNOWLEDGED');
  const staleActivity=await app.inject({method:'POST',url:activityPath,headers:headers(currentAssigneeSession),payload:{...activityBody,expectedAssignmentRevision:1}});
  assert.equal(staleActivity.statusCode,409,staleActivity.body);assert.equal(staleActivity.json().error.code,'STALE_TASK_ASSIGNMENT');
  const laborSessionPath=`/api/v1/sites/${siteA}/my-task-labor-session`;
  const laborStartPath=`/api/v1/sites/${siteA}/my-tasks/${order.id}/${assignedTaskId}/labor/start`;
  const laborBefore=await app.inject({url:laborSessionPath,headers:headers(currentAssigneeSession)});
  assert.equal(laborBefore.statusCode,200,laborBefore.body);assert.equal(laborBefore.headers['cache-control'],'no-store');
  assert.deepEqual(laborBefore.json(),{session:null});
  const crossSiteLaborRead=await app.inject({url:`/api/v1/sites/${siteB}/my-task-labor-session`,headers:headers(currentAssigneeSession)});
  assert.equal(crossSiteLaborRead.statusCode,403,'A technician cannot read another site’s active timer.');
  const crossSiteLaborStart=await app.inject({method:'POST',url:`/api/v1/sites/${siteB}/my-tasks/${order.id}/${assignedTaskId}/labor/start`,
    headers:headers(currentAssigneeSession),payload:{expectedWorkPlanRevisionId:currentTask.workPlanRevisionId,expectedAssignmentRevision:currentTask.assignmentRevision}});
  assert.equal(crossSiteLaborStart.statusCode,403,'A technician cannot start a timer through another site route.');
  const staleLaborStart=await app.inject({method:'POST',url:laborStartPath,headers:headers(currentAssigneeSession),payload:{expectedWorkPlanRevisionId:currentTask.workPlanRevisionId,expectedAssignmentRevision:1}});
  assert.equal(staleLaborStart.statusCode,409,staleLaborStart.body);assert.equal(staleLaborStart.json().error.code,'STALE_TASK_ASSIGNMENT');
  const laborStartBody={expectedWorkPlanRevisionId:currentTask.workPlanRevisionId,expectedAssignmentRevision:currentTask.assignmentRevision};
  const invalidLaborStart=await app.inject({method:'POST',url:laborStartPath,headers:headers(currentAssigneeSession),payload:{...laborStartBody,startedAt:'2026-11-14T08:00:00.000Z'}});
  assert.equal(invalidLaborStart.statusCode,400,'The browser must not choose the start time.');
  const workOrderVersionBeforeLabor=Number((await admin.query('SELECT version FROM work_orders WHERE id=$1',[order.id])).rows[0]?.version);
  const laborStartKey=randomUUID();
  const laborStart=await app.inject({method:'POST',url:laborStartPath,headers:headers(currentAssigneeSession,laborStartKey),payload:laborStartBody});
  assert.equal(laborStart.statusCode,200,laborStart.body);
  const startedLabor=z.object({id:z.string().uuid(),workOrderId:z.string().uuid(),taskId:z.string().uuid(),workPlanRevisionId:z.string().uuid(),assignmentRevision:z.number(),startedAt:z.string(),stoppedAt:z.null(),elapsedSeconds:z.number().int().nonnegative()}).strict().parse(laborStart.json());
  assert.equal(startedLabor.workOrderId,order.id);assert.equal(startedLabor.taskId,assignedTaskId);
  assert.equal(startedLabor.assignmentRevision,currentTask.assignmentRevision);
  assert.ok(Date.parse(startedLabor.startedAt)>=Date.now()-10_000,'The start timestamp must come from the server clock.');
  const laborStartReplay=await app.inject({method:'POST',url:laborStartPath,headers:headers(currentAssigneeSession,laborStartKey),payload:laborStartBody});
  assert.equal(laborStartReplay.statusCode,200,laborStartReplay.body);assert.deepEqual(laborStartReplay.json(),laborStart.json());
  const changedLaborReplay=await app.inject({method:'POST',url:laborStartPath,headers:headers(currentAssigneeSession,laborStartKey),payload:{...laborStartBody,expectedAssignmentRevision:1}});
  assert.equal(changedLaborReplay.statusCode,409,'Reusing a start key with stale changed input must be denied.');
  const preservedActiveLabor=await app.inject({url:laborSessionPath,headers:headers(currentAssigneeSession)});
  assert.equal(preservedActiveLabor.json().session.id,startedLabor.id,'A changed-body retry must not create or replace a session.');
  const duplicateLaborStart=await app.inject({method:'POST',url:laborStartPath,headers:headers(currentAssigneeSession),payload:laborStartBody});
  assert.equal(duplicateLaborStart.statusCode,409,duplicateLaborStart.body);assert.equal(duplicateLaborStart.json().error.code,'TASK_LABOR_ALREADY_ACTIVE');
  const activeLabor=await app.inject({url:laborSessionPath,headers:headers(currentAssigneeSession)});
  assert.equal(activeLabor.statusCode,200,activeLabor.body);assert.equal(activeLabor.json().session.id,startedLabor.id);
  const otherUserStop=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/my-task-labor-sessions/${startedLabor.id}/stop`,headers:headers(currentSupervisorJar),payload:{expectedStartedAt:startedLabor.startedAt}});
  assert.equal(otherUserStop.statusCode,404,'Only the session owner may stop the time record.');
  const laborStopPath=`/api/v1/sites/${siteA}/my-task-labor-sessions/${startedLabor.id}/stop`;
  const laborStopBody={expectedStartedAt:startedLabor.startedAt};
  const laborStopKey=randomUUID();
  const laborStop=await app.inject({method:'POST',url:laborStopPath,headers:headers(currentAssigneeSession,laborStopKey),payload:laborStopBody});
  assert.equal(laborStop.statusCode,200,laborStop.body);assert.ok(laborStop.json().stoppedAt);
  const laborStopReplay=await app.inject({method:'POST',url:laborStopPath,headers:headers(currentAssigneeSession,laborStopKey),payload:laborStopBody});
  assert.equal(laborStopReplay.statusCode,200,laborStopReplay.body);assert.deepEqual(laborStopReplay.json(),laborStop.json());
  const noActiveLabor=await app.inject({url:laborSessionPath,headers:headers(currentAssigneeSession)});
  assert.deepEqual(noActiveLabor.json(),{session:null});
  await assert.rejects(admin.query('UPDATE work_order_task_labor_sessions SET assignment_revision=assignment_revision+1 WHERE id=$1',[startedLabor.id]),/immutable/i);
  await assert.rejects(admin.query('DELETE FROM work_order_task_labor_sessions WHERE id=$1',[startedLabor.id]),/immutable/i);
  assert.equal(Number((await admin.query('SELECT version FROM work_orders WHERE id=$1',[order.id])).rows[0]?.version),workOrderVersionBeforeLabor,
    'Time records do not advance or complete the work order.');
  const racingStarts=await Promise.all([randomUUID(),randomUUID()].map(key=>app.inject({
    method:'POST',url:laborStartPath,headers:headers(currentAssigneeSession,key),payload:laborStartBody,
  })));
  assert.deepEqual(racingStarts.map(response=>response.statusCode).sort(),[200,409],
    'Concurrent starts by one technician must leave exactly one open session.');
  const racingWinner=racingStarts.find(response=>response.statusCode===200)!;
  const racingLoser=racingStarts.find(response=>response.statusCode===409)!;
  assert.equal(racingLoser.json().error.code,'TASK_LABOR_ALREADY_ACTIVE');
  const racingSession=racingWinner.json() as typeof startedLabor;
  const racingStop=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/my-task-labor-sessions/${racingSession.id}/stop`,headers:headers(currentAssigneeSession),payload:{expectedStartedAt:racingSession.startedAt}});
  assert.equal(racingStop.statusCode,200,racingStop.body);
  const laborEventTypes=await admin.query(`SELECT event_type FROM domain_events
    WHERE aggregate_id=ANY($1::uuid[]) ORDER BY event_type`,[[startedLabor.id,racingSession.id]]);
  assert.deepEqual(laborEventTypes.rows.map(row=>row.event_type),[
    'work-order.task-labor.started','work-order.task-labor.started',
    'work-order.task-labor.stopped','work-order.task-labor.stopped',
  ]);
  const laborOutboxCount=Number((await admin.query(`SELECT count(*)::int AS count FROM outbox box
    JOIN domain_events event ON event.id=box.event_id
    WHERE event.aggregate_id=ANY($1::uuid[])`,[[startedLabor.id,racingSession.id]])).rows[0]?.count);
  assert.equal(laborOutboxCount,4,'Each committed start/stop is paired with an outbox item.');
  const laborCountsBeforeRollback=await admin.query(`SELECT
      (SELECT count(*)::int FROM work_order_task_labor_sessions WHERE organisation_id=$1 AND site_id=$2 AND actor_user_id=$3) AS sessions,
      (SELECT count(*)::int FROM domain_events WHERE organisation_id=$1 AND site_id=$2 AND event_type LIKE 'work-order.task-labor.%') AS events,
      (SELECT count(*)::int FROM outbox box JOIN domain_events event ON event.id=box.event_id
        WHERE event.organisation_id=$1 AND event.site_id=$2 AND event.event_type LIKE 'work-order.task-labor.%') AS outbox`,[orgA,siteA,technicianTwo.id]);
  await admin.query(`CREATE FUNCTION public.fail_task_labor_outbox_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic task labour outbox failure'; END $$`);
  await admin.query('CREATE TRIGGER fail_task_labor_outbox_test BEFORE INSERT ON public.outbox FOR EACH ROW EXECUTE FUNCTION public.fail_task_labor_outbox_test()');
  try {
    const failedLaborStart=await app.inject({method:'POST',url:laborStartPath,headers:headers(currentAssigneeSession),payload:laborStartBody});
    assert.equal(failedLaborStart.statusCode,500,'Outbox failure must reject the time command.');
  } finally {
    await admin.query('DROP TRIGGER fail_task_labor_outbox_test ON public.outbox');
    await admin.query('DROP FUNCTION public.fail_task_labor_outbox_test()');
  }
  const laborCountsAfterRollback=await admin.query(`SELECT
      (SELECT count(*)::int FROM work_order_task_labor_sessions WHERE organisation_id=$1 AND site_id=$2 AND actor_user_id=$3) AS sessions,
      (SELECT count(*)::int FROM domain_events WHERE organisation_id=$1 AND site_id=$2 AND event_type LIKE 'work-order.task-labor.%') AS events,
      (SELECT count(*)::int FROM outbox box JOIN domain_events event ON event.id=box.event_id
        WHERE event.organisation_id=$1 AND event.site_id=$2 AND event.event_type LIKE 'work-order.task-labor.%') AS outbox`,[orgA,siteA,technicianTwo.id]);
  assert.deepEqual(laborCountsAfterRollback.rows,laborCountsBeforeRollback.rows,
    'Session, audit event and outbox must roll back together.');
  const workEntriesPath=`/api/v1/sites/${siteA}/my-tasks/${order.id}/${assignedTaskId}/work-entries`;
  const workEvidencePath=`/api/v1/sites/${siteA}/my-tasks/${order.id}/${assignedTaskId}/work-evidence?page=1&pageSize=25`;
  const taskEvidenceId=randomUUID();
  const taskEvidenceSha='a'.repeat(64);
  await admin.query(`INSERT INTO evidence_records (
      id,organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,
      purpose_kind,target_id,display_name,declared_media_type,quarantine_key,accepted_key)
    VALUES ($1,$2,$3,'accepted',$4,'application/pdf',128,$5,'work-order',$6,
      'Synthetic road-test evidence.pdf','application/pdf','quarantine/synthetic-road-test.pdf','accepted/synthetic-road-test.pdf')`,
  [taskEvidenceId,orgA,siteA,taskEvidenceSha,technicianTwo.id,order.id]);
  await admin.query(`INSERT INTO evidence_scan_attempts (
      id,organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code,scanned_at)
    VALUES (gen_random_uuid(),$1,$2,$3,1,'clean',$4,'synthetic-test','1','clean',clock_timestamp())`,
  [orgA,siteA,taskEvidenceId,taskEvidenceSha]);
  await admin.query(`INSERT INTO work_order_evidence_links (
      organisation_id,site_id,work_order_id,evidence_id,attached_by)
    VALUES ($1,$2,$3,$4,$5)`,[orgA,siteA,order.id,taskEvidenceId,technicianTwo.id]);
  const taskEvidenceOptions=await app.inject({url:workEvidencePath,headers:headers(currentAssigneeSession)});
  assert.equal(taskEvidenceOptions.statusCode,200,taskEvidenceOptions.body);
  assert.deepEqual(taskEvidenceOptions.json().items,[{
    evidenceId:taskEvidenceId,
    displayName:'Synthetic road-test evidence.pdf',
    mediaType:'application/pdf',
    state:'attached',
    uploadedAt:taskEvidenceOptions.json().items[0].uploadedAt,
  }]);
  assert.equal(taskEvidenceOptions.json().pagination.totalItems,1);
  assert.equal(taskEvidenceOptions.json().workPlanRevisionId,currentTask.workPlanRevisionId);
  const formerAssigneeEvidence=await app.inject({url:workEvidencePath,headers:headers(formerAssigneeSession)});
  assert.equal(formerAssigneeEvidence.statusCode,409);assert.equal(formerAssigneeEvidence.json().error.code,'CURRENT_TASK_ASSIGNMENT_REQUIRED');
  const oversizedEvidencePage=await app.inject({url:`/api/v1/sites/${siteA}/my-tasks/${order.id}/${assignedTaskId}/work-evidence?page=1&pageSize=51`,headers:headers(currentAssigneeSession)});
  assert.equal(oversizedEvidencePage.statusCode,400);
  const workEntryBody={expectedWorkPlanRevisionId:currentTask.workPlanRevisionId,expectedAssignmentRevision:currentTask.assignmentRevision,
    kind:'test',result:'not-reproduced',summary:'Synthetic road test',detail:'No unusual sound was heard or reproduced during this test.',
    observedAt:'2026-11-12T08:00:00.000Z',evidenceIds:[taskEvidenceId],supersedesEntryId:null,correctionReason:null};
  async function insertTaskEvidenceWithScanState(scanState:'quarantined'|'rejected',verdict:'unavailable'|'infected') {
    const evidenceId=randomUUID(),intentId=randomUUID(),sha='b'.repeat(64);
    await admin.query(`INSERT INTO evidence_upload_intents(
        id,organisation_id,site_id,created_by,command_id,purpose_kind,target_id,display_name,declared_media_type,expected_bytes,state,expires_at)
      VALUES($1,$2,$3,$4,$5,'work-order',$6,$7,'application/pdf',128,'completed',now()+interval '10 minutes')`,
    [intentId,orgA,siteA,technicianTwo.id,randomUUID(),order.id,`Synthetic ${scanState} task evidence.pdf`]);
    await admin.query(`INSERT INTO work_order_task_evidence_intents(
        organisation_id,site_id,upload_intent_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [orgA,siteA,intentId,order.id,assignedTaskId,currentTask.workPlanRevisionId,currentTask.assignmentRevision,technicianTwo.id]);
    await admin.query(`INSERT INTO evidence_records(
        id,organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,purpose_kind,target_id,
        display_name,declared_media_type,quarantine_key,accepted_key,upload_intent_id)
      VALUES($1,$2,$3,$4,$5,'application/pdf',128,$6,'work-order',$7,$8,'application/pdf',$9,NULL,$10)`,
    [evidenceId,orgA,siteA,scanState,sha,technicianTwo.id,order.id,`Synthetic ${scanState} task evidence.pdf`,
      `quarantine/synthetic-${evidenceId}`,intentId]);
    await admin.query(`INSERT INTO evidence_scan_attempts(
        id,organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code,scanned_at)
      VALUES(gen_random_uuid(),$1,$2,$3,1,$4,$5,'synthetic-test','1',$4,now())`,
    [orgA,siteA,evidenceId,verdict,verdict==='infected'?sha:null]);
    return evidenceId;
  }
  for (const [scanState,verdict] of [['quarantined','unavailable'],['rejected','infected']] as const) {
    const unavailableTaskEvidence=await insertTaskEvidenceWithScanState(scanState,verdict);
    const deniedTaskEvidence=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession),
      payload:{...workEntryBody,kind:'action',result:'done',summary:`Synthetic ${scanState} evidence denial`,evidenceIds:[unavailableTaskEvidence]}});
    assert.equal(deniedTaskEvidence.statusCode,409,deniedTaskEvidence.body);
    assert.equal(deniedTaskEvidence.json().error.code,'EVIDENCE_NOT_AVAILABLE');
    const deniedEvidenceDownload=await app.inject({url:`/api/v1/sites/${siteA}/evidence/${unavailableTaskEvidence}/download`,headers:headers(currentAssigneeSession)});
    assert(deniedEvidenceDownload.statusCode>=400,`A ${scanState} task file must not be downloadable.`);
    const partialTaskLink=await admin.query(`SELECT count(*)::int AS count FROM work_order_task_evidence_links
      WHERE organisation_id=$1 AND site_id=$2 AND evidence_id=$3`,[orgA,siteA,unavailableTaskEvidence]);
    assert.equal(partialTaskLink.rows[0].count,0,`A ${scanState} task file must not leave a task link.`);
  }
  const historyAfterRejectedEvidence=await admin.query(`SELECT count(*)::int AS count FROM work_order_task_work_entries
    WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND task_id=$4`,[orgA,siteA,order.id,assignedTaskId]);
  assert.equal(historyAfterRejectedEvidence.rows[0].count,0,'Quarantined and rejected task evidence must not leave partial work entries.');
  const workEntryKey=randomUUID();
  const workEntryWrite=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession,workEntryKey),payload:workEntryBody});
  assert.equal(workEntryWrite.statusCode,200,workEntryWrite.body);
  assert.equal(workEntryWrite.json().entry.kind,'test');assert.equal(workEntryWrite.json().entry.result,'not-reproduced');
  assert.deepEqual(workEntryWrite.json().entry.evidenceIds,[taskEvidenceId]);
  assert.equal(workEntryWrite.json().entry.actorName,'Synthetic Direct Technician Two');
  assert.equal(workEntryWrite.json().entry.observedAt,workEntryBody.observedAt);
  const workEntryReplay=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession,workEntryKey),payload:workEntryBody});
  assert.equal(workEntryReplay.statusCode,200,workEntryReplay.body);assert.deepEqual(workEntryReplay.json(),workEntryWrite.json());
  const changedWorkEntryReplay=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession,workEntryKey),payload:{...workEntryBody,detail:'Changed result.'}});
  assert.equal(changedWorkEntryReplay.statusCode,409);assert.equal(changedWorkEntryReplay.json().error.code,'IDEMPOTENCY_CONFLICT');
  const invalidWorkEntry=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession),payload:{...workEntryBody,kind:'action'}});
  assert.equal(invalidWorkEntry.statusCode,400,'A test result cannot be recorded as an action result.');
  const unavailableEvidence=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession),payload:{...workEntryBody,kind:'action',result:'done',summary:'Synthetic work action',evidenceIds:[randomUUID()]}});
  assert.equal(unavailableEvidence.statusCode,409);assert.equal(unavailableEvidence.json().error.code,'EVIDENCE_NOT_AVAILABLE');
  const staleWorkEntry=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession),payload:{...workEntryBody,expectedAssignmentRevision:1}});
  assert.equal(staleWorkEntry.statusCode,409);assert.equal(staleWorkEntry.json().error.code,'STALE_TASK_ASSIGNMENT');
  const workEntryCorrectionBody={...workEntryBody,kind:'test',result:'inconclusive',summary:'Corrected road test note',
    detail:'The earlier wording was incomplete; the test outcome is inconclusive.',supersedesEntryId:workEntryWrite.json().entry.id,correctionReason:'Synthetic correction test.'};
  const correctionKey=randomUUID();
  const correctionWrite=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession,correctionKey),payload:workEntryCorrectionBody});
  assert.equal(correctionWrite.statusCode,200,correctionWrite.body);
  assert.deepEqual(correctionWrite.json().entry.evidenceIds,[taskEvidenceId]);
  const correctionReplay=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession,correctionKey),payload:workEntryCorrectionBody});
  assert.equal(correctionReplay.statusCode,200,correctionReplay.body);assert.deepEqual(correctionReplay.json(),correctionWrite.json());
  const duplicateCorrection=await app.inject({method:'POST',url:workEntriesPath,headers:headers(currentAssigneeSession),payload:{...workEntryCorrectionBody,detail:'A second correction.'}});
  assert.equal(duplicateCorrection.statusCode,409);assert.equal(duplicateCorrection.json().error.code,'CORRECTION_SOURCE_UNAVAILABLE');
  const workHistoryPageOne=await app.inject({url:`${workEntriesPath}?page=1&pageSize=1`,headers:headers(currentAssigneeSession)});
  const workHistoryPageTwo=await app.inject({url:`${workEntriesPath}?page=2&pageSize=1`,headers:headers(currentAssigneeSession)});
  assert.equal(workHistoryPageOne.statusCode,200,workHistoryPageOne.body);assert.equal(workHistoryPageTwo.statusCode,200,workHistoryPageTwo.body);
  assert.deepEqual(workHistoryPageOne.json().pagination,{page:1,pageSize:1,totalItems:2,totalPages:2});
  assert.equal(workHistoryPageOne.json().items[0].id,workEntryWrite.json().entry.id);
  assert.equal(workHistoryPageTwo.json().items[0].supersedesEntryId,workEntryWrite.json().entry.id);
  const serviceReportPath=`/api/v1/sites/${siteA}/work-orders/${order.id}/service-report`;
  const serviceReport=await app.inject({url:serviceReportPath,headers:headers(currentAssigneeSession)});
  assert.equal(serviceReport.statusCode,200,serviceReport.body);
  assert.equal(serviceReport.json().workOrderVersion,order.version);
  assert.equal(serviceReport.json().order.id,order.id);
  assert.deepEqual(serviceReport.json().pagination,{page:1,pageSize:50,totalItems:2,totalPages:1});
  assert.deepEqual(serviceReport.json().entries.map((entry:{id:string;actorName:string})=>({id:entry.id,actorName:entry.actorName})),[
    {id:workEntryWrite.json().entry.id,actorName:'Synthetic Direct Technician Two'},
    {id:correctionWrite.json().entry.id,actorName:'Synthetic Direct Technician Two'},
  ]);
  const reportedRoadTest=serviceReport.json().entries.find((entry:{id:string})=>entry.id===workEntryWrite.json().entry.id);
  assert.deepEqual(reportedRoadTest.evidence,[{
    evidenceId:taskEvidenceId,
    displayName:'Synthetic road-test evidence.pdf',
    mediaType:'application/pdf',
  }]);
  assert.deepEqual(reportedRoadTest.evidenceIds,[taskEvidenceId]);
  assert.equal(JSON.stringify(serviceReport.json()).includes('accepted/synthetic-road-test.pdf'),false,
    'Service reports must not expose private storage object keys.');
  assert.deepEqual(serviceReport.json().entries.find((entry:{id:string})=>entry.id===correctionWrite.json().entry.id).evidence,[{
    evidenceId:taskEvidenceId,
    displayName:'Synthetic road-test evidence.pdf',
    mediaType:'application/pdf',
  }]);
  await admin.query(`INSERT INTO work_order_task_work_entries (
      id,organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,
      actor_user_id,actor_placement_id,entry_kind,result,summary,detail,observed_at,recorded_at)
    SELECT gen_random_uuid(),entry.organisation_id,entry.site_id,entry.work_order_id,entry.task_id,
      entry.work_plan_revision_id,entry.assignment_revision,entry.actor_user_id,entry.actor_placement_id,
      entry.entry_kind,entry.result,'Synthetic overflow entry '||n,
      'Synthetic entry used to verify the report size guard.',NULL,clock_timestamp()+(n*interval '1 millisecond')
    FROM work_order_task_work_entries entry CROSS JOIN generate_series(1,99) AS n
    WHERE entry.id=$1`,[workEntryWrite.json().entry.id]);
  const firstServiceReportPage=await app.inject({url:serviceReportPath,headers:headers(currentAssigneeSession)});
  const missingContinuation=await app.inject({url:`${serviceReportPath}?page=2`,headers:headers(currentAssigneeSession)});
  assert.equal(missingContinuation.statusCode,400,missingContinuation.body);
  const staleContinuation=await app.inject({url:`${serviceReportPath}?page=2&expectedVersion=${order.version+1}&expectedTotal=101`,headers:headers(currentAssigneeSession)});
  assert.equal(staleContinuation.statusCode,409,staleContinuation.body);
  assert.equal(staleContinuation.json().error.code,'SERVICE_REPORT_CHANGED');
  const changedCountContinuation=await app.inject({url:`${serviceReportPath}?page=2&expectedVersion=${order.version}&expectedTotal=100`,headers:headers(currentAssigneeSession)});
  assert.equal(changedCountContinuation.statusCode,409,changedCountContinuation.body);
  assert.equal(changedCountContinuation.json().error.code,'SERVICE_REPORT_CHANGED');
  assert.equal(firstServiceReportPage.statusCode,200,firstServiceReportPage.body);
  assert.deepEqual(firstServiceReportPage.json().pagination,{page:1,pageSize:50,totalItems:101,totalPages:3});
  assert.ok(firstServiceReportPage.json().generatedAt);
  const secondServiceReportPage=await app.inject({url:`${serviceReportPath}?page=2&expectedVersion=${order.version}&expectedTotal=101`,headers:headers(currentAssigneeSession)});
  const thirdServiceReportPage=await app.inject({url:`${serviceReportPath}?page=3&expectedVersion=${order.version}&expectedTotal=101`,headers:headers(currentAssigneeSession)});
  assert.equal(secondServiceReportPage.statusCode,200,secondServiceReportPage.body);
  assert.equal(thirdServiceReportPage.statusCode,200,thirdServiceReportPage.body);
  assert.equal(secondServiceReportPage.json().order,null);
  assert.equal(secondServiceReportPage.json().generatedAt,null);
  assert.deepEqual(secondServiceReportPage.json().pagination,{page:2,pageSize:50,totalItems:101,totalPages:3});
  assert.deepEqual(thirdServiceReportPage.json().pagination,{page:3,pageSize:50,totalItems:101,totalPages:3});
  assert.equal(thirdServiceReportPage.json().entries.length,1);
  const allReportEntries=[...firstServiceReportPage.json().entries,...secondServiceReportPage.json().entries,...thirdServiceReportPage.json().entries];
  assert.equal(allReportEntries.length,101);
  assert.equal(new Set(allReportEntries.map((entry:{id:string})=>entry.id)).size,101,'Report pages must not repeat entries.');
  const formerWorkEntryRead=await app.inject({url:workEntriesPath,headers:headers(formerAssigneeSession)});
  assert.equal(formerWorkEntryRead.statusCode,409);assert.equal(formerWorkEntryRead.json().error.code,'CURRENT_TASK_ASSIGNMENT_REQUIRED');
  const supervisorWorkEntryRead=await app.inject({url:workEntriesPath,headers:headers(currentSupervisorJar)});
  assert.equal(supervisorWorkEntryRead.statusCode,409);assert.equal(supervisorWorkEntryRead.json().error.code,'CURRENT_TASK_ASSIGNMENT_REQUIRED');
  const unchangedAfterWorkEntries=await admin.query('SELECT version FROM work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[orgA,siteA,order.id]);
  assert.equal(Number(unchangedAfterWorkEntries.rows[0].version),order.version,'Work notes must not complete a task or invalidate the work plan.');
  const workEntryEvent=await admin.query(`SELECT event_type,aggregate_type FROM domain_events WHERE aggregate_id=$1`,[workEntryWrite.json().entry.id]);
  assert.equal(workEntryEvent.rowCount,1);assert.equal(workEntryEvent.rows[0].event_type,'work-order.task.work-entry-recorded');
  assert.equal(workEntryEvent.rows[0].aggregate_type,'work-order-task-work-entry');
  const workEntryReadAudits=await admin.query(`SELECT result_count FROM sensitive_read_events
    WHERE site_id=$1 AND actor_id=$2 AND action='work-order-task-work-entries-read-prepared'`,[siteA,technicianTwo.id]);
  assert.equal(workEntryReadAudits.rowCount,2,'Each work-history page is audited.');
  assert(workEntryReadAudits.rows.every(row=>Number(row.result_count)===1));
  const serviceReportReadAudits=await admin.query(`SELECT result_count FROM sensitive_read_events
    WHERE site_id=$1 AND actor_id=$2 AND action='work-order-service-report-read-prepared'`,[siteA,technicianTwo.id]);
  assert.equal(serviceReportReadAudits.rowCount,4,'Every service report page is audited.');
  assert(serviceReportReadAudits.rows.every(row=>Number(row.result_count)<=50),'The audit stores each page size, not the full sensitive report snapshot.');
  assert.equal(serviceReportReadAudits.rows.reduce((sum,row)=>sum+Number(row.result_count),0),103);
  await assert.rejects(admin.query('UPDATE work_order_task_work_entries SET detail=$1 WHERE organisation_id=$2 AND site_id=$3 AND id=$4',['forbidden rewrite',orgA,siteA,workEntryWrite.json().entry.id]),/immutable/);
  const supervisorActivity=await app.inject({url:activityPath,headers:headers(currentSupervisorJar)});
  assert.equal(supervisorActivity.statusCode,403,supervisorActivity.body);
  const supervisorActivityPath=`/api/v1/sites/${siteA}/work-orders/${order.id}/task-activity?page=1&pageSize=25`;
  const supervisorActivityPage=await app.inject({url:supervisorActivityPath,headers:headers(currentSupervisorJar)});
  assert.equal(supervisorActivityPage.statusCode,200,supervisorActivityPage.body);
  assert.deepEqual(supervisorActivityPage.json().pagination,{page:1,pageSize:25,totalItems:2,totalPages:1});
  assert.equal(supervisorActivityPage.json().planRevisionId,plan.workPlan.id);
  assert.deepEqual(supervisorActivityPage.json().items.map((item:{note:string;actorName:string;currentAssigneeName:string;currentAssignmentRevision:number})=>({
    note:item.note,actorName:item.actorName,currentAssigneeName:item.currentAssigneeName,currentAssignmentRevision:item.currentAssignmentRevision,
  })).sort((left:{note:string},right:{note:string})=>left.note.localeCompare(right.note)),[
    {note:'Synthetic acknowledgement.',actorName:'Synthetic Direct Technician Two',currentAssigneeName:'Synthetic Direct Technician Two',currentAssignmentRevision:2},
    {note:activityBody.note,actorName:'Synthetic Direct Technician Two',currentAssigneeName:'Synthetic Direct Technician Two',currentAssignmentRevision:2},
  ].sort((left,right)=>left.note.localeCompare(right.note)));
  const restrictedSupervisorActivity=await app.inject({url:supervisorActivityPath,headers:headers(restrictedJar)});
  assert.equal(restrictedSupervisorActivity.statusCode,403,restrictedSupervisorActivity.body);
  assert.equal(restrictedSupervisorActivity.json().error.code,'TASK_ACTIVITY_READ_REQUIRED');
  const unassignedLeadAllocationView=await app.inject({url:allocationPath,headers:headers(restrictedJar)});
  assert.equal(unassignedLeadAllocationView.statusCode,200,unassignedLeadAllocationView.body);
  assert.equal(unassignedLeadAllocationView.json().activityAudience,null,'An unassigned Team Lead must not be included in task-feed oversight.');
  const leadActivityPage=await app.inject({url:supervisorActivityPath,headers:headers(leadSessionForPlan)});
  assert.equal(leadActivityPage.statusCode,200,leadActivityPage.body);
  assert.equal(leadActivityPage.json().items.length,2,'The assigned Team Lead can read all current plan updates.');
  const headActivityPage=await app.inject({url:supervisorActivityPath,headers:headers(jarA)});
  assert.equal(headActivityPage.statusCode,200,headActivityPage.body);
  assert.equal(headActivityPage.json().items.length,2,'The Head of Service Centre can read all current plan updates.');
  const activityAudienceResponse=await app.inject({url:allocationPath,headers:headers(leadSessionForPlan)});
  assert.equal(activityAudienceResponse.statusCode,200,activityAudienceResponse.body);
  assert.equal(activityAudienceResponse.json().activityAudience,'team-lead');
  const headActivityAudienceResponse=await app.inject({url:allocationPath,headers:headers(jarA)});
  assert.equal(headActivityAudienceResponse.statusCode,200,headActivityAudienceResponse.body);
  assert.equal(headActivityAudienceResponse.json().activityAudience,'head-service-centre');
  const supervisorActivityAudits=await admin.query(`SELECT result_count FROM sensitive_read_events
    WHERE site_id=$1 AND actor_id=$2 AND action='work-order-task-activity-read-prepared'`,[siteA,allocationSupervisorId]);
  assert.equal(supervisorActivityAudits.rowCount,1,'Supervisor task activity reads are audited.');
  assert.equal(Number(supervisorActivityAudits.rows[0].result_count),2);
  const oversightActivityAudits=await admin.query(`SELECT actor_id,result_count FROM sensitive_read_events
    WHERE site_id=$1 AND actor_id=ANY($2::uuid[]) AND action='work-order-task-activity-read-prepared'`,[siteA,[allocationLeadId,actorA]]);
  assert.equal(oversightActivityAudits.rowCount,2,'Assigned lead and Head task feed reads are audited.');
  assert(oversightActivityAudits.rows.every(row=>Number(row.result_count)===2));
  const reassignmentLaborStart=await app.inject({method:'POST',url:laborStartPath,headers:headers(currentAssigneeSession),payload:laborStartBody});
  assert.equal(reassignmentLaborStart.statusCode,200,reassignmentLaborStart.body);
  const reassignmentLaborSession=reassignmentLaborStart.json() as typeof startedLabor;
  const reassignWhileClockRuns=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar),payload:{
    expectedVersion:order.version,planRevisionId,assignments:[{taskId:assignedTaskId,staffUserId:technicianOne.id}],
  }});
  assert.equal(reassignWhileClockRuns.statusCode,200,reassignWhileClockRuns.body);
  assert.equal(reassignWhileClockRuns.json().assignments[0].revision,3);
  order.version=reassignWhileClockRuns.json().version;
  const formerOwnerStop=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/my-task-labor-sessions/${reassignmentLaborSession.id}/stop`,
    headers:headers(currentAssigneeSession),payload:{expectedStartedAt:reassignmentLaborSession.startedAt}});
  assert.equal(formerOwnerStop.statusCode,200,'The owner must be able to stop a session after the task is reassigned.');
  const restoreAssignee=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar),payload:{
    expectedVersion:order.version,planRevisionId,assignments:[{taskId:assignedTaskId,staffUserId:technicianTwo.id}],
  }});
  assert.equal(restoreAssignee.statusCode,200,restoreAssignee.body);
  assert.equal(restoreAssignee.json().assignments[0].revision,4);
  order.version=restoreAssignee.json().version;
  await admin.query('UPDATE staff_role_placements SET reports_to_placement_id=$1 WHERE organisation_id=$2 AND site_id=$3 AND id=$4',
    [restrictedSupervisorPlacementId,orgA,siteA,technicianTwo.placementId]);
  const supervisorAfterTeamMove=await app.inject({url:supervisorActivityPath,headers:headers(currentSupervisorJar)});
  const leadAfterTeamMove=await app.inject({url:supervisorActivityPath,headers:headers(leadSessionForPlan)});
  const headAfterTeamMove=await app.inject({url:supervisorActivityPath,headers:headers(jarA)});
  assert.equal(supervisorAfterTeamMove.statusCode,200,supervisorAfterTeamMove.body);
  assert.equal(leadAfterTeamMove.statusCode,200,leadAfterTeamMove.body);
  assert.equal(headAfterTeamMove.statusCode,200,headAfterTeamMove.body);
  assert.equal(supervisorAfterTeamMove.json().items.length,0,'A moved Technician is excluded from the former Supervisor feed.');
  assert.equal(leadAfterTeamMove.json().items.length,0,'Oversight does not retain updates from a Technician who moved outside the current Supervisor team.');
  assert.equal(headAfterTeamMove.json().items.length,0,'Head visibility follows the current Supervisor team boundary.');
  const unchangedOrder=await admin.query('SELECT version FROM work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[orgA,siteA,order.id]);
  assert.equal(Number(unchangedOrder.rows[0].version),order.version,'progress notes must not change the work-order version or invalidate its plan');
  const activityCount=await admin.query('SELECT count(*)::int AS total FROM work_order_task_activity WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND task_id=$4',[orgA,siteA,order.id,assignedTaskId]);
  assert.equal(activityCount.rows[0].total,2,'same-key replay must not duplicate task history');
  await assert.rejects(admin.query('UPDATE work_order_task_activity SET note=$1 WHERE organisation_id=$2 AND site_id=$3 AND work_order_id=$4 AND task_id=$5',['forbidden rewrite',orgA,siteA,order.id,assignedTaskId]),/immutable/);
  assert.deepEqual(currentAssigneeTasks.json().pagination,{page:1,pageSize:1,totalItems:1,totalPages:1});
  const nonTechnicianTasks=await app.inject({url:`/api/v1/sites/${siteA}/my-tasks`,headers:headers(currentSupervisorJar)});
  assert.equal(nonTechnicianTasks.statusCode,403,nonTechnicianTasks.body);
  assert.equal(nonTechnicianTasks.json().error.code,'TECHNICIAN_ROLE_REQUIRED');
  const queueAudits=await admin.query(`SELECT actor_id,result_count FROM sensitive_read_events
    WHERE site_id=$1 AND action='work-order-queue-read-prepared' AND actor_id IN ($2,$3)
    ORDER BY actor_id`,[siteA,technicianOne.id,technicianTwo.id]);
  assert.equal(queueAudits.rowCount,2,'both personalized task queue reads are audited');
  assert.deepEqual(queueAudits.rows.map(row=>Number(row.result_count)).sort(),[0,1]);
  const taskSearch = async (jar:Record<string,string>, query:string, page=1) => {
    const params=new URLSearchParams({q:query,page:String(page),pageSize:'1'});
    return app.inject({url:`/api/v1/sites/${siteA}/my-tasks?${params}`,headers:headers(jar)});
  };
  for (const query of [
    currentTask.bookingReference.slice(-4).toLowerCase(),
    currentTask.registration.slice(-4).toLowerCase(),
    currentTask.taskReference.toLowerCase(),
    currentTask.taskTitle.slice(4).toLowerCase(),
  ]) {
    const match=await taskSearch(currentAssigneeSession,query);
    assert.equal(match.statusCode,200,match.body);
    assert.equal(match.json().pagination.totalItems,1,`Search should match the assigned task field: ${query}`);
    assert.equal(match.json().items[0].taskId,assignedTaskId);
  }
  const clampedSearch=await taskSearch(currentAssigneeSession,currentTask.taskTitle.toUpperCase(),99);
  assert.equal(clampedSearch.statusCode,200,clampedSearch.body);
  assert.deepEqual(clampedSearch.json().pagination,{page:1,pageSize:1,totalItems:1,totalPages:1},'Filtered pagination clamps a stale page to the matching result set.');
  for (const query of ['%','_','no-current-task-matches-this-text']) {
    const noMatch=await taskSearch(currentAssigneeSession,query);
    assert.equal(noMatch.statusCode,200,noMatch.body);
    assert.deepEqual(noMatch.json().items,[],`Search treats ${query} as literal text and returns no unrelated task.`);
    assert.equal(noMatch.json().pagination.totalItems,0);
    assert.equal(noMatch.json().pagination.page,1);
  }
  const formerAssigneeSearch=await taskSearch(formerAssigneeSession,currentTask.bookingReference);
  assert.equal(formerAssigneeSearch.statusCode,200,formerAssigneeSearch.body);
  assert.deepEqual(formerAssigneeSearch.json().items,[],'Search cannot recover an assignment after it has moved to another Technician.');
  const nonTechnicianSearch=await taskSearch(jarA,currentTask.bookingReference);
  assert.equal(nonTechnicianSearch.statusCode,403,nonTechnicianSearch.body);
  assert.equal(nonTechnicianSearch.json().error.code,'TECHNICIAN_ROLE_REQUIRED','A search term cannot grant the read-only Technician queue to another staff role.');
  const crossSiteSearch=await app.inject({
    url:`/api/v1/sites/${siteB}/my-tasks?q=${encodeURIComponent(currentTask.bookingReference)}`,
    headers:headers(currentAssigneeSession),
  });
  assert.equal(crossSiteSearch.statusCode,403,crossSiteSearch.body);
  assert.equal(crossSiteSearch.json().error.code,'SITE_FORBIDDEN','A search term cannot bypass the current site membership boundary.');
  const privateSearchText=`PRIVATE-SEARCH-${randomUUID()}`;
  const privateSearch=await taskSearch(currentAssigneeSession,privateSearchText);
  assert.equal(privateSearch.statusCode,200,privateSearch.body);
  const serializedAudit=await admin.query(`SELECT to_jsonb(event)::text AS serialized FROM sensitive_read_events event
    WHERE site_id=$1 AND actor_id=$2 AND action='work-order-queue-read-prepared'`,[siteA,technicianTwo.id]);
  assert(serializedAudit.rows.every(row=>!String(row.serialized).includes(privateSearchText)),
    'Sensitive-read events must not retain the raw task-search text.');
  const history=await admin.query('SELECT assignee_user_id,assignment_revision FROM work_order_task_assignment_revisions WHERE work_order_id=$1 AND task_id=$2 ORDER BY assignment_revision',[order.id,assignedTaskId]);
  assert.deepEqual(history.rows.map(row=>({staffUserId:row.assignee_user_id,revision:row.assignment_revision})),[
    {staffUserId:technicianOne.id,revision:1},{staffUserId:technicianTwo.id,revision:2},
    {staffUserId:technicianOne.id,revision:3},{staffUserId:technicianTwo.id,revision:4},
  ]);
  await assert.rejects(runtime.query('UPDATE work_order_task_assignment_revisions SET reason=reason WHERE work_order_id=$1',[order.id]),/permission denied/i);
  await assert.rejects(runtime.query('DELETE FROM work_order_task_assignment_revisions WHERE work_order_id=$1',[order.id]),/permission denied/i);
  const siteBRead=await scoped(runtime,{actorId:actorB,organisationId:orgB,siteId:siteB},client=>client.query('SELECT id FROM work_order_task_assignment_revisions'));
  assert.equal(siteBRead.rowCount,0);

  await admin.query(`CREATE FUNCTION fail_task_allocation_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event_type='work-order.tasks-assigned' THEN RAISE EXCEPTION 'synthetic allocation event failure'; END IF; RETURN NEW; END $$`);
  await admin.query('CREATE TRIGGER fail_task_allocation_event BEFORE INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION fail_task_allocation_event()');
  const beforeRollback=await admin.query('SELECT version FROM work_orders WHERE id=$1',[order.id]);
  const beforeRollbackCount=await admin.query('SELECT count(*)::int AS count FROM work_order_task_assignment_revisions WHERE work_order_id=$1',[order.id]);
  try {
    const failedAllocation=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar),payload:{expectedVersion:order.version,planRevisionId,assignments:[{taskId:assignedTaskId,staffUserId:technicianOne.id}]}});
    assert.equal(failedAllocation.statusCode,500);
  } finally {
    await admin.query('DROP TRIGGER fail_task_allocation_event ON domain_events');await admin.query('DROP FUNCTION fail_task_allocation_event()');
  }
  assert.deepEqual((await admin.query('SELECT version FROM work_orders WHERE id=$1',[order.id])).rows,beforeRollback.rows);
  assert.deepEqual((await admin.query('SELECT count(*)::int AS count FROM work_order_task_assignment_revisions WHERE work_order_id=$1',[order.id])).rows,beforeRollbackCount.rows);

  const changedJob=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${order.id}/complaints`,headers:headers(jarA),payload:{expectedVersion:order.version,wording:'Synthetic unrelated change after allocation'}});
  assert.equal(changedJob.statusCode,200,changedJob.body);order=detailSchema.parse(changedJob.json());
  const stalePlanView=await app.inject({url:allocationPath,headers:headers(currentSupervisorJar)});
  assert.equal(stalePlanView.statusCode,200,stalePlanView.body);assert.equal(stalePlanView.json().canAssign,false);assert.equal(stalePlanView.json().blockReason,'current-plan-required');
  const stalePlanPost=await app.inject({method:'POST',url:allocationPath,headers:headers(currentSupervisorJar),payload:{expectedVersion:order.version,planRevisionId,assignments:[{taskId:assignedTaskId,staffUserId:technicianOne.id}]}});
  assert.equal(stalePlanPost.statusCode,409,stalePlanPost.body);assert.equal(stalePlanPost.json().error.code,'CURRENT_PLAN_REQUIRED');
});

test('work-order policy ledger is immutable, site-scoped, and not writable by the runtime role',async()=>{
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-order-policy-packages`,headers:headers(jarA)})).statusCode,404,
    'there must be no operational policy package resolver route yet');
  assert.equal((await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-order-policy-decisions`,headers:headers(jarA),payload:{}})).statusCode,404,
    'there must be no policy approval or decision write route yet');
  const packageId=randomUUID();
  const packageIdOtherSite=randomUUID();
  const packageIdOtherOrganisation=randomUUID();
  const revisionA=randomUUID();
  const revisionA2=randomUUID();
  const revisionB=randomUUID();
  const digest='a'.repeat(64);
  const from='2026-11-01T00:00:00.000Z';
  const content=(id:string,revision:number)=>({packageId:id,revision,schemaVersion:1,effectiveFrom:from,effectiveTo:null});
  const insertRevision=async(id:string,organisationId:string,siteId:string,ownerId:string,packageRef:string,body:unknown,sha=digest)=>
    admin.query(`INSERT INTO work_order_policy_package_revisions
      (id,organisation_id,site_id,package_id,revision,schema_version,package_content,package_sha256,effective_from,created_by)
      VALUES($1,$2,$3,$4,1,1,$5::jsonb,$6,$7,$8)`,
    [id,organisationId,siteId,packageRef,JSON.stringify(body),sha,from,ownerId]);

  await insertRevision(revisionA,orgA,siteA,actorA,packageId,content(packageId,1));
  await insertRevision(revisionA2,orgA,siteA2,actorA,packageIdOtherSite,content(packageIdOtherSite,1));
  await insertRevision(revisionB,orgB,siteB,actorB,packageIdOtherOrganisation,content(packageIdOtherOrganisation,1));
  await assert.rejects(insertRevision(randomUUID(),orgA,siteA,actorA,randomUUID(),content(randomUUID(),1)),
    error=>error instanceof Error&&'code' in error&&error.code==='23514','package content must agree with its indexed identity');
  await assert.rejects(insertRevision(randomUUID(),orgA,siteA,actorA,randomUUID(),content(randomUUID(),1),'not-a-sha256'),
    error=>error instanceof Error&&'code' in error&&error.code==='23514','package digests must be lower-case SHA-256 values');
  await assert.rejects(insertRevision(randomUUID(),orgA,siteA,actorA,randomUUID(),[]),
    error=>error instanceof Error&&'code' in error&&error.code==='23514','stored policy package content must be a JSON object');
  const missingEndPackageId=randomUUID();
  const missingEffectiveEnd=content(missingEndPackageId,1);delete (missingEffectiveEnd as Record<string,unknown>).effectiveTo;
  await assert.rejects(insertRevision(randomUUID(),orgA,siteA,actorA,missingEndPackageId,missingEffectiveEnd),
    error=>error instanceof Error&&'code' in error&&error.code==='23514','stored policy package content must include an explicit end time or null');
  await assert.rejects(insertRevision(randomUUID(),orgA,siteA,actorA,randomUUID(),{...content(randomUUID(),1),effectiveTo:'2026-10-01T00:00:00.000Z'}),
    error=>error instanceof Error&&'code' in error&&error.code==='23514','stored policy effectivity must match its validated content');
  await assert.rejects(admin.query(`UPDATE work_order_policy_package_revisions SET revision=2 WHERE id=$1`,[revisionA]),/policy history is immutable/);
  await assert.rejects(admin.query(`DELETE FROM work_order_policy_package_revisions WHERE id=$1`,[revisionA]),/policy history is immutable/);

  assert.deepEqual((await runtime.query('SELECT id FROM work_order_policy_package_revisions')).rows,[],
    'scope-less runtime reads must return no policy rows');
  const client=await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.organisation_id',$1,true),set_config('app.site_id',$2,true)",[orgA,siteA]);
    assert.deepEqual((await client.query('SELECT id FROM work_order_policy_package_revisions ORDER BY id')).rows,[{id:revisionA}],
      'the site-scoped runtime can read only its own policy revisions');
    await client.query("SELECT set_config('app.organisation_id',$1,true),set_config('app.site_id',$2,true)",[orgB,siteB]);
    assert.deepEqual((await client.query('SELECT id FROM work_order_policy_package_revisions')).rows,[{id:revisionB}],
      'changing transaction scope exposes only the matching organisation and site');
    await client.query('ROLLBACK');
  } finally { client.release(); }

  await assert.rejects(runtime.query('INSERT INTO work_order_policy_package_revisions (id,organisation_id,site_id,package_id,revision,schema_version,package_content,package_sha256,effective_from,created_by) VALUES ($1,$2,$3,$4,1,1,$5::jsonb,$6,$7,$8)',
    [randomUUID(),orgA,siteA,randomUUID(),JSON.stringify(content(randomUUID(),1)),digest,from,actorA]),
  error=>error instanceof Error&&'code' in error&&error.code==='42501','runtime role must have read-only policy access');
  await assert.rejects(runtime.query('UPDATE work_order_policy_package_revisions SET revision=2 WHERE id=$1',[revisionA]),
    error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query('DELETE FROM work_order_policy_package_revisions WHERE id=$1',[revisionA]),
    error=>error instanceof Error&&'code' in error&&error.code==='42501');

  const commandId=randomUUID();
  await admin.query('INSERT INTO command_receipts(organisation_id,site_id,actor_id,command_id,fingerprint,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
    [orgA,siteA,actorA,commandId,digest,'{}']);
  await admin.query(`INSERT INTO work_order_policy_package_decisions
    (organisation_id,site_id,package_id,package_revision,package_sha256,decision_number,action,actor_id,authority_snapshot,reason,command_id)
    VALUES($1,$2,$3,1,$4,1,'rejected',$5,'{}'::jsonb,'Synthetic rejected candidate',$6)`,
  [orgA,siteA,packageId,digest,actorA,commandId]);
  await assert.deepEqual((await runtime.query('SELECT id FROM work_order_policy_package_decisions')).rows,[],
    'scope-less runtime reads must return no policy decisions');
  const scopedDecisionClient=await runtime.connect();
  try {
    await scopedDecisionClient.query('BEGIN');
    await scopedDecisionClient.query("SELECT set_config('app.organisation_id',$1,true),set_config('app.site_id',$2,true)",[orgA,siteA]);
    assert.deepEqual((await scopedDecisionClient.query('SELECT package_id FROM work_order_policy_package_decisions')).rows,[{package_id:packageId}]);
    await scopedDecisionClient.query("SELECT set_config('app.organisation_id',$1,true),set_config('app.site_id',$2,true)",[orgA,siteA2]);
    assert.deepEqual((await scopedDecisionClient.query('SELECT package_id FROM work_order_policy_package_decisions')).rows,[]);
    await scopedDecisionClient.query('ROLLBACK');
  } finally { scopedDecisionClient.release(); }
  await assert.rejects(runtime.query(`INSERT INTO work_order_policy_package_decisions
    (organisation_id,site_id,package_id,package_revision,package_sha256,decision_number,action,actor_id,authority_snapshot,reason,command_id)
    VALUES($1,$2,$3,1,$4,1,'rejected',$5,'{}'::jsonb,'Runtime must be read-only',$6)`,
  [orgA,siteA,packageId,digest,actorA,randomUUID()]),error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query('UPDATE work_order_policy_package_decisions SET action=\'approved\' WHERE command_id=$1',[commandId]),
    error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(runtime.query('DELETE FROM work_order_policy_package_decisions WHERE command_id=$1',[commandId]),
    error=>error instanceof Error&&'code' in error&&error.code==='42501');
  await assert.rejects(admin.query(`INSERT INTO work_order_policy_package_decisions
    (organisation_id,site_id,package_id,package_revision,package_sha256,decision_number,action,actor_id,authority_snapshot,reason,command_id)
    VALUES($1,$2,$3,1,$4,1,'approved',$5,'{}'::jsonb,'Cross-site fixture',$6)`,
  [orgA,siteA2,packageId,digest,actorA,commandId]),error=>error instanceof Error&&'code' in error&&error.code==='23503',
  'a decision cannot point to a policy revision at another site');
  await assert.rejects(admin.query('UPDATE work_order_policy_package_decisions SET action=\'approved\' WHERE command_id=$1',[commandId]),/policy history is immutable/);
  await assert.rejects(admin.query('DELETE FROM work_order_policy_package_decisions WHERE command_id=$1',[commandId]),/policy history is immutable/);
});

test('service request storage isolates sites and preserves contact history',async()=>{
  const requestId=randomUUID(), entryId=randomUUID();
  const scopeA={organisationId:orgA,siteId:siteA,actorId:actorA};
  await scoped(runtime,scopeA,async client=>{
    await client.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'service-request')",[requestId,orgA,siteA]);
    await client.query("INSERT INTO service_requests(id,organisation_id,site_id,version,source_channel,concern,created_by) VALUES($1,$2,$3,1,'phone','Synthetic concern',$4)",[requestId,orgA,siteA,actorA]);
    await client.query("INSERT INTO service_request_contact_entries(id,organisation_id,site_id,request_id,recorded_by,channel,outcome) VALUES($1,$2,$3,$4,$5,'phone','no-answer')",[entryId,orgA,siteA,requestId,actorA]);
  });
  await scoped(runtime,{organisationId:orgA,siteId:siteA2,actorId:actorA},async client=>{
    assert.equal((await client.query('SELECT id FROM service_requests WHERE id=$1',[requestId])).rowCount,0);
    assert.equal((await client.query('SELECT id FROM service_request_contact_entries WHERE id=$1',[entryId])).rowCount,0);
  });
  await assert.rejects(scoped(runtime,scopeA,client=>client.query("UPDATE service_request_contact_entries SET outcome='reached' WHERE id=$1",[entryId])));
  await assert.rejects(scoped(runtime,scopeA,client=>client.query('DELETE FROM service_request_contact_entries WHERE id=$1',[entryId])));
  await scoped(runtime,scopeA,async client=>{
    assert.equal((await client.query('SELECT outcome FROM service_request_contact_entries WHERE id=$1',[entryId])).rows[0].outcome,'no-answer');
  });
});

test('service request creation commits once and rejects changed replay',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA}, key=randomUUID();
  const input=serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic concern'});
  const [first,second]=await Promise.all([createServiceRequest(runtime,scope,key,input),createServiceRequest(runtime,scope,key,input)]);
  assert.deepEqual(first,second);
  await assert.rejects(createServiceRequest(runtime,scope,key,{...input,concern:'Changed'}),/already used/);
  await assert.rejects(createServiceRequest(runtime,{...scope,actorId:reader},randomUUID(),input),/does not permit changes/);
  await assert.rejects(createServiceRequest(runtime,{...scope,actorId:operatorA},randomUUID(),input),/limited to account administration/);
  const scheduled=serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic callback request',nextAction:'Call the customer back',callbackDueAt:'2026-12-01T14:00:00+00:00'});
  const withFollowUp=await createServiceRequest(runtime,scope,randomUUID(),scheduled);
  assert.equal(serviceRequestInputSchema.safeParse({sourceChannel:'phone',concern:'Synthetic missing action',callbackDueAt:'2026-12-01T14:00:00Z'}).success,false);
  await scoped(runtime,scope,async client=>{
    assert.equal((await client.query('SELECT id FROM service_requests WHERE id=$1',[first.id])).rowCount,1);
    assert.equal((await client.query("SELECT id FROM domain_events WHERE aggregate_id=$1 AND event_type='service-request.created'",[first.id])).rowCount,1);
    assert.equal((await client.query('SELECT o.id FROM outbox o JOIN domain_events e ON e.id=o.event_id WHERE e.aggregate_id=$1',[first.id])).rowCount,1);
    const followUp=await client.query('SELECT next_action,callback_due_at,assigned_to,created_by FROM service_requests WHERE id=$1',[withFollowUp.id]);
    assert.equal(followUp.rows[0].next_action,'Call the customer back');assert.equal(new Date(followUp.rows[0].callback_due_at).toISOString(),'2026-12-01T14:00:00.000Z');
    assert.equal(followUp.rows[0].assigned_to,actorA);assert.equal(followUp.rows[0].created_by,actorA);
    assert.equal((await client.query('SELECT id FROM service_request_contact_entries WHERE request_id=$1',[withFollowUp.id])).rowCount,0);
    const noFollowUp=await client.query('SELECT assigned_to,next_action,callback_due_at FROM service_requests WHERE id=$1',[first.id]);
    assert.equal(noFollowUp.rows[0].assigned_to,null);assert.equal(noFollowUp.rows[0].next_action,null);assert.equal(noFollowUp.rows[0].callback_due_at,null);
  });
});

test('service request contact serializes updates and preserves callback history',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic concern'}));
  const input=contactAttemptSchema.parse({expectedVersion:1,channel:'phone',outcome:'no-answer',notes:'Called once',nextAction:'Call again',callbackDueAt:'2026-11-13T10:00:00Z'});
  const keys=[randomUUID(),randomUUID()];
  const results=await Promise.allSettled(keys.map(key=>recordServiceRequestContact(runtime,scope,key,request.id,input)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  const winnerIndex=results.findIndex(result=>result.status==='fulfilled');
  const winner=results[winnerIndex];
  const winningKey=keys[winnerIndex];
  if(!winner || winner.status!=='fulfilled' || !winningKey) throw new Error('No winning contact command');
  assert.deepEqual(await recordServiceRequestContact(runtime,scope,winningKey,request.id,input),winner.value);
  await assert.rejects(recordServiceRequestContact(runtime,{...scope,siteId:siteA2},randomUUID(),request.id,input),/not found/);
  await scoped(runtime,scope,async client=>{
    const row=await client.query('SELECT version,next_action,callback_due_at FROM service_requests WHERE id=$1',[request.id]);
    assert.equal(row.rows[0].version,2);
    assert.equal(row.rows[0].next_action,'Call again');
    assert.equal(row.rows[0].callback_due_at.toISOString(),'2026-11-13T10:00:00.000Z');
    assert.equal((await client.query('SELECT id FROM service_request_contact_entries WHERE request_id=$1',[request.id])).rowCount,1);
    assert.equal((await client.query("SELECT id FROM domain_events WHERE aggregate_id=$1 AND event_type='service-request.contact-recorded'",[request.id])).rowCount,1);
  });
});

test('service request creator read is scoped and audited without recording content',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic private concern'}));
  const requestId=randomUUID();
  const item=await readServiceRequest(runtime,scope,request.id,requestId);
  assert.equal(item.concern,'Synthetic private concern');
  await assert.rejects(readServiceRequest(runtime,{...scope,actorId:reader},request.id,randomUUID()),/not found/);
  await assert.rejects(readServiceRequest(runtime,{...scope,siteId:siteA2},request.id,randomUUID()),/not found/);
  const audit=await admin.query('SELECT action,result_count FROM sensitive_read_events WHERE request_id=$1',[requestId]);
  assert.deepEqual(audit.rows,[{action:'service-request-read-prepared',result_count:1}]);
});

test('service request status routes require CSRF and keep close and reopen replay-safe',async()=>{
  const base=`/api/v1/sites/${siteA}/service-requests`;
  const created=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:{sourceChannel:'phone',concern:'Synthetic status route request'}});
  assert.equal(created.statusCode,200,created.body);
  const id=created.json().id as string;
  const closePath=`${base}/${id}/close`,closeBody={expectedVersion:1,reason:'The caller confirmed the matter was resolved.'},key=randomUUID();
  assert.equal((await app.inject({method:'POST',url:closePath,payload:closeBody})).statusCode,403);
  const closed=await app.inject({method:'POST',url:closePath,headers:headers(jarA,key),payload:closeBody});
  assert.equal(closed.statusCode,200,closed.body);
  assert.deepEqual((await app.inject({method:'POST',url:closePath,headers:headers(jarA,key),payload:closeBody})).json(),closed.json());
  assert.equal((await app.inject({method:'GET',url:`${base}/${id}/status-history`,headers:headers(jarA)})).json().items[0].reason,closeBody.reason);
  const closedQueue=await app.inject({url:`${base}?filter=closed`,headers:headers(jarA)});
  assert.equal(closedQueue.statusCode,200,closedQueue.body);
  assert.equal(closedQueue.json().items.some((item:{id:string})=>item.id===id),true);
  const reopenPath=`${base}/${id}/reopen`,reopenBody={expectedVersion:2,reason:'The caller says the concern has returned.'},reopenKey=randomUUID();
  const reopened=await app.inject({method:'POST',url:reopenPath,headers:headers(jarA,reopenKey),payload:reopenBody});
  assert.equal(reopened.statusCode,200,reopened.body);
  assert.deepEqual((await app.inject({method:'POST',url:reopenPath,headers:headers(jarA,reopenKey),payload:reopenBody})).json(),reopened.json());
  const openQueue=await app.inject({url:`${base}?filter=closed`,headers:headers(jarA)});
  assert.equal(openQueue.statusCode,200,openQueue.body);
  assert.equal(openQueue.json().items.some((item:{id:string})=>item.id===id),false);
});

test('service request contact history is paginated, private and audited',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic concern'}));
  for(let version=1;version<=3;version++) await recordServiceRequestContact(runtime,scope,randomUUID(),request.id,contactAttemptSchema.parse({expectedVersion:version,channel:'phone',outcome:'no-answer',notes:`Attempt ${version}`,nextAction:null,callbackDueAt:null}));
  const auditId=randomUUID();
  const first=await readServiceRequestContacts(runtime,scope,request.id,auditId,1,2);
  const second=await readServiceRequestContacts(runtime,scope,request.id,randomUUID(),2,2);
  assert.equal(first.totalCount,3); assert.equal(first.totalPages,2);
  assert.deepEqual([...first.items,...second.items].map(item=>item.notes),['Attempt 3','Attempt 2','Attempt 1']);
  await assert.rejects(readServiceRequestContacts(runtime,{...scope,actorId:reader},request.id,randomUUID()),/not found/);
  await assert.rejects(readServiceRequestContacts(runtime,{...scope,siteId:siteA2},request.id,randomUUID()),/not found/);
  await assert.rejects(readServiceRequestContacts(runtime,scope,request.id,randomUUID(),1,51));
  const audit=await admin.query('SELECT action,result_count FROM sensitive_read_events WHERE request_id=$1',[auditId]);
  assert.deepEqual(audit.rows,[{action:'service-request-read-prepared',result_count:2}]);
});

test('service request contact corrections serialize, replay once and stay site-scoped',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic correction race'}));
  await recordServiceRequestContact(runtime,scope,randomUUID(),request.id,contactAttemptSchema.parse({expectedVersion:1,channel:'phone',outcome:'reached',notes:'Synthetic original',nextAction:null,callbackDueAt:null}));
  const originalEntry=await scoped(runtime,scope,async client=>client.query('SELECT id FROM service_request_contact_entries WHERE request_id=$1 AND corrects_entry_id IS NULL',[request.id]));
  const originalEntryId=String(originalEntry.rows[0]?.id);assert.ok(originalEntryId);
  const bodies=[
    {expectedVersion:2,entryId:originalEntryId,channel:'phone',outcome:'reached' as const,notes:'Synthetic correction A',reason:'Synthetic correction race A'},
    {expectedVersion:2,entryId:originalEntryId,channel:'phone',outcome:'reached' as const,notes:'Synthetic correction B',reason:'Synthetic correction race B'},
  ];
  const keys=[randomUUID(),randomUUID()];
  const results=await Promise.allSettled(bodies.map((body,index)=>correctServiceRequestContact(runtime,scope,keys[index]!,request.id,body)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  const winnerIndex=results.findIndex(result=>result.status==='fulfilled'),winner=results[winnerIndex];
  if(!winner||winner.status!=='fulfilled')throw new Error('No winning correction command');
  const winningKey=keys[winnerIndex],winningBody=bodies[winnerIndex];assert.ok(winningKey);assert.ok(winningBody);
  assert.deepEqual(await correctServiceRequestContact(runtime,scope,winningKey,request.id,winningBody),winner.value);
  await assert.rejects(correctServiceRequestContact(runtime,{...scope,siteId:siteA2},randomUUID(),request.id,winningBody),/not found/);
  const history=await readServiceRequestContacts(runtime,scope,request.id,randomUUID(),1,10);
  assert.equal(history.totalCount,2);
  assert.equal(history.items.filter(item=>item.correctsEntryId===originalEntryId).length,1);
  assert.equal(history.items.find(item=>item.correctsEntryId===originalEntryId)?.notes,winningBody.notes);
  await scoped(runtime,scope,async client=>{
    const row=await client.query('SELECT version FROM service_requests WHERE id=$1',[request.id]);
    assert.equal(row.rows[0]?.version,3);
    assert.equal((await client.query("SELECT id FROM domain_events WHERE aggregate_id=$1 AND event_type='service-request.contact-corrected'",[request.id])).rowCount,1);
  });
});

test('service request close and reopen keep reasoned immutable history and refuse linked jobs',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic close and reopen'}));
  const closeBody={expectedVersion:1,reason:'The customer confirmed the issue is resolved.'},closeKey=randomUUID();
  const closed=await closeServiceRequest(runtime,scope,closeKey,request.id,closeBody);
  assert.equal(closed.version,2);
  assert.deepEqual(await closeServiceRequest(runtime,scope,closeKey,request.id,closeBody),closed);
  await assert.rejects(closeServiceRequest(runtime,scope,randomUUID(),request.id,{...closeBody,reason:'Different content'}),/STALE_VERSION|changed/);
  const reopened=await reopenServiceRequest(runtime,scope,randomUUID(),request.id,{expectedVersion:2,reason:'The customer reported that the issue returned.'});
  assert.equal(reopened.version,3);
  const history=await readServiceRequestStatusHistory(runtime,scope,request.id,randomUUID());
  assert.deepEqual(history.items.map(row=>[row.previousStatus,row.nextStatus,row.reason]),[
    ['closed','open','The customer reported that the issue returned.'],
    ['open','closed','The customer confirmed the issue is resolved.'],
  ]);
  await assert.rejects(readServiceRequestStatusHistory(runtime,{...scope,actorId:reader},request.id,randomUUID()),/not found/);
  await assert.rejects(readServiceRequestStatusHistory(runtime,{...scope,siteId:siteA2},request.id,randomUUID()),/not found/);
  const linked=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic linked request'}));
  const workOrderResponse=await create(jarA,siteA,'WVWZZZ1JZXW778806');assert.equal(workOrderResponse.statusCode,200,workOrderResponse.body);
  const workOrder=detailSchema.parse(workOrderResponse.json());
  await linkServiceRequestToWorkOrder(runtime,scope,randomUUID(),linked.id,{expectedVersion:1,workOrderId:workOrder.id,reason:'Confirmed visit match.'});
  await assert.rejects(closeServiceRequest(runtime,scope,randomUUID(),linked.id,{expectedVersion:2,reason:'Attempt to close a linked request.'}),/Only an open request/);
  await scoped(runtime,scope,async client=>{
    const status=await client.query('SELECT version,status FROM service_requests WHERE id=$1',[request.id]);
    assert.deepEqual(status.rows[0],{version:3,status:'open'});
    assert.equal((await client.query('SELECT id FROM service_request_status_history WHERE request_id=$1',[request.id])).rowCount,2);
    assert.equal((await client.query("SELECT id FROM domain_events WHERE aggregate_id=$1 AND event_type IN ('service-request.closed','service-request.reopened')",[request.id])).rowCount,2);
    assert.equal((await client.query('SELECT o.id FROM outbox o JOIN domain_events e ON e.id=o.event_id WHERE e.aggregate_id=$1 AND e.event_type IN (\'service-request.closed\',\'service-request.reopened\')',[request.id])).rowCount,2);
  });
});

test('service advisor shared request read ends when the role ends',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic shared concern'}));
  const placement=randomUUID();
  await admin.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')",[placement,orgA,siteA]);
  await admin.query("INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by) VALUES($1,$2,$3,$4,'service-advisor',$5,$5)",[placement,orgA,siteA,reader,actorA]);
  const advisor={...scope,actorId:reader};
  assert.equal((await readServiceRequest(runtime,advisor,request.id,randomUUID())).concern,'Synthetic shared concern');
  assert.equal((await readServiceRequestContacts(runtime,advisor,request.id,randomUUID())).totalCount,0);
  await admin.query("UPDATE staff_role_placements SET state='ended' WHERE id=$1",[placement]);
  await assert.rejects(readServiceRequest(runtime,advisor,request.id,randomUUID()),/not found/);
});

test('shared contact update requires an active authorized role even on replay',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA}, other=randomUUID(), placement=randomUUID();
  await admin.query("INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic Advisor','unused')",[other,`test-request-advisor-${other}`]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write,active) VALUES($1,$2,true,true)',[other,siteA]);
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic concern'}));
  const input=contactAttemptSchema.parse({expectedVersion:1,channel:'phone',outcome:'reached',notes:'Spoke',nextAction:null,callbackDueAt:null});
  const otherScope={...scope,actorId:other}, key=randomUUID();
  await assert.rejects(recordServiceRequestContact(runtime,otherScope,key,request.id,input),/not found/);
  await admin.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')",[placement,orgA,siteA]);
  await admin.query("INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by) VALUES($1,$2,$3,$4,'service-advisor',$5,$5)",[placement,orgA,siteA,other,actorA]);
  assert.equal((await recordServiceRequestContact(runtime,otherScope,key,request.id,input)).version,2);
  await claimServiceRequest(runtime,otherScope,randomUUID(),request.id,{expectedVersion:2});
  await admin.query("UPDATE staff_role_placements SET state='ended' WHERE id=$1",[placement]);
  await assert.rejects(recordServiceRequestContact(runtime,otherScope,key,request.id,input),/not found/);
  const queue=await listServiceRequests(runtime,scope,randomUUID());
  assert.equal(queue.items.find(item=>item.id===request.id)?.assigneeActive,false);
});

test('service request queue filters callbacks and scopes results',async()=>{
  const other=randomUUID(), scope={organisationId:orgA,siteId:siteA,actorId:other};
  await admin.query("INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic Caller','unused')",[other,`test-request-queue-${other}`]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write,active) VALUES($1,$2,true,true)',[other,siteA]);
  const input=serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic queue concern'});
  const overdue=await createServiceRequest(runtime,scope,randomUUID(),input);
  const unscheduled=await createServiceRequest(runtime,scope,randomUUID(),input);
  const today=await createServiceRequest(runtime,scope,randomUUID(),input);
  await recordServiceRequestContact(runtime,scope,randomUUID(),overdue.id,contactAttemptSchema.parse({expectedVersion:1,channel:'phone',outcome:'no-answer',nextAction:'Call back',callbackDueAt:'2020-01-01T00:00:00Z'}));
  const clock=await admin.query("SELECT (now() + (((date_trunc('day',now() AT TIME ZONE 'Africa/Accra') + interval '1 day') AT TIME ZONE 'Africa/Accra') - now()) / 2) AS due");
  await recordServiceRequestContact(runtime,scope,randomUUID(),today.id,contactAttemptSchema.parse({expectedVersion:1,channel:'phone',outcome:'no-answer',nextAction:'Call today',callbackDueAt:clock.rows[0].due.toISOString()}));
  const auditId=randomUUID();
  const due=await listServiceRequests(runtime,scope,auditId,'overdue');
  assert.deepEqual(due.items.map(item=>item.id),[overdue.id]);
  const noTime=await listServiceRequests(runtime,scope,randomUUID(),'unscheduled',1,1);
  assert.deepEqual(noTime.items.map(item=>item.id),[unscheduled.id]);
  assert.deepEqual((await listServiceRequests(runtime,scope,randomUUID(),'due-today')).items.map(item=>item.id),[today.id]);
  assert.equal((await listServiceRequests(runtime,scope,randomUUID(),'all',1,1)).totalPages,3);
  const audit=await admin.query('SELECT result_count FROM sensitive_read_events WHERE request_id=$1',[auditId]);
  assert.equal(audit.rows[0].result_count,1);
  const head=await listServiceRequests(runtime,{...scope,actorId:actorA},randomUUID(),'overdue');
  assert.ok(head.items.some(item=>item.id===overdue.id));
  await claimServiceRequest(runtime,scope,randomUUID(),unscheduled.id,{expectedVersion:1});
  assert.deepEqual((await listServiceRequests(runtime,scope,randomUUID(),'mine')).items.map(item=>item.id),[unscheduled.id]);
  await admin.query('UPDATE memberships SET active=false WHERE user_id=$1 AND site_id=$2',[other,siteA]);
  const afterRemoval=await listServiceRequests(runtime,{...scope,actorId:actorA},randomUUID(),'unscheduled');
  assert.equal(afterRemoval.items.find(item=>item.id===unscheduled.id)?.assigneeActive,false);
  await assert.rejects(listServiceRequests(runtime,{...scope,siteId:siteA2},randomUUID()),/active access/);
  assert.equal((await runtime.query('SELECT public.current_scoped_site_timezone() AS zone')).rows[0].zone,null);
});

test('service request HTTP routes enforce access, CSRF and idempotent contact updates',async()=>{
  const base=`/api/v1/sites/${siteA}/service-requests`, key=randomUUID();
  const payload={sourceChannel:'phone',concern:'Synthetic HTTP request'};
  const unauth=await app.inject({method:'GET',url:base});
  assert.equal(unauth.statusCode,401);
  const noCsrf=await app.inject({method:'POST',url:base,payload});
  assert.equal(noCsrf.statusCode,403);
  const created=await app.inject({method:'POST',url:base,headers:headers(jarA,key),payload});
  assert.equal(created.statusCode,200,created.body);
  const id=created.json().id as string;
  const replay=await app.inject({method:'POST',url:base,headers:headers(jarA,key),payload});
  assert.deepEqual(replay.json(),created.json());
  const foreign=await app.inject({method:'GET',url:`/api/v1/sites/${siteB}/service-requests/${id}`,headers:headers(jarA)});
  assert.equal(foreign.statusCode,403);
  const operatorJar=await signIn('test-operator-a');
  assert.equal((await app.inject({method:'GET',url:base,headers:headers(operatorJar)})).statusCode,403);
  const contact={expectedVersion:1,channel:'phone',outcome:'no-answer',notes:'Called',nextAction:'Call back',callbackDueAt:'2020-01-01T00:00:00Z'};
  const contactKey=randomUUID();
  const saved=await app.inject({method:'POST',url:`${base}/${id}/contacts`,headers:headers(jarA,contactKey),payload:contact});
  assert.equal(saved.statusCode,200,saved.body);
  assert.deepEqual((await app.inject({method:'POST',url:`${base}/${id}/contacts`,headers:headers(jarA,contactKey),payload:contact})).json(),saved.json());
  assert.equal((await app.inject({method:'POST',url:`${base}/${id}/contacts`,headers:headers(jarA),payload:contact})).statusCode,409);
  const history=await app.inject({method:'GET',url:`${base}/${id}/contacts`,headers:headers(jarA)});
  assert.equal(history.statusCode,200,history.body); assert.equal(history.json().totalCount,1);
  const claimKey=randomUUID(), claimBody={expectedVersion:2};
  const claim=await app.inject({method:'POST',url:`${base}/${id}/claim`,headers:headers(jarA,claimKey),payload:claimBody});
  assert.equal(claim.statusCode,200,claim.body);
  assert.deepEqual((await app.inject({method:'POST',url:`${base}/${id}/claim`,headers:headers(jarA,claimKey),payload:claimBody})).json(),claim.json());
  const detail=await app.inject({method:'GET',url:`${base}/${id}`,headers:headers(jarA)});
  assert.equal(detail.statusCode,200,detail.body); assert.equal(detail.json().assignedTo,actorA);
  assert.equal((await app.inject({method:'POST',url:`${base}/${id}/claim`,headers:headers(jarA),payload:{expectedVersion:3}})).statusCode,409);
  const people=await app.inject({method:'GET',url:`${base}/${id}/assignees`,headers:headers(jarA)});
  assert.equal(people.statusCode,200,people.body);assert.ok(people.json().items.some((person:{id:string})=>person.id===actorA));
  const unassign=await app.inject({method:'POST',url:`${base}/${id}/assignment`,headers:headers(jarA),payload:{expectedVersion:3,assigneeId:null,reason:'Synthetic change'}});
  assert.equal(unassign.statusCode,200,unassign.body);
  const queue=await app.inject({method:'GET',url:`${base}?filter=overdue`,headers:headers(jarA)});
  assert.equal(queue.statusCode,200,queue.body); assert.ok(queue.json().items.some((row:{id:string})=>row.id===id));
  assert.equal((await app.inject({method:'GET',url:`${base}?pageSize=51`,headers:headers(jarA)})).statusCode,400);
});

test('competing request claims assign exactly one responsible person',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA}, other=randomUUID(), placement=randomUUID();
  await admin.query("INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic Advisor','unused')",[other,`test-claim-${other}`]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write,active) VALUES($1,$2,true,true)',[other,siteA]);
  await admin.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')",[placement,orgA,siteA]);
  await admin.query("INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by) VALUES($1,$2,$3,$4,'service-advisor',$5,$5)",[placement,orgA,siteA,other,actorA]);
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic claim'}));
  const results=await Promise.allSettled([claimServiceRequest(runtime,scope,randomUUID(),request.id,{expectedVersion:1}),claimServiceRequest(runtime,{...scope,actorId:other},randomUUID(),request.id,{expectedVersion:1})]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected').length,1);
  await scoped(runtime,scope,async client=>{
    const row=await client.query('SELECT version,assigned_to FROM service_requests WHERE id=$1',[request.id]);
    assert.equal(row.rows[0].version,2); assert.ok([actorA,other].includes(row.rows[0].assigned_to));
    assert.equal((await client.query("SELECT id FROM domain_events WHERE aggregate_id=$1 AND event_type='service-request.claimed'",[request.id])).rowCount,1);
  });
});

test('request assignment rejects concurrent access removal and records reassignment',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA}, other=randomUUID(), placement=randomUUID();
  await admin.query("INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic Advisor','unused')",[other,`test-assign-${other}`]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write,active) VALUES($1,$2,true,true)',[other,siteA]);
  await admin.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')",[placement,orgA,siteA]);
  await admin.query("INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by) VALUES($1,$2,$3,$4,'service-advisor',$5,$5)",[placement,orgA,siteA,other,actorA]);
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic assignment'}));
  const body={expectedVersion:1,assigneeId:other,reason:'Synthetic handover'}, key=randomUUID();
  assert.ok((await listRequestAssignees(runtime,scope,request.id,randomUUID())).items.some(person=>person.id===other));
  assert.equal((await runtime.query('SELECT public.lock_request_assignee($1) AS value',[other])).rows[0].value,null);
  await scoped(runtime,scope,async client=>assert.equal((await client.query('SELECT public.lock_request_assignee($1) AS value',[actorB])).rows[0].value,null));
  const lock=await admin.connect();
  try{
    await lock.query('BEGIN');await lock.query('UPDATE memberships SET active=false WHERE user_id=$1 AND site_id=$2',[other,siteA]);
    await assert.rejects(assignServiceRequest(runtime,scope,key,request.id,body),/being updated/);
    await lock.query('COMMIT');
  }finally{await lock.query('ROLLBACK').catch(()=>{});lock.release();}
  await assert.rejects(assignServiceRequest(runtime,scope,key,request.id,body),/active writable access/);
  await admin.query('UPDATE memberships SET active=true WHERE user_id=$1 AND site_id=$2',[other,siteA]);
  const assigned=await assignServiceRequest(runtime,scope,key,request.id,body);
  assert.equal(assigned.version,2);assert.deepEqual(await assignServiceRequest(runtime,scope,key,request.id,body),assigned);
  const cleared=await assignServiceRequest(runtime,scope,randomUUID(),request.id,{expectedVersion:2,assigneeId:null,reason:'Synthetic handover cancelled'});
  assert.equal(cleared.version,3);
  const detail=await readServiceRequest(runtime,scope,request.id,randomUUID());assert.equal(detail.assignedTo,null);
});

test('request assignment rechecks target role after a concurrent role removal',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA}, other=randomUUID(), placement=randomUUID();
  await admin.query("INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic Advisor','unused')",[other,`test-assign-role-race-${other}`]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write,active) VALUES($1,$2,true,true)',[other,siteA]);
  await admin.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'staff-role-placement')",[placement,orgA,siteA]);
  await admin.query("INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,created_by,updated_by) VALUES($1,$2,$3,$4,'service-advisor',$5,$5)",[placement,orgA,siteA,other,actorA]);
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic role race'}));
  const lock=await admin.connect();let pending:Promise<unknown>|undefined;let transaction=false;
  try{
    await lock.query('BEGIN');transaction=true;
    await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workforce:${orgA}:${siteA}`]);
    pending=assignServiceRequest(runtime,scope,randomUUID(),request.id,{expectedVersion:1,assigneeId:other,reason:'Synthetic race'});
    let waiting=false;const deadline=Date.now()+5000;
    while(Date.now()<deadline){const rows=await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'");if(Number(rows.rows[0]?.count)>0){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
    assert.ok(waiting,'Assignment should wait for workforce serialization.');
    await lock.query("UPDATE staff_role_placements SET state='ended' WHERE id=$1",[placement]);
    await lock.query('COMMIT');transaction=false;
    await assert.rejects(pending,/can access this request/);
    const detail=await readServiceRequest(runtime,scope,request.id,randomUUID());assert.equal(detail.assignedTo,null);assert.equal(detail.version,1);
  } finally {if(transaction)await lock.query('ROLLBACK');lock.release();if(pending)await pending.catch(()=>undefined);}
});

test('request links to a same-site job once without changing its gates',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const orderResponse=await create(jarA,siteA,'WVWZZZ1JZXW778801');assert.equal(orderResponse.statusCode,200,orderResponse.body);
  const order=orderResponse.json();
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic request'}));
  const key=randomUUID(),body={expectedVersion:1,workOrderId:order.id,reason:'Confirmed matching visit'};
  const linked=await linkServiceRequestToWorkOrder(runtime,scope,key,request.id,body);
  assert.equal(linked.version,2);assert.deepEqual(await linkServiceRequestToWorkOrder(runtime,scope,key,request.id,body),linked);
  await assert.rejects(linkServiceRequestToWorkOrder(runtime,scope,randomUUID(),request.id,{...body,expectedVersion:2}),/already linked or closed/);
  const detail=await readServiceRequest(runtime,scope,request.id,randomUUID());assert.equal(detail.workOrderId,order.id);assert.equal(detail.status,'converted');
  const readId=randomUUID();const related=await listWorkOrderRequests(runtime,scope,order.id,readId);
  assert.deepEqual(related.items.map(item=>item.id),[request.id]);
  assert.equal((await listWorkOrderRequests(runtime,{...scope,actorId:reader},order.id,randomUUID())).totalCount,0);
  await assert.rejects(listWorkOrderRequests(runtime,{...scope,siteId:siteA2},order.id,randomUUID()),/not found/);
  assert.equal((await admin.query('SELECT result_count FROM sensitive_read_events WHERE request_id=$1',[readId])).rows[0].result_count,1);
  assert.ok((await listServiceRequests(runtime,scope,randomUUID(),'linked')).items.some(item=>item.id===request.id));
  assert.ok(!(await listServiceRequests(runtime,scope,randomUUID(),'all')).items.some(item=>item.id===request.id));
  const after=await app.inject({method:'GET',url:`/api/v1/sites/${siteA}/work-orders/${order.id}`,headers:headers(jarA)});
  assert.equal(after.statusCode,200,after.body);assert.equal(after.json().version,order.version);assert.deepEqual(after.json().gates,order.gates);
  const contact=contactAttemptSchema.parse({expectedVersion:2,channel:'phone',outcome:'reached',nextAction:null,callbackDueAt:null});
  assert.equal((await recordServiceRequestContact(runtime,scope,randomUUID(),request.id,contact)).version,3);
  const correction={expectedVersion:3,reason:'Synthetic incorrect job'},correctionKey=randomUUID();
  await assert.rejects(unlinkServiceRequest(runtime,{...scope,actorId:reader},randomUUID(),request.id,correction),/does not permit changes/);
  const corrected=await unlinkServiceRequest(runtime,scope,correctionKey,request.id,correction);
  assert.equal(corrected.version,4);assert.deepEqual(await unlinkServiceRequest(runtime,scope,correctionKey,request.id,correction),corrected);
  assert.equal((await readServiceRequest(runtime,scope,request.id,randomUUID())).workOrderId,null);
  assert.equal((await readServiceRequestContacts(runtime,scope,request.id,randomUUID())).totalCount,1);
  assert.equal((await listWorkOrderRequests(runtime,scope,order.id,randomUUID())).totalCount,0);
  const unchangedJob=await app.inject({method:'GET',url:`/api/v1/sites/${siteA}/work-orders/${order.id}`,headers:headers(jarA)});assert.equal(unchangedJob.json().version,order.version);
  const history=await admin.query("SELECT previous_state,reason FROM domain_events WHERE aggregate_id=$1 AND event_type='service-request.link-corrected'",[request.id]);assert.equal(history.rows[0].previous_state.workOrderId,order.id);assert.equal(history.rows[0].reason,correction.reason);
  const other=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic other request'}));
  await assert.rejects(linkServiceRequestToWorkOrder(runtime,scope,randomUUID(),other.id,{...body,workOrderId:randomUUID()}),/not found/);
  const contenders=await Promise.allSettled([linkServiceRequestToWorkOrder(runtime,scope,randomUUID(),other.id,body),linkServiceRequestToWorkOrder(runtime,scope,randomUUID(),other.id,body)]);
  assert.equal(contenders.filter(result=>result.status==='fulfilled').length,1);assert.equal(contenders.filter(result=>result.status==='rejected').length,1);
});

test('request reception creates one linked job atomically and rejects conflicting attempts',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic arrival'}));
  const base=`/api/v1/sites/${siteA}/service-requests/${request.id}/reception`;
  const body={expectedVersion:1,reason:'Synthetic confirmed arrival',intake:intake('WVWZZZ1JZXW778803')},key=randomUUID();
  const readerJar=await signIn('test-reader');
  assert.equal((await app.inject({method:'POST',url:base,headers:headers(readerJar),payload:body})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:`/api/v1/sites/${siteB}/service-requests/${request.id}/reception`,headers:headers(jarA),payload:body})).statusCode,403);
  const response=await app.inject({method:'POST',url:base,headers:headers(jarA,key),payload:body});assert.equal(response.statusCode,200,response.body);
  const job=response.json();assert.ok(job.gates.every((gate:{state:string})=>gate.state==='pending'));
  const replay=await app.inject({method:'POST',url:base,headers:headers(jarA,key),payload:body});assert.deepEqual(replay.json(),job);
  const detail=await readServiceRequest(runtime,scope,request.id,randomUUID());assert.equal(detail.workOrderId,job.id);assert.equal(detail.version,2);
  assert.equal((await app.inject({method:'POST',url:base,headers:headers(jarA),payload:body})).statusCode,409);
  const ledger=await admin.query("SELECT count(*)::int AS count FROM domain_events WHERE aggregate_id=$1 AND event_type='service-request.linked-to-work-order'",[request.id]);assert.equal(ledger.rows[0].count,1);
  const another=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic duplicate'}));
  const failed=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/service-requests/${another.id}/reception`,headers:headers(jarA),payload:body});assert.equal(failed.statusCode,409);
  const unchanged=await readServiceRequest(runtime,scope,another.id,randomUUID());assert.equal(unchanged.status,'open');assert.equal(unchanged.version,1);assert.equal(unchanged.workOrderId,null);
  const raceBody={...body,intake:intake('WVWZZZ1JZXW778804')};
  const results=await Promise.all([app.inject({method:'POST',url:`/api/v1/sites/${siteA}/service-requests/${another.id}/reception`,headers:headers(jarA),payload:raceBody}),app.inject({method:'POST',url:`/api/v1/sites/${siteA}/service-requests/${another.id}/reception`,headers:headers(jarA),payload:raceBody})]);
  assert.deepEqual(results.map(result=>result.statusCode).sort(),[200,409]);
});

test('request reception rolls back both aggregates if the job outbox fails',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic rollback'}));
  const count=async()=> (await admin.query("SELECT (SELECT count(*)::int FROM work_orders) jobs,(SELECT count(*)::int FROM visits) visits,(SELECT count(*)::int FROM vehicles) vehicles,(SELECT count(*)::int FROM domain_events) events,(SELECT count(*)::int FROM outbox) outbox,(SELECT count(*)::int FROM command_receipts) receipts")).rows;
  const before=await count();
  await admin.query("CREATE FUNCTION fail_request_intake_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'eventType'='reception.draft-created' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$");
  await admin.query('CREATE TRIGGER fail_request_intake_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION fail_request_intake_outbox()');
  try{
    const response=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/service-requests/${request.id}/reception`,headers:headers(jarA),payload:{expectedVersion:1,reason:'Synthetic rollback',intake:intake('WVWZZZ1JZXW778805')}});
    assert.equal(response.statusCode,500);
  }finally{await admin.query('DROP TRIGGER fail_request_intake_outbox ON outbox');await admin.query('DROP FUNCTION fail_request_intake_outbox()');}
  assert.deepEqual(await count(),before);
  const unchanged=await readServiceRequest(runtime,scope,request.id,randomUUID());assert.equal(unchanged.status,'open');assert.equal(unchanged.version,1);assert.equal(unchanged.workOrderId,null);
});

test('contact corrections preserve the original and scheduled follow-up',async()=>{
  const scope={organisationId:orgA,siteId:siteA,actorId:actorA};
  const request=await createServiceRequest(runtime,scope,randomUUID(),serviceRequestInputSchema.parse({sourceChannel:'phone',concern:'Synthetic contact correction'}));
  await recordServiceRequestContact(runtime,scope,randomUUID(),request.id,contactAttemptSchema.parse({expectedVersion:1,channel:'phone',outcome:'no-answer',notes:'Original',nextAction:'Call again',callbackDueAt:'2026-12-01T10:00:00Z'}));
  const original=(await readServiceRequestContacts(runtime,scope,request.id,randomUUID())).items[0];assert.ok(original);
  const body={expectedVersion:2,entryId:original.id,channel:'phone',outcome:'reached' as const,notes:'Corrected',reason:'Wrong outcome'},key=randomUUID();
  await assert.rejects(correctServiceRequestContact(runtime,{...scope,actorId:reader},randomUUID(),request.id,body),/does not permit changes/);
  const saved=await correctServiceRequestContact(runtime,scope,key,request.id,body);assert.equal(saved.version,3);
  assert.deepEqual(await correctServiceRequestContact(runtime,scope,key,request.id,body),saved);
  await assert.rejects(correctServiceRequestContact(runtime,scope,randomUUID(),request.id,{...body,expectedVersion:3}),/already been corrected/);
  const history=await readServiceRequestContacts(runtime,scope,request.id,randomUUID());assert.equal(history.totalCount,2);
  assert.equal(history.items.find(item=>item.id===original.id)?.isCorrected,true);
  assert.equal(history.items.find(item=>item.correctsEntryId===original.id)?.correctionReason,'Wrong outcome');
  const detail=await readServiceRequest(runtime,scope,request.id,randomUUID());assert.equal(detail.nextAction,'Call again');assert.equal(detail.callbackDueAt,'2026-12-01T10:00:00.000Z');
});

test('sales delivery and PDI observations are role-scoped, source-attributed and never infer owner or payer',async()=>{
  const addPlacement=async(roleCode:string)=>admin.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,reports_to_placement_id,revision,state,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,NULL,1,'active',$4,$4)`,[randomUUID(),orgA,siteA,actorA,roleCode]);
  const vin=`WVWZZZ1JZXW${randomBytes(3).toString('hex').toUpperCase()}`,base=`/api/v1/sites/${siteA}/sales-deliveries`,deliveryKey=randomUUID();
  const body={vehicle:{kind:'new',vin,registration:'SYN-REG-1',make:'Synthetic BYD',model:'Synthetic Seal',variant:null,powertrain:'Battery'},deliveredOn:'2026-11-12',registrationAtDelivery:null,purchaserAtDeliveryClaim:'Synthetic purchaser',purchaserSource:'Synthetic sales record',sourceReference:'Synthetic delivery form'};
  const denied=await app.inject({method:'POST',url:base,headers:headers(jarA),payload:body});
  assert.equal(denied.statusCode,403);
  assert.equal((await admin.query('SELECT 1 FROM vehicles WHERE organisation_id=$1 AND vin=$2',[orgA,vin])).rowCount,0,'Unauthorized delivery must not create an orphan vehicle.');
  await addPlacement('sales-representative');
  const saved=await app.inject({method:'POST',url:base,headers:headers(jarA,deliveryKey),payload:body});
  assert.equal(saved.statusCode,200,saved.body);
  const delivery=saved.json();assert.equal(delivery.vin,vin);assert.equal(delivery.registrationAtDelivery,null);assert.equal(delivery.purchaserAtDeliveryClaim,'Synthetic purchaser');
  assert.equal((await admin.query('SELECT registration FROM vehicles WHERE organisation_id=$1 AND id=$2',[orgA,delivery.vehicleId])).rows[0]?.registration,'SYN-REG-1','Current canonical registration must not be inferred as registration at delivery.');
  assert.deepEqual((await admin.query('SELECT customer_id FROM vehicles WHERE organisation_id=$1 AND id=$2',[orgA,delivery.vehicleId])).rows[0],{customer_id:null},'Purchaser claim must not create a client, owner or payer relationship.');
  assert.deepEqual((await app.inject({method:'POST',url:base,headers:headers(jarA,deliveryKey),payload:body})).json(),delivery,'Delivery replay must return its original result.');
  const duplicateDelivery=await app.inject({method:'POST',url:base,headers:headers(jarA,randomUUID()),payload:{...body,vehicle:{kind:'existing',vehicleId:delivery.vehicleId}}});
  assert.equal(duplicateDelivery.statusCode,409,duplicateDelivery.body);assert.match(duplicateDelivery.body,/DELIVERY_ALREADY_RECORDED/);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM sales_deliveries WHERE organisation_id=$1 AND site_id=$2 AND vehicle_id=$3',[orgA,siteA,delivery.vehicleId])).rows[0]?.count,1,'One canonical vehicle has at most one initial delivery at this site.');
  const match=await app.inject({url:`/api/v1/sites/${siteA}/vehicles/lookup?vin=${vin}`,headers:headers(jarA)});assert.equal(match.statusCode,200);assert.equal(match.json().id,delivery.vehicleId,'After-Sales must find the delivery vehicle at the same site.');
  const pdiPath=`${base}/${delivery.id}/pdi-observations`,note={area:'Infotainment',observation:'Synthetic factual observation from the supplied PDI record.',sourceReference:'Synthetic PDI source'};
  const pdiDenied=await app.inject({method:'POST',url:pdiPath,headers:headers(jarA),payload:note});assert.equal(pdiDenied.statusCode,403,pdiDenied.body);
  await addPlacement('pdi-observer');
  const pdiKey=randomUUID(),pdi=await app.inject({method:'POST',url:pdiPath,headers:headers(jarA,pdiKey),payload:note});assert.equal(pdi.statusCode,200,pdi.body);assert.equal(pdi.json().observation,note.observation);
  const pdiReplay=await app.inject({method:'POST',url:pdiPath,headers:headers(jarA,pdiKey),payload:note});assert.deepEqual(pdiReplay.json(),pdi.json());
  const correctionBody={...note,observation:'Synthetic corrected PDI observation.',correctsObservationId:pdi.json().id,correctionReason:'Synthetic reason: transcription corrected against the source form.'};
  const missingCorrectionReason=await app.inject({method:'POST',url:pdiPath,headers:headers(jarA),payload:{...correctionBody,correctionReason:null}});
  assert.equal(missingCorrectionReason.statusCode,400,'A PDI correction must include its reason.');
  const readerForCorrection=await signIn('test-reader');
  const deniedCorrection=await app.inject({method:'POST',url:pdiPath,headers:headers(readerForCorrection),payload:correctionBody});
  assert.equal(deniedCorrection.statusCode,403,'Site membership without a PDI Observer role cannot correct PDI history.');
  const correctionKey=randomUUID();
  const correction=await app.inject({method:'POST',url:pdiPath,headers:headers(jarA,correctionKey),payload:correctionBody});
  assert.equal(correction.statusCode,200,correction.body);assert.equal(correction.json().correctsObservationId,pdi.json().id);
  assert.equal(correction.json().correctionReason,correctionBody.correctionReason);assert.equal(correction.json().observation,correctionBody.observation);
  const correctionReplay=await app.inject({method:'POST',url:pdiPath,headers:headers(jarA,correctionKey),payload:correctionBody});assert.deepEqual(correctionReplay.json(),correction.json());
  const changedCorrectionReplay=await app.inject({method:'POST',url:pdiPath,headers:headers(jarA,correctionKey),payload:{...correctionBody,observation:'Changed correction payload.'}});
  assert.equal(changedCorrectionReplay.statusCode,409,'A changed correction cannot reuse an idempotency key.');
  const readerJar=await signIn('test-reader');
  const historyDenied=await app.inject({url:`/api/v1/sites/${siteA}/vehicles/${delivery.vehicleId}/sales-history`,headers:headers(readerJar)});
  assert.equal(historyDenied.statusCode,403,historyDenied.body);assert.match(historyDenied.body,/ROLE_REQUIRED/,'Site membership alone must not expose purchaser and PDI history.');
  const history=await app.inject({url:`/api/v1/sites/${siteA}/vehicles/${delivery.vehicleId}/sales-history`,headers:headers(jarA)});assert.equal(history.statusCode,200,history.body);assert.equal(history.json().items[0].pdiObservations.length,2);
  assert.equal(history.json().items[0].pdiObservations.find((item:{id:string})=>item.id===pdi.json().id)?.observation,note.observation,'The original PDI note must remain unchanged.');
  const correctedHistory=history.json().items[0].pdiObservations.find((item:{id:string})=>item.id===correction.json().id);
  assert.equal(correctedHistory?.correctsObservationId,pdi.json().id);assert.equal(correctedHistory?.correctionReason,correctionBody.correctionReason);
  assert.equal(JSON.stringify(history.json()).toLowerCase().includes('passed'),false,'PDI history must not imply a pass or approval.');
  assert.equal((await admin.query('SELECT 1 FROM sensitive_read_events WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND action=$4',[orgA,siteA,actorA,'vehicle-sales-history-read-prepared'])).rowCount,1);
  await assert.rejects(runtime.query('DELETE FROM sales_deliveries WHERE id=$1',[delivery.id]),/permission denied/i);
});

test('delivery preparation stays separate from dated delivery and links only through an explicit versioned command',async()=>{
  const preparationsPath=`/api/v1/sites/${siteA}/delivery-preparations`,vin=`WVWZZZ1JZXW${randomBytes(3).toString('hex').toUpperCase()}`;
  const body={vehicle:{kind:'new',vin,registration:'SYN-PREP-1',make:'Synthetic BYD',model:'Synthetic Sealion',variant:null,powertrain:'Battery'},summary:'Synthetic source-based pre-delivery notes.',sourceReference:'Synthetic sales preparation record'};
  const readerJar=await signIn('test-reader');
  const denied=await app.inject({method:'POST',url:preparationsPath,headers:headers(readerJar),payload:body});
  assert.equal(denied.statusCode,403,'A site member without the Sales Representative role cannot create a preparation.');
  assert.equal((await admin.query('SELECT 1 FROM public.vehicles WHERE organisation_id=$1 AND vin=$2',[orgA,vin])).rowCount,0,'A denied request must not create a vehicle.');
  await admin.query(`INSERT INTO public.staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,reports_to_placement_id,revision,state,created_by,updated_by)
    SELECT $1,$2,$3,$4,'sales-representative',NULL,1,'active',$4,$4
    WHERE NOT EXISTS(SELECT 1 FROM public.staff_role_placements WHERE organisation_id=$2 AND site_id=$3 AND staff_user_id=$4 AND role_code='sales-representative' AND state='active')`,
  [randomUUID(),orgA,siteA,actorA]);

  const key=randomUUID();
  const saved=await app.inject({method:'POST',url:preparationsPath,headers:headers(jarA,key),payload:body});
  assert.equal(saved.statusCode,200,saved.body);
  const preparation=saved.json();
  assert.equal(preparation.vin,vin);assert.equal(preparation.version,1);assert.equal(preparation.linkedDeliveryId,null);
  assert.equal(preparation.summary,body.summary);assert.equal(preparation.sourceReference,body.sourceReference);
  assert.deepEqual((await admin.query('SELECT customer_id FROM public.vehicles WHERE organisation_id=$1 AND id=$2',[orgA,preparation.vehicleId])).rows[0],{customer_id:null},'A preparation must not infer a client, owner or payer.');
  const secondPreparationKey=randomUUID();
  const secondPreparationResponse=await app.inject({method:'POST',url:preparationsPath,headers:headers(jarA,secondPreparationKey),payload:{vehicle:{kind:'existing',vehicleId:preparation.vehicleId},summary:'Synthetic second preparation record.',sourceReference:'Synthetic second inspection source'}});
  assert.equal(secondPreparationResponse.statusCode,200,secondPreparationResponse.body);
  const secondPreparation=secondPreparationResponse.json();
  assert.deepEqual((await app.inject({method:'POST',url:preparationsPath,headers:headers(jarA,key),payload:body})).json(),preparation,'A same-key retry must return the same preparation.');
  const changedReplay=await app.inject({method:'POST',url:preparationsPath,headers:headers(jarA,key),payload:{...body,summary:'Changed preparation notes.'}});
  assert.equal(changedReplay.statusCode,409,'A changed payload cannot reuse the same idempotency key.');
  const lookup=await app.inject({url:`/api/v1/sites/${siteA}/vehicles/lookup?vin=${vin}`,headers:headers(jarA)});
  assert.equal(lookup.statusCode,200,lookup.body);assert.equal(lookup.json().id,preparation.vehicleId,'A prepared stock vehicle must be findable at its site.');
  const unlinkedHistory=await app.inject({url:`/api/v1/sites/${siteA}/vehicles/${preparation.vehicleId}/sales-history`,headers:headers(jarA)});
  assert.equal(unlinkedHistory.statusCode,200,unlinkedHistory.body);assert.equal(unlinkedHistory.json().items.length,0);assert.equal(unlinkedHistory.json().preparations.length,2,'A vehicle may have more than one preparation; no lifetime-preparation rule is inferred.');
  const otherSiteLookup=await app.inject({url:`/api/v1/sites/${siteA2}/vehicles/lookup?vin=${vin}`,headers:headers(jarA)});
  assert.equal(otherSiteLookup.statusCode,200,otherSiteLookup.body);assert.equal(otherSiteLookup.json(),null,'A preparation must not establish visibility at another site.');
  assert.deepEqual((await admin.query(`SELECT (SELECT count(*)::int FROM public.visits WHERE organisation_id=$1 AND vehicle_id=$2) AS visits,
      (SELECT count(*)::int FROM public.work_orders WHERE organisation_id=$1 AND vehicle_id=$2) AS work_orders`,[orgA,preparation.vehicleId])).rows[0],{visits:0,work_orders:0},'A preparation must not create an after-sales visit or work order.');
  const beforeDelivery=await app.inject({method:'POST',url:`${preparationsPath}/${preparation.id}/link-delivery`,headers:headers(jarA),payload:{expectedVersion:1,deliveryId:randomUUID()}});
  assert.equal(beforeDelivery.statusCode,409);assert.match(beforeDelivery.body,/DELIVERY_REQUIRED/,'A delivery link must name an actual dated delivery.');

  const deliveryBody={vehicle:{kind:'existing',vehicleId:preparation.vehicleId},deliveredOn:'2026-11-14',registrationAtDelivery:'SYN-PREP-1',purchaserAtDeliveryClaim:null,purchaserSource:null,sourceReference:'Synthetic actual dated delivery'};
  const delivery=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/sales-deliveries`,headers:headers(jarA),payload:deliveryBody});
  assert.equal(delivery.statusCode,200,delivery.body);
  const deliveryId=delivery.json().id;
  const wrongDelivery=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/sales-deliveries`,headers:headers(jarA),payload:{...deliveryBody,vehicle:{kind:'new',vin:`WVWZZZ1JZXW${randomBytes(3).toString('hex').toUpperCase()}`,registration:null,make:'Synthetic Other',model:'Synthetic Other Model',variant:null,powertrain:'Battery'}}});
  assert.equal(wrongDelivery.statusCode,200,wrongDelivery.body);
  const linkPath=`${preparationsPath}/${preparation.id}/link-delivery`,linkKeyA=randomUUID(),linkKeyB=randomUUID();
  const wrongLink=await app.inject({method:'POST',url:linkPath,headers:headers(jarA),payload:{expectedVersion:1,deliveryId:wrongDelivery.json().id}});
  assert.equal(wrongLink.statusCode,409,wrongLink.body);assert.match(wrongLink.body,/DELIVERY_REQUIRED/,'Preparation and delivery must refer to the same vehicle.');
  const linkBody={expectedVersion:1,deliveryId},competitors=[linkKeyA,linkKeyB];
  const competingLinks=await Promise.all(competitors.map(key=>app.inject({method:'POST',url:linkPath,headers:headers(jarA,key),payload:linkBody})));
  assert.deepEqual(competingLinks.map(response=>response.statusCode).sort(),[200,409],'Only one same-version delivery link may commit.');
  const winnerIndex=competingLinks.findIndex(response=>response.statusCode===200),linked=competingLinks[winnerIndex],linkKey=competitors[winnerIndex];
  assert.ok(linked&&linkKey,'A successful concurrent link must have a matching idempotency key.');
  assert.equal(linked.json().version,2);assert.equal(linked.json().deliveryId,deliveryId);
  assert.deepEqual((await app.inject({method:'POST',url:linkPath,headers:headers(jarA,linkKey),payload:linkBody})).json(),linked.json(),'A same-key retry must return the original explicit link.');
  const duplicateLink=await app.inject({method:'POST',url:linkPath,headers:headers(jarA),payload:linkBody});
  assert.equal(duplicateLink.statusCode,409,'A second link requires an owner-defined lifecycle rule and is not inferred.');
  const secondLinkKey=randomUUID();
  const secondLinked=await app.inject({method:'POST',url:`${preparationsPath}/${secondPreparation.id}/link-delivery`,headers:headers(jarA,secondLinkKey),payload:linkBody});
  assert.equal(secondLinked.statusCode,200,secondLinked.body);assert.equal(secondLinked.json().deliveryId,deliveryId,'More than one preparation may be associated with the same actual delivery.');
  const history=await app.inject({url:`/api/v1/sites/${siteA}/vehicles/${preparation.vehicleId}/sales-history`,headers:headers(jarA)});
  assert.equal(history.statusCode,200,history.body);assert.equal(history.json().items.length,1);assert.ok(history.json().preparations.every((item:{linkedDeliveryId:string|null;version:number})=>item.linkedDeliveryId===deliveryId&&item.version===2));
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM public.delivery_preparation_delivery_links WHERE organisation_id=$1 AND site_id=$2 AND preparation_id=ANY($3::uuid[])',[orgA,siteA,[preparation.id,secondPreparation.id]])).rows[0]?.count,2);
  const commandIds=[key,secondPreparationKey,linkKey,secondLinkKey];
  const ledger=await admin.query(`SELECT
      (SELECT count(*)::int FROM public.domain_events WHERE aggregate_id=ANY($1::uuid[]) AND event_type=ANY($2::text[])) AS events,
      (SELECT count(*)::int FROM public.command_receipts WHERE actor_id=$3 AND site_id=$4 AND command_id=ANY($5::uuid[])) AS receipts,
      (SELECT count(*)::int FROM public.outbox WHERE event_id IN (SELECT id FROM public.domain_events WHERE aggregate_id=ANY($1::uuid[]) AND event_type=ANY($2::text[]))) AS outbox`,
  [[preparation.id,secondPreparation.id],['sales.delivery-preparation-recorded','sales.delivery-preparation-linked'],actorA,siteA,commandIds]);
  assert.deepEqual(ledger.rows[0],{events:4,receipts:4,outbox:4},'Each saved preparation/link must have one event, receipt and outbox item.');
  const outsideScope=await runtime.query('SELECT id FROM public.delivery_preparations WHERE id=$1',[preparation.id]);assert.equal(outsideScope.rowCount,0,'Forced RLS must hide preparation facts without site scope.');
  const privileges=await admin.query(`SELECT has_table_privilege('vmms_runtime','public.delivery_preparations','SELECT') AS can_read,
      has_table_privilege('vmms_runtime','public.delivery_preparations','INSERT') AS can_insert,
      has_table_privilege('vmms_runtime','public.delivery_preparations','UPDATE') AS can_update,
      has_table_privilege('vmms_runtime','public.delivery_preparations','DELETE') AS can_delete`);
  assert.deepEqual(privileges.rows[0],{can_read:true,can_insert:true,can_update:false,can_delete:false});
  await assert.rejects(runtime.query('DELETE FROM public.delivery_preparations WHERE id=$1',[preparation.id]),/permission denied/i);
});

test('source report transcriptions preserve provenance, corrections and work-order version without claiming task work',async()=>{
  const created=await create(jarA,siteA,'WVWZZZ1JZXW123987');assert.equal(created.statusCode,200,created.body);
  const order=detailSchema.parse(created.json());
  const path=`/api/v1/sites/${siteA}/work-orders/${order.id}/source-reports`;
  const body={expectedVersion:order.version,sourceKind:'workshop-report',title:'Synthetic workshop visit note',sourceDate:'2026-11-12',sourceEvidenceId:null,
    items:[
      {kind:'concern',summary:'Rear noise was reported',detail:'Noise was reported around the rear during driving.',existingComplaintId:null},
      {kind:'test',result:'not-reproduced',summary:'Road test did not reproduce the noise',detail:'No unusual sound was heard during the synthetic road test.',sourceOccurrenceDate:'2026-11-12',relatedConcernOrdinal:1},
      {kind:'action',result:'partial',summary:'Radio application was installed',detail:'The customer can use it after connecting the infotainment system to the internet.',sourceOccurrenceDate:'2026-11-12',relatedConcernOrdinal:null},
      {kind:'follow-up',result:'pending',summary:'Body damage needs assessment',detail:'Repair work has not started.',sourceOccurrenceDate:null,relatedConcernOrdinal:null},
    ],supersedesReportId:null,correctionReason:null};
  const readBefore=await app.inject({url:path,headers:headers(jarA)});assert.equal(readBefore.statusCode,200,readBefore.body);assert.deepEqual(readBefore.json().reports,[]);
  const crossSite=await app.inject({method:'POST',url:path,headers:headers(jarB),payload:body});assert.equal(crossSite.statusCode,403,crossSite.body);
  const afterCrossSite=await admin.query(`SELECT version,(SELECT count(*)::int FROM work_order_source_reports WHERE work_order_id=$1) AS reports
    FROM work_orders WHERE id=$1`,[order.id]);assert.deepEqual(afterCrossSite.rows[0],{version:order.version,reports:0});
  const noCsrf=await app.inject({method:'POST',url:path,headers:{cookie:headers(jarA).cookie,origin},payload:body});assert.equal(noCsrf.statusCode,403);
  const workerJar=await signIn('test-worker-a');
  const denied=await app.inject({method:'POST',url:path,headers:headers(workerJar),payload:body});assert.equal(denied.statusCode,403);assert.equal(denied.json().error.code,'SOURCE_REPORT_ROLE_REQUIRED');
  const readerJar=await signIn('test-reader');
  const readOnly=await app.inject({method:'POST',url:path,headers:headers(readerJar),payload:body});assert.equal(readOnly.statusCode,403);assert.equal(readOnly.json().error.code,'READ_ONLY');
  const operatorJar=await signIn('test-operator-a');
  const operator=await app.inject({method:'POST',url:path,headers:headers(operatorJar),payload:body});assert.equal(operator.statusCode,403);assert.equal(operator.json().error.code,'WORK_ROLE_REQUIRED');
  const commandId=randomUUID();
  const first=await app.inject({method:'POST',url:path,headers:headers(jarA,commandId),payload:body});assert.equal(first.statusCode,200,first.body);
  const replay=await app.inject({method:'POST',url:path,headers:headers(jarA,commandId),payload:body});assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json(),first.json());
  const firstHistory=z.object({workOrderVersion:z.number(),reports:z.array(z.any())}).parse(first.json());
  assert.equal(firstHistory.workOrderVersion,order.version+1);assert.equal(firstHistory.reports.length,1);
  const initialReport=firstHistory.reports[0] as {id:string;sourceDocumentId:string;revision:number;recordedBy:string;items:Array<{kind:string;complaintId:string|null;summary:string}>};
  assert.equal(initialReport.recordedBy,'Advisor A');assert.equal(initialReport.revision,1);assert.equal(initialReport.items.length,4);
  const initialConcernId=initialReport.items[0]?.complaintId;assert.ok(initialConcernId);
  assert.equal(initialReport.items[1]?.kind,'test');assert.equal(initialReport.items[1]?.complaintId,initialConcernId);
  assert.equal(initialReport.items[2]?.kind,'action');assert.equal(initialReport.items[3]?.kind,'follow-up');
  const correction={...body,expectedVersion:firstHistory.workOrderVersion,supersedesReportId:initialReport.id,correctionReason:'Corrected the description after checking the source note.',items:[
    {...body.items[0],summary:'Rear and cabin noise was reported'},
    ...body.items.slice(1),
  ]};
  const revised=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:correction});assert.equal(revised.statusCode,200,revised.body);
  const revisedHistory=z.object({workOrderVersion:z.number(),reports:z.array(z.object({id:z.string(),sourceDocumentId:z.string(),revision:z.number(),supersedesReportId:z.string().nullable(),correctionReason:z.string().nullable(),items:z.array(z.object({complaintId:z.string().nullable()}))}))}).parse(revised.json());
  assert.equal(revisedHistory.reports.length,2);assert.equal(revisedHistory.reports[1]?.revision,2);
  assert.equal(revisedHistory.reports[1]?.sourceDocumentId,initialReport.sourceDocumentId);
  assert.equal(revisedHistory.reports[1]?.supersedesReportId,initialReport.id);
  assert.equal(revisedHistory.reports[1]?.items[0]?.complaintId,initialConcernId);
  const currentRevision=revisedHistory.reports[1]!;
  const concurrentCorrection=(summary:string)=>({...correction,expectedVersion:revisedHistory.workOrderVersion,
    supersedesReportId:currentRevision.id,correctionReason:'Concurrent source-check correction.',
    items:[{...correction.items[0],summary},...correction.items.slice(1)]});
  const concurrentCorrections=await Promise.all([
    app.inject({method:'POST',url:path,headers:headers(jarA,randomUUID()),payload:concurrentCorrection('Rear and cabin noise was reported after source check A')}),
    app.inject({method:'POST',url:path,headers:headers(jarA,randomUUID()),payload:concurrentCorrection('Rear and cabin noise was reported after source check B')}),
  ]);
  assert.deepEqual(concurrentCorrections.map(response=>response.statusCode).sort(),[200,409]);
  const correctionConflict=concurrentCorrections.find(response=>response.statusCode===409);
  assert.equal(correctionConflict?.json().error.code,'STALE_VERSION');
  const detailAfter=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${order.id}`,headers:headers(jarA)});assert.equal(detailAfter.statusCode,200,detailAfter.body);
  const updated=detailSchema.parse(detailAfter.json());assert.equal(updated.complaints.length,2);
  assert.deepEqual(updated.gates.map(gate=>gate.state),order.gates.map(gate=>gate.state));
  const report=await app.inject({url:`/api/v1/sites/${siteA}/work-orders/${order.id}/service-report`,headers:headers(jarA)});assert.equal(report.statusCode,200,report.body);
  assert.deepEqual(report.json().entries,[]);
  const stale=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:{...body,expectedVersion:order.version}});assert.equal(stale.statusCode,409);assert.equal(stale.json().error.code,'STALE_VERSION');
  const historyRead=await app.inject({url:path,headers:headers(jarA)});assert.equal(historyRead.statusCode,200,historyRead.body);assert.equal(historyRead.json().reports.length,3);
  const audit=await admin.query("SELECT count(*)::int AS count FROM sensitive_read_events WHERE site_id=$1 AND actor_id=$2 AND action='work-order-source-reports-read-prepared'",[siteA,actorA]);assert.ok(audit.rows[0]?.count>=2);
  const reviewedCreated=await create(jarA,siteA,'WVWZZZ1JZXW123988');assert.equal(reviewedCreated.statusCode,200,reviewedCreated.body);
  const reviewedOrder=detailSchema.parse(reviewedCreated.json());
  await admin.query(`INSERT INTO work_order_operations_reviews(id,organisation_id,site_id,work_order_id,reviewed_by,notes,reviewed_work_order_version,authority_decision)
    VALUES($1,$2,$3,$4,$5,'Synthetic review-window fixture',$6,$7)`,[randomUUID(),orgA,siteA,reviewedOrder.id,actorA,reviewedOrder.version,{grant:{id:randomUUID(),grant_revision:1},decidedAt:new Date().toISOString()}]);
  const closedPath=`/api/v1/sites/${siteA}/work-orders/${reviewedOrder.id}/source-reports`;
  const closed=await app.inject({method:'POST',url:closedPath,headers:headers(jarA),payload:{...body,expectedVersion:reviewedOrder.version}});
  assert.equal(closed.statusCode,409);assert.equal(closed.json().error.code,'SOURCE_REPORT_WINDOW_CLOSED');
  const unchanged=await admin.query(`SELECT work.version,(SELECT count(*)::int FROM work_order_source_reports report WHERE report.work_order_id=work.id) AS reports,(SELECT count(*)::int FROM complaints complaint WHERE complaint.work_order_id=work.id) AS complaints
    FROM work_orders work WHERE work.organisation_id=$1 AND work.site_id=$2 AND work.id=$3`,[orgA,siteA,reviewedOrder.id]);
  assert.deepEqual(unchanged.rows[0],{version:reviewedOrder.version,reports:0,complaints:1});

  const raceCreated=await create(jarA,siteA,'WVWZZZ1JZXW123989');assert.equal(raceCreated.statusCode,200,raceCreated.body);
  const raceOrder=detailSchema.parse(raceCreated.json());
  const nextReviewGrant=await admin.query(`SELECT coalesce(max(grant_revision),0)+1 AS revision FROM staff_authority_grants
    WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND capability='work-order.operations-review'`,[orgA,siteA,actorA]);
  await admin.query(`INSERT INTO staff_authority_grants(id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from)
    VALUES($1,$2,$3,$4,'work-order.operations-review',$5,$4,'Synthetic race-test grant',now()-interval '1 minute')`,[randomUUID(),orgA,siteA,actorA,nextReviewGrant.rows[0].revision]);
  const raceSourceReport=app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${raceOrder.id}/source-reports`,headers:headers(jarA,randomUUID()),payload:{...body,expectedVersion:raceOrder.version}});
  const raceOperationsReview=app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${raceOrder.id}/operations-review`,headers:headers(jarA,randomUUID()),payload:{expectedVersion:raceOrder.version,notes:'Synthetic concurrent review race'}});
  const [sourceReportRaceResult,operationsReviewRaceResult]=await Promise.all([raceSourceReport,raceOperationsReview]);
  assert.deepEqual([sourceReportRaceResult.statusCode,operationsReviewRaceResult.statusCode].sort(),[200,409]);
  const raceConflict=sourceReportRaceResult.statusCode===409?sourceReportRaceResult:operationsReviewRaceResult;
  assert.equal(raceConflict.json().error.code,sourceReportRaceResult.statusCode===409?'SOURCE_REPORT_WINDOW_CLOSED':'STALE_VERSION');
  const raceState=await admin.query(`SELECT work.version,
      (SELECT count(*)::int FROM work_order_source_reports report WHERE report.organisation_id=work.organisation_id AND report.site_id=work.site_id AND report.work_order_id=work.id) AS reports,
      (SELECT count(*)::int FROM work_order_operations_reviews review WHERE review.organisation_id=work.organisation_id AND review.site_id=work.site_id AND review.work_order_id=work.id) AS reviews
    FROM work_orders work WHERE work.organisation_id=$1 AND work.site_id=$2 AND work.id=$3`,[orgA,siteA,raceOrder.id]);
  assert.equal(raceState.rows[0]?.version,raceOrder.version+1);
  assert.equal(Number(raceState.rows[0]?.reports)+Number(raceState.rows[0]?.reviews),1,'the two competing transitions cannot both commit');

  const rollbackCreated=await create(jarA,siteA,'WVWZZZ1JZXW123990');assert.equal(rollbackCreated.statusCode,200,rollbackCreated.body);
  const rollbackOrder=detailSchema.parse(rollbackCreated.json());
  const rollbackPayload={...body,expectedVersion:rollbackOrder.version};
  const rollbackCommandId=randomUUID();
  const ledgerCounts=()=>admin.query(`SELECT
      (SELECT count(*)::int FROM work_orders) AS workOrders,
      (SELECT count(*)::int FROM complaints) AS complaints,
      (SELECT count(*)::int FROM work_order_source_reports) AS reports,
      (SELECT count(*)::int FROM work_order_source_report_items) AS reportItems,
      (SELECT count(*)::int FROM domain_events) AS events,
      (SELECT count(*)::int FROM command_receipts) AS receipts,
      (SELECT count(*)::int FROM outbox) AS outbox`);
  const ledgerBeforeFailure=await ledgerCounts();
  await admin.query("CREATE FUNCTION fail_source_report_outbox_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic source report outbox failure'; END $$");
  await admin.query('CREATE TRIGGER fail_source_report_outbox_test BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION fail_source_report_outbox_test()');
  try {
    const failed=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${rollbackOrder.id}/source-reports`,headers:headers(jarA,rollbackCommandId),payload:rollbackPayload});
    assert.equal(failed.statusCode,500,failed.body);
  } finally {
    await admin.query('DROP TRIGGER fail_source_report_outbox_test ON outbox');
    await admin.query('DROP FUNCTION fail_source_report_outbox_test()');
  }
  assert.deepEqual((await ledgerCounts()).rows,ledgerBeforeFailure.rows,'A failed outbox write must roll back the source report, complaint, version, event and receipt together.');
  const retryAfterRollback=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${rollbackOrder.id}/source-reports`,headers:headers(jarA,rollbackCommandId),payload:rollbackPayload});
  assert.equal(retryAfterRollback.statusCode,200,`${retryAfterRollback.body} The same idempotency key remains usable after transaction rollback.`);
});

test('Finance configuration drafts require a current scoped grant and remain non-effective immutable revisions',async()=>{
  const draftId=randomUUID(),manageGrantId=randomUUID(),readGrantId=randomUUID();
  const path=`/api/v1/sites/${siteA}/finance/configuration-drafts`;
  const content={
    schemaVersion:1 as const,
    legalEntity:{proposedName:null,registrationReference:null,businessAddress:null,businessContactReference:null},
    currencyCode:null,
    rateScheduleReference:null,
    taxTreatmentReference:null,
    invoiceNumberingRuleReference:null,
    receiptNumberingRuleReference:null,
    paymentTermsReference:null,
    paymentVerificationSourceReference:null,
    paymentEvidencePolicyReference:null,
    showroomGuaranteeAuthorityReference:null,
    invoiceTemplateReference:null,
    receiptTemplateReference:null,
    emailSenderConfigurationReference:null,
    verifiedClientEmailPolicyReference:null,
    correctionPolicyReference:null,
    retentionPolicyReference:null,
    sourceReferences:[],
  };
  const first={draftId,expectedRevision:0,revisionNote:'Synthetic initial Finance proposal',content};
  const deniedRead=await app.inject({url:path,headers:headers(jarA)});
  assert.equal(deniedRead.statusCode,403);
  assert.equal(deniedRead.json().error.code,'FINANCE_CONFIGURATION_GRANT_REQUIRED');
  const deniedWrite=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:first});
  assert.equal(deniedWrite.statusCode,403);
  assert.equal(deniedWrite.json().error.code,'FINANCE_CONFIGURATION_GRANT_REQUIRED');
  assert.equal((await admin.query('SELECT 1 FROM public.finance_configuration_draft_revisions WHERE draft_id=$1',[draftId])).rowCount,0);

  const now=new Date(Date.now()-1000);
  await admin.query(`INSERT INTO public.staff_authority_grants
    (id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from)
    VALUES($1,$2,$3,$4,'finance.configuration-draft.manage',1,$4,'Synthetic isolated Finance draft test grant',$5)`,
  [manageGrantId,orgA,siteA,actorA,now]);
  const firstKey=randomUUID();
  const saved=await app.inject({method:'POST',url:path,headers:headers(jarA,firstKey),payload:first});
  assert.equal(saved.statusCode,200,saved.body);
  const firstRevision=saved.json();
  assert.equal(firstRevision.draftId,draftId);
  assert.equal(firstRevision.revision,1);
  assert.equal(firstRevision.previousRevision,null);
  assert.equal(firstRevision.state,'draft-only');
  assert.equal(firstRevision.operationallyEffective,false);
  assert.deepEqual((await app.inject({method:'POST',url:path,headers:headers(jarA,firstKey),payload:first})).json(),firstRevision,
    'An identical command retry must return the one saved revision.');

  const second={...first,expectedRevision:1,revisionNote:'Synthetic Finance proposal revision',content:{...content,currencyCode:'GHS'}};
  const secondKey=randomUUID();
  const secondSaved=await app.inject({method:'POST',url:path,headers:headers(jarA,secondKey),payload:second});
  assert.equal(secondSaved.statusCode,200,secondSaved.body);
  assert.equal(secondSaved.json().revision,2);
  assert.equal(secondSaved.json().previousRevision,1);
  assert.equal(secondSaved.json().operationallyEffective,false);
  const stale=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:{...second,expectedRevision:1}});
  assert.equal(stale.statusCode,409);
  assert.equal(stale.json().error.code,'STALE_FINANCE_DRAFT');
  const unknownField=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:{...second,content:{...second.content,approvedTaxRate:0}}});
  assert.equal(unknownField.statusCode,400);
  const inlineSecret=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:{...second,content:{...second.content,emailSenderConfigurationReference:'smtp://user:synthetic-password@example.test'}}});
  assert.equal(inlineSecret.statusCode,400,'Credential-bearing sender values must not be stored as configuration references.');

  const competitors=[
    {body:{...second,expectedRevision:2,revisionNote:'Synthetic competing Finance proposal A'},key:randomUUID()},
    {body:{...second,expectedRevision:2,revisionNote:'Synthetic competing Finance proposal B'},key:randomUUID()},
  ];
  const race=await Promise.all(competitors.map(({body,key})=>app.inject({method:'POST',url:path,headers:headers(jarA,key),payload:body})));
  assert.deepEqual(race.map(response=>response.statusCode).sort(),[200,409],
    'Concurrent writes against one expected revision must have exactly one winner.');
  const winner=race.find(response=>response.statusCode===200);
  const loser=race.find(response=>response.statusCode===409);
  assert.equal(winner?.json().revision,3);
  assert.equal(loser?.json().error.code,'STALE_FINANCE_DRAFT');

  const listed=await app.inject({url:`${path}?page=1&pageSize=1`,headers:headers(jarA)});
  assert.equal(listed.statusCode,200,listed.body);
  assert.equal(listed.headers['cache-control'],'no-store');
  assert.equal(listed.json().totalItems,3);
  assert.equal(listed.json().items.length,1);
  assert.equal(listed.json().items[0].state,'draft-only');
  assert.equal(listed.json().items[0].operationallyEffective,false);
  assert.equal(listed.json().canManage,true);
  const secondPage=await app.inject({url:`${path}?page=2&pageSize=1`,headers:headers(jarA)});
  assert.equal(secondPage.statusCode,200,secondPage.body);
  assert.equal(secondPage.json().items.length,1);
  assert.notEqual(secondPage.json().items[0].revisionId,listed.json().items[0].revisionId);
  const allRevisions=await app.inject({url:`${path}?page=1&pageSize=25`,headers:headers(jarA)});
  assert.equal(allRevisions.statusCode,200,allRevisions.body);
  const currentRevisions=allRevisions.json().items.filter((item:{isCurrent:boolean})=>item.isCurrent);
  const priorRevisions=allRevisions.json().items.filter((item:{isCurrent:boolean})=>!item.isCurrent);
  assert.equal(currentRevisions.length,1);
  assert.equal(currentRevisions[0]?.revision,3);
  assert.equal(priorRevisions.length,2);

  await admin.query(`UPDATE public.staff_authority_grants SET revoked_at=clock_timestamp(),revoked_by=$2,
      revocation_reason='Synthetic grant rotation for isolated test'
    WHERE id=$1`,[manageGrantId,actorA]);
  await admin.query(`INSERT INTO public.staff_authority_grants
    (id,organisation_id,site_id,staff_user_id,capability,grant_revision,granted_by,basis_reference,valid_from)
    VALUES($1,$2,$3,$4,'finance.configuration-draft.read',1,$4,'Synthetic isolated Finance read test grant',$5)`,
  [readGrantId,orgA,siteA,actorA,now]);
  const readOnlyList=await app.inject({url:path,headers:headers(jarA)});
  assert.equal(readOnlyList.statusCode,200,readOnlyList.body);
  assert.equal(readOnlyList.json().canManage,false);
  const deniedAfterRotation=await app.inject({method:'POST',url:path,headers:headers(jarA),payload:{...second,expectedRevision:2}});
  assert.equal(deniedAfterRotation.statusCode,403);
  assert.equal(deniedAfterRotation.json().error.code,'FINANCE_CONFIGURATION_GRANT_REQUIRED');

  const runtimeWithoutScope=await runtime.query('SELECT id FROM public.finance_configuration_draft_revisions WHERE draft_id=$1',[draftId]);
  assert.equal(runtimeWithoutScope.rowCount,0,'Forced RLS must hide site data without transaction scope.');
  const privileges=await admin.query(`SELECT has_table_privilege('vmms_runtime','public.finance_configuration_draft_revisions','SELECT') AS can_read,
      has_table_privilege('vmms_runtime','public.finance_configuration_draft_revisions','INSERT') AS can_insert,
      has_table_privilege('vmms_runtime','public.finance_configuration_draft_revisions','UPDATE') AS can_update,
      has_table_privilege('vmms_runtime','public.finance_configuration_draft_revisions','DELETE') AS can_delete`);
  assert.deepEqual(privileges.rows[0],{can_read:true,can_insert:true,can_update:false,can_delete:false});
  const eventCount=await admin.query(`SELECT
      (SELECT count(*)::int FROM public.domain_events WHERE aggregate_id=$1 AND event_type='finance.configuration-draft.saved') AS events,
      (SELECT count(*)::int FROM public.command_receipts WHERE actor_id=$2 AND command_id=ANY($3::uuid[])) AS receipts,
      (SELECT count(*)::int FROM public.outbox WHERE event_id IN (SELECT id FROM public.domain_events WHERE aggregate_id=$1 AND event_type='finance.configuration-draft.saved')) AS outbox`,
  [draftId,actorA,[firstKey,secondKey,...competitors.map(({key})=>key)]]);
  assert.equal(eventCount.rows[0]?.events,3);
  assert.equal(eventCount.rows[0]?.receipts,3);
  assert.equal(eventCount.rows[0]?.outbox,3);
  assert.equal((await admin.query(`SELECT count(*)::int AS count FROM public.sensitive_read_events
    WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND action='finance-configuration-draft-read-prepared'`,
  [orgA,siteA,actorA])).rows[0]?.count,4);
});
