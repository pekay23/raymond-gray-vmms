import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const site='10000000-0000-4000-8000-000000000002', user='10000000-0000-4000-8000-000000000013', id='30000000-0000-4000-8000-000000000001';
const browser=await chromium.launch({headless:true,channel:process.env.VMMS_BROWSER_CHANNEL||'msedge'});
const context=await browser.newContext();
let saved=null,contacts=[],firstAttempt=true,originalCommand=null;
await context.route('**/api/v1/session',r=>r.fulfill({json:{authenticated:true,user:{id:user,displayName:'Synthetic Advisor'},sites:[{id:site,name:'Synthetic Centre',code:'SYN',timeZone:'Africa/Accra',canWrite:true,roleCodes:['service-advisor']}]}}));
await context.route('**/api/v1/owner/session',r=>r.fulfill({json:{authenticated:false}}));
await context.route(`**/api/v1/sites/${site}/service-requests**`,async r=>{
 const u=new URL(r.request().url()),method=r.request().method(),body=method==='POST'?r.request().postDataJSON():null;
 if(method==='POST'&&u.pathname.endsWith('/claim')) {assert.ok(r.request().headers()['idempotency-key']);saved.version++;saved.assignedTo=user;saved.assignedToName='Synthetic Advisor';saved.assigneeActive=true;return r.fulfill({json:{id,version:saved.version}});}
 if(method==='POST'&&u.pathname.endsWith('/contacts')) {assert.ok(r.request().headers()['idempotency-key']); contacts.unshift({id:'40000000-0000-4000-8000-000000000001',recordedAt:new Date().toISOString(),recordedByName:'Synthetic Advisor',correctsEntryId:null,correctsRecordedAt:null,correctionReason:null,isCorrected:false,...body});saved.version++; saved.nextAction=body.nextAction;saved.callbackDueAt=body.callbackDueAt;return r.fulfill({json:{id,version:saved.version}});}
 if(method==='POST') {const command=r.request().headers()['idempotency-key'];assert.ok(command);if(firstAttempt){firstAttempt=false;originalCommand=command;saved={id,version:1,status:'open',...body,nextAction:null,callbackDueAt:null,assignedTo:null,assignedToName:null,assigneeActive:null,workOrderId:null};return r.abort('failed');}assert.equal(command,originalCommand);return r.fulfill({json:{id,version:1}});}
 if(u.pathname.endsWith('/contacts')) return r.fulfill({json:{items:contacts,page:1,totalPages:contacts.length?1:0}});
 if(u.pathname.endsWith(id)) return r.fulfill({json:saved});
 return r.fulfill({json:{items:saved?[saved]:[],page:1,totalPages:saved?1:0,totalCount:saved?1:0}});
});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:5173/sites/${site}/requests`);
 await page.getByRole('button',{name:'New request'}).click();
 await page.getByLabel('Keep this draft in this browser tab for up to eight hours').check();
 await page.getByLabel('What was reported?').fill('Synthetic noise');
 await page.getByLabel('Contact name or number').fill('Synthetic caller');
 await page.getByRole('button',{name:'Save request'}).click();
 await page.getByRole('button',{name:'Retry save'}).waitFor();
 await page.reload();
 await page.getByRole('button',{name:'New request'}).click();
 await page.getByText('Saved draft restored for this account and service centre.').waitFor();
 await page.getByRole('button',{name:'Retry save'}).click();
 await page.getByRole('heading',{name:'Request details'}).waitFor();
 await page.getByRole('button',{name:'Take responsibility'}).click();
 await page.getByText('Responsible: Synthetic Advisor').waitFor();
 await page.getByLabel('Notes').fill('Called customer');
 await page.getByLabel('Next action').fill('Call again');
 await page.getByRole('button',{name:'Save contact'}).click();
 await page.getByText('Called customer').waitFor();
 for(const width of [320,390,768,1440]) {await page.setViewportSize({width,height:900});const dimensions=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.client,JSON.stringify({width,...dimensions}));}
 assert.deepEqual(errors,[]);console.log('PASS: synthetic API response-loss recovery, contact and four responsive widths');
} finally {await browser.close();}
