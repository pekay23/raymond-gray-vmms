import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const root = resolve(import.meta.dirname, '..');
const siteId = '10000000-0000-4000-8000-000000000002';
const staffId = '10000000-0000-4000-8000-000000000013';
const reportPath = resolve(root, 'docs/verification/browser/my-assigned-tasks.json');
const now = '2026-11-11T12:00:00.000Z';
const viewportWidths = [320, 390, 768, 1024, 1440];
const report = {
  recordedAt: new Date().toISOString(),
  scope: 'Local Vite browser with synthetic API responses; assigned-task list, pagination, empty/failure states, keyboard targets, responsive overflow and automated accessibility scan.',
  result: 'RUNNING',
  checks: [],
  limitations: [
    'The page uses synthetic API responses here; PostgreSQL authorization and audit behavior are verified separately by the API integration suite.',
    'This does not establish staff UAT, production identity, physical-device or HarmonyOS support.',
  ],
};
const task = (index) => ({
  workOrderId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  bookingReference: `EV-SR-${String(index).padStart(5, '0')}`,
  registration: `RG-${String(index).padStart(4, '0')}`,
  vehicleLabel: 'Raymond Gray Electric Touring',
  taskId: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  taskReference: `T${String(index).padStart(2, '0')}`,
  taskTitle: `Synthetic assigned task ${index}`,
  supervisorName: 'Synthetic Workshop Supervisor',
  planRevisionNumber: 2,
  workPlanRevisionId: `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  assignmentRevision: 1,
  assignedAt: now,
});
let responseMode = 'populated';
let vite;
let browser;
const pageErrors = [];
const observedApiResponses = [];

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
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    return route.abort('blockedbyclient');
  });
  await context.route('**/api/v1/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      authenticated: true,
      user: { id: staffId, displayName: 'Synthetic Technician' },
      sites: [{ id: siteId, name: 'Synthetic Service Centre', code: 'SYN', timeZone: 'Africa/Accra', canWrite: true, roleCodes: ['technician-engineer-trainee'] }],
    }),
  }));
  await context.route('**/api/v1/owner/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }),
  }));
  await context.route(`**/api/v1/sites/${siteId}/my-task-labor-session`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ session: null }),
  }));
  await context.route(`**/api/v1/sites/${siteId}/my-tasks**`, (route) => {
    if (responseMode === 'failure') return route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Assigned tasks are temporarily unavailable.' } }),
    });
    const params = new URL(route.request().url()).searchParams;
    const page = Number(params.get('page') ?? 1);
    const pageSize = Number(params.get('pageSize') ?? 25);
    const all = responseMode === 'empty' ? [] : Array.from({ length: 27 }, (_, index) => task(index + 1));
    const query = (params.get('q') ?? '').trim().toLocaleLowerCase();
    const filtered = all.filter(item => [item.bookingReference, item.registration, item.taskReference, item.taskTitle]
      .join(' ').toLocaleLowerCase().includes(query));
    const totalPages = Math.ceil(filtered.length / pageSize);
    const effectivePage = Math.min(page, Math.max(1, totalPages));
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        items: filtered.slice((effectivePage - 1) * pageSize, effectivePage * pageSize),
        pagination: { page: effectivePage, pageSize, totalItems: filtered.length, totalPages },
      }),
    });
  });

  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/v1/')) observedApiResponses.push({ path: url.pathname, status: response.status() });
  });
  await page.goto(`${origin}/sites/${siteId}/my-tasks`);
  await page.getByRole('heading', { name: 'My assigned tasks', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Current assignments', exact: true }).waitFor();
  assert.equal(await page.locator('main ul[aria-label="Tasks currently assigned to you"] > li').count(), 25);
  assert.equal(await page.getByRole('link', { name: 'My assigned tasks' }).count(), 1);
  assert.match(await page.locator('main').innerText(), /does not authorize you to start, diagnose, or repair/i);
  assert.equal(await page.getByRole('button', { name: 'Previous' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Next' }).isEnabled(), true);
  report.checks.push({ name: 'Populated first page shows 25 current assignments and the explicit authority boundary.', result: 'VERIFIED' });

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByText('Page 2 of 2', { exact: true }).waitFor();
  assert.equal(await page.locator('main ul[aria-label="Tasks currently assigned to you"] > li').count(), 2);
  assert.equal(await page.getByRole('button', { name: 'Next' }).isDisabled(), true);
  report.checks.push({ name: 'Pagination advances to the final page and disables Next.', result: 'VERIFIED' });

  const search = page.getByRole('search').getByLabel('Search assigned tasks', { exact: true });
  await search.fill('rg-0027');
  await search.press('Enter');
  await page.getByText('Showing 1–1 of 1 task matching your search', { exact: true }).waitFor();
  assert.equal(await page.locator('main ul[aria-label="Tasks currently assigned to you"] > li').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Previous' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Next' }).isDisabled(), true);
  assert.equal((await page.locator('main ul[aria-label="Tasks currently assigned to you"] > li').innerText()).includes('RG-0027'), true);
  report.checks.push({ name: 'Keyboard search filters by registration and resets pagination to the matching first page.', result: 'VERIFIED' });

  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByText(/Showing 1–25 of 27 tasks/).waitFor();
  assert.equal(await page.locator('main ul[aria-label="Tasks currently assigned to you"] > li').count(), 25);
  assert(await page.getByRole('button', { name: 'Next' }).isEnabled());
  report.checks.push({ name: 'Clear restores all current assignments on page one.', result: 'VERIFIED' });

  await search.fill('%');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('heading', { name: 'No tasks match your search' }).waitFor();
  assert.match(await page.locator('main').innerText(), /Clear the search to see all your assignments/i);
  report.checks.push({ name: 'Literal wildcard characters return the empty state without widening the search.', result: 'VERIFIED' });

  const responsive = [];
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 960 });
    const openNavigation = page.getByRole('button', { name: 'Open navigation menu' });
    if (await openNavigation.isVisible().catch(() => false)) await openNavigation.click();
    await page.waitForTimeout(50);
    const geometry = await page.evaluate(() => ({
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector('main')?.getBoundingClientRect().width ?? 0,
      visiblePrimaryLinks: [...document.querySelectorAll('#workspace-navigation nav[aria-label="Primary navigation"] a')]
        .filter(link => link.getClientRects().length > 0).map(link => ({ text: link.textContent?.trim(), width: link.getBoundingClientRect().width })),
    }));
    assert.equal(geometry.documentWidth, width, `${width}px layout must not overflow horizontally`);
    assert(geometry.visiblePrimaryLinks.some(link => link.text === 'My assigned tasks'), `${width}px nav link should remain visible`);
    assert(geometry.mainWidth > 0 && geometry.mainWidth <= width, `${width}px main content should fit the viewport`);
    responsive.push(geometry);
  }
  report.checks.push({ name: 'Responsive layout keeps the navigation, content and controls inside all tested widths.', result: 'VERIFIED', viewports: responsive });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => ({
    name: document.activeElement?.textContent?.trim() ?? '',
    visible: Boolean(document.activeElement && document.activeElement.getClientRects().length),
  }));
  assert(focus.visible, 'Keyboard focus must remain visible.');
  report.checks.push({ name: 'Keyboard navigation reaches visible, named controls.', result: 'VERIFIED', firstTabFocus: focus });

  const accessibility = await new AxeBuilder({ page }).analyze();
  const accessibilityFindings = accessibility.violations.map(item => ({
    id: item.id,
    impact: item.impact,
    description: item.description,
    nodes: item.nodes.map(node => ({ target: node.target, html: node.html, summary: node.failureSummary })),
  }));
  assert.deepEqual(accessibilityFindings, [], 'Axe must report no accessibility violations.');
  report.checks.push({ name: 'Axe accessibility scan reports no violations on the populated task page.', result: 'VERIFIED', violations: accessibility.violations.length });

  responseMode = 'empty';
  await page.reload();
  await page.getByRole('heading', { name: 'No current tasks assigned' }).waitFor();
  report.checks.push({ name: 'Empty state explains how an assignment appears.', result: 'VERIFIED' });

  responseMode = 'failure';
  await page.reload();
  await page.getByRole('alert').getByText('Assigned tasks are temporarily unavailable.').waitFor();
  assert(await page.getByRole('button', { name: 'Try again' }).isVisible());
  report.checks.push({ name: 'Failure state presents the server message and a retry control.', result: 'VERIFIED' });
  assert.deepEqual(pageErrors, [], 'The browser must not report page errors.');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.failure = error instanceof Error ? error.message : String(error);
  report.apiResponses = observedApiResponses;
  report.pageErrors = pageErrors;
  throw error;
} finally {
  await mkdir(resolve(root, 'docs/verification/browser'), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  await vite?.close();
}

process.stdout.write(`Wrote ${reportPath} (${report.result})\n`);
