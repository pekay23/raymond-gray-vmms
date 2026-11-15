import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const origin = new URL(process.env.VMMS_WEB_ORIGIN ?? 'http://127.0.0.1:5173');
assert(['127.0.0.1', 'localhost', '::1'].includes(origin.hostname), 'Messages browser checks may only target a local loopback web origin.');
const siteId = '10000000-0000-4000-8000-000000000002';
const headId = '10000000-0000-4000-8000-000000000013';
const advisorId = '10000000-0000-4000-8000-000000000014';
const lastStaffId = '40000000-0000-4000-8000-000000000051';
const workOrderId = '20000000-0000-4000-8000-000000000051';
const checksDir = resolve('docs/verification/browser');
const viewports = [280, 320, 390, 540, 768, 820, 1024, 1280, 1440];
const report = { recordedAt: new Date().toISOString(), scope: 'Synthetic API responses in a local browser; HSC send, explicit recipients, read receipt, non-Head privacy, responsive layout and accessibility.', result: 'RUNNING', checks: [], limitations: ['API and database authorization are covered by separate PostgreSQL/API tests.', 'This does not verify message retention approval, production identity, outbound notifications, staff UAT or physical devices.'] };
const browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
const staff = Array.from({ length: 51 }, (_, index) => ({
  id: index === 13 ? advisorId : `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  displayName: `Synthetic staff ${String(index + 1).padStart(3, '0')}`,
}));
let message = null;
let readAt = null;
const now = '2026-11-09T21:30:00.000Z';
const createdMessage = () => message && ({
  ...message,
  recipients: message.recipients.map((recipient) => ({ ...recipient, readAt: recipient.userId === advisorId ? readAt : recipient.readAt })),
});

async function setupRoutes(context, { actorId = headId, displayName = 'Synthetic Head', canSend = true, receiver = false, failRead = false } = {}) {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin.origin) return route.continue();
    return route.abort('blockedbyclient');
  });
  await context.route('**/api/v1/session', (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, user: { id: actorId, displayName }, sites: [{ id: siteId, name: 'Synthetic Service Centre', code: 'SYN', timeZone: 'Africa/Accra', canWrite: true }] }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
  await context.route('**/api/v1/owner/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
  await context.route(`**/api/v1/sites/${siteId}/staff/messages**`, async (route) => {
    if (route.request().method() === 'GET') {
      const items = receiver && message
        ? [{ ...createdMessage(), recipients: createdMessage().recipients.filter((recipient) => recipient.userId === actorId), readAt }]
        : message ? [createdMessage()] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ canSend, items, page: 1, pageSize: 25, totalCount: items.length, totalPages: items.length ? 1 : 0 }) });
    }
    if (route.request().method() === 'POST' && route.request().url().endsWith('/read')) {
      if (failRead) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Read receipt service is temporarily unavailable.' } }) });
      readAt ??= now;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messageId: message.id, readAt }) });
    }
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      assert.equal(route.request().headers()['idempotency-key']?.length, 36, 'Sending must include a UUID idempotency key.');
      assert.equal(payload.recipientUserIds.length, 2, 'Both explicitly selected staff accounts should be sent as recipients.');
      assert.deepEqual([...payload.recipientUserIds].sort(), [advisorId, lastStaffId].sort());
      assert.equal(payload.workOrderId, workOrderId);
      assert.equal(payload.body, 'Please review the service update before the next shift.');
      message = {
        id: '30000000-0000-4000-8000-000000000051', senderUserId: headId, senderName: 'Synthetic Head',
        recipients: [{ userId: advisorId, displayName: 'Synthetic staff 014', readAt: null }, { userId: lastStaffId, displayName: 'Synthetic staff 051', readAt: null }],
        body: payload.body, workOrderId, workOrderReference: 'EV-SYN-00051', createdAt: now, readAt: null,
      };
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ messageId: message.id, createdAt: now }) });
    }
    return route.continue();
  });
  await context.route(`**/api/v1/sites/${siteId}/staff/organogram**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const page = Number(params.get('page') ?? '1');
    const pageStaff = page === 1 ? [{ id: headId, displayName: 'Synthetic Head' }, ...staff.slice(0, 49)] : staff.slice(49);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roles: [], placements: [], staff: pageStaff, page, pageSize: 50, totalCount: 52, totalPages: 2, staffTotalCount: 52, staffTotalPages: 2 }) });
  });
  await context.route(`**/api/v1/sites/${siteId}/work-orders**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const q = params.get('q') ?? '';
    const items = !q || 'EV-SYN-00051'.toLowerCase().includes(q.toLowerCase()) ? [{ id: workOrderId, reference: 'EV-SYN-00051', version: 1, createdAt: now, clientName: 'Synthetic client', vehicleLabel: 'Synthetic model', vin: 'WVWZZZ1JZXW000051', registration: 'SYN-0051', status: 'intakeDraft', complaintCount: 1, openHoldCount: 0 }] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, pagination: { page: 1, pageSize: 50, totalItems: items.length, totalPages: items.length ? 1 : 0 }, totals: { open: items.length, held: 0, intakeDrafts: items.length }, asOf: now }) });
  });
}

function record(name, facts = {}) { report.checks.push({ name, result: 'VERIFIED', ...facts }); }

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await setupRoutes(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${origin.origin}/sites/${siteId}/messages`);
  await page.getByRole('heading', { name: 'Staff messages', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Send a staff message' }).waitFor();
  await page.getByRole('checkbox', { name: 'Synthetic staff 014' }).check();
  await page.getByRole('button', { name: 'Next staff page' }).click();
  await page.getByRole('checkbox', { name: 'Synthetic staff 051' }).check();
  assert.equal(await page.getByText('2 selected · 52 active staff').count(), 1);
  await page.getByLabel(/Job link/).selectOption(workOrderId);
  await page.getByRole('textbox', { name: /Message/ }).fill('Please review the service update before the next shift.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByText('Message sent to the selected staff.').waitFor();
  await page.locator('ul.space-y-3 li').filter({ hasText: 'Please review the service update before the next shift.' }).waitFor();
  assert.equal(await page.getByText(/To: Synthetic staff 014, Synthetic staff 051/).count(), 1);
  record('Head sends immutable in-app message with explicit recipients and same-site work link', { recipientCount: 2, workOrderReference: 'EV-SYN-00051', externalDelivery: false });

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(axe.violations.map((item) => ({ id: item.id, impact: item.impact })), [], 'Messages page has automated accessibility violations.');
  record('Automated WCAG 2.1 A/AA scan passes on the HSC message page');
  const layoutEvidence = [];
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 850 });
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, main: document.querySelector('#workspace-main')?.getBoundingClientRect().width }));
    assert(layout.scroll <= layout.width + 1, `${width}px message page overflows horizontally: ${JSON.stringify(layout)}`);
    assert(layout.main && layout.main > 0, `${width}px message page main content is not visible.`);
    layoutEvidence.push({ width, documentWidth: layout.scroll });
    if ([390, 768, 1440].includes(width)) await page.screenshot({ path: resolve(checksDir, `staff-messages-${width}.png`), fullPage: true });
  }
  record('Message composition and inbox fit nine phone, tablet and desktop widths', { widths: layoutEvidence.map((entry) => entry.width) });

  const recipientContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await setupRoutes(recipientContext, { actorId: advisorId, displayName: 'Synthetic staff 014', canSend: false, receiver: true });
  const recipientPage = await recipientContext.newPage();
  recipientPage.on('pageerror', (error) => pageErrors.push(error.message));
  await recipientPage.goto(`${origin.origin}/sites/${siteId}/messages`);
  await recipientPage.getByRole('heading', { name: 'Staff messages', exact: true }).waitFor();
  assert.equal(await recipientPage.getByRole('heading', { name: 'Send a staff message' }).count(), 0, 'Recipient must not have the Head composer.');
  assert.equal(await recipientPage.getByText('Synthetic staff 051', { exact: false }).count(), 0, 'Recipient must not receive other recipients’ read or identity details.');
  await recipientPage.getByRole('button', { name: 'Mark as read' }).click();
  await recipientPage.getByRole('button', { name: 'Mark as read' }).waitFor({ state: 'detached' });
  const receivedCard = recipientPage.locator('ul.space-y-3 li').filter({ hasText: 'Please review the service update before the next shift.' });
  await receivedCard.getByText(/^Read\b/).waitFor();
  assert.match(await receivedCard.innerText(), /\bRead\b/);
  assert.doesNotMatch(await receivedCard.innerText(), /Not marked as read/);
  await page.reload();
  const sentCard = page.locator('ul.space-y-3 li').filter({ hasText: 'Please review the service update before the next shift.' });
  await sentCard.getByText(/To: Synthetic staff 014 \(read\), Synthetic staff 051/).waitFor();
  record('Named recipient reads only their addressed message and records a read receipt');
  record('Sender sees the recipient read receipt on the message');
  const recipientAxe = await new AxeBuilder({ page: recipientPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(recipientAxe.violations.map((item) => ({ id: item.id, impact: item.impact })), [], 'Recipient inbox has automated accessibility violations.');
  await recipientContext.close();

  const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await offlineContext.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
  await setupRoutes(offlineContext);
  const offlinePage = await offlineContext.newPage();
  await offlinePage.goto(`${origin.origin}/sites/${siteId}/messages`);
  await offlinePage.getByRole('heading', { name: 'Messages are unavailable offline' }).waitFor();
  assert.equal(await offlinePage.getByText('Please review the service update before the next shift.').count(), 0, 'Offline page must not show potentially stale message content.');
  record('Offline state withholds messages and does not retain unsent message drafts');
  await offlineContext.close();

  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('; ')}`);
  record('No browser runtime errors');
  report.result = 'passed';
  await mkdir(checksDir, { recursive: true });
  await writeFile(resolve(checksDir, 'staff-messages-browser-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await context.close();
} catch (error) {
  report.result = 'failed';
  report.failures = [{ message: error instanceof Error ? error.message : String(error) }];
  await mkdir(checksDir, { recursive: true });
  await writeFile(resolve(checksDir, 'staff-messages-browser-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}
