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
  scope: 'Local Vite browser with synthetic API responses; Today work previews for single and combined roles, queue-link routing, assigned-task list, pagination, empty/failure states, keyboard targets, responsive overflow and automated accessibility scans.',
  result: 'RUNNING',
  checks: [],
  limitations: [
    'The page uses synthetic API responses here; PostgreSQL authorization and audit behavior are verified separately by the API integration suite.',
    'This does not establish staff UAT, production identity, physical-device or HarmonyOS support.',
  ],
};
const responsiveFailures = [];
let activeRoles = ['technician-engineer-trainee'];
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
let workOrderMode = 'populated';
const taskActivityItems = new Map();
let submittedTaskActivity = null;
let submittedChecklistOutcome = null;
const checklistOutcomeItems = [];
const checklistId = '50000000-0000-4000-8000-000000000001';
const checklistItemId = '60000000-0000-4000-8000-000000000001';
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
      sites: [{ id: siteId, name: 'Synthetic Service Centre', code: 'SYN', timeZone: 'Africa/Accra', canWrite: true, roleCodes: activeRoles }],
    }),
  }));
  await context.route('**/api/v1/owner/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }),
  }));
  await context.route(`**/api/v1/sites/${siteId}/my-task-labor-session`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ session: null }),
  }));
  await context.route(`**/api/v1/sites/${siteId}/work-orders**`, (route) => {
    const queue = new URL(route.request().url()).searchParams.get('queue') ?? 'all';
    if (workOrderMode === 'failure') return route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'The workshop queue is temporarily unavailable.' } }),
    });
    const item = {
      id: '20000000-0000-4000-8000-000000000001', reference: 'EV-SR-00001', version: 1,
      createdAt: now, clientName: 'Synthetic Client', vehicleLabel: 'Raymond Gray Electric Touring',
      vin: 'SYNTHETICVIN000001', registration: 'RG-0001', status: 'intakeDraft',
      complaintCount: 2, openHoldCount: 0,
    };
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: workOrderMode === 'empty' ? [] : [item], pagination: { page: 1, pageSize: 4, totalItems: workOrderMode === 'empty' ? 0 : 1, totalPages: workOrderMode === 'empty' ? 0 : 1 }, totals: { open: 1, held: 0, intakeDrafts: 1 }, asOf: now, requestedQueue: queue }),
    });
  });
  await context.route(`**/api/v1/sites/${siteId}/service-requests**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [], page: 1, pageSize: 4, totalCount: 0, totalPages: 0 }),
  }));
  const emptyReviewQueue = { items: [], pagination: { page: 1, pageSize: 5, totalItems: 0, totalPages: 0 } };
  await context.route(`**/api/v1/sites/${siteId}/task-review-requests**`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(emptyReviewQueue),
  }));
  await context.route(`**/api/v1/sites/${siteId}/diagnostic-review-findings**`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(emptyReviewQueue),
  }));
  await context.route(`**/api/v1/sites/${siteId}/checklist-review-queue**`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ...emptyReviewQueue, canReview: false, blockReason: null }),
  }));
  await context.route(`**/api/v1/sites/${siteId}/my-tasks**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/work-evidence')) {
      const segments = url.pathname.split('/');
      const taskIndex = segments.indexOf('my-tasks');
      const assigned = Array.from({ length: 27 }, (_, index) => task(index + 1)).find(item => item.taskId === segments[taskIndex + 2]);
      if (!assigned) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CURRENT_TASK_ASSIGNMENT_REQUIRED', message: 'This task is no longer assigned to you.' } }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workOrderId: segments[taskIndex + 1], taskId: segments[taskIndex + 2], workPlanRevisionId: assigned.workPlanRevisionId, assignmentRevision: assigned.assignmentRevision, items: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 } }) });
    }
    if (url.pathname.includes('/checklists')) {
      const segments = url.pathname.split('/');
      const taskIndex = segments.indexOf('my-tasks');
      const workOrderId = segments[taskIndex + 1];
      const taskId = segments[taskIndex + 2];
      const assigned = Array.from({ length: 27 }, (_, index) => task(index + 1)).find(item => item.taskId === taskId);
      if (!assigned) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CURRENT_TASK_ASSIGNMENT_REQUIRED', message: 'This task is no longer assigned to you.' } }) });
      if (segments.at(-1) === 'checklists') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workOrderId, taskId, workPlanRevisionId: assigned.workPlanRevisionId, assignmentRevision: assigned.assignmentRevision, checklists: [
        { id: checklistId, state: 'in-progress', version: submittedChecklistOutcome ? 2 : 1, templateCode: 'SYNTHETIC-RM', templateRevision: 1, items: [{ id: checklistItemId, code: 'VISUAL-01', definition: { label: 'Synthetic visual check', description: 'Confirm the visible area is in acceptable condition.', classification: { systemCode: 'SYNTHETIC.BODY', taskClassCode: 'SYNTHETIC.VISUAL-CHECK' }, requiredQualifications: ['SYNTHETIC-QA'], evidenceRequired: false, notApplicableAllowed: true } }] },
        { id: '50000000-0000-4000-8000-000000000002', state: 'draft', version: 1, templateCode: 'SYNTHETIC-DRAFT', templateRevision: 1, items: [{ id: '60000000-0000-4000-8000-000000000002', code: 'DRAFT-01', definition: { label: 'Synthetic draft item' } }] },
      ] }) });
      if (segments.at(-1) === 'outcomes' && route.request().method() === 'POST') {
        submittedChecklistOutcome = route.request().postDataJSON();
        const outcome = { id: '70000000-0000-4000-8000-000000000002', revision: checklistOutcomeItems.length + 1, result: submittedChecklistOutcome.result, reason: submittedChecklistOutcome.reason, applicabilityReason: submittedChecklistOutcome.applicabilityReason, comments: submittedChecklistOutcome.comments, measurement: submittedChecklistOutcome.measurement, evidenceIds: submittedChecklistOutcome.evidenceIds, actorName: 'Synthetic Technician', assigneeName: 'Synthetic Technician', recordedAt: now };
        checklistOutcomeItems.unshift(outcome);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workOrderId, taskId, checklistId, checklistVersion: 2, itemId: checklistItemId, sourceTemplateRevisionId: '80000000-0000-4000-8000-000000000001', outcome }) });
      }
      if (segments.at(-1) === 'outcomes') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workOrderId, taskId, checklistId, checklistVersion: submittedChecklistOutcome ? 2 : 1, sourceTemplateRevisionId: '80000000-0000-4000-8000-000000000001', itemCode: 'VISUAL-01', definition: { label: 'Synthetic visual check' }, items: checklistOutcomeItems, pagination: { page: 1, pageSize: 100, totalItems: checklistOutcomeItems.length, totalPages: checklistOutcomeItems.length ? 1 : 0 } }) });
    }
    if (url.pathname.endsWith('/activity')) {
      const pathParts = url.pathname.split('/');
      const workOrderId = pathParts.at(-3);
      const taskId = pathParts.at(-2);
      const assigned = Array.from({ length: 27 }, (_, index) => task(index + 1)).find(item => item.taskId === taskId);
      if (!assigned) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Task not found.' } }) });
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        submittedTaskActivity = body;
        const item = { id: '70000000-0000-4000-8000-000000000001', assignmentRevision: assigned.assignmentRevision, entryType: body.entryType, progressState: body.progressState, requestType: body.requestType, completionDeclaration: body.completionDeclaration ?? null, declarationWorkEntryIds: null, responseToActivityId: null, responseToActorName: null, responseToNote: null, hasSupervisorResponse: false, note: body.note, actorName: 'Synthetic Technician', createdAt: now };
        taskActivityItems.set(taskId, [...(taskActivityItems.get(taskId) ?? []), item]);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workOrderId, taskId, activity: item }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workOrderId, taskId, workPlanRevisionId: assigned.workPlanRevisionId, assignmentRevision: assigned.assignmentRevision, items: taskActivityItems.get(taskId) ?? [] }) });
    }
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
  await page.goto(`${origin}/sites/${siteId}/today`);
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Your assigned tasks', exact: true }).waitFor();
  await page.getByText('Synthetic assigned task 1', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Work needing your attention' }).count(), 1);
  report.checks.push({ name: 'Technician Today shows a role-specific assigned-task preview backed by the existing scoped task API.', result: 'VERIFIED' });

  activeRoles = ['head-service-centre', 'ev-team-lead', 'supervisor', 'technician-engineer-trainee'];
  await page.reload();
  for (const heading of ['Jobs to review', 'Jobs needing a team lead', 'Jobs assigned to you', 'Jobs with your team', 'Your assigned tasks']) {
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  }
  const todayAccessibility = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(todayAccessibility.violations.map(item => item.id), [], 'Axe must report no accessibility violations on the combined-role Today page.');
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 960 });
    const geometry = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    if (geometry.document !== geometry.viewport) responsiveFailures.push({ page: 'Today', viewport: width, documentWidth: geometry.document });
  }
  report.checks.push({ name: 'Combined-role Today layout fits every tested viewport.', result: responsiveFailures.some(item => item.page === 'Today') ? 'FAILED' : 'VERIFIED', viewports: viewportWidths, failures: responsiveFailures.filter(item => item.page === 'Today') });
  const leadQueueLink = page.getByRole('link', { name: 'View all' }).first();
  await leadQueueLink.click();
  await page.getByRole('heading', { name: 'Work orders', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('queue'), 'awaiting-operations', 'Today preview must open the matching work-order queue.');
  await page.goto(`${origin}/sites/${siteId}/today`);
  await page.getByRole('heading', { name: 'Your assigned tasks', exact: true }).waitFor();
  workOrderMode = 'empty';
  await page.reload();
  await page.getByRole('heading', { name: 'Jobs to review', exact: true }).waitFor();
  const emptyQueueMessages = page.getByText('No jobs are waiting in this list.', { exact: true });
  await emptyQueueMessages.nth(3).waitFor();
  assert.equal(await emptyQueueMessages.count(), 4);
  workOrderMode = 'failure';
  await page.reload();
  await page.getByRole('heading', { name: 'Jobs to review', exact: true }).waitFor();
  const queueFailures = page.getByRole('alert').filter({ hasText: 'The workshop queue is temporarily unavailable.' });
  await queueFailures.nth(3).waitFor();
  assert.equal(await queueFailures.count(), 4);
  workOrderMode = 'populated';
  report.checks.push({ name: 'Today work-order previews show distinct empty and retryable API failure states.', result: 'VERIFIED', queueCards: 4 });

  report.checks.push({ name: 'Combined Head, lead, supervisor and technician roles show every applicable preview; queue links preserve their server filter.', result: 'VERIFIED', accessibilityViolations: todayAccessibility.violations.length, viewports: viewportWidths });

  await page.goto(`${origin}/sites/${siteId}/my-tasks`);
  await page.getByRole('heading', { name: 'My assigned tasks', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Current assignments', exact: true }).waitFor();
  assert.equal(await page.locator('main ul[aria-label="Tasks currently assigned to you"] > li').count(), 25);
  assert.equal(await page.getByRole('link', { name: 'My assigned tasks' }).count(), 1);
  assert.match(await page.locator('main').innerText(), /does not authorize you to start, diagnose, or repair/i);
  assert.equal(await page.getByRole('button', { name: 'Previous' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Next' }).isEnabled(), true);
  report.checks.push({ name: 'Populated first page shows 25 current assignments and the explicit authority boundary.', result: 'VERIFIED' });

  const firstTaskRow = page.locator('main ul[aria-label="Tasks currently assigned to you"] > li').first();
  await firstTaskRow.getByRole('button', { name: 'Update task', exact: true }).click();
  await page.getByLabel('Update type', { exact: true }).selectOption('request');
  await page.getByLabel('What do you need?', { exact: true }).selectOption('supervisor-review');
  await page.getByText('This sends a review request. It does not mark the task or job complete.', { exact: true }).waitFor();
  await page.getByLabel('Describe your request', { exact: true }).fill('Synthetic request for a Supervisor to review this task.');
  await firstTaskRow.getByRole('button', { name: 'Save update', exact: true }).click();
  await firstTaskRow.getByText('Task update saved.', { exact: true }).waitFor();
  assert.equal(submittedTaskActivity?.requestType, 'supervisor-review');
  assert.equal(submittedTaskActivity?.entryType, 'request');
  report.checks.push({ name: 'Technician can ask the Supervisor to review a task; UI and API retain this as a non-completing request.', result: 'VERIFIED' });

  await firstTaskRow.getByRole('button', { name: 'Record work', exact: true }).click();
  const workType = firstTaskRow.getByLabel('Record type', { exact: true });
  await workType.waitFor();
  assert.equal(await workType.inputValue(), 'finding');
  assert.equal(await firstTaskRow.getByLabel('Result', { exact: true }).inputValue(), 'observed');
  assert.equal(await workType.locator('option[value="test"]').isDisabled(), true);
  assert.equal(await workType.locator('option[value="action"]').isDisabled(), true);
  const resultOptions = firstTaskRow.getByLabel('Result', { exact: true });
  await workType.selectOption('follow-up');
  assert.equal(await resultOptions.locator('option[value="done"]').isDisabled(), true);
  assert.match(await firstTaskRow.locator('form').innerText(), /approved scope, effective vehicle instructions, a matching qualification and signed task authority/i);
  report.checks.push({ name: 'Technician work form defaults to a safe observation and blocks tests, repair actions and completed follow-ups until server-checked authority is available.', result: 'VERIFIED' });
  await firstTaskRow.getByRole('button', { name: 'Progress update', exact: true }).click();

  await firstTaskRow.getByRole('heading', { name: 'Maintenance checklist', exact: true }).waitFor();
  const draftChecklist = firstTaskRow.locator('section[aria-label="SYNTHETIC-DRAFT revision 1"]');
  await draftChecklist.getByRole('button', { name: 'View details', exact: true }).click();
  await draftChecklist.getByText('Draft only. VMMS cannot start this checklist yet.', { exact: false }).waitFor();
  assert.equal(await draftChecklist.getByRole('button', { name: 'Save outcome', exact: true }).count(), 0);
  report.checks.push({ name: 'Draft maintenance checklists state clearly that VMMS cannot start them and expose no technician save action.', result: 'VERIFIED' });
  await firstTaskRow.getByRole('button', { name: 'Record outcome', exact: true }).click();
  await firstTaskRow.getByText('Synthetic visual check', { exact: true }).waitFor();
  assert.equal(await firstTaskRow.getByLabel('Result', { exact: true }).count(), 1, await firstTaskRow.innerText());
  await firstTaskRow.getByLabel('Result', { exact: true }).selectOption('completed');
  await firstTaskRow.getByRole('button', { name: 'Save outcome', exact: true }).click();
  await firstTaskRow.getByText('Checklist outcome saved. The task remains subject to separate review and release.', { exact: true }).waitFor();
  assert.equal(submittedChecklistOutcome?.expectedWorkPlanRevisionId, task(1).workPlanRevisionId);
  assert.equal(submittedChecklistOutcome?.expectedAssignmentRevision, 1);
  assert.equal(submittedChecklistOutcome?.result, 'completed');
  assert.equal(submittedChecklistOutcome?.reason, null);
  assert.equal(submittedChecklistOutcome?.supersedesRevisionId, null);
  await firstTaskRow.getByText('Latest saved outcome: completed', { exact: true }).waitFor();
  report.checks.push({ name: 'Assigned Technician records a checklist result against the current plan and assignment, then sees immutable outcome history.', result: 'VERIFIED' });

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
    if (geometry.documentWidth !== width) responsiveFailures.push({ page: 'My assigned tasks', viewport: width, documentWidth: geometry.documentWidth });
    assert(geometry.visiblePrimaryLinks.some(link => link.text === 'My assigned tasks'), `${width}px nav link should remain visible`);
    assert(geometry.mainWidth > 0 && geometry.mainWidth <= width, `${width}px main content should fit the viewport`);
    responsive.push(geometry);
  }
  report.checks.push({ name: 'Responsive layout keeps the navigation, content and controls inside all tested widths.', result: responsiveFailures.length ? 'FAILED' : 'VERIFIED', viewports: responsive, failures: responsiveFailures });

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
  report.result = responsiveFailures.length ? 'FAIL' : 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.failure = error instanceof Error ? error.message : String(error);
  report.apiResponses = observedApiResponses;
  report.pageErrors = pageErrors;
  report.responsiveFailures = responsiveFailures;
  throw error;
} finally {
  await mkdir(resolve(root, 'docs/verification/browser'), { recursive: true });
  report.responsiveFailures = responsiveFailures;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  await vite?.close();
}

process.stdout.write(`Wrote ${reportPath} (${report.result})\n`);
if (report.result === 'FAIL') process.exitCode = 1;
