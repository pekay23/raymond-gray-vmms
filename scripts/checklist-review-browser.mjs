import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const root = resolve(import.meta.dirname, '..');
const siteId = '10000000-0000-4000-8000-000000000001';
const workOrderId = '20000000-0000-4000-8000-000000000001';
const taskId = '30000000-0000-4000-8000-000000000001';
const checklistId = '40000000-0000-4000-8000-000000000001';
const outcomeIds = [
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
];
const actorId = '60000000-0000-4000-8000-000000000001';
const now = '2026-11-19T12:00:00.000Z';
const reviews = [];
let vite;
let browser;
const pageErrors = [];

try {
  vite = await createServer({
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    root: resolve(root, 'apps/web'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    logLevel: 'error',
  });
  await vite.listen();
  const address = vite.httpServer.address();
  assert(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/api/v1/**', route => route.fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'NOT_STUBBED', message: 'No synthetic response is configured for this request.' } }),
  }));
  await context.route('**/api/v1/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { id: actorId, displayName: 'Synthetic Head of Service Centre' }, sites: [
      { id: siteId, name: 'EV Afriq After Sales Service Centre', code: 'CITY-GALLERIA', timeZone: 'Africa/Accra', canWrite: true, roleCodes: ['head-service-centre'] },
    ] }),
  }));
  await context.route('**/api/v1/owner/session', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }),
  }));
  await context.route(`**/api/v1/sites/${siteId}/checklist-review-queue**`, route => {
    const reviewed = new Set(reviews.map(review => review.body.outcomeRevisionId));
    const items = outcomeIds.flatMap((outcomeRevisionId, index) => reviewed.has(outcomeRevisionId) ? [] : [{
      workOrderId, bookingReference: 'EV-SR-00017', vehicleLabel: 'BYD Sealion 06', registration: 'GM-921-26',
      taskId, taskReference: 'T01', taskTitle: 'Record a synthetic maintenance observation',
      checklistId, checklistVersion: 7 + reviews.length, itemId: `70000000-0000-4000-8000-00000000000${index + 1}`,
      itemCode: `CHK-00${index + 1}`, itemLabel: index === 0 ? 'Inspect the reported condition' : 'Record the measured result',
      outcomeRevisionId, outcomeRevision: 1, result: 'completed', reason: null,
      comments: 'Synthetic observation for interface verification.', measurement: null, evidence: [],
      evidenceRequired: index === 0, evidenceCurrent: false, hasOpenHold: false,
      technicianName: 'Synthetic Technician', recordedAt: now,
      workPlanRevisionId: '80000000-0000-4000-8000-000000000001', assignmentRevision: 1,
    }]);
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ canReview: true, blockReason: null, items,
        pagination: { page: 1, pageSize: 5, totalItems: items.length, totalPages: items.length ? 1 : 0 } }),
    });
  });
  await context.route(`**/api/v1/sites/${siteId}/work-orders/${workOrderId}/tasks/${taskId}/checklists/${checklistId}/items/**/reviews`, async route => {
    const body = route.request().postDataJSON();
    const commandId = route.request().headers()['idempotency-key'];
    assert.equal(route.request().method(), 'POST');
    assert.ok(commandId, 'A review command must carry an idempotency key.');
    reviews.push({ commandId, body });
    const index = outcomeIds.indexOf(body.outcomeRevisionId);
    assert(index >= 0, 'The submitted review must name an item in the current queue.');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      reviewId: `90000000-0000-4000-8000-00000000000${index + 1}`,
      workOrderId, checklistId, itemId: `70000000-0000-4000-8000-00000000000${index + 1}`,
      outcomeRevisionId: body.outcomeRevisionId, disposition: body.disposition,
      checklistVersion: 8 + reviews.length, reviewedAt: now,
    }) });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${origin}/sites/${siteId}`, { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('article', { name: 'Checklist records to review' });
  await panel.waitFor();
  await panel.getByText('Inspect the reported condition', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Confirm record', exact: true }).first().isDisabled(), true,
    'A record requiring evidence cannot be confirmed before accepted evidence is available.');
  const firstReason = panel.getByLabel('Review reason').first();
  await panel.getByRole('button', { name: 'Return for correction', exact: true }).first().click();
  await panel.getByRole('alert').getByText('Enter a reason before saving this review.').waitFor();
  assert.equal(reviews.length, 0, 'A blank reason must not submit a review.');
  await firstReason.fill('Please attach the required evidence before this record is confirmed.');
  await panel.getByRole('button', { name: 'Return for correction', exact: true }).first().click();
  await page.getByText('Checklist record returned for correction.', { exact: true }).waitFor();
  await panel.getByText('Record the measured result', { exact: true }).waitFor();
  assert.deepEqual(reviews[0].body, {
    expectedChecklistVersion: 7,
    expectedWorkPlanRevisionId: '80000000-0000-4000-8000-000000000001',
    expectedAssignmentRevision: 1,
    outcomeRevisionId: outcomeIds[0],
    disposition: 'returned-for-correction',
    reason: 'Please attach the required evidence before this record is confirmed.',
  });

  const secondReason = panel.getByLabel('Review reason').first();
  await panel.getByRole('button', { name: 'Confirm record', exact: true }).first().click();
  await panel.getByRole('alert').getByText('Enter a reason before saving this review.').waitFor();
  await secondReason.fill('The recorded result matches the attached inspection record.');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(axe.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) })), [],
    'Checklist review queue has automated WCAG 2.1 A/AA violations.');
  await panel.getByRole('button', { name: 'Confirm record', exact: true }).first().click();
  await page.getByText('Checklist record confirmed. Technical work status is unchanged.', { exact: true }).waitFor();
  await panel.getByText('No checklist records are waiting for review in your current work scope.', { exact: true }).waitFor();
  assert.deepEqual(reviews[1].body, {
    expectedChecklistVersion: 8,
    expectedWorkPlanRevisionId: '80000000-0000-4000-8000-000000000001',
    expectedAssignmentRevision: 1,
    outcomeRevisionId: outcomeIds[1],
    disposition: 'record-confirmed',
    reason: 'The recorded result matches the attached inspection record.',
  });
  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join('; ')}`);

  const report = {
    recordedAt: new Date().toISOString(),
    scope: 'Synthetic API responses in Chromium; checklist evidence block, required reason, return/confirm actions, idempotency header, queue refresh and automated accessibility scan.',
    result: 'PASS',
    browser: `Chromium ${browser.version()}`,
    reviews,
    axeViolations: axe.violations.length,
    pageErrors,
    limitations: ['This is UI verification with synthetic API responses. PostgreSQL review authorization, audit and transaction behavior are not proven by this run.'],
  };
  await mkdir(resolve(root, 'docs/verification/browser'), { recursive: true });
  await writeFile(resolve(root, 'docs/verification/checklist-record-review-browser-results-2026-11-19.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await context.close();
} finally {
  await browser?.close();
  await vite?.close();
}
