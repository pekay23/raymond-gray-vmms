import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';

const root = process.cwd();
const siteId = '10000000-0000-4000-8000-000000000001';
const orderId = '20000000-0000-4000-8000-000000000001';
const checklistId = '30000000-0000-4000-8000-000000000001';
const actorId = '40000000-0000-4000-8000-000000000001';
const reportPath = `/api/v1/sites/${siteId}/work-orders/${orderId}/checklists/${checklistId}/report`;
const now = '2026-11-18T10:00:00.000Z';
const item = (ordinal, result, reason = null) => ({
  id: `50000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
  code: `CHK-${String(ordinal).padStart(3, '0')}`, ordinal, label: ordinal === 1 ? 'Inspect front suspension and listen for unusual noise during a road test' : `Inspect workshop maintenance point ${ordinal}`,
  result, reason: reason ?? null, applicabilityReason: null, comments: ordinal === 1 ? 'Noise was not reproduced during the controlled road test.' : null,
  measurement: ordinal === 1 ? { 'Road-test distance': '4 km' } : null, actorName: result ? 'Synthetic Technician' : null,
  assigneeName: result ? 'Synthetic Technician' : null, taskReference: result ? 'TASK-001' : null, taskTitle: result ? 'Road test and record findings' : null,
  revision: result ? 1 : null, correctionReason: null, recordedAt: result ? now : null,
  evidenceLabels: result ? ['road-test-note.pdf'] : [],
});
const full = Array.from({ length: 51 }, (_, index) => item(index + 1, index === 0 ? 'completed' : null, index === 0 ? null : undefined));
const apiPages = [];
let vite;
let browser;
const pageErrors = [];
try {
  vite = await createServer({ root: resolve(root, 'apps/web'), configFile: resolve(root, 'apps/web/vite.config.ts'), server: { host: '127.0.0.1', port: 0, proxy: {} } });
  await vite.listen();
  const origin = new URL(vite.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/api/v1/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    authenticated: true, user: { id: actorId, displayName: 'Synthetic Head of Service Centre' },
    sites: [{ id: siteId, name: 'EV Afriq After Sales Service Centre', code: 'CITY-GALLERIA', timeZone: 'Africa/Accra', canWrite: true, roleCodes: ['head-service-centre'] }],
  }) }));
  await context.route('**/api/v1/owner/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
  await context.route(`**${reportPath}*`, async route => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    apiPages.push({ page: pageNumber, expectedChecklistVersion: url.searchParams.get('expectedChecklistVersion') });
    const rows = pageNumber === 1 ? full.slice(0, 50) : full.slice(50);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify({
      workOrderId: orderId, bookingReference: 'EV-SR-00017', siteName: 'EV Afriq After Sales Service Centre',
      vehicle: { registration: 'GT-1234-26', make: 'BYD', model: 'Sealion 06', variant: 'Premium', powertrain: 'EV' },
      checklist: { id: checklistId, kind: 'routine-maintenance', state: 'in-progress', version: 7, scheduleBasis: 'verified-history', odometerAtStartKm: 10000, templateCode: 'RM-BYD-SEALION-06', templateRevision: 2,
        sources: [{ reference: 'SOP-RM-001', title: 'Routine maintenance source', revision: '1.0', status: 'effective', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveUntil: null, current: true }] },
      summary: { totalItems: 51, completed: 1, failed: 0, notChecked: 50, notCompleted: 0, blocked: 0, notApplicable: 0 },
      items: rows, pagination: { page: pageNumber, pageSize: 50, totalItems: 51, totalPages: 2 }, preparedAt: now,
    }) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${origin}/sites/${siteId}/work-orders/${orderId}/checklists/${checklistId}/report`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: 'Routine maintenance report' }).waitFor();
  await page.getByText('EV-SR-00017', { exact: true }).waitFor();
  try { await page.getByRole('heading', { name: /Inspect front suspension and listen for unusual noise during a road test/ }).waitFor(); } catch (error) { process.stderr.write(JSON.stringify({ body: await page.locator('body').innerText(), apiPages, pageErrors }, null, 2) + '\\n'); throw error; }
  await page.getByRole('heading', { name: /Inspect workshop maintenance point 51/ }).waitFor();
  assert.deepEqual(apiPages, [{ page: 1, expectedChecklistVersion: null }, { page: 2, expectedChecklistVersion: '7' }], 'The print page should fetch every report page with the same checklist version.');
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, report: document.querySelector('.task-progress-report').getBoundingClientRect().width }));
    assert(bounds.document <= bounds.viewport, `Horizontal overflow at ${width}px: ${JSON.stringify(bounds)}`);
    assert(bounds.report > 0 && bounds.report <= bounds.viewport, `Report width invalid at ${width}px: ${JSON.stringify(bounds)}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(axe.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) })), [], 'Checklist report has automated WCAG 2.1 A/AA violations.');
  await page.emulateMedia({ media: 'print' });
  const printView = await page.evaluate(() => ({ printMode: matchMedia('print').matches, reportVisibility: getComputedStyle(document.querySelector('.task-progress-report')).visibility, toolbarDisplay: getComputedStyle(document.querySelector('.task-progress-report-toolbar')).display, title: document.title }));
  assert.equal(printView.printMode, true);
  assert.equal(printView.reportVisibility, 'visible');
  assert.equal(printView.toolbarDisplay, 'none');
  assert.match(printView.title, /EV-SR-00017 maintenance checklist/);
  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join('; ')}`);
  await page.emulateMedia({ media: 'screen' });
  await mkdir(resolve(root, 'docs/verification/work-order-checklist-report-2026-11-18'), { recursive: true });
  await writeFile(resolve(root, 'docs/verification/work-order-checklist-report-2026-11-18/browser-results.json'), JSON.stringify({ result: 'passed', mode: 'mocked browser API; synthetic report only', browser: `Chromium ${browser.version()}`, widths: [320, 360, 390, 430, 768, 1024, 1440], pagesFetched: apiPages, axeViolations: axe.violations.length, printView, pageErrors }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ result: 'passed', browser: `Chromium ${browser.version()}`, widths: [320, 360, 390, 430, 768, 1024, 1440], pagesFetched: apiPages, axeViolations: axe.violations.length, printView, pageErrors }, null, 2) + '\n');
  await context.close();
} finally {
  await browser?.close();
  await vite?.close();
}



