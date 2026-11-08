import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { randomBytes,randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { makePool,scoped } from '../src/db.js';
import { hashPassword } from '../src/identity.js';
import { detailSchema } from '../src/schemas.js';
import type { Config } from '../src/config.js';
import type { OidcProvider } from '../src/oidc-client.js';

loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
const ownerUrl=z.url().parse(process.env.MIGRATION_DATABASE_URL);
const runtimeUrl=z.url().parse(process.env.DATABASE_URL);
const name=`vmms_test_${process.pid}_${randomBytes(4).toString('hex')}`;
const owner=new pg.Pool({connectionString:ownerUrl});
const testOwnerUrl=new URL(ownerUrl);testOwnerUrl.pathname=`/${name}`;
const testRuntimeUrl=new URL(runtimeUrl);testRuntimeUrl.pathname=`/${name}`;
const admin=new pg.Pool({connectionString:testOwnerUrl.toString()});
const runtime=makePool(testRuntimeUrl.toString());
const orgA=randomUUID(),orgB=randomUUID(),siteA=randomUUID(),siteA2=randomUUID(),siteB=randomUUID(),actorA=randomUUID(),actorB=randomUUID(),reader=randomUUID(),ownerAccountA=randomUUID(),ownerAccountB=randomUUID(),ownerAccountC=randomUUID(),ownerEvidence=randomUUID();
const password='Synthetic-test-account-7392';
const origin='http://127.0.0.1:5173';
const config:Config={DATABASE_URL:testRuntimeUrl.toString(),SESSION_SECRET:'test-session-secret-must-be-at-least-32-characters',WEB_ORIGIN:origin,OIDC_ISSUER:'http://localhost:8080/realms/raymond-gray-dev',OIDC_CLIENT_ID:'vmms-web-dev',OIDC_CALLBACK_URL:'http://127.0.0.1:4100/api/v1/auth/oidc/callback',PORT:4100,HOST:'127.0.0.1',NODE_ENV:'test'};
let app:Awaited<ReturnType<typeof createApp>>;
let jarA:Record<string,string>={},jarB:Record<string,string>={};
let orderA:z.infer<typeof detailSchema>;
let orderB:z.infer<typeof detailSchema>;

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
  async createAuthorizationUrl(input) {
    const url=new URL('http://localhost:8080/realms/raymond-gray-dev/protocol/openid-connect/auth');
    url.searchParams.set('state',input.state);url.searchParams.set('nonce',input.nonce);url.searchParams.set('code_challenge','synthetic-pkce-challenge');
    return url;
  },
  async exchangeAuthorizationCode(input) {
    const code=input.callbackUrl.searchParams.get('code');
    assert.ok(code==='synthetic-code'||code==='unmapped-code');
    assert.equal(input.callbackUrl.searchParams.get('state'),input.state);
    assert.equal(input.codeVerifier.length>=43,true);
    return {issuer:config.OIDC_ISSUER,subject:code==='unmapped-code'?'unmapped-subject':'synthetic-advisor-subject'};
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

async function signIn(username:string) {
  const jar:Record<string,string>={};
  const session=await app.inject({method:'GET',url:'/api/v1/session'});
  updateCookies(jar,session.headers['set-cookie']);
  const response=await app.inject({method:'POST',url:'/api/v1/session',headers:headers(jar),payload:{username,password}});
  assert.equal(response.statusCode,200,response.body);
  updateCookies(jar,response.headers['set-cookie']);
  return jar;
}

function intake(vin='WVWZZZ1JZXW000001') {
  return {customer:{name:'Synthetic Customer',phone:'+233200000000',email:''},vehicle:{vin,registration:'DEV-100',make:'Development',model:'EV'},odometerKm:12000,socPercent:42,complaint:'Customer reports intermittent charging.'};
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
  await admin.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4),($8,$9,$10,$4)',[actorA,'test-advisor-a','Advisor A',hash,actorB,'test-advisor-b','Advisor B',reader,'test-reader','Reader']);
  await admin.query('INSERT INTO staff_identities(issuer,subject,staff_user_id) VALUES($1,$2,$3)',[config.OIDC_ISSUER,'synthetic-advisor-subject',actorA]);
  await admin.query('INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,true),($1,$3,true),($4,$5,true),($6,$2,false)',[actorA,siteA,siteA2,actorB,siteB,reader]);
  await admin.query(`INSERT INTO evidence_records(id,organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,purpose_kind,display_name,declared_media_type,quarantine_key,accepted_key) VALUES($1,$2,$3,'accepted',$4,'application/pdf',128,$5,'legacy','synthetic-owner-approval.pdf','application/pdf',$6,$7)`,[ownerEvidence,orgA,siteA,'a'.repeat(64),actorA,`quarantine/${orgA}/${siteA}/${ownerEvidence}`,`accepted/${orgA}/${siteA}/${ownerEvidence}`]);
  await admin.query(`INSERT INTO evidence_scan_attempts(id,organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code,scanned_at) VALUES($1,$2,$3,$4,1,'clean',$5,'synthetic-test','1','clean',now())`,[randomUUID(),orgA,siteA,ownerEvidence,'a'.repeat(64)]);
  await admin.query('INSERT INTO vehicle_owner_accounts(id,organisation_id,issuer,subject) VALUES($1,$2,$3,$4),($5,$2,$3,$6),($7,$2,$3,$8)',[ownerAccountA,orgA,config.OIDC_ISSUER,'synthetic-owner-a',ownerAccountB,'synthetic-owner-b',ownerAccountC,'synthetic-owner-c']);
  await admin.query('INSERT INTO owner_access_approver_grants(id,organisation_id,site_id,staff_user_id,capability,granted_by,evidence_record_id,reason,valid_from,valid_until) VALUES($1,$2,$3,$4,\'vehicle-owner-access.manage\',$4,$5,\'Synthetic test-only approval authority\',now()-interval \'1 minute\',now()+interval \'1 day\')',[randomUUID(),orgA,siteA,actorA,ownerEvidence]);
  app=await createApp(config,runtime,testOidcProvider);
  jarA=await signIn('test-advisor-a');jarB=await signIn('test-advisor-b');
});

test('runtime cannot claim or complete evidence scans or forge accepted evidence',async()=>{
  await assert.rejects(runtime.query('SELECT * FROM public.claim_evidence_scan_job($1)',[120]),/permission denied/i);
  await assert.rejects(runtime.query(`SELECT public.complete_evidence_scan_job($1,$2,'clean',$3,'forged','1','clean',now())`,[randomUUID(),randomUUID(),'a'.repeat(64)]),/permission denied/i);
  await assert.rejects(runtime.query(`UPDATE evidence_records SET scan_state='accepted' WHERE id=$1`,[ownerEvidence]),/permission denied/i);
});

test('shared OIDC login binds independent tabs, issues only a local session, and consumes state once',async()=>{
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
  assert.equal((await app.inject({url:`/api/v1/sites/${siteA}/work-orders`,headers:{cookie:Object.entries(sessionJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).statusCode,200);
  assert.equal((await app.inject({url:`/api/v1/sites/${siteB}/work-orders`,headers:{cookie:Object.entries(sessionJar).map(([key,value])=>`${key}=${value}`).join('; ')}})).statusCode,403);

  const replay=await completeOidc(second.state,second.jar);
  assert.equal(new URL(replay.headers.location!).searchParams.get('signin'),'failed');
  const unmappedFlow=await startOidc();
  const unmapped=await completeOidc(unmappedFlow.state,unmappedFlow.jar,'unmapped-code');
  assert.equal(new URL(unmapped.headers.location!).searchParams.get('signin'),'not-approved');
  assert.ok(first.state.length>=32);
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

test('session identifies only permitted sites and prevents CSRF, forged actor and unauthenticated requests',async()=>{
  const session=await app.inject({url:'/api/v1/session',headers:headers(jarA)});
  const body=z.object({authenticated:z.literal(true),sites:z.array(z.object({id:z.string()}))}).parse(session.json());
  assert.deepEqual(new Set(body.sites.map(s=>s.id)),new Set([siteA,siteA2]));
  const noToken=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:{cookie:headers(jarA).cookie,origin},payload:intake()});assert.equal(noToken.statusCode,403);
  const missing=await app.inject(`/api/v1/sites/${siteA}/work-orders`);assert.equal(missing.statusCode,401);
  const forged=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/intake-drafts`,headers:headers(jarA),payload:{...intake(),actorId:actorB}});assert.equal(forged.statusCode,400);
});

test('intake persists one visit, work order and C01 with all gates pending',async()=>{
  const response=await create(jarA,siteA,'WVWZZZ1JZXW000001');assert.equal(response.statusCode,200,response.body);
  orderA=detailSchema.parse(response.json());assert.equal(orderA.complaints.length,1);assert.equal(orderA.complaints[0]?.reference,'C01');
  assert.equal(orderA.gates.length,5);assert.ok(orderA.gates.every(g=>g.state==='pending'));assert.equal(orderA.history.length,1);
  const firstEvent=await admin.query('SELECT actor_id,event_type,aggregate_version,reason,previous_state,new_state FROM domain_events WHERE aggregate_id=$1',[orderA.id]);
  assert.deepEqual(firstEvent.rows[0],{actor_id:actorA,event_type:'reception.draft-created',aggregate_version:1,reason:'Reception draft saved; intake gate remains pending.',previous_state:{},new_state:{version:1,customerId:orderA.customer.id,vehicleId:orderA.vehicle.id,visitId:(await admin.query('SELECT id FROM visits WHERE vehicle_id=$1',[orderA.vehicle.id])).rows[0].id,complaintId:orderA.complaints[0]?.id}});
  const responseB=await create(jarB,siteB,'WVWZZZ1JZXW000001');assert.equal(responseB.statusCode,200,responseB.body);orderB=detailSchema.parse(responseB.json());
  const rows=await admin.query('SELECT (SELECT count(*) FROM visits WHERE site_id=$1)::int AS visits,(SELECT count(*) FROM work_orders WHERE site_id=$1)::int AS work_orders,(SELECT count(*) FROM command_receipts WHERE site_id=$1)::int AS receipts,(SELECT count(*) FROM outbox WHERE site_id=$1)::int AS outbox',[siteA]);
  assert.deepEqual(rows.rows[0],{visits:1,work_orders:1,receipts:1,outbox:1});
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
  const ledger=await admin.query(`SELECT (SELECT count(*) FROM vehicle_owner_revisions)::int AS revisions,(SELECT count(*) FROM domain_events WHERE aggregate_type='vehicle-owner-access')::int AS events,(SELECT count(*) FROM outbox)::int AS outbox`);
  assert.deepEqual(ledger.rows[0],{revisions:4,events:3,outbox:5});
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
  const complaint=orderA.complaints[0];assert.ok(complaint);
  const task=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/tasks`,headers:headers(jarA),payload:{expectedVersion:orderA.version,complaintId:complaint.id,title:'Investigate charging report'}});assert.equal(task.statusCode,200,task.body);orderA=detailSchema.parse(task.json());
  const taskId=orderA.tasks[0]?.id;assert.ok(taskId);
  const hold=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/holds`,headers:headers(jarA),payload:{expectedVersion:orderA.version,scope:{kind:'task',taskId},category:'parts',severity:'warning',reason:'Awaiting identification',source:'Advisor observation'}});assert.equal(hold.statusCode,200,hold.body);orderA=detailSchema.parse(hold.json());assert.equal(orderA.holds[0]?.taskId,taskId);
  const other=await app.inject({method:'POST',url:`/api/v1/sites/${siteA}/work-orders/${orderA.id}/tasks`,headers:headers(jarA),payload:{expectedVersion:orderA.version,complaintId:complaint.id,title:'Plan unrelated visual assessment'}});assert.equal(other.statusCode,200,other.body);orderA=detailSchema.parse(other.json());assert.equal(orderA.tasks.length,2);assert.ok(orderA.tasks.every(t=>t.state==='planned'));
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
    assert.equal((await client.query('SELECT id FROM vehicle_owner_access_scopes')).rowCount,1);
    assert.equal((await client.query('SELECT id FROM evidence_records')).rowCount,1);
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

test('login attempts are bounded without leaking account existence',async()=>{
  const jar:Record<string,string>={};
  updateCookies(jar,(await app.inject('/api/v1/session')).headers['set-cookie']);
  for(let attempt=0;attempt<10;attempt++) {
    const result=await app.inject({method:'POST',url:'/api/v1/session',headers:headers(jar),payload:{username:'nonexistent-person',password:'incorrect'}});assert.equal(result.statusCode,401);
  }
  const throttled=await app.inject({method:'POST',url:'/api/v1/session',headers:headers(jar),payload:{username:'nonexistent-person',password:'incorrect'}});assert.equal(throttled.statusCode,429);
});
