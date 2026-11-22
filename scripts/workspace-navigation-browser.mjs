import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const origin = new URL(process.env.VMMS_WEB_URL || 'http://127.0.0.1:5173');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Use a local VMMS web server.');
const browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
const ids = {
  workshop: '10000000-0000-4000-8000-000000000001',
  sales: '10000000-0000-4000-8000-000000000002',
  operator: '10000000-0000-4000-8000-000000000003',
};
const roles = [
  { name: 'Head with Operator', roleCodes: ['head-service-centre', 'vmms-operator'], siteId: ids.workshop, home: 'today', visible: ['Today', 'Requests and callbacks', 'Work orders', 'Service history'], hidden: ['Finance setup', 'Sales and PDI history'] },
  { name: 'Advisor', roleCodes: ['service-advisor'], siteId: ids.workshop, home: 'today', visible: ['Today', 'Requests and callbacks', 'Work orders', 'Service history'], hidden: ['Sales and PDI history', 'Staff accounts'] },
  { name: 'Read-only Advisor', roleCodes: ['service-advisor'], siteId: ids.workshop, canWrite: false, home: 'today', visible: ['Today', 'Requests and callbacks', 'Work orders'], hidden: ['Sales and PDI history', 'Finance setup', 'Staff accounts'] },
  { name: 'Technician', roleCodes: ['technician-engineer-trainee'], siteId: ids.workshop, home: 'today', visible: ['My assigned tasks', 'Service history'], hidden: ['Sales and PDI history', 'Staff accounts'] },
  { name: 'Sales-only', roleCodes: ['sales-representative'], siteId: ids.sales, home: 'today', visible: ['Today', 'Requests and callbacks'], hidden: ['Work orders', 'Service history', 'Staff accounts', 'Sales and PDI history', 'Finance setup'] },
  { name: 'Operator-only', roleCodes: ['vmms-operator'], siteId: ids.operator, home: 'staff/accounts', visible: ['Staff accounts'], hidden: ['Today', 'Requests and callbacks', 'Work orders'] },
  { name: 'Finance-only', roleCodes: ['finance-billing'], siteId: ids.workshop, home: 'today', visible: ['Today', 'Requests and callbacks'], hidden: ['Work orders', 'Service history', 'Sales and PDI history', 'Finance setup', 'Staff accounts'] },
];
const results = [];

try {
  for (const persona of roles) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.route('**/api/v1/session', route => route.fulfill({
      status: 200,
      headers: { 'set-cookie': 'vmms_csrf=workspace-nav-test; Path=/; SameSite=Strict' },
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: { id: '10000000-0000-4000-8000-000000000010', displayName: persona.name },
        sites: [{ id: persona.siteId, name: 'Synthetic QA Centre', code: 'QA', timeZone: 'Africa/Accra', canWrite: persona.canWrite ?? true, roleCodes: persona.roleCodes }],
      }),
    }));
    await context.route('**/api/v1/owner/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
    await context.route('**/api/v1/sites/*/staff/account-provisioning-requests*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ requests: [], page: 1, pageSize: 25, totalCount: 0, totalPages: 0 }),
    }));
    await context.route('**/api/v1/sites/*/finance/configuration-drafts*', route => route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'FINANCE_CONFIGURATION_GRANT_REQUIRED', message: 'A current Finance configuration grant is required for this action.' } }),
    }));
    await context.route(url => new URL(url).pathname.endsWith('/service-history'), route => {
      const vin = new URL(route.request().url()).searchParams.get('vin');
      if (vin === 'WVWZZZ1JZXW000001') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        vehicle: { id: '30000000-0000-4000-8000-000000000001', vin, registration: 'SYN-101', make: 'Synthetic BYD', model: 'Sealion 06', variant: 'Premium', powertrain: 'Battery electric' },
        items: [{ workOrderId: '20000000-0000-4000-8000-000000000001', reference: 'EV-SR-00001', openedAt: '2026-11-12T08:00:00.000Z', odometerKm: 12000, complaints: ['Customer reported an unusual rear noise.'], workEntries: [{ id: '40000000-0000-4000-8000-000000000001', taskReference: 'T01', taskTitle: 'Inspect rear noise concern', kind: 'test', result: 'not-reproduced', summary: 'Noise not heard during this test', detail: 'Road test completed on the recorded route.', actorName: 'Synthetic Technician', recordedAt: '2026-11-12T10:00:00.000Z', supersedesEntryId: null, correctionReason: null }] }],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
      }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ vehicle: null, items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 } }) });
    });
    await context.route(url => new URL(url).pathname.endsWith('/service-requests') && new URL(url).searchParams.has('filter'), route => {
      const filter = new URL(route.request().url()).searchParams.get('filter');
      if (persona.name === 'Advisor') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ROLE_REQUIRED', message: 'Request queue unavailable.' } }) });
      const due = filter === 'overdue' && persona.name === 'Head with Operator'
        ? [{ id: '10000000-0000-4000-8000-000000000021', version: 1, concern: 'Synthetic brake noise callback', reportedContact: null, reportedContactName: 'Synthetic private caller', reportedContactPhone: '+233000000001', reportedContactRelationship: 'unknown', reportedVehicle: 'Synthetic Sealion 06', reportedClient: null, nextAction: 'Call about the test drive', callbackDueAt: '2026-11-12T09:00:00.000Z', assignedTo: null, assignedToName: null, assigneeActive: null }]
        : filter === 'due-today' && persona.name === 'Head with Operator'
          ? [{ id: '10000000-0000-4000-8000-000000000022', version: 1, concern: 'Synthetic radio app follow-up', reportedContact: null, reportedContactName: null, reportedContactPhone: null, reportedContactRelationship: 'unknown', reportedVehicle: 'Synthetic Sealion 06', reportedClient: null, nextAction: 'Confirm the radio app works', callbackDueAt: '2026-11-13T10:00:00.000Z', assignedTo: null, assignedToName: null, assigneeActive: null }]
          : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: due, page: 1, pageSize: 4, totalCount: due.length, totalPages: due.length ? 1 : 0 }) });
    });
    await context.route(url => new URL(url).pathname.endsWith('/diagnostic-review-findings'), route => {
      if (!persona.roleCodes.includes('head-service-centre') && !persona.roleCodes.includes('ev-team-lead') && !persona.roleCodes.includes('ice-team-lead'))
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'DIAGNOSTIC_REVIEW_QUEUE_REQUIRED', message: 'This review list is unavailable.' } }) });
      const requestUrl = new URL(route.request().url());
      const page = Number(requestUrl.searchParams.get('page') || 1);
      const items = Array.from({ length: 6 }, (_, index) => ({
        findingId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        workOrderId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        bookingReference: `EV-SR-${String(index + 1).padStart(5, '0')}`,
        vehicleLabel: 'BYD Sealion 06', registration: 'GM-921-26', complaintReference: 'C01',
        taskReference: 'T01', taskTitle: 'Check reported charging concern',
        summary: `Synthetic finding ${index + 1}: the reported issue was not reproduced.`,
        certaintyState: 'inconclusive', certaintyExplanation: 'The symptom did not occur during the available test.',
        residualRisk: 'The reported concern remains unresolved.', restrictions: 'Do not describe this system as cleared.',
        recordedAt: '2026-11-18T09:00:00.000Z',
      }));
      const pageSize = 5;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        items: items.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, pageSize, totalItems: items.length, totalPages: Math.ceil(items.length / pageSize) },
      }) });
    });
    await context.route(url => new URL(url).pathname.includes('/service-requests/10000000-0000-4000-8000-000000000021'), route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/contacts')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 1, totalPages: 0 }) });
      if (url.pathname.endsWith('/status-history')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 1, totalPages: 0 }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: '10000000-0000-4000-8000-000000000021', version: 1, status: 'open', sourceChannel: 'Phone', concern: 'Synthetic brake noise callback', reportedContact: null, reportedContactName: 'Synthetic private caller', reportedContactPhone: '+233000000001', reportedContactRelationship: 'unknown', reportedVehicle: 'Synthetic Sealion 06', reportedClient: null, nextAction: 'Call about the test drive', callbackDueAt: '2026-11-12T09:00:00.000Z', assignedTo: null, assignedToName: null, workOrderId: null }) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(new URL(`/sites/${persona.siteId}`, origin).href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { level: 1, name: persona.home === 'today' ? 'Today' : persona.home === 'sales-deliveries' ? 'Sales and deliveries' : /Staff account/ }).waitFor();
    if (persona.name === 'Head with Operator') {
      await page.getByRole('heading', { name: 'Latest diagnostic findings' }).waitFor();
      await page.getByText('The reported concern remains unresolved.', { exact: false }).first().waitFor();
      await page.getByText('Do not describe this system as cleared.', { exact: false }).first().waitFor();
      await page.getByText('Page 1 of 2 · 6 findings').waitFor();
      await page.getByRole('button', { name: 'Next' }).last().click();
      await page.getByText('Page 2 of 2 · 6 findings').waitFor();
    }
    if (persona.name === 'Head with Operator') {
      await page.getByRole('heading', { name: 'Callbacks due' }).waitFor();
      await page.getByRole('heading', { name: 'Overdue (1)' }).waitFor();
      await page.getByRole('heading', { name: 'Due today (1)' }).waitFor();
      const callbackLink = page.getByRole('link', { name: 'Call about the test drive' });
      assert.match(await callbackLink.getAttribute('href'), /request=10000000-0000-4000-8000-000000000021&filter=overdue/);
      assert.equal(await page.getByText('Synthetic private caller', { exact: true }).count(), 0, 'Today must not display caller contact details.');
      assert.equal(await page.getByText('+233000000001', { exact: true }).count(), 0, 'Today must not display caller phone numbers.');
    }
    if (persona.name === 'Technician') await page.getByText('No overdue callbacks or callbacks due today.').waitFor();
    if (persona.name === 'Advisor') await page.getByRole('button', { name: 'Try again' }).waitFor();
    for (const label of persona.visible) {
      if (label === 'My assigned tasks' || label === 'Finance setup')
        await page.locator('summary[aria-label="More sections"]').click();
      await page.getByRole('link', { name: new RegExp(label, 'i') }).first().waitFor();
    }
    for (const label of persona.hidden) {
      assert.equal(await page.getByRole('link', { name: new RegExp(label, 'i') }).count(), 0, `${persona.name} should not see ${label}.`);
    }
    if (persona.name === 'Advisor') {
      await page.getByRole('link', { name: 'Service history', exact: true }).click();
      await page.getByRole('heading', { name: 'Service history', exact: true }).waitFor();
      await page.getByLabel('Vehicle identification number (VIN)').fill('WVWZZZ1JZXW000001');
      await page.getByRole('button', { name: 'Find history' }).click();
      await page.getByText('EV-SR-00001', { exact: true }).waitFor();
      await page.getByText('Customer reported an unusual rear noise.', { exact: true }).waitFor();
      await page.getByText('Noise not heard during this test', { exact: true }).waitFor();
      await page.getByText('Recorded by Synthetic Technician', { exact: false }).waitFor();
      assert.equal(await page.getByText(/Synthetic historical purchaser/).count(), 0, 'Service history must not expose purchaser-at-delivery claims.');
      for (const width of [280, 320, 390, 540, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        assert(layout.document <= layout.viewport, `Service history overflows at ${width}px: ${JSON.stringify(layout)}`);
      }
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      assert.deepEqual(axe.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) })), [], 'Service history has accessibility violations.');
      await page.getByLabel('Vehicle identification number (VIN)').fill('WVWZZZ1JZXW000002');
      await page.getByRole('button', { name: 'Find history' }).click();
      await page.getByRole('heading', { name: 'No service history found at this centre' }).waitFor();
    }
    if (persona.roleCodes.includes('head-service-centre')) {
      for (const width of [320, 390, 673, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        assert(layout.document <= layout.viewport, `${persona.name} overflows at ${width}px: ${JSON.stringify(layout)}`);
      }
      assert.equal(await page.getByRole('link', { name: 'Today', exact: true }).getAttribute('aria-current'), 'page');
      const more = page.locator('summary[aria-label="More sections"]');
      await more.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('link', { name: /Service-centre overview/ }).waitFor();
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      assert.deepEqual(axe.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(node => node.target) })), [], 'Head Today has accessibility violations.');
      await page.getByRole('link', { name: 'Call about the test drive' }).click();
      await page.waitForURL(/\/requests\?request=.*&filter=overdue/);
      assert.equal(await page.getByLabel('Show requests').inputValue(), 'overdue', 'Opening a callback should preserve its queue filter.');
      await page.getByLabel('Show requests').selectOption('due-today');
      await page.waitForURL(/\/requests\?request=.*&filter=due-today/);
    }
    if (persona.name === 'Sales-only' || persona.name === 'Read-only Advisor') {
      if (persona.name === 'Sales-only') {
        await page.getByRole('link', { name: 'Requests and callbacks', exact: true }).click();
        await page.getByRole('heading', { name: 'Requests and callbacks', exact: true }).waitFor();
      }
      await page.goto(new URL(`/sites/${persona.siteId}/sales-deliveries`, origin).href);
      await page.waitForURL(new RegExp(`/sites/${persona.siteId}/today$`));
    }
    if (persona.name === 'Operator-only') {
      await page.goto(new URL(`/sites/${persona.siteId}/today`, origin).href);
      await page.waitForURL(new RegExp(`/sites/${persona.siteId}/staff/accounts$`));
    }
    if (persona.name === 'Head with Operator') {
      await page.goto(new URL(`/sites/${persona.siteId}/finance-setup`, origin).href);
      await page.waitForURL(new RegExp(`/sites/${persona.siteId}/today$`));
    }
    if (persona.name === 'Finance-only' || persona.name === 'Read-only Advisor') {
      await page.goto(new URL(`/sites/${persona.siteId}/finance-setup`, origin).href);
      await page.waitForURL(new RegExp(`/sites/${persona.siteId}/today$`));
    }
    assert.deepEqual(pageErrors, [], `${persona.name} raised browser errors.`);
    results.push({ persona: persona.name, result: 'VERIFIED' });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.route('**/api/v1/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { id: '10000000-0000-4000-8000-000000000010', displayName: 'Multi-site Advisor' }, sites: [
      { id: ids.workshop, name: 'Workshop', code: 'WS', timeZone: 'Africa/Accra', canWrite: true, roleCodes: ['service-advisor'] },
      { id: ids.sales, name: 'Sales', code: 'SL', timeZone: 'Africa/Accra', canWrite: true, roleCodes: ['sales-representative'] },
    ] }),
  }));
  await context.route('**/api/v1/owner/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: false }) }));
  await context.route('**/api/v1/sites/*/staff/account-provisioning-requests*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ requests: [], page: 1, pageSize: 25, totalCount: 0, totalPages: 0 }),
  }));
  await context.route(url => new URL(url).pathname.endsWith('/service-requests') && new URL(url).searchParams.has('filter'), route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [], page: 1, pageSize: 4, totalCount: 0, totalPages: 0 }),
  }));
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(new URL(`/sites/${ids.sales}`, origin).href, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Service centre').selectOption(ids.workshop);
  await page.waitForURL(new RegExp(`/sites/${ids.workshop}/today$`));
  await page.getByRole('heading', { name: 'Today' }).waitFor();
  await page.getByText('No overdue callbacks or callbacks due today.').waitFor();
  results.push({ persona: 'Multi-site selected-role landing', result: 'VERIFIED' });
  await context.close();

  process.stdout.write(`${JSON.stringify({ validation: 'passed', results }, null, 2)}\n`);
} finally {
  await browser.close();
}
