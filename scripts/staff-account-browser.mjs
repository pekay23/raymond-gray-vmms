import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const origin=new URL(process.env.VMMS_WEB_ORIGIN??'http://127.0.0.1:5173');
assert(['127.0.0.1','localhost','::1'].includes(origin.hostname),'Staff-account browser checks may only target a local loopback web origin.');
const siteId='10000000-0000-4000-8000-000000000002';
const operatorId='10000000-0000-4000-8000-000000000013';
const procedureId='30000000-0000-4000-8000-000000000001';
const operatorSite={id:siteId,name:'Synthetic Service Centre',code:'SYN',timeZone:'Africa/Accra',canWrite:true,roleCodes:['vmms-operator']};
const headSite={...operatorSite,canWrite:false,roleCodes:['head-service-centre']};
const now=new Date().toISOString();
const requests=[];
const commands=[];
const checks=[];
const errors=[];
const viewports=[{width:280,height:653},{width:320,height:568},{width:390,height:844},{width:540,height:720},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}];
const checksDir=resolve('docs/verification/browser');
await mkdir(checksDir,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.VMMS_BROWSER_CHANNEL||'msedge'});

function record(name){checks.push({name,result:'VERIFIED'});}
function sessionRoute(site){return async route=>route.fulfill({status:200,headers:{'set-cookie':'vmms_csrf=synthetic-csrf; Path=/; SameSite=Strict'},contentType:'application/json',body:JSON.stringify({authenticated:true,user:{id:operatorId,displayName:site===operatorSite?'Synthetic Operator':'Synthetic Head'},sites:[site]})});}
function requestList(){return {requests:[...requests].reverse(),page:1,pageSize:25,totalCount:requests.length,totalPages:Math.ceil(requests.length/25)}};

try{
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin.origin?route.continue():route.abort('blockedbyclient'));
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/api/v1/session',async route=>{
    if(route.request().method()==='GET') return sessionRoute(operatorSite)(route);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})});
  });
  await page.route('**/api/v1/owner/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  let operatorWorkReadCount=0;
  await page.route(`**/api/v1/sites/${siteId}/work-orders*`,route=>{operatorWorkReadCount++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],pagination:{page:1,pageSize:25,totalItems:0,totalPages:0},totals:{open:0,held:0,intakeDrafts:0},asOf:now})});});
  await page.route(`**/api/v1/sites/${siteId}/documents*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({documents:[{documentId:procedureId,reference:'SYN-PROC-01',alias:'Workshop procedure',title:'Synthetic approved procedure',ownerName:'Synthetic Quality Lead',revision:'1.0',effectiveFrom:now,reviewDueAt:null}],pagination:{page:1,pageSize:25,totalItems:1,totalPages:1}})}));
  await page.route(`**/api/v1/sites/${siteId}/staff/account-provisioning-requests*`,async route=>{
    if(route.request().method()==='GET') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(requestList())});
    assert.equal(route.request().method(),'POST');
    const body=route.request().postDataJSON();
    assert.match(route.request().headers()['idempotency-key']??'',/^[0-9a-f-]{36}$/i);
    assert.equal('roleCode' in body,false,'Account requests must not assign work roles.');
    assert.equal('password' in body,false,'The VMMS browser must not create or send a password.');
    commands.push(body);
    const request={id:'20000000-0000-4000-8000-000000000001',email:String(body.email).toLowerCase(),displayName:body.displayName,siteAccess:body.siteAccess,state:'queued',revision:1,createdAt:now};
    requests.push(request);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:request.id,displayName:request.displayName,siteAccess:request.siteAccess,state:request.state,revision:request.revision,createdAt:request.createdAt})});
  });

  await page.goto(`${origin.origin}/sites/${siteId}/work-orders`);
  await page.getByRole('heading',{level:1,name:'Staff account requests'}).waitFor();
  assert.equal(new URL(page.url()).pathname,`/sites/${siteId}/staff/accounts`,'An account-only Operator must land in account administration.');
  assert.equal(operatorWorkReadCount,0,'An account-only Operator must not request the workshop queue.');
  assert.equal(await page.getByRole('link',{name:'Work orders'}).count(),0);
  await page.getByRole('link',{name:'Documents'}).waitFor();
  await page.getByRole('link',{name:'Documents'}).click();
  await page.getByLabel('Search by title, reference, or another name',{exact:true}).waitFor();
  await page.getByRole('heading',{name:'Current procedures'}).waitFor();
  await page.getByText('They do not replace the checks or approvals required before work starts.',{exact:false}).waitFor();
  await page.getByText('Maintained by',{exact:true}).waitFor();
  await page.getByText('Current since',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Download current version of Synthetic approved procedure',exact:true}).waitFor();
  const procedureSearch=page.getByRole('searchbox',{name:'Search by title, reference, or another name'});
  await procedureSearch.fill('current');
  await procedureSearch.focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button',{name:'Search',exact:true}).evaluate(element=>element===document.activeElement),true,'Search must follow the procedure search field in keyboard order.');
  const procedureAxe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  assert.deepEqual(procedureAxe.violations.map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.map(node=>node.target)})),[],'Procedure library must pass automated WCAG 2.1 A/AA scans.');
  for(const {width,height} of viewports){
    await page.setViewportSize({width,height});
    const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,main:document.querySelector('main')?.getBoundingClientRect().width}));
    assert(dimensions.scroll<=dimensions.width+1,`${width}px procedure page overflows horizontally: ${JSON.stringify(dimensions)}`);
    assert(dimensions.main&&dimensions.main>0,`${width}px procedure page has no visible main content.`);
  }
  await page.setViewportSize({width:1280,height:900});
  record('Procedure library uses plain labels, keeps safety meaning, supports keyboard access, and fits seven viewport widths');
  assert.equal(new URL(page.url()).pathname,`/sites/${siteId}/documents`);
  assert.equal(operatorWorkReadCount,0,'Opening documents must not load the workshop queue for an account-only Operator.');
  record('Operator-only staff can open site-scoped staff documents while remaining excluded from workshop queues');
  await page.goto(`${origin.origin}/sites/${siteId}/staff/accounts`);
  await page.getByRole('heading',{level:1,name:'Staff account requests'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Head overview'}).count(),0);
  await page.goto(`${origin.origin}/sites/${siteId}/work-orders`);
  await page.getByRole('heading',{level:1,name:'Staff account requests'}).waitFor();
  assert.equal(operatorWorkReadCount,0,'Direct work-order navigation must return to account administration without reading workshop data.');
  record('Account-only Operator keeps account administration separate from workshop queues and Head management routes');
  await page.getByRole('link',{name:'Staff accounts'}).waitFor();
  await page.getByRole('link',{name:'Staff accounts'}).click();
  await page.getByRole('heading',{level:1,name:'Staff account requests'}).waitFor();
  await page.getByText('No account or invitation is created yet.',{exact:false}).waitFor();
  await page.getByRole('heading',{name:'No account requests yet'}).waitFor();
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  assert.deepEqual(axe.violations.map(item=>({id:item.id,impact:item.impact,nodes:item.nodes.map(node=>node.target)})),[], 'Operator account page must pass automated WCAG 2.1 A/AA scans.');
  record('Operator account request page passes automated WCAG 2.1 A/AA scan');

  for(const {width,height} of viewports){
    await page.setViewportSize({width,height});
    const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,main:document.querySelector('main')?.getBoundingClientRect().width}));
    assert(dimensions.scroll<=dimensions.width+1,`${width}px account page overflows horizontally: ${JSON.stringify(dimensions)}`);
    assert(dimensions.main&&dimensions.main>0,`${width}px account page has no visible main content.`);
    await page.screenshot({path:resolve(checksDir,`staff-accounts-${width}x${height}.png`),fullPage:true});
    checks.push({name:`${width}x${height} account page fits without horizontal overflow`,result:'VERIFIED'});
  }

  await page.getByLabel('Staff name').fill('Synthetic New Staff');
  await page.getByLabel('Email for sign-in setup').fill('New.Staff@example.test');
  await page.getByLabel('Site access').selectOption('read-only');
  await page.getByLabel('Reason for this request').fill('Synthetic browser account request.');
  await page.getByRole('button',{name:'Save account request'}).click();
  await page.getByRole('status').filter({hasText:'No sign-in invitation has been sent.'}).waitFor();
  await page.getByText('new.staff@example.test',{exact:true}).waitFor();
  assert.equal(commands.length,1);
  assert.equal(commands[0].siteAccess,'read-only');
  assert.equal(await page.getByLabel('Staff name').inputValue(),'');
  record('Account request posts without a role or credential and clearly confirms no invitation was sent');

  const offlinePage=await context.newPage();
  offlinePage.setDefaultTimeout(5000);
  offlinePage.on('pageerror',error=>errors.push(error.message));
  await offlinePage.route('**/api/v1/session',async route=>{
    if(route.request().method()==='GET') return sessionRoute(operatorSite)(route);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})});
  });
  await offlinePage.route('**/api/v1/owner/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  let offlineWorkReadCount=0;
  await offlinePage.route(`**/api/v1/sites/${siteId}/work-orders*`,route=>{offlineWorkReadCount++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],pagination:{page:1,pageSize:25,totalItems:0,totalPages:0},totals:{open:0,held:0,intakeDrafts:0},asOf:now})});});
  let offlineAccountReadCount=0;
  await offlinePage.route(`**/api/v1/sites/${siteId}/staff/account-provisioning-requests*`,async route=>{
    if(route.request().method()!=='GET') return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'OPERATOR_REQUIRED',message:'Restricted'}})});
    offlineAccountReadCount++;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({requests:[],page:1,pageSize:25,totalCount:0,totalPages:0})});
  });
  await offlinePage.goto(`${origin.origin}/sites/${siteId}/work-orders`);
  await offlinePage.getByRole('heading',{level:1,name:'Staff account requests'}).waitFor();
  assert.equal(offlineWorkReadCount,0,'Offline account-only access must not request workshop records.');
  await offlinePage.evaluate(async()=>{await import('/src/pages/staff-accounts.tsx');});
  await offlinePage.context().setOffline(true);
  assert.equal(await offlinePage.evaluate(()=>navigator.onLine),false,'Browser must report offline before exercising the offline account page.');
  await offlinePage.getByText('You are offline. This list was loaded earlier in this tab and may be out of date; it is not saved on this device.',{exact:true}).waitFor();
  await offlinePage.getByRole('heading',{name:'No account requests yet'}).waitFor();
  assert.equal(await offlinePage.getByRole('button',{name:'Save account request'}).isDisabled(),true);
  assert.equal(offlineAccountReadCount,1,'The account list should load once while online and must not refresh while offline.');
  await offlinePage.context().setOffline(false);
  await offlinePage.close();
  record('Offline Operator view marks the earlier account list as potentially stale and blocks account changes');

  const headPage=await context.newPage();
  headPage.on('pageerror',error=>errors.push(error.message));
  await headPage.route('**/api/v1/session',sessionRoute(headSite));
  await headPage.route('**/api/v1/owner/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  await headPage.route(`**/api/v1/sites/${siteId}/work-orders*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],pagination:{page:1,pageSize:25,totalItems:0,totalPages:0},totals:{open:0,held:0,intakeDrafts:0},asOf:now})}));
  await headPage.route(`**/api/v1/sites/${siteId}/staff/account-provisioning-requests*`,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'OPERATOR_REQUIRED',message:'Only Operators may access this section.'}})}));
  await headPage.goto(`${origin.origin}/sites/${siteId}/work-orders`);
  await headPage.getByRole('heading',{level:1,name:'Work orders'}).waitFor();
  assert.equal(await headPage.getByRole('link',{name:'Staff accounts'}).count(),0,'The Head must not see the Operator account link.');
  await headPage.goto(`${origin.origin}/sites/${siteId}/staff/accounts`);
  await headPage.getByRole('heading',{level:1,name:'This section is for the VMMS Operator'}).waitFor();
  assert.equal(await headPage.getByText('new.staff@example.test').count(),0,'The Head must not see pending account-request data.');
  record('Head overview hides Operator navigation and direct API denial shows no account data');
  await headPage.close();
  await context.close();

  assert.deepEqual(errors,[],`Unexpected browser errors: ${errors.join('; ')}`);
  const report={result:'passed',checks,commands:commands.length,viewports,limitations:['Browser API responses are synthetic; PostgreSQL/API authorization has a separate integration test.','No identity-provider invitation is sent by this slice.','This is local browser evidence, not physical-device coverage or staff UAT.']};
  await writeFile(resolve(checksDir,'staff-account-browser-results.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();}
