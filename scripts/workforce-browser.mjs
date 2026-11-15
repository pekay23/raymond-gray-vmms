import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const origin=new URL(process.env.VMMS_WEB_ORIGIN??'http://127.0.0.1:5173');
assert(['127.0.0.1','localhost','::1'].includes(origin.hostname),'Workforce browser checks may only target a local loopback web origin.');
const siteId='10000000-0000-4000-8000-000000000002';
const headId='10000000-0000-4000-8000-000000000013';
const staffId='10000000-0000-4000-8000-000000000014';
const headPlacementId='10000000-0000-4000-8000-000000000023';
const staffPlacementId='10000000-0000-4000-8000-000000000024';
const roles=[
  {code:'head-service-centre',label:'Head of Service Centre / Operations Admin',description:'Oversees the service centre and assigns staff roles.',assignableByHead:true},
  {code:'service-advisor',label:'Service Advisor',description:'Records visits and coordinates collection.',assignableByHead:true},
  {code:'vmms-operator',label:'VMMS Operator',description:'Manages user accounts and approved access.',assignableByHead:false},
];
const activeHead={id:headPlacementId,staffUserId:headId,displayName:'Synthetic Head',username:'synthetic-head',role:roles[0],reportsToPlacementId:null,reportsToName:null,revision:1,state:'active'};
const staffMember={id:staffId,displayName:'Synthetic Advisor',username:'synthetic-advisor',roleCodes:['service-advisor'],rolePlacements:[{id:staffPlacementId,roleCode:'service-advisor',revision:7,state:'active',reportsToPlacementId:headPlacementId,reportsToName:'Synthetic Head'}]};
const assigned={id:staffPlacementId,staffUserId:staffId,displayName:staffMember.displayName,username:staffMember.username,role:roles[1],reportsToPlacementId:headPlacementId,reportsToName:'Synthetic Head',revision:8,state:'active'};
const ended={...activeHead,revision:2,state:'ended'};
const checks=[];
const viewports=[
  {width:280,height:653},{width:320,height:568},{width:344,height:882},{width:375,height:812},
  {width:540,height:720},{width:712,height:853},{width:768,height:1024},{width:820,height:1180},
  {width:1024,height:768},{width:1280,height:800},{width:1440,height:900},
];
const checksDir=resolve('docs/verification/browser');
await mkdir(checksDir,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.VMMS_BROWSER_CHANNEL||'msedge'});
try {
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const page=await context.newPage();
  page.on('pageerror',error=>process.stderr.write(`Browser page error: ${error.message}\n`));
  page.on('console',message=>{if(message.type()==='error')process.stderr.write(`Browser console error: ${message.text()}\n`);});
  page.on('response',response=>{if(response.url().includes('/api/v1/'))process.stdout.write(`API ${response.status()} ${new URL(response.url()).pathname}\n`);});
  const commands=[];
  const organogram=(pageNumber=1)=>({
    roles,placements:pageNumber===1?[activeHead]:[],
    staff:[
      {id:headId,displayName:'Synthetic Head',username:'synthetic-head',roleCodes:['head-service-centre'],rolePlacements:[{id:headPlacementId,roleCode:'head-service-centre',revision:1,state:'active',reportsToPlacementId:null,reportsToName:null}]},
      staffMember,
    ],
    page:pageNumber,pageSize:50,totalCount:2,totalPages:1,staffTotalCount:2,staffTotalPages:1,
  });
  await page.route('**/api/v1/session',route=>route.request().method()==='GET'
    ?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:true,user:{id:headId,displayName:'Synthetic Head'},sites:[{id:siteId,name:'Synthetic Service Centre',code:'SYN',timeZone:'Africa/Accra',canWrite:true,roleCodes:['head-service-centre','service-advisor']}]})})
    :route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  await page.route('**/api/v1/owner/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  await page.route(`**/api/v1/sites/${siteId}/work-orders*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],pagination:{page:1,pageSize:25,totalItems:0,totalPages:0},totals:{open:0,held:0,intakeDrafts:0},asOf:new Date().toISOString()})}));
  await page.route(`**/api/v1/sites/${siteId}/staff/organogram*`,route=>{
    const pageNumber=Number(new URL(route.request().url()).searchParams.get('page')??'1');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(organogram(pageNumber))});
  });
  await page.route(`**/api/v1/sites/${siteId}/staff/role-placements`,async route=>{
    assert.equal(route.request().method(),'POST');
    assert.match(route.request().headers()['idempotency-key']??'',/^[0-9a-f-]{36}$/i);
    commands.push({kind:'assign',body:route.request().postDataJSON()});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(assigned)});
  });
  await page.route(`**/api/v1/sites/${siteId}/staff/role-placements/${headPlacementId}/end`,async route=>{
    assert.equal(route.request().method(),'POST');
    assert.match(route.request().headers()['idempotency-key']??'',/^[0-9a-f-]{36}$/i);
    commands.push({kind:'end',body:route.request().postDataJSON()});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ended)});
  });
  await page.goto(`${origin.origin}/sites/${siteId}/work-orders`);
  await page.getByRole('heading',{level:1,name:'Work orders'}).waitFor();
  await page.getByRole('link',{name:'People and roles'}).click();
  await page.waitForTimeout(500);
  await page.screenshot({path:resolve(checksDir,'workforce-debug.png'),fullPage:true});
  if(await page.getByRole('heading',{level:1,name:'Staff and roles'}).count()!==1)
    throw new Error(`Workforce page did not render at ${page.url()}. Session: ${JSON.stringify(await page.evaluate(async()=>await (await fetch('/api/v1/session')).json()))}. Body: ${(await page.locator('body').innerText()).slice(0,1000)}`);
  assert.equal(await page.getByText('Synthetic Advisor',{exact:true}).count(),1);
  for(const {width,height} of viewports){
    await page.setViewportSize({width,height});
    const layout=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,main:document.querySelector('main')?.getBoundingClientRect().width}));
    assert(layout.scroll<=layout.width+1,`${width}px workforce page overflowed horizontally: ${JSON.stringify(layout)}`);
    assert(layout.main&&layout.main>0,`${width}px workforce page main content was not visible.`);
    await page.screenshot({path:resolve(checksDir,`workforce-${width}x${height}.png`),fullPage:true});
    checks.push(`${width}x${height} viewport has no horizontal overflow and renders the main workforce content`);
  }
  await page.setViewportSize({width:1280,height:900});
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  assert.deepEqual(audit.violations.map(item=>({id:item.id,impact:item.impact})),[],'Workforce page has automated accessibility violations.');
  checks.push('Automated WCAG 2.1 A/AA scan passes on the Head workforce page');

  await page.getByLabel('Staff member').selectOption(staffId);
  await page.locator('#workforce-role').selectOption('service-advisor');
  await page.locator('#workforce-manager').selectOption(headPlacementId);
  await page.locator('#workforce-reason').fill('Synthetic browser role revision check.');
  await page.getByRole('button',{name:'Save role'}).click();
  await page.getByText('Service Advisor role saved for Synthetic Advisor.',{exact:true}).waitFor();
  assert.equal(commands[0]?.body.expectedVersion,7,'The form must use the selected staff member role revision, even if the placement row is on another page.');
  assert.equal(commands[0]?.body.reportsToPlacementId,headPlacementId);
  checks.push('Role assignment submits the selected staff member current revision and manager with an idempotency key');

  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'End role'}).click();
  await page.getByText('Head of Service Centre / Operations Admin role ended for Synthetic Head.',{exact:true}).waitFor();
  assert.equal(commands[1]?.body.expectedVersion,1);
  checks.push('Role ending requires browser confirmation and sends the displayed revision');

  const restrictedPage=await context.newPage();
  await restrictedPage.route('**/api/v1/session',route=>route.request().method()==='GET'
    ?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:true,user:{id:staffId,displayName:'Synthetic Advisor'},sites:[{id:siteId,name:'Synthetic Service Centre',code:'SYN',timeZone:'Africa/Accra',canWrite:true,roleCodes:['service-advisor']}]})})
    :route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  await restrictedPage.route('**/api/v1/owner/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  await restrictedPage.route(`**/api/v1/sites/${siteId}/work-orders*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],pagination:{page:1,pageSize:25,totalItems:0,totalPages:0},totals:{open:0,held:0,intakeDrafts:0},asOf:new Date().toISOString()})}));
  await restrictedPage.route(`**/api/v1/sites/${siteId}/staff/organogram*`,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'ROLE_REQUIRED',message:'Restricted'}})}));
  await restrictedPage.goto(`${origin.origin}/sites/${siteId}/staff`);
  await restrictedPage.getByRole('heading',{name:'This section is for the Head of Service Centre'}).waitFor();
  checks.push('Staff without the Head role sees a clear restricted state without staff directory data');
  await restrictedPage.close();

  const readOnlyPage=await context.newPage();
  await readOnlyPage.route('**/api/v1/session',route=>route.request().method()==='GET'
    ?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:true,user:{id:headId,displayName:'Synthetic Head'},sites:[{id:siteId,name:'Synthetic Service Centre',code:'SYN',timeZone:'Africa/Accra',canWrite:false,roleCodes:['head-service-centre','service-advisor']}]})})
    :route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  await readOnlyPage.route('**/api/v1/owner/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  await readOnlyPage.route(`**/api/v1/sites/${siteId}/work-orders*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],pagination:{page:1,pageSize:25,totalItems:0,totalPages:0},totals:{open:0,held:0,intakeDrafts:0},asOf:new Date().toISOString()})}));
  await readOnlyPage.route(`**/api/v1/sites/${siteId}/staff/organogram*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(organogram())}));
  await readOnlyPage.goto(`${origin.origin}/sites/${siteId}/work-orders`);
  await readOnlyPage.getByRole('heading',{level:1,name:'Work orders'}).waitFor();
  await readOnlyPage.getByRole('link',{name:'People and roles'}).click();
  await readOnlyPage.getByText('Your site access is read-only. You can review staff roles, but you cannot change them with this account.',{exact:true}).waitFor();
  assert.equal(await readOnlyPage.getByRole('heading',{name:'Assign a role'}).count(),0);
  assert.equal(await readOnlyPage.getByRole('button',{name:'End role'}).count(),0);
  assert((await readOnlyPage.getByText('Synthetic Head',{exact:true}).count())>=1,'Read-only Head should be able to view current role placements.');
  await readOnlyPage.getByText('Manages user accounts and approved access.',{exact:true}).waitFor();
  await readOnlyPage.getByText('Account management is separate',{exact:true}).waitFor();
  checks.push('Read-only Head can review role descriptions but does not see role-change controls');
  await readOnlyPage.close();

  await context.close();
  const report={result:'passed',checks,commands:commands.map(command=>command.kind),viewports,limitations:['API behavior is verified separately through real PostgreSQL integration tests.','Browser API responses in this script are synthetic; this is not staff UAT.']};
  await writeFile(resolve(checksDir,'workforce-browser-results.json'),JSON.stringify(report,null,2)+'\n');
  await rm(resolve(checksDir,'workforce-debug.png'),{force:true});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
} finally {await browser.close();}
