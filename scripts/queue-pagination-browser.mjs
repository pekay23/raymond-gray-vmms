import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { z } from 'zod';
import { startEvidenceBrowserRuntime } from '../apps/api/test/support/evidence-browser-runtime.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'docs/verification/browser-queue-pagination');
const report = {
  recordedAt: new Date().toISOString(),
  scope: 'Synthetic disposable PostgreSQL workflow for Operations, team-lead, and supervisor queue paging, search, responsive layout, keyboard operation, and native browser zoom.',
  result: 'RUNNING',
  rowsCreated: 0,
  checks: [],
  limitations: [
    'All three role queues are exercised with more than one browser page using synthetic records and authority in disposable PostgreSQL.',
    'All three implemented role queues are exercised at native 200% and 400% Edge browser zoom; this is not physical-device or assistive-technology certification.',
    'The test uses test-mode password sessions and synthetic grants; it does not verify production identity, UAT, SOP authority or physical devices.',
  ],
};
const errors = [];
let runtime;
let vite;
let browser;
let context;
let leadApiContext;
let page;
let webOrigin = '';
let phase = 'startup';
let failed = false;

function check(name, facts = {}) {
  report.checks.push({ name, result: 'VERIFIED', ...facts });
  process.stdout.write(`VERIFIED: ${name}\n`);
}

async function responseJson(response, expectedStatus = 200) {
  const body = await response.text();
  assert.equal(response.status(), expectedStatus, `Unexpected HTTP ${response.status()} during ${phase}: ${body}`);
  return JSON.parse(body);
}

async function login(actor, browserContext = context) {
  const bootstrap = await browserContext.request.get(`${webOrigin}/api/v1/session`);
  assert.equal(bootstrap.status(), 200);
  const csrf = (await browserContext.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf, 'Session bootstrap did not set the CSRF cookie.');
  const session = await browserContext.request.post(`${webOrigin}/api/v1/session`, {
    headers: { Origin: webOrigin, 'X-CSRFToken': decodeURIComponent(csrf.value) },
    data: { username: actor.username, password: actor.password },
  });
  assert.equal(session.status(), 200, await session.text());
  assert.equal((await session.json()).authenticated, true);
}

async function mutate(path, payload, browserContext = context) {
  const csrf = (await browserContext.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf);
  return responseJson(await browserContext.request.post(`${webOrigin}/api/v1${path}`, {
    headers: { Origin: webOrigin, 'X-CSRFToken': decodeURIComponent(csrf.value), 'Idempotency-Key': randomUUID() },
    data: payload,
  }));
}

async function createSyntheticWorkOrder(index) {
  const serial = String(index).padStart(6, '0');
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf);
  const response = await context.request.post(`${webOrigin}/api/v1/sites/${runtime.siteId}/intake-drafts`, {
    headers: {
      Origin: webOrigin,
      'X-CSRFToken': decodeURIComponent(csrf.value),
      'Idempotency-Key': randomUUID(),
    },
    data: {
      client: { kind: 'new', partyKind: 'organisation', name: `Synthetic pagination client ${serial}`, phone: '', email: '' },
      owner: { kind: 'new', partyKind: 'person', name: `Synthetic pagination owner ${serial}`, phone: '', email: '' },
      visitContact: { kind: 'new', name: `Synthetic pagination contact ${serial}`, phone: '+233200000001', email: '' },
      vehicle: {
        kind: 'new',
        vin: `WVWZZZ1JZXW${serial}`,
        registration: `PG-${serial}`,
        make: 'Synthetic',
        model: 'Pagination fixture',
      },
      odometerKm: 1000 + index,
      socPercent: 50,
      powertrainClass: 'EV',
      warrantyStatus: 'unknown',
      warrantyConfirmationNote: '',
      complaint: `Synthetic pagination queue entry ${serial}.`,
    },
  });
  const created = await responseJson(response);
  return z.uuid().parse(created.id);
}

async function assignToSupervisor(orderId, index) {
  const base = `/sites/${runtime.siteId}/work-orders/${orderId}`;
  let current = await responseJson(await context.request.get(`${webOrigin}/api/v1${base}`));
  const review = await mutate(`${base}/operations-review`, {
    expectedVersion: current.version,
    notes: `Synthetic queue pagination review ${index}.`,
  });
  current = await responseJson(await context.request.get(`${webOrigin}/api/v1${base}`));
  await mutate(`${base}/team-lead-assignment`, {
    expectedVersion: current.version,
    operationsReviewId: review.reviewId,
    leadUserId: runtime.actors.teamLead.id,
    reason: `Synthetic qualified EV lead assignment ${index}.`,
  });
  current = await responseJson(await context.request.get(`${webOrigin}/api/v1${base}`));
  const task = await mutate(`${base}/tasks`, {
    expectedVersion: current.version,
    complaintId: current.complaints[0].id,
    title: `Synthetic queue task ${index}.`,
  });
  current = await responseJson(await context.request.get(`${webOrigin}/api/v1${base}`));
  const plan = await mutate(`${base}/work-plan-revisions`, {
    expectedVersion: current.version,
    rationale: `Synthetic work plan for supervisor queue pagination ${index}.`,
    taskIds: [task.tasks.at(-1).id],
  }, leadApiContext);
  current = await responseJson(await context.request.get(`${webOrigin}/api/v1${base}`));
  await mutate(`${base}/supervisor-handoff`, {
    expectedVersion: current.version,
    supervisorUserId: runtime.actors.supervisor.id,
    workPlanRevisionId: plan.workPlan.id,
    reason: `Synthetic supervisor handoff for queue pagination ${index}.`,
  }, leadApiContext);
}

function queueStatusLocator() {
  return page.getByRole('status').filter({ hasText: /Page \d+ of \d+/ });
}

async function statusText() {
  return (await queueStatusLocator().innerText()).replace(/\s+/g, ' ').trim();
}

async function checkVisibleQueueControls(width) {
  await page.setViewportSize({ width, height: 850 });
  await queueStatusLocator().scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => {
    const controls = [...(document.querySelector('#workspace-main')?.querySelectorAll('a,button,input,select,textarea') ?? [])]
      .filter(element => element.getClientRects().length > 0)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      });
    return { viewportWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth, controls };
  });
  assert.equal(geometry.documentWidth, width, `${width}px queue page must not overflow horizontally.`);
  assert(geometry.controls.length > 0, `${width}px queue should expose interactive controls.`);
  for (const control of geometry.controls) {
    assert(control.width > 0 && control.height > 0 && control.left >= -1 && control.right <= width + 1,
      `${width}px visible queue control is missing or clipped: ${control.name}`);
  }
  for (const name of ['Previous', 'Next']) {
    const button = page.getByRole('button', { name, exact: true });
    assert.equal(await button.count(), 1, `${width}px ${name} control must be present.`);
    assert(await button.isVisible(), `${width}px ${name} control must be visible.`);
  }
  return geometry;
}

async function checkQueueZoom(label, sourceContext, queue) {
  for (const zoom of [2, 4]) {
    const profile = await mkdtemp(resolve(tmpdir(), 'vmms-queue-zoom-'));
    await mkdir(resolve(profile, 'Default'), { recursive: true });
    await writeFile(resolve(profile, 'Default', 'Preferences'), JSON.stringify({
      partition: { default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) } },
    }));
    let zoomContext;
    try {
      zoomContext = await chromium.launchPersistentContext(profile, {
        headless: true,
        channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge',
        viewport: null,
        args: ['--window-size=1440,1000', '--force-device-scale-factor=1'],
      });
      await zoomContext.route('**/*', route => {
        if (new URL(route.request().url()).origin === webOrigin) return route.continue();
        errors.push(`unexpected-outbound-request-${label}-${zoom * 100}`);
        return route.abort('blockedbyclient');
      });
      const cookies = await sourceContext.cookies(`${webOrigin}/api/v1/session`);
      assert(cookies.some(cookie => cookie.name === 'vmms_session'), `${label} source context has no staff session.`);
      await zoomContext.addCookies(cookies);
      const zoomPage = zoomContext.pages()[0] || await zoomContext.newPage();
      zoomPage.setDefaultTimeout(15000);
      zoomPage.on('pageerror', error => errors.push(`${label} ${zoom * 100}%: ${error.message}`));
      await zoomPage.goto(`${webOrigin}/api/v1/session`);
      assert.equal(JSON.parse(await zoomPage.locator('body').innerText()).authenticated, true,
        `${label} ${zoom * 100}% session did not survive isolated browser context.`);
      await zoomPage.goto(`${webOrigin}/sites/${runtime.siteId}/work-orders`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await zoomPage.getByRole('main').waitFor();
      await zoomPage.getByLabel('Show jobs').selectOption(queue);
      await zoomPage.getByText('Showing 1–25 of 26 work orders · Page 1 of 2', { exact: true }).waitFor();
      const status = zoomPage.getByRole('status').filter({ hasText: /Page \d+ of \d+/ });
      await status.scrollIntoViewIfNeeded();

      const layout = await zoomPage.evaluate(() => {
        const main = document.querySelector('#workspace-main');
        const controls = [...(main?.querySelectorAll('a,button,input,select,textarea') ?? [])]
          .filter(element => element.getClientRects().length > 0)
          .map(element => {
            const rect = element.getBoundingClientRect();
            return {
              name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
              left: rect.left,
              right: rect.right,
              width: rect.width,
              height: rect.height,
            };
          });
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          controls,
        };
      });
      const expectedViewport = zoom === 2 ? { min: 650, max: 760 } : { min: 320, max: 400 };
      assert(layout.viewportWidth >= expectedViewport.min && layout.viewportWidth <= expectedViewport.max,
        `${label} ${zoom * 100}% expected a CSS viewport from ${expectedViewport.min} to ${expectedViewport.max}px, received ${layout.viewportWidth}px.`);
      assert.equal(layout.documentWidth, layout.viewportWidth, `${label} ${zoom * 100}% queue must not overflow the document.`);
      assert.equal(layout.bodyWidth, layout.viewportWidth, `${label} ${zoom * 100}% queue must not overflow the body.`);
      assert(layout.controls.length > 0, `${label} ${zoom * 100}% queue must expose interactive controls.`);
      for (const control of layout.controls) {
        assert(control.width > 0 && control.height > 0 && control.left >= -1 && control.right <= layout.viewportWidth + 1,
          `${label} ${zoom * 100}% visible control is clipped: ${control.name}`);
      }

      const next = zoomPage.getByRole('button', { name: 'Next', exact: true });
      assert.equal(await next.count(), 1, `${label} ${zoom * 100}% must expose one named Next button.`);
      assert(await next.isVisible(), `${label} ${zoom * 100}% Next button must be visible.`);
      const searchField = zoomPage.getByLabel('Search by booking number, vehicle ID, registration or client', { exact: true });
      await searchField.focus();
      let reachedNextByTab = false;
      for (let tab = 0; tab < 64; tab += 1) {
        await zoomPage.keyboard.press('Tab');
        if (await next.evaluate(element => element === document.activeElement)) {
          reachedNextByTab = true;
          break;
        }
      }
      assert(reachedNextByTab, `${label} ${zoom * 100}% Next button must be reachable through normal Tab navigation.`);
      assert.equal(await next.evaluate(element => element === document.activeElement), true,
        `${label} ${zoom * 100}% Next button must retain keyboard focus.`);
      await zoomPage.keyboard.press('Enter');
      await status.getByText(/Page 2 of 2/).waitFor();
      assert.match((await status.innerText()).replace(/\s+/g, ' ').trim(),
        /^Showing 26–26 of 26 work orders · Page 2 of 2$/,
        `${label} ${zoom * 100}% keyboard activation must advance the queue.`);
      await zoomPage.screenshot({ path: resolve(output, `${queue}-queue-zoom-${zoom * 100}.png`), fullPage: true });
      check(`${label} queue stays usable at native ${zoom * 100}% browser zoom`, {
        queue,
        zoom,
        viewportWidth: layout.viewportWidth,
        documentWidth: layout.documentWidth,
        interactiveControls: layout.controls.length,
        keyboardReachableByTab: reachedNextByTab,
        keyboardPagedTo: 'Page 2 of 2',
      });
    } finally {
      try {
        await zoomContext?.close();
      } finally {
        await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    }
  }
}

async function checkAssignedRoleQueue(actor, queue, label) {
  const roleContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  roleContext.setDefaultTimeout(15000);
  roleContext.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
  await roleContext.route('**/*', route => {
    if (new URL(route.request().url()).origin === webOrigin) return route.continue();
    errors.push('unexpected-outbound-request');
    return route.abort('blockedbyclient');
  });
  try {
    await login(actor, roleContext);
    page = await roleContext.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${webOrigin}/sites/${runtime.siteId}/work-orders`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByLabel('Show jobs').selectOption(queue);
    await page.getByText('Showing 1–25 of 26 work orders · Page 1 of 2', { exact: true }).waitFor();
    const firstPageStatus = await statusText();
    assert.match(firstPageStatus, /^Showing 1–25 of 26 work orders · Page 1 of 2$/, `${label} page one must include only the 26 records assigned to this role. Observed: ${firstPageStatus}; selected=${await page.getByLabel('Show jobs').inputValue()}; url=${page.url()}`);
    const pageOne = await page.locator('#workspace-main ul li a p.font-mono').allTextContents();
    assert.equal(pageOne.length, 25);
    const next = page.getByRole('button', { name: 'Next', exact: true });
    const previous = page.getByRole('button', { name: 'Previous', exact: true });
    assert.equal(await previous.isEnabled(), false);
    assert.equal(await next.isEnabled(), true);
    await next.click();
    await queueStatusLocator().getByText(/Page 2 of 2/).waitFor();
    assert.match(await statusText(), /^Showing 26–26 of 26 work orders · Page 2 of 2$/);
    assert.equal(await page.locator('#workspace-main ul li').count(), 1);
    const secondReference = (await page.locator('#workspace-main ul li a p.font-mono').first().innerText()).trim();
    assert(!pageOne.includes(secondReference), `${label} page two must not repeat records from page one.`);
    assert.equal(await next.isEnabled(), false);
    await previous.click();
    await queueStatusLocator().getByText(/Page 1 of 2/).waitFor();
    await page.getByLabel('Search by booking number, vehicle ID, registration or client', { exact: true }).fill(secondReference);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await queueStatusLocator().getByText(/Page 1 of 1/).waitFor();
    assert.match(await statusText(), /^Showing 1–1 of 1 work orders · Page 1 of 1$/);
    assert.equal(await page.getByLabel('Show jobs').inputValue(), queue, `${label} search must retain the role filter.`);
    assert.equal((await page.locator('#workspace-main ul li a p.font-mono').first().innerText()).trim(), secondReference);
    const responsive = [];
    for (const width of [320, 390, 768, 1024, 1440]) responsive.push(await checkVisibleQueueControls(width));
    await page.setViewportSize({ width: 390, height: 844 });
    await queueStatusLocator().scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `${queue}-queue-pagination-phone.png`), fullPage: true });
    check(`${label} queue navigates both pages, retains its role filter through search, and fits five device widths`, {
      pageOneRows: pageOne.length,
      pageTwoRange: '26–26 of 26',
      searchedReference: secondReference,
      queue,
      widths: responsive.map(item => item.viewportWidth),
      documentWidths: responsive.map(item => item.documentWidth),
    });
    await checkQueueZoom(label, roleContext, queue);
  } finally {
    await roleContext.close();
  }
}

try {
  if (!process.argv.includes('--run')) {
    process.stdout.write('Opt-in only: node --import tsx scripts/queue-pagination-browser.mjs --run\n');
    process.exit(0);
  }
  loadEnv({ path: resolve(root, '.env'), quiet: true });
  await mkdir(output, { recursive: true });

  phase = 'isolated-runtime';
  runtime = await startEvidenceBrowserRuntime({
    migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL,
    runtimeDatabaseUrl: process.env.DATABASE_URL,
    webOrigin: 'http://127.0.0.1:1',
  });
  process.stdout.write(`LOCAL: disposable database ${runtime.databaseName}.\n`);

  phase = 'vite';
  vite = await createServer({
    root: resolve(root, 'apps/web'),
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: runtime.apiOrigin, changeOrigin: false } } },
  });
  await vite.listen();
  webOrigin = new URL(vite.resolvedUrls.local[0]).origin;
  runtime.setWebOrigin(webOrigin);

  phase = 'browser';
  browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(15000);
  context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === webOrigin) return route.continue();
    errors.push('unexpected-outbound-request');
    return route.abort('blockedbyclient');
  });
  await login(runtime.actors.creator);
  leadApiContext = await browser.newContext({ serviceWorkers: 'block' });
  await login(runtime.actors.teamLead, leadApiContext);
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));

  phase = 'seed';
  const expectedTotal = 52;
  for (let index = 1; index <= expectedTotal; index += 1) {
    const orderId = await createSyntheticWorkOrder(index);
    if (index > 26) await assignToSupervisor(orderId, index - 26);
    report.rowsCreated += 1;
  }

  phase = 'operations-first-page';
  await page.goto(`${webOrigin}/sites/${runtime.siteId}/work-orders`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByLabel('Show jobs').selectOption('operations');
  const pageStatus = queueStatusLocator();
  await page.getByText('Showing 1–25 of 26 work orders · Page 1 of 2', { exact: true }).waitFor();
  assert.match(await statusText(), /^Showing 1–25 of 26 work orders · Page 1 of 2$/);
  assert.equal(await page.getByLabel('Rows per page').inputValue(), '25');
  const previous = page.getByRole('button', { name: 'Previous', exact: true });
  const next = page.getByRole('button', { name: 'Next', exact: true });
  assert.equal(await previous.isEnabled(), false, 'Previous must be disabled on page one.');
  assert.equal(await next.isEnabled(), true, 'Next must be enabled when page two exists.');
  assert.equal(await page.locator('#workspace-main ul li').count(), 25);
  const pageOneRefs = await page.locator('#workspace-main ul li a p.font-mono').allTextContents();
  assert.equal(pageOneRefs.length, 25);
  check('Operations queue shows 25 of 26 records on page one with correct Previous/Next state', {
    pageOneRange: await statusText(),
    queue: await page.getByLabel('Show jobs').inputValue(),
    uniquePageOneReferences: new Set(pageOneRefs).size,
  });

  phase = 'operations-second-page';
  await next.click();
  await pageStatus.getByText(/Page 2 of 2/).waitFor();
  assert.match(await statusText(), /^Showing 26–26 of 26 work orders · Page 2 of 2$/);
  assert.equal(await page.locator('#workspace-main ul li').count(), 1);
  const pageTwoReference = (await page.locator('#workspace-main ul li a p.font-mono').first().innerText()).trim();
  assert(!pageOneRefs.includes(pageTwoReference), 'The second page must not repeat a first-page record.');
  assert.equal(await previous.isEnabled(), true);
  assert.equal(await next.isEnabled(), false, 'Next must be disabled on the final page.');
  check('Operations queue next-page click shows the remaining record without duplicate rows', {
    pageTwoRange: await statusText(),
    pageTwoReference,
  });

  phase = 'previous-page';
  await previous.click();
  await pageStatus.getByText(/Page 1 of 2/).waitFor();
  assert.match(await statusText(), /^Showing 1–25 of 26 work orders · Page 1 of 2$/);
  check('Previous returns to the first Operations queue page');

  phase = 'search-composition';
  await page.getByLabel('Search by booking number, vehicle ID, registration or client', { exact: true }).fill(pageTwoReference);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await pageStatus.getByText(/Page 1 of 1/).waitFor();
  assert.match(await statusText(), /^Showing 1–1 of 1 work orders · Page 1 of 1$/);
  assert.equal(await page.getByLabel('Show jobs').inputValue(), 'operations', 'Search must keep the Operations queue filter.');
  assert.equal(await page.locator('#workspace-main ul li').count(), 1);
  assert.equal((await page.locator('#workspace-main ul li a p.font-mono').first().innerText()).trim(), pageTwoReference);
  assert.equal(await next.isEnabled(), false);
  assert.equal(await previous.isEnabled(), false);
  check('Search keeps the Operations filter and narrows the queue to the selected second-page record', {
    resultRange: await statusText(),
    queue: await page.getByLabel('Show jobs').inputValue(),
    matchedReference: pageTwoReference,
  });

  phase = 'responsive-pager';
  const responsive = [];
  for (const width of [320, 390, 768, 1024, 1440]) responsive.push(await checkVisibleQueueControls(width));
  await page.setViewportSize({ width: 390, height: 844 });
  await queueStatusLocator().scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'operations-queue-pagination-phone.png'), fullPage: true });
  check('Filtered Operations queue pager and visible interactive controls fit five phone, tablet and desktop widths', {
    widths: responsive.map(item => item.viewportWidth),
    documentWidths: responsive.map(item => item.documentWidth),
  });
  await checkQueueZoom('Operations', context, 'operations');

  phase = 'team-lead-role-queue';
  await checkAssignedRoleQueue(runtime.actors.teamLead, 'team-lead', 'Team-lead');

  phase = 'supervisor-role-queue';
  await checkAssignedRoleQueue(runtime.actors.supervisor, 'supervisor', 'Supervisor');

  assert.deepEqual(errors, [], 'No browser errors or outbound network requests are allowed.');
  report.result = 'VERIFIED';
} catch (error) {
  failed = true;
  report.result = 'FAILED';
  report.failure = {
    phase,
    kind: error instanceof Error ? error.name : 'unknown',
    message: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof Error) errors.push({ phase, kind: error.name, message: error.message });
  process.stderr.write(`FAILED: ${phase} (${report.failure.kind})\n${report.failure.message}\n`);
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  for (const [name, resource] of [['lead-api-context', leadApiContext], ['context', context], ['browser', browser], ['vite', vite], ['isolated-runtime', runtime]]) {
    if (!resource) continue;
    try { await resource.close(); }
    catch (error) {
      failed = true;
      report.result = 'FAILED';
      errors.push({ phase: 'teardown', kind: 'cleanup-failed', resource: name });
      process.stderr.write(`FAILED: cleanup ${name}: ${error instanceof Error ? error.message : ''}\n`);
    }
  }
  report.finishedAt = new Date().toISOString();
  report.errors = errors;
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (failed) process.exitCode = 1;
}
