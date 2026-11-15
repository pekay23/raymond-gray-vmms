import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';
import { startEvidenceBrowserRuntime } from '../apps/api/test/support/evidence-browser-runtime.ts';

if (!process.argv.includes('--run')) {
  console.log('Opt-in only: node --import tsx scripts/sales-deliveries-real-browser.mjs --run');
  process.exit(0);
}

const root = fileURLToPath(new URL('../', import.meta.url));
loadEnv({ path: resolve(root, '.env'), quiet: true });
const checks = [];
const output = resolve(root, 'docs/verification/sales-deliveries-browser');
let runtime, vite, browser, adminContext, salesContext, page, failed = false;

function check(name, facts = {}) {
  checks.push({ name, result: 'VERIFIED', ...facts });
  console.log(`VERIFIED: ${name}`);
}

async function login(context, actor, origin) {
  const initial = await context.request.get(`${origin}/api/v1/session`);
  assert.equal(initial.status(), 200);
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf, 'Session bootstrap did not issue CSRF.');
  const response = await context.request.post(`${origin}/api/v1/session`, {
    headers: { Origin: origin, 'X-CSRFToken': decodeURIComponent(csrf.value) },
    data: { username: actor.username, password: actor.password },
  });
  assert.equal(response.status(), 200, await response.text());
}

async function assignRole(context, origin, siteId, staffUserId, roleCode) {
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf);
  const response = await context.request.post(`${origin}/api/v1/sites/${siteId}/staff/role-placements`, {
    headers: { Origin: origin, 'X-CSRFToken': decodeURIComponent(csrf.value), 'Idempotency-Key': randomUUID() },
    data: { staffUserId, roleCode, reportsToPlacementId: null, expectedVersion: 0, reason: 'Synthetic Sales/PDI browser acceptance fixture' },
  });
  assert.equal(response.status(), 200, await response.text());
}

try {
  runtime = await startEvidenceBrowserRuntime({
    migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL,
    runtimeDatabaseUrl: process.env.DATABASE_URL,
    webOrigin: 'http://127.0.0.1:1',
  });
  vite = await createServer({
    root: resolve(root, 'apps/web'),
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: runtime.apiOrigin, changeOrigin: false } } },
  });
  await vite.listen();
  const origin = new URL(vite.resolvedUrls.local[0]).origin;
  runtime.setWebOrigin(origin);
  browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
  adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  salesContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  for (const context of [adminContext, salesContext]) context.setDefaultTimeout(15000);

  await login(adminContext, runtime.actors.creator, origin);
  await assignRole(adminContext, origin, runtime.siteId, runtime.actors.peer.id, 'sales-representative');
  await assignRole(adminContext, origin, runtime.siteId, runtime.actors.peer.id, 'pdi-observer');
  check('Head assigns Sales and PDI roles to a synthetic staff member through the application');

  await login(salesContext, runtime.actors.peer, origin);
  const session = await (await salesContext.request.get(`${origin}/api/v1/session`)).json();
  const site = session.sites.find(item => item.id === runtime.siteId);
  assert(site?.roleCodes.includes('sales-representative') && site?.roleCodes.includes('pdi-observer'));
  page = await salesContext.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${origin}/sites/${runtime.siteId}/sales-deliveries`);
  await page.getByRole('heading', { name: 'Sales and deliveries', exact: true }).waitFor();

  const vin = 'WVWZZZ1JZXW778808';
  await page.getByLabel('Vehicle VIN').fill(vin);
  await page.getByLabel('Vehicle VIN').press('Enter');
  await page.getByText('No matching vehicle is recorded at this service centre.', { exact: false }).waitFor();
  await page.getByLabel('Make').fill('Synthetic BYD');
  await page.getByLabel('Model').fill('Synthetic Sealion');
  await page.getByLabel('Registration (optional)').fill('SYN-PDI-01');
  await page.getByLabel('Powertrain (optional)').fill('Battery electric');
  await page.getByLabel('Preparation notes').fill('Synthetic source-based preparation notes for browser verification.');
  await page.getByLabel('Source reference', { exact: true }).fill('Synthetic preparation document');
  await page.getByRole('button', { name: 'Save preparation notes' }).click();
  await page.getByRole('status').getByText('Delivery preparation saved. No PDI approval was recorded.').waitFor();
  await page.getByText('Synthetic source-based preparation notes for browser verification.', { exact: true }).waitFor();
  await page.getByText('Technical PDI checklist is unavailable because no approved vehicle-specific procedure is configured. These notes do not authorize work or vehicle release.', { exact: true }).waitFor();
  check('Sales can record source-attributed preparation notes before an actual delivery without a work order or PDI approval');
  await page.getByLabel('Preparation notes').fill('Second synthetic preparation record for browser verification.');
  await page.getByLabel('Source reference', { exact: true }).fill('Second synthetic preparation source');
  await page.getByRole('button', { name: 'Save preparation notes' }).click();
  await page.getByRole('status').getByText('Delivery preparation saved. No PDI approval was recorded.').waitFor();
  await page.getByText('Second synthetic preparation record for browser verification.', { exact: true }).waitFor();
  check('The same vehicle can hold multiple preparation records without imposing an unapproved one-preparation rule');
  await page.getByLabel('Delivery date').fill('2026-11-13');
  await page.getByLabel('Registration at delivery (optional)').fill('SYN-PDI-01');
  await page.getByLabel('Purchaser at delivery (optional)').fill('Synthetic purchaser');
  await page.getByLabel('Source for purchaser name').fill('Synthetic delivery document');
  await page.getByLabel('Source reference (optional)').fill('Synthetic delivery source');
  await page.getByRole('button', { name: 'Save delivery' }).click();
  await page.getByRole('status').getByText('Delivery record saved.').waitFor();
  const preparationDeliverySelectors = page.getByLabel('Actual delivery to link');
  assert.equal(await preparationDeliverySelectors.count(), 2, 'Each preparation must have its own delivery selector.');
  await preparationDeliverySelectors.nth(0).selectOption({ label: 'Delivered 2026-11-13 · SYN-PDI-01' });
  assert.equal(await preparationDeliverySelectors.nth(1).inputValue(), '', 'Choosing a delivery for one preparation must not change another.');
  await page.getByRole('button', { name: 'Link delivery', exact: true }).first().click();
  await page.getByRole('status').getByText('Actual delivery linked to preparation.').waitFor();
  await page.getByText('Linked to an actual delivery record.', { exact: true }).waitFor();
  await page.getByLabel('Actual delivery to link').selectOption({ label: 'Delivered 2026-11-13 · SYN-PDI-01' });
  await page.getByRole('button', { name: 'Link delivery', exact: true }).click();
  await page.getByRole('status').getByText('Actual delivery linked to preparation.').waitFor();
  await page.getByText('Linked to an actual delivery record.', { exact: true }).nth(1).waitFor();
  await page.getByText('Purchaser at delivery: Synthetic purchaser', { exact: false }).waitFor();
  await page.getByText(/source: Synthetic delivery document/).waitFor();
  check('Sales page records dated delivery separately and links it only after explicit selection', { vin });

  await page.getByLabel('Area').fill('Infotainment');
  await page.getByLabel('Source reference (optional)').last().fill('Synthetic PDI sheet, row 4');
  await page.getByLabel('Observation').fill('Synthetic factual observation recorded for browser verification.');
  await page.getByRole('button', { name: 'Save PDI observation' }).click();
  await page.getByRole('status').getByText('PDI observation saved. It is not an approval or safety sign-off.').waitFor();
  await page.getByText('Synthetic factual observation recorded for browser verification.', { exact: true }).waitFor();
  assert.equal(await page.getByText(/PDI.*passed|passed.*PDI/i).count(), 0, 'PDI notes must not become a pass or approval label.');
  check('PDI note saves with source and remains an observation, not a pass or sign-off');

  await page.getByRole('button', { name: 'Correct this PDI note: Infotainment' }).click();
  await page.getByRole('heading', { name: 'Correct PDI observation', exact: true }).waitFor();
  await page.getByLabel('Observation').fill('Synthetic corrected observation checked against the source PDI sheet.');
  await page.getByLabel('Reason for correction').fill('The earlier wording was transcribed incorrectly.');
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await page.getByRole('status').getByText('Correction saved. The earlier PDI note is still in the history.').waitFor();
  await page.getByText('Synthetic factual observation recorded for browser verification.', { exact: true }).waitFor();
  await page.getByText('Synthetic corrected observation checked against the source PDI sheet.', { exact: true }).waitFor();
  await page.getByText('Correction to an earlier PDI note: The earlier wording was transcribed incorrectly.', { exact: true }).waitFor();
  check('PDI correction requires a reason and preserves both the original and correction');

  await page.reload();
  await page.getByRole('heading', { name: 'Delivery and PDI history', exact: true }).waitFor();
  await page.getByLabel('Vehicle VIN').fill(vin);
  await page.getByLabel('Vehicle VIN').press('Enter');
  await page.getByText(vin, { exact: true }).waitFor();
  await page.getByText('Synthetic factual observation recorded for browser verification.', { exact: true }).waitFor();
  await page.getByText('Synthetic corrected observation checked against the source PDI sheet.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Linked to an actual delivery record.', { exact: true }).count(), 2, 'Both source preparations must retain the explicit delivery link after reload.');
  await page.getByRole('button', { name: 'Use this delivery for PDI notes', exact: true }).click();
  await page.getByRole('heading', { name: 'Add PDI observation', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save delivery', exact: true }).count(), 0, 'An existing delivery cannot be recorded again from the vehicle search.');
  check('Delivery and PDI history persist after a browser reload');

  const viewports = [
    { width: 280, height: 653, name: 'compact phone' },
    { width: 320, height: 568, name: 'small phone' },
    { width: 344, height: 882, name: 'foldable cover' },
    { width: 390, height: 844, name: 'phone' },
    { width: 768, height: 1024, name: 'tablet portrait' },
    { width: 1024, height: 768, name: 'tablet landscape' },
    { width: 1440, height: 1000, name: 'desktop' },
    { width: 844, height: 390, name: 'phone landscape' },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const metrics = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const visibleControls = [...document.querySelectorAll('button,input,textarea,select')]
        .filter(element => element.getClientRects().length)
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });
      return { clientWidth: width, scrollWidth: document.documentElement.scrollWidth, visibleControls };
    });
    assert(metrics.scrollWidth <= metrics.clientWidth, `${viewport.name}: horizontal overflow ${JSON.stringify(metrics)}`);
    assert(metrics.visibleControls.every(control => control.left >= -1 && control.right <= metrics.clientWidth + 1), `${viewport.name}: clipped controls ${JSON.stringify(metrics)}`);
    check(`Sales/PDI page fits ${viewport.name} without horizontal overflow or clipped controls`, viewport);
  }

  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(output, 'sales-deliveries-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'sales-deliveries-phone.png'), fullPage: true });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(audit.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) })), []);
  check('Automated WCAG 2.1 A/AA scan passes after the persisted PDI entry');
  assert.deepEqual(pageErrors, [], 'Browser reported page errors.');
  check('Browser reported no uncaught page errors');

  const report = { recordedAt: new Date().toISOString(), scope: 'Synthetic disposable PostgreSQL, real VMMS API and browser Sales/PDI workflow.', browser: `Chromium ${browser.version()}`, checks, axeViolations: audit.violations.length };
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const [name, resource] of [['sales-page', page], ['sales-context', salesContext], ['admin-context', adminContext], ['browser', browser], ['vite', vite]]) {
    if (resource) try { await resource.close(); } catch (error) { failed = true; console.error(`Cleanup ${name} failed`, error); }
  }
  if (runtime) try { await runtime.close(); } catch (error) { failed = true; console.error('Cleanup database/runtime failed', error); }
  if (failed) process.exitCode = 1;
}
