import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.VMMS_WEB_URL || 'http://127.0.0.1:5173';
assert(['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(baseUrl).hostname), 'This check only runs against a loopback VMMS web app.');

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const siteId = '3b7c6d6e-4c50-4b34-8ecf-7f92475f67de';
  let ownerAccessExpired = false;
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/session') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        authenticated: true,
        user: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic Staff Member' },
        sites: [{ id: siteId, name: 'Synthetic Service Centre', code: 'TEST', timeZone: 'Africa/Accra', canWrite: true, roleCodes: ['operations-admin'] }],
      }) });
    }
    if (pathname === '/api/v1/owner/session')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, audience: 'owner' }) });
    if (pathname === '/api/v1/owner/vehicles') {
      if (ownerAccessExpired)
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Owner access has expired.' } }) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ vehicles: [{ id: siteId, registration: 'QA-OWNER-02', make: 'Synthetic', model: 'Shared-session test vehicle' }] }) });
    }
    if (pathname === `/api/v1/sites/${siteId}/work-orders`)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 }, totals: { open: 0, held: 0, intakeDrafts: 0 }, asOf: new Date().toISOString() }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`${baseUrl}/?audience=owner`);
  await page.getByRole('heading', { name: 'Synthetic Shared-session test vehicle', exact: true }).waitFor();
  ownerAccessExpired = true;
  await context.setOffline(true);
  await page.getByText('Connect to the internet to view your vehicles.').waitFor();
  await context.setOffline(false);
  await page.getByRole('heading', { name: 'Vehicle owner sign in', exact: true }).waitFor();

  await page.goto(`${baseUrl}/?audience=staff`);
  await page.getByRole('heading', { level: 1, name: 'Work orders', exact: true }).waitFor();
  await page.getByText('Synthetic Staff Member', { exact: true }).first().waitFor();
  assert.deepEqual(errors, [], `Unexpected browser errors: ${errors.join('; ')}`);
  process.stdout.write('PASS: owner 401 after reconnect clears owner access and preserves the staff workspace.\n');
} finally {
  await browser.close();
}
