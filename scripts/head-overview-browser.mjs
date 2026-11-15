import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const origin=new URL(process.env.VMMS_WEB_ORIGIN??'http://127.0.0.1:5173');
assert(['127.0.0.1','localhost','::1'].includes(origin.hostname),'Head overview browser checks may only target a local loopback web origin.');
const siteId='10000000-0000-4000-8000-000000000002';
const headId='10000000-0000-4000-8000-000000000013';
const staffId='10000000-0000-4000-8000-000000000014';
const checksDir=resolve('docs/verification/browser');
const viewports=[
  {width:280,height:653},{width:320,height:568},{width:344,height:882},{width:375,height:812},
  {width:540,height:720},{width:712,height:853},{width:768,height:1024},{width:820,height:1180},
  {width:1024,height:768},{width:1280,height:800},{width:1440,height:900},
];
const payload={
  asOf:'2026-11-09T12:30:00.000Z',
  workOrders:{active:12,held:2,awaitingOperationsReview:3,awaitingTeamLead:4,assignedToTeamLead:5},
  staff:{active:18,activeRolePlacements:22},
};
await mkdir(checksDir,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.VMMS_BROWSER_CHANNEL||'msedge'});
try {
  const checks=[];
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const page=await context.newPage();
  page.on('pageerror',error=>process.stderr.write(`Browser page error: ${error.message}\n`));
  page.on('console',message=>{if(message.type()==='error')process.stderr.write(`Browser console error: ${message.text()}\n`);});
  async function sessionRoutes(target,id,name,roleCodes=['head-service-centre','service-advisor']){
    await target.route('**/api/v1/session',route=>route.request().method()==='GET'
      ?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:true,user:{id,displayName:name},sites:[{id:siteId,name:'Synthetic Service Centre',code:'SYN',timeZone:'Africa/Accra',canWrite:true,roleCodes}]})})
      :route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
    await target.route('**/api/v1/owner/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false})}));
    await target.route(`**/api/v1/sites/${siteId}/work-orders*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],pagination:{page:1,pageSize:25,totalItems:0,totalPages:0},totals:{open:0,held:0,intakeDrafts:0},asOf:payload.asOf})}));
  }
  await sessionRoutes(page,headId,'Synthetic Head');
  await page.route(`**/api/v1/sites/${siteId}/workforce/overview`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}));
  await page.route(`**/api/v1/sites/${siteId}/documents*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({documents:[],pagination:{page:1,pageSize:25,totalItems:0,totalPages:0}})}));
  await page.goto(`${origin.origin}/sites/${siteId}/work-orders`);
  await page.getByRole('link',{name:'Head overview'}).click();
  try { await page.getByRole('heading',{level:1,name:'Head overview'}).waitFor({timeout:10000}); }
  catch { throw new Error(`Head overview did not render at ${page.url()}. Body: ${(await page.locator('body').innerText()).slice(0,1200)}`); }
  await page.getByText('Awaiting Operations review',{exact:true}).waitFor();
  for(const {width,height} of viewports){
    await page.setViewportSize({width,height});
    const layout=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,main:document.querySelector('main')?.getBoundingClientRect().width}));
    assert(layout.scroll<=layout.width+1,`${width}px Head overview overflowed horizontally: ${JSON.stringify(layout)}`);
    assert(layout.main&&layout.main>0,`${width}px Head overview main content was not visible.`);
    await page.screenshot({path:resolve(checksDir,`head-overview-${width}x${height}.png`),fullPage:true});
    checks.push(`${width}x${height} viewport has no horizontal overflow and renders main overview content`);
  }
  await page.setViewportSize({width:1280,height:900});
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  assert.deepEqual(audit.violations.map(item=>({id:item.id,impact:item.impact})),[],'Head overview has automated accessibility violations.');
  checks.push('Automated WCAG 2.1 A/AA scan passes on the Head overview');
  assert.equal(await page.getByRole('link',{name:'View staff and roles'}).getAttribute('href'),`/sites/${siteId}/staff`);
  assert.equal(await page.getByRole('link',{name:'Head overview'}).getAttribute('href'),`/sites/${siteId}/overview`);
  checks.push('Overview navigation links to staff and roles separately');
  const metricTargets=[
    ['Active jobs',`/sites/${siteId}/work-orders`],
    ['Jobs on hold',`/sites/${siteId}/work-orders?queue=held`],
    ['Awaiting Operations review',`/sites/${siteId}/work-orders?queue=awaiting-operations`],
    ['Awaiting team-lead assignment',`/sites/${siteId}/work-orders?queue=awaiting-lead`],
    ['Assigned to a team lead',`/sites/${siteId}/work-orders?queue=assigned`],
  ];
  for(const [label,target] of metricTargets){
    assert.equal(await page.getByRole('link',{name:label,exact:true}).getAttribute('href'),target,`${label} must open its matching site report.`);
  }
  await page.goto(`${origin.origin}/sites/${siteId}/overview/print`);
  await page.getByRole('heading',{level:1,name:'Service-centre operations'}).waitFor();
  assert.equal(await page.getByText('Active jobs',{exact:true}).count(),1);
  assert.equal(await page.getByText('Operations review',{exact:true}).count(),1);
  assert.equal(await page.getByText('Active staff accounts',{exact:true}).count(),1);
  assert.match(await page.locator('.overview-report footer').innerText(),/not a work authorization.*invoice or financial statement/s);
  assert.match(await page.title(),/Synthetic Service Centre service-centre report/);
  for(const width of [280,390,768,1440]){
    await page.setViewportSize({width,height:900});
    const reportLayout=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,report:document.querySelector('.overview-report')?.getBoundingClientRect().width}));
    assert(reportLayout.scroll<=reportLayout.width+1,`${width}px service-centre report overflows: ${JSON.stringify(reportLayout)}`);
    assert(reportLayout.report&&reportLayout.report>0,`${width}px service-centre report is not visible.`);
  }
  checks.push('Purpose-built service-centre report shows only its aggregate workload, review and staffing summary at four device widths');
  await page.setViewportSize({width:1280,height:900});
  const reportAudit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  assert.deepEqual(reportAudit.violations.map(item=>({id:item.id,impact:item.impact})),[],'Service-centre report has automated accessibility violations.');
  await page.emulateMedia({media:'print'});
  const printState=await page.evaluate(()=>({visibility:getComputedStyle(document.querySelector('.overview-report')).visibility,toolbar:getComputedStyle(document.querySelector('.overview-report-toolbar')).display}));
  assert.equal(printState.visibility,'visible');
  assert.equal(printState.toolbar,'none');
  const pdf=await page.pdf({printBackground:true});
  assert.equal(pdf.subarray(0,5).toString('ascii'),'%PDF-');
  assert(pdf.length>2500,'The purpose-built service-centre report should produce substantive printable content.');
  checks.push('Service-centre report passes automated accessibility checks and prints its HTML report template as a selectable-text PDF, without page controls');
  await page.emulateMedia({media:'screen'});
  await page.goto(`${origin.origin}/sites/${siteId}/overview`);
  await page.goto(`${origin.origin}/sites/${siteId}/documents`);
  await page.getByLabel('Search by title, reference, or another name',{exact:true}).waitFor();
  assert.equal(await page.getByPlaceholder('Title, reference, or another name',{exact:true}).count(),1);
  await page.getByText('No procedures are marked as current for this service centre yet.',{exact:false}).waitFor();
  checks.push('Controlled-document page uses plain-language search and explains when no current procedures are available');
  await page.goto(`${origin.origin}/sites/${siteId}/overview`);
  await page.getByRole('heading',{level:1,name:'Head overview'}).waitFor();
  await page.getByRole('link',{name:'Awaiting team-lead assignment',exact:true}).click();
  assert.equal(await page.getByLabel('Show jobs').inputValue(),'awaiting-lead','The work-order page must honor the overview drill-down filter.');
  await page.getByRole('heading',{level:2,name:'Jobs awaiting team-lead assignment',exact:true}).waitFor();
  checks.push('Each overview work count opens a site-scoped filtered report and the report applies its selected filter');

  const restricted=await context.newPage();
  await sessionRoutes(restricted,staffId,'Synthetic Advisor',['service-advisor']);
  await restricted.route(`**/api/v1/sites/${siteId}/workforce/overview`,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'ROLE_REQUIRED',message:'Only the Head can access this overview.'}})}));
  await restricted.goto(`${origin.origin}/sites/${siteId}/overview`);
  await restricted.getByRole('heading',{name:'This overview is for the Head of Service Centre'}).waitFor();
  assert.equal(await restricted.getByText('12',{exact:true}).count(),0,'Restricted staff must not see overview counts.');
  checks.push('Non-Head staff receives a clear restricted state and no overview counts');
  await restricted.close();

  const offlineContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const offline=await offlineContext.newPage();
  await offline.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
  await sessionRoutes(offline,headId,'Synthetic Head');
  await offline.goto(`${origin.origin}/sites/${siteId}/work-orders`);
  await offline.getByRole('heading',{level:1,name:'Work orders'}).waitFor();
  await offline.getByRole('link',{name:'Head overview'}).click();
  await offline.getByRole('heading',{name:'Overview is unavailable offline'}).waitFor();
  assert.equal(await offline.getByText('12',{exact:true}).count(),0,'Offline page must not display cached overview figures.');
  checks.push('Offline state withholds potentially stale overview figures');
  await offline.screenshot({path:resolve(checksDir,'head-overview-offline-390x844.png'),fullPage:true});
  await offlineContext.close();

  const directPage=await context.newPage();
  await sessionRoutes(directPage,headId,'Synthetic Head');
  await directPage.route(`**/api/v1/sites/${siteId}/workforce/overview`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}));
  await directPage.goto(`${origin.origin}/sites/${siteId}/overview`);
  let directRouteFailure=null;
  try {
    await directPage.getByRole('heading',{level:1,name:'Head overview'}).waitFor({timeout:8000});
    checks.push('Overview route opens correctly from a direct page load');
  } catch {
    directRouteFailure={url:directPage.url(),body:(await directPage.locator('body').innerText()).slice(0,900)};
    checks.push('Cold direct load of the overview route currently fails');
  }
  await directPage.close();

  const report={result:directRouteFailure?'failed':'passed',checks,viewports,...(directRouteFailure?{failures:[{check:'Cold direct route',...directRouteFailure}]}:{}),limitations:['Browser API responses are synthetic; server behavior is covered separately by PostgreSQL/API tests.','This is not staff UAT.']};
  await writeFile(resolve(checksDir,'head-overview-browser-results.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  await context.close();
  if(directRouteFailure)process.exitCode=1;
} finally {await browser.close();}
