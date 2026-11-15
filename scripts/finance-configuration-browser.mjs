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

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv.includes('--run')) {
  process.stdout.write('Opt-in only: node --import tsx scripts/finance-configuration-browser.mjs --run\n');
  process.exit(0);
}
loadEnv({ path: resolve(root, '.env'), quiet: true });

const output = resolve(root, 'docs/verification/finance-configuration-draft-ui-2026-11-14');
const report = {
  recordedAt: new Date().toISOString(),
  scope: 'Disposable PostgreSQL database, synthetic staff grants, VMMS API and Finance setup browser page.',
  result: 'RUNNING',
  checks: [],
  limitations: ['Synthetic accounts and configuration only; this does not approve Finance policy or prove invoice, payment, receipt, email or G5 operations.'],
};
const pageErrors = [];
let runtime, vite, browser;
let managerPage;
let webOrigin = '';
let phase = 'startup';
let failed = false;

function check(name, details = {}) {
  report.checks.push({ name, details });
  process.stdout.write(`VERIFIED: ${name}\n`);
}

async function login(actor, context) {
  const bootstrap = await context.request.get(`${webOrigin}/api/v1/session`);
  assert.equal(bootstrap.status(), 200);
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf, 'Session initialization did not set a CSRF cookie.');
  const response = await context.request.post(`${webOrigin}/api/v1/session`, {
    headers: { Origin: webOrigin, 'X-CSRFToken': decodeURIComponent(csrf.value) },
    data: { username: actor.username, password: actor.password },
  });
  assert.equal(response.status(), 200, await response.text());
  assert.equal((await response.json()).authenticated, true);
}

function observeContext(context) {
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  context.on('page', tab => tab.on('pageerror', error => pageErrors.push(error.message)));
  void context.route('**/*', route => {
    if (new URL(route.request().url()).origin === webOrigin) return route.continue();
    pageErrors.push('unexpected-outbound-request');
    return route.abort('blockedbyclient');
  });
  return context;
}

async function postProposal(context, body) {
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf, 'Finance command has no CSRF cookie.');
  return context.request.post(`${webOrigin}/api/v1/sites/${runtime.siteId}/finance/configuration-drafts`, {
    headers: {
      Origin: webOrigin,
      'X-CSRFToken': decodeURIComponent(csrf.value),
      'Idempotency-Key': randomUUID(),
    },
    data: body,
  });
}

try {
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);

  phase = 'isolated-runtime';
  runtime = await startEvidenceBrowserRuntime({
    migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL,
    runtimeDatabaseUrl: process.env.DATABASE_URL,
    webOrigin: 'http://127.0.0.1:1',
  });
  await runtime.grantFinanceConfigurationForTest(runtime.actors.creator.id, 'manage');
  await runtime.grantFinanceConfigurationForTest(runtime.actors.peer.id, 'read');
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
  const noGrantContext = observeContext(await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }));
  await login(runtime.actors.teamLead, noGrantContext);
  const noGrantPage = await noGrantContext.newPage();
  await noGrantPage.goto(`${webOrigin}/sites/${runtime.siteId}/finance-setup`);
  await noGrantPage.getByRole('heading', { name: 'Finance setup', exact: true }).waitFor();
  await noGrantPage.getByText('Finance setup access has not been assigned to this account.', { exact: false }).waitFor();
  assert.equal(await noGrantPage.getByRole('button', { name: 'New proposal', exact: true }).count(), 0);
  const deniedResponse = await noGrantContext.request.get(`${webOrigin}/api/v1/sites/${runtime.siteId}/finance/configuration-drafts`);
  assert.equal(deniedResponse.status(), 403);
  check('Staff with no Finance grant receive a clear denial and no proposal data', { status: deniedResponse.status() });

  phase = 'manager-create-and-revise';
  const managerContext = observeContext(await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }));
  await login(runtime.actors.creator, managerContext);
  managerPage = await managerContext.newPage();
  await managerPage.goto(`${webOrigin}/sites/${runtime.siteId}/finance-setup`);
  await managerPage.getByRole('heading', { name: 'Finance setup', exact: true }).waitFor();
  await managerPage.getByRole('link', { name: 'Finance setup', exact: true }).waitFor();
  assert.equal(await managerPage.getByRole('link', { name: 'Finance setup', exact: true }).getAttribute('aria-current'), 'page');
  const apiList = await managerContext.request.get(`${webOrigin}/api/v1/sites/${runtime.siteId}/finance/configuration-drafts?page=1&pageSize=25`);
  assert.equal(apiList.status(), 200, await apiList.text());
  assert.equal(apiList.headers()['cache-control'], 'no-store');
  assert.equal((await apiList.json()).canManage, true);

  await managerPage.getByRole('button', { name: 'New proposal', exact: true }).focus();
  await managerPage.keyboard.press('Enter');
  const expectedLabels = [
    'Proposed business name', 'Registration reference', 'Proposed business address', 'Business contact reference',
    'Proposed currency code', 'Rate schedule reference', 'Tax treatment reference', 'Payment terms reference',
    'Invoice numbering rule', 'Receipt numbering rule', 'Invoice template', 'Receipt template',
    'Correction policy reference', 'Payment confirmation source', 'Payment evidence policy',
    'Showroom guarantee authority', 'Email sender setup reference', 'Verified client email policy',
    'Retention policy reference', 'Reason for this proposal or revision',
  ];
  for (const label of expectedLabels) await managerPage.getByLabel(label, { exact: false }).waitFor();
  await managerPage.getByLabel('Proposed business name', { exact: false }).fill('Synthetic workshop proposal');
  await managerPage.getByLabel('Proposed currency code', { exact: false }).fill('GHS');
  await managerPage.getByLabel('Rate schedule reference', { exact: false }).fill('synthetic-rate-schedule-v1');
  await managerPage.getByLabel('Reason for this proposal or revision', { exact: false }).fill('Synthetic browser proposal for the draft-only Finance setup page.');
  await managerPage.getByRole('button', { name: 'Add a source', exact: true }).click();
  await managerPage.getByLabel('Source 1 name', { exact: false }).fill('Synthetic review reference');
  await managerPage.getByLabel('Document or decision reference', { exact: false }).fill('synthetic-finance-review-1');
  await managerPage.getByRole('button', { name: 'Save proposal', exact: true }).focus();
  await managerPage.keyboard.press('Enter');
  await managerPage.getByText('Proposal revision 1 saved. It is not approved or in use.', { exact: true }).waitFor();
  const createdList = await managerContext.request.get(`${webOrigin}/api/v1/sites/${runtime.siteId}/finance/configuration-drafts?page=1&pageSize=25`);
  assert.equal(createdList.status(), 200, await createdList.text());
  const created = (await createdList.json()).items.find(item => item.content.legalEntity.proposedName === 'Synthetic workshop proposal');
  assert(created, 'The saved proposal could not be found in the manager list.');
  const draftShortId = created.draftId.slice(0, 8);
  let row = managerPage.locator('li').filter({ hasText: `Proposal ${draftShortId} · revision 1` });
  await row.getByText('Current revision', { exact: false }).waitFor();
  await row.getByRole('button', { name: 'View revision', exact: true }).click();
  await managerPage.locator('#finance-proposal-preview-heading').getByText(`Proposal ${draftShortId} · revision 1`, { exact: true }).waitFor();
  await managerPage.getByText('This proposal is not approved or in use.', { exact: true }).waitFor();
  await managerPage.getByRole('button', { name: 'Close details', exact: true }).click();
  await row.getByRole('button', { name: 'Create new revision', exact: true }).click();
  await managerPage.getByLabel('Proposed business name', { exact: false }).fill('Updated synthetic workshop proposal');
  await managerPage.getByLabel('Reason for this proposal or revision', { exact: false }).fill('Synthetic reason for revision two.');
  await managerPage.getByRole('button', { name: 'Save proposal', exact: true }).click();
  await managerPage.getByText('Proposal revision 2 saved. It is not approved or in use.', { exact: true }).waitFor();
  await managerPage.locator('li').filter({ hasText: `Proposal ${draftShortId} · revision 2` }).getByText('Current revision', { exact: false }).waitFor();
  await managerPage.locator('li').filter({ hasText: `Proposal ${draftShortId} · revision 1` }).getByText('Earlier revision', { exact: false }).waitFor();
  check('Manager creates a proposal, reviews its saved snapshot, and creates an immutable current revision', { revisions: 2 });

  phase = 'read-only-reviewer';
  const readerContext = observeContext(await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }));
  await login(runtime.actors.peer, readerContext);
  const readerPage = await readerContext.newPage();
  await readerPage.goto(`${webOrigin}/sites/${runtime.siteId}/finance-setup`);
  await readerPage.getByRole('heading', { name: 'Finance setup', exact: true }).waitFor();
  await readerPage.locator('li').filter({ hasText: `Proposal ${draftShortId} · revision 2` }).getByRole('button', { name: 'View revision', exact: true }).waitFor();
  assert.equal(await readerPage.getByRole('button', { name: 'New proposal', exact: true }).count(), 0);
  assert.equal(await readerPage.getByRole('button', { name: 'Create new revision', exact: true }).count(), 0);
  const readOnlyList = await readerContext.request.get(`${webOrigin}/api/v1/sites/${runtime.siteId}/finance/configuration-drafts`);
  assert.equal(readOnlyList.status(), 200);
  assert.equal((await readOnlyList.json()).canManage, false);
  check('Read-only Finance grant can inspect revisions but receives no edit controls', { canManage: false });

  phase = 'stale-conflict-and-pagination';
  await managerPage.locator('li').filter({ hasText: `Proposal ${draftShortId} · revision 2` }).getByRole('button', { name: 'Create new revision', exact: true }).click();
  await managerPage.getByLabel('Reason for this proposal or revision', { exact: false }).fill('Stale browser submission after another writer saves.');
  const latestList = await managerContext.request.get(`${webOrigin}/api/v1/sites/${runtime.siteId}/finance/configuration-drafts?page=1&pageSize=25`);
  assert.equal(latestList.status(), 200, await latestList.text());
  const latest = (await latestList.json()).items.find(item => item.draftId === created.draftId && item.revision === 2);
  assert(latest, 'The newest saved proposal revision was not returned by the authorized list.');
  const staleBody = {
    draftId: latest.draftId,
    expectedRevision: 2,
    revisionNote: 'Synthetic concurrent revision written by the verification harness.',
    content: { ...latest.content, currencyCode: 'USD' },
  };
  const competing = await postProposal(managerContext, staleBody);
  assert.equal(competing.status(), 200, await competing.text());
  await managerPage.getByRole('button', { name: 'Save proposal', exact: true }).click();
  await managerPage.getByText('This proposal changed after you opened it.', { exact: false }).waitFor();
  await managerPage.getByRole('button', { name: 'Cancel', exact: true }).click();
  await managerPage.locator('li').filter({ hasText: `Proposal ${draftShortId} · revision 3` }).getByText(/^Current revision/).waitFor();

  const emptyContent = {
    schemaVersion: 1,
    legalEntity: { proposedName: null, registrationReference: null, businessAddress: null, businessContactReference: null },
    currencyCode: null,
    rateScheduleReference: null,
    taxTreatmentReference: null,
    invoiceNumberingRuleReference: null,
    receiptNumberingRuleReference: null,
    paymentTermsReference: null,
    paymentVerificationSourceReference: null,
    paymentEvidencePolicyReference: null,
    showroomGuaranteeAuthorityReference: null,
    invoiceTemplateReference: null,
    receiptTemplateReference: null,
    emailSenderConfigurationReference: null,
    verifiedClientEmailPolicyReference: null,
    correctionPolicyReference: null,
    retentionPolicyReference: null,
    sourceReferences: [],
  };
  for (let index = 0; index < 25; index += 1) {
    const response = await postProposal(managerContext, {
      draftId: randomUUID(), expectedRevision: 0,
      revisionNote: `Synthetic pagination proposal ${index + 1}.`, content: emptyContent,
    });
    assert.equal(response.status(), 200, await response.text());
  }
  await managerPage.reload();
  await managerPage.getByRole('heading', { name: 'Finance proposals', exact: true }).waitFor();
  await managerPage.getByText('Page 1 of 2 · 28 revisions', { exact: true }).waitFor();
  await managerPage.getByRole('button', { name: 'Next page', exact: true }).click();
  await managerPage.getByText('Page 2 of 2 · 28 revisions', { exact: true }).waitFor();
  check('Stale browser edits are rejected and paginated proposal history works', { pages: 2, totalRevisions: 28 });

  phase = 'accessibility-responsive';
  await managerPage.getByRole('button', { name: 'Previous page', exact: true }).click();
  const accessibility = await new AxeBuilder({ page: managerPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(accessibility.violations, [], 'Finance setup page must pass automated WCAG 2.1 A/AA checks.');
  const layouts = [];
  for (const width of [280, 320, 390, 540, 768, 820, 1024, 1440]) {
    await managerPage.setViewportSize({ width, height: 900 });
    const geometry = await managerPage.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert(geometry.scrollWidth <= geometry.width, `Finance setup overflows at ${width}px.`);
    layouts.push(geometry);
  }
  await managerPage.setViewportSize({ width: 1440, height: 1000 });
  await managerPage.screenshot({ path: resolve(output, 'finance-setup-desktop.png'), fullPage: true });
  await managerPage.setViewportSize({ width: 390, height: 844 });
  await managerPage.screenshot({ path: resolve(output, 'finance-setup-phone.png'), fullPage: true });
  assert.deepEqual(pageErrors, [], 'Unexpected browser errors or outbound requests.');
  check('Finance setup passes automated WCAG 2.1 A/AA checks and fits phone, tablet, foldable and desktop widths', {
    accessibilityViolations: accessibility.violations.length,
    layouts,
  });
  report.result = 'VERIFIED';
} catch (error) {
  failed = true;
  report.result = 'FAILED';
  let visibleText = '';
  try { visibleText = (await managerPage?.locator('body').innerText())?.slice(0, 5000) ?? ''; } catch { /* The page may not have opened. */ }
  try { await managerPage?.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }); } catch { /* Preserve the original failure. */ }
  report.errors = [{ phase, kind: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : String(error), visibleText }];
  process.stderr.write(`FAILED: ${phase} (${error instanceof Error ? error.name : 'unknown'})\n${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  for (const resource of [browser, vite]) {
    try { await resource?.close(); } catch (error) {
      failed = true;
      report.result = 'FAILED';
      report.errors = [...(report.errors ?? []), { phase: 'cleanup', kind: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : String(error) }];
    }
  }
  try { await runtime?.close(); } catch (error) {
    failed = true;
    report.result = 'FAILED';
    report.errors = [...(report.errors ?? []), { phase: 'cleanup', kind: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message : String(error) }];
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (failed) process.exitCode = 1;
}
