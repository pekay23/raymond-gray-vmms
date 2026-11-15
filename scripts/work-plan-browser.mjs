import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { config as loadEnv } from 'dotenv';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';
import { z } from 'zod';
import { startEvidenceBrowserRuntime } from '../apps/api/test/support/evidence-browser-runtime.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv.includes('--run')) {
  process.stdout.write('Opt-in only: node --import tsx scripts/work-plan-browser.mjs --run\n');
  process.exit(0);
}
loadEnv({ path: resolve(root, '.env'), quiet: true });

const outputName = process.env.VMMS_BROWSER_OUTPUT_NAME || 'browser-work-plan';
assert(/^[a-z0-9][a-z0-9-]{0,63}$/.test(outputName), 'Browser output name must be a single safe directory name.');
const output = resolve(root, 'docs/verification', outputName);
const report = {
  recordedAt: new Date().toISOString(),
  scope: 'Synthetic, disposable PostgreSQL scenario with operations reviewer, assigned qualified team lead, receiving Supervisor, direct-report Technician, real VMMS API and browser work-plan/assigned-task UI.',
  result: 'RUNNING',
  checks: [],
  limitations: ['Physical-device, production role schedule, SOP and management approval remain untested.', 'This draft does not authorize repairs or satisfy G2.'],
};
const uuid = z.uuid();
const reportEvidenceName = 'synthetic-work-entry-evidence.pdf';
const reportEvidencePdf = Buffer.from('%PDF-1.4\nSynthetic service-report evidence\n%%EOF\n');
const taskEvidenceName = 'synthetic-task-upload-after-handoff.pdf';
const taskEvidencePdf = Buffer.from('%PDF-1.4\nSynthetic task-scoped evidence\n%%EOF\n');
const errors = [];
let runtime, vite, browser, reviewer, lead, supervisor, technician, page, reportEvidencePage;
let reportEvidenceId, taskEvidenceId;
let webOrigin = '';
let phase = 'startup';
let failed = false;

function check(name, facts = {}) {
  report.checks.push({ name, result: 'VERIFIED', ...facts });
  process.stdout.write(`VERIFIED: ${name}\n`);
}

async function responseJson(response, status = 200) {
  assert.equal(response.status(), status, `Unexpected HTTP ${response.status()} during ${phase}: ${await response.text()}`);
  return response.json();
}

async function newContext(timezoneId) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', ...(timezoneId ? { timezoneId } : {}) });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(45_000);
  context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === webOrigin) return route.continue();
    errors.push('unexpected-outbound-request');
    return route.abort('blockedbyclient');
  });
  return context;
}

async function assertAuthenticatedZoom(routeName, sourceContext, orderId, prepare) {
  if (process.argv.includes('--labor-only')) return;
  for (const zoom of [2, 4]) {
    const profile = await mkdtemp(resolve(tmpdir(), 'vmms-work-plan-zoom-'));
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
        errors.push(`unexpected-outbound-request-${routeName}-${zoom * 100}`);
        return route.abort('blockedbyclient');
      });
      const staffCookies = await sourceContext.cookies(`${webOrigin}/api/v1/session`);
      assert(staffCookies.some(cookie => cookie.name === 'vmms_session'), 'The source browser has no staff session cookie to transfer.');
      await zoomContext.addCookies(staffCookies);
      const zoomPage = zoomContext.pages()[0] || await zoomContext.newPage();
      zoomPage.setDefaultTimeout(15000);
      zoomPage.on('pageerror', error => errors.push(`${routeName} ${zoom * 100}%: ${error.message}`));
      await zoomPage.goto(`${webOrigin}/api/v1/session`);
      const session = await zoomPage.locator('body').innerText();
      assert.equal(JSON.parse(session).authenticated, true, `${routeName} ${zoom * 100}%: copied team-lead session is not authenticated.`);
      await zoomPage.goto(`${webOrigin}${orderPath(orderId)}`);
      await zoomPage.getByRole('main').waitFor();
      await prepare(zoomPage);
      const layout = await zoomPage.evaluate(() => {
        const controls = [...document.querySelectorAll('a[href],button,input,select,textarea')]
          .filter(element => element.getClientRects().length > 0)
          .map(element => {
            const box = element.getBoundingClientRect();
            const labels = 'labels' in element
              ? [...(element.labels ?? [])].map(label => label.textContent?.trim() ?? '').filter(Boolean).join(' ')
              : '';
            const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/)
              .map(id => document.getElementById(id)?.textContent?.trim() ?? '').filter(Boolean).join(' ');
            return {
              name: element.getAttribute('aria-label') || labelledBy || labels || element.textContent?.trim() || '',
              left: box.left,
              right: box.right,
              height: box.height,
              isButton: element instanceof HTMLButtonElement,
              disabled: element instanceof HTMLButtonElement && element.disabled,
            };
          });
        const clippedText = [...document.querySelectorAll('main h1,main h2,main h3,main label,main legend,main button,main a,main p,main [role="alert"],main [role="status"]')]
          .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).textOverflow !== 'ellipsis')
          .flatMap(element => {
            const bounds = element.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(element);
            return [...range.getClientRects()]
              .filter(fragment => fragment.width > 0 && (fragment.left < bounds.left - 1 || fragment.right > bounds.right + 1))
              .map(fragment => ({
                text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || element.tagName,
                element: element.tagName,
                bounds: { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height },
                fragment: { left: fragment.left, right: fragment.right, width: fragment.width, height: fragment.height },
                style: { whiteSpace: getComputedStyle(element).whiteSpace, overflowWrap: getComputedStyle(element).overflowWrap, wordBreak: getComputedStyle(element).wordBreak },
                ancestors: (() => { const result = []; let current = element.parentElement; while (current && result.length < 6) { const box = current.getBoundingClientRect(); const style = getComputedStyle(current); result.push({ tag: current.tagName, className: typeof current.className === 'string' ? current.className.slice(0, 100) : '', left: box.left, right: box.right, width: box.width, overflowX: style.overflowX }); current = current.parentElement; } return result; })(),
              }));
          });
        return {
          width: window.innerWidth,
          visualWidth: window.visualViewport?.width ?? window.innerWidth,
          compact: document.documentElement.dataset.vmmsCompactViewport === 'true',
          zoomCompact: document.documentElement.dataset.vmmsZoomCompactViewport === 'true',
          shellDisplay: getComputedStyle(document.querySelector('#workspace-shell')).display,
          navigationPosition: getComputedStyle(document.querySelector('#workspace-navigation')).position,
          dpr: window.devicePixelRatio,
          documentWidth: document.documentElement.scrollWidth,
          controls,
          clippedText,
        };
      });
      assert(Math.abs(layout.dpr - zoom) < 0.1, `${routeName}: native ${zoom * 100}% zoom was not applied.`);
      assert.equal(layout.compact, layout.visualWidth <= 640, `${routeName} ${zoom * 100}%: compact workspace mode does not match the visible viewport.`);
      assert.equal(layout.zoomCompact, layout.visualWidth <= 640 && layout.dpr >= 2, `${routeName} ${zoom * 100}%: zoom-specific compact navigation mode does not match the effective viewport.`);
      if (layout.compact) assert.equal(layout.shellDisplay, 'block', `${routeName} ${zoom * 100}%: compact workspace is still using the desktop rail grid.`);
      assert.equal(layout.navigationPosition, layout.zoomCompact ? 'static' : 'sticky', `${routeName} ${zoom * 100}%: navigation scroll behavior does not match the viewport and zoom mode.`);
      assert(layout.documentWidth <= layout.width + 1, `${routeName} ${zoom * 100}%: page overflows horizontally.`);
      assert(layout.controls.every(control => control.name.trim()), `${routeName} ${zoom * 100}%: a visible control has no accessible name.`);
      assert(layout.controls.every(control => control.left >= -1 && control.right <= layout.width + 1), `${routeName} ${zoom * 100}%: a visible control is clipped.`);
      assert.deepEqual(layout.clippedText, [], `${routeName} ${zoom * 100}%: visible text is clipped.`);
      const shortButtons = layout.controls.filter(control => control.isButton && !control.disabled && control.height < 43.5);
      assert.deepEqual(shortButtons, [], `${routeName} ${zoom * 100}%: an enabled button is below 44 CSS pixels.`);
      await zoomPage.keyboard.press('Tab');
      const focus = await zoomPage.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return null;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return { visible: element.matches(':focus-visible') && (style.outlineStyle !== 'none' || style.boxShadow !== 'none'), left: box.left, right: box.right };
      });
      assert(focus?.visible && focus.left >= -1 && focus.right <= layout.width + 1, `${routeName} ${zoom * 100}%: keyboard focus is not visible within the viewport.`);
      const navigationLinks = zoomPage.locator('#workspace-navigation nav[aria-label="Primary navigation"] a');
      const navigationLinkCount = await navigationLinks.count();
      assert(navigationLinkCount > 0, `${routeName} ${zoom * 100}%: workspace navigation has no links. ${JSON.stringify(await zoomPage.evaluate(async () => {
        const session = await fetch('/api/v1/session').then(response => response.json());
        return {
        url: location.pathname,
        roleCodes: session.sites?.[0]?.roleCodes,
        viewport: { width: innerWidth, visual: visualViewport?.width, dpr: devicePixelRatio },
        };
      }))}`);
      let hasHiddenNavigationLink = false;
      for (let index = 0; index < navigationLinkCount; index++) {
        if (!(await navigationLinks.nth(index).isVisible())) hasHiddenNavigationLink = true;
      }
      if (hasHiddenNavigationLink) {
        const more = zoomPage.locator('#workspace-navigation details');
        assert(await more.locator('summary').isVisible(), `${routeName} ${zoom * 100}%: More navigation control is hidden.`);
        await more.locator('summary').click();
      }
      for (let index = 0; index < navigationLinkCount; index++) {
        const link = navigationLinks.nth(index);
        assert(await link.isVisible(), `${routeName} ${zoom * 100}%: navigation link ${index + 1} is hidden.`);
        await link.click({ trial: true });
      }
      const signOut = zoomPage.getByRole('button', { name: 'Sign out', exact: true });
      assert(await signOut.isVisible(), `${routeName} ${zoom * 100}%: Sign out is hidden.`);
      await signOut.click({ trial: true });
      await zoomPage.screenshot({ path: resolve(output, `${routeName}-zoom-${zoom * 100}.png`), fullPage: true });
      check(`${routeName} form and workspace navigation pass native ${zoom * 100}% zoom, name, clipping, target, focus and reachability checks`);
    } finally {
      await zoomContext?.close();
      await rm(profile, { recursive: true, force: true });
    }
  }
}

async function login(context, actor) {
  const session = await context.request.get(`${webOrigin}/api/v1/session`);
  assert.equal(session.status(), 200);
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf, 'Session bootstrap did not set the CSRF cookie.');
  const signIn = await context.request.post(`${webOrigin}/api/v1/session`, {
    headers: { Origin: webOrigin, 'X-CSRFToken': decodeURIComponent(csrf.value) },
    data: { username: actor.username, password: actor.password },
  });
  assert.equal(signIn.status(), 200, await signIn.text());
  assert.equal((await signIn.json()).authenticated, true);
}

async function mutate(context, path, body) {
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf);
  return context.request.post(`${webOrigin}/api/v1${path}`, {
    headers: {
      Origin: webOrigin,
      'X-CSRFToken': decodeURIComponent(csrf.value),
      'Idempotency-Key': randomUUID(),
    },
    data: body,
  });
}

async function queueItems(context, queue) {
  const response = await context.request.get(`${webOrigin}/api/v1/sites/${runtime.siteId}/work-orders?queue=${queue}`);
  const body = await responseJson(response);
  return body.items;
}

function orderPath(orderId) {
  return `/sites/${runtime.siteId}/work-orders/${orderId}`;
}

async function buildWorkOrder() {
  const intake = await mutate(reviewer, `/sites/${runtime.siteId}/intake-drafts`, {
    client: { kind: 'new', partyKind: 'organisation', name: 'Synthetic Work-plan Client', phone: '', email: '' },
    owner: { kind: 'new', partyKind: 'person', name: 'Synthetic Work-plan Owner', phone: '', email: '' },
    visitContact: { kind: 'new', name: 'Synthetic Work-plan Contact', phone: '+233200000001', email: '' },
    vehicle: { kind: 'new', vin: 'WVWZZZ1JZXW000071', registration: 'PLAN-TEST-1', make: 'Synthetic', model: 'Fixture EV' },
    odometerKm: 12000,
    socPercent: 42,
    powertrainClass: 'EV',
    warrantyStatus: 'unknown',
    warrantyConfirmationNote: '',
    complaint: 'Synthetic work-plan browser verification.',
  });
  const created = await responseJson(intake);
  const orderId = uuid.parse(created.id);
  let current = await (await reviewer.request.get(`${webOrigin}/api/v1${orderPath(orderId)}`)).json();
  assert.equal(current.id, orderId);
  let complaintId = current.complaints?.[0]?.id;
  if (!complaintId) {
    const complaint = await mutate(reviewer, `${orderPath(orderId)}/complaints`, {
      expectedVersion: current.version,
      wording: 'Synthetic proposed tasks for work-plan ordering.',
    });
    current = await responseJson(complaint);
    complaintId = current.complaints.at(-1)?.id;
  }
  complaintId = uuid.parse(complaintId);
  for (const title of ['Synthetic inspection task', 'Synthetic preparation task']) {
    const task = await mutate(reviewer, `${orderPath(orderId)}/tasks`, {
      expectedVersion: current.version,
      complaintId,
      title,
    });
    current = await responseJson(task);
  }
  assert.equal(current.tasks.length, 2);

  reportEvidencePage = await reviewer.newPage();
  await reportEvidencePage.goto(`${webOrigin}${orderPath(orderId)}`);
  await reportEvidencePage.getByRole('heading', { name: 'Evidence', exact: true }).waitFor();
  await reportEvidencePage.getByLabel('Choose a file', { exact: true }).setInputFiles({
    name: reportEvidenceName,
    mimeType: 'application/pdf',
    buffer: reportEvidencePdf,
  });
  const reportEvidenceUpload = reportEvidencePage.waitForResponse(response =>
    response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/content'));
  await reportEvidencePage.getByRole('button', { name: 'Upload evidence', exact: true }).click();
  const reportEvidenceUploaded = await responseJson(await reportEvidenceUpload, 202);
  assert.equal(reportEvidenceUploaded.state, 'pending');
  assert.equal(await runtime.scanNext(), true, 'The report evidence scan did not run.');
  await reportEvidencePage.getByRole('button', { name: 'Refresh work order', exact: true }).click();
  await reportEvidencePage.getByText('Security check passed', { exact: true }).waitFor();
  const attachReportEvidence = reportEvidencePage.waitForResponse(response =>
    response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/v1${orderPath(orderId)}/evidence`);
  await reportEvidencePage.getByRole('button', { name: `Attach ${reportEvidenceName} to work order`, exact: true }).click();
  const attachedReportEvidence = await responseJson(await attachReportEvidence);
  const linkedReportEvidence = attachedReportEvidence.evidence.find(item => item.evidenceId === reportEvidenceUploaded.evidenceId);
  assert.equal(linkedReportEvidence?.state, 'accepted');
  assert(linkedReportEvidence?.attachedAt);
  await reportEvidencePage.getByText('Evidence attached to the work order.', { exact: true }).waitFor();
  reportEvidenceId = reportEvidenceUploaded.evidenceId;
  current = await responseJson(await reviewer.request.get(`${webOrigin}/api/v1${orderPath(orderId)}`));
  check('Accepted synthetic evidence is attached before Operations review and team-lead assignment');

  phase = 'source-report-entry-and-correction';
  await reportEvidencePage.getByRole('button', { name: 'Add earlier report', exact: true }).click();
  await reportEvidencePage.getByLabel('Report title', { exact: true }).fill('Synthetic workshop visit report');
  await reportEvidencePage.getByLabel('Date on the report', { exact: true }).fill('2026-11-12');
  await reportEvidencePage.getByLabel('Report type', { exact: true }).selectOption('workshop-report');
  await reportEvidencePage.getByLabel('Original report file').selectOption(reportEvidenceId);
  await reportEvidencePage.getByLabel('Short description for report item 1', { exact: true }).fill('Synthetic rear noise reported by the client');
  await reportEvidencePage.getByLabel('More detail for report item 1, if stated', { exact: true }).fill('The noise was described in the source note; no performer is identified.');
  await reportEvidencePage.getByRole('button', { name: 'Add report item', exact: true }).click();
  const secondSourceItem = reportEvidencePage.locator('fieldset').filter({ hasText: 'Report item 2' });
  await secondSourceItem.getByLabel('Type for report item 2', { exact: true }).selectOption('test');
  await reportEvidencePage.getByLabel('Outcome for report item 2', { exact: true }).selectOption('not-reproduced');
  await reportEvidencePage.getByLabel('Short description for report item 2', { exact: true }).fill('A road test did not reproduce the sound');
  await reportEvidencePage.getByLabel('More detail for report item 2, if stated', { exact: true }).fill('No unusual sound was heard during this test.');
  await reportEvidencePage.getByLabel('Related concern for report item 2', { exact: true }).selectOption('1');
  const sourceCreate = reportEvidencePage.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1${orderPath(orderId)}/source-reports`);
  await reportEvidencePage.getByRole('button', { name: 'Save report', exact: true }).click();
  const sourceCreated = await responseJson(await sourceCreate);
  const sourceCurrent = sourceCreated.reports.find(report => report.revision === 1);
  assert.equal(sourceCurrent?.sourceFile?.displayName, reportEvidenceName);
  assert.equal(sourceCurrent?.items.length, 2);
  assert.equal(sourceCurrent?.items[1]?.complaintReference, sourceCurrent?.items[0]?.complaintReference);
  await reportEvidencePage.getByText('Synthetic rear noise reported by the client', { exact: true }).waitFor();
  check('Accepted source file and structured report items are recorded with recorder attribution');

  await reportEvidencePage.getByRole('button', { name: 'Correct transcription', exact: true }).click();
  await reportEvidencePage.getByLabel('Why does this transcription need correcting?', { exact: true }).fill('Corrected after checking the source note.');
  await reportEvidencePage.getByLabel('Short description for report item 1', { exact: true }).fill('Synthetic rear and cabin noise reported by the client');
  assert.equal(await reportEvidencePage.getByLabel('Original report file').inputValue(), reportEvidenceId,
    'A correction should retain its source file association.');
  const sourceCorrection = reportEvidencePage.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1${orderPath(orderId)}/source-reports`);
  await reportEvidencePage.getByRole('button', { name: 'Save correction', exact: true }).click();
  const correctionResponse = await sourceCorrection.catch(async error => {
    const formText = await reportEvidencePage.locator('form').last().innerText().catch(() => 'Report form unavailable.');
    throw new Error(`${error.message}; report form: ${formText.slice(0, 1600)}`, { cause: error });
  });
  const correctedSource = await responseJson(correctionResponse);
  assert.equal(correctedSource.reports.length, 2);
  assert.equal(correctedSource.reports[1]?.revision, 2);
  assert.equal(correctedSource.reports[1]?.sourceFile?.displayName, reportEvidenceName);
  await reportEvidencePage.getByText(/Show earlier transcription versions/).click();
  await reportEvidencePage.getByText(/Correction reason: Corrected after checking the source note\./).first().waitFor();
  await reportEvidencePage.getByText('Synthetic rear noise reported by the client', { exact: true }).waitFor();
  check('Correction history remains readable and keeps the linked source file');

  const sourcePrintPage = await reviewer.newPage();
  await sourcePrintPage.goto(`${webOrigin}${orderPath(orderId)}/print`);
  await sourcePrintPage.getByRole('heading', { name: 'Earlier reports transcribed for this visit', exact: true }).waitFor();
  await sourcePrintPage.getByText(reportEvidenceName, { exact: true }).first().waitFor();
  await sourcePrintPage.getByText(`Transcribed by ${sourceCurrent.recordedBy}`, { exact: false }).first().waitFor();
  await sourcePrintPage.getByText('Superseded version 1', { exact: false }).waitFor();
  await sourcePrintPage.getByText('Synthetic rear and cabin noise reported by the client', { exact: true }).waitFor();
  check('Printable report shows selectable source text, recorder, file name and correction history');
  await sourcePrintPage.close();

  await reportEvidencePage.close();
  reportEvidencePage = undefined;

  const operationsItems = await queueItems(reviewer, 'operations');
  assert(operationsItems.some(item => item.id === orderId), 'New work must enter the Operations review and assignment queue.');
  assert.equal(current.workflowContext.stage, 'operations-review');
  assert.equal(current.workflowContext.dueAt, null);
  assert.equal(current.workflowContext.evidenceChecklist, 'awaiting-approved-sop');
  page = await reviewer.newPage();
  await page.goto(`${webOrigin}/sites/${runtime.siteId}/work-orders`);
  await page.getByLabel('Show jobs').selectOption('operations');
  await page.getByText(current.reference, { exact: true }).waitFor();
  await page.getByText(current.reference, { exact: true }).click();
  await page.getByRole('heading', { name: 'Operations review', exact: true }).waitFor();
  await page.getByRole('region', { name: 'Current job step' }).getByText('Review the job before assigning a team lead.', { exact: true }).waitFor();
  await assertAuthenticatedZoom('operations-review', reviewer, orderId, async zoomPage => {
    await zoomPage.locator('#operations-review-notes').waitFor();
    await zoomPage.getByRole('button', { name: 'Record Operations review', exact: true }).waitFor();
  });
  await page.locator('#operations-review-notes').fill('Synthetic operations review recorded through the browser.');
  await page.getByRole('button', { name: 'Record Operations review', exact: true }).click();
  const reviewToast = page.locator('.toast').filter({ hasText: 'Operations review recorded.' });
  await reviewToast.waitFor();
  await reviewToast.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.waitForTimeout(5200);
  assert(await reviewToast.isVisible(), 'An auto-dismiss timer must pause while the toast dismiss control has keyboard focus.');
  await reviewToast.getByRole('button', { name: 'Dismiss notification' }).click();
  await reviewToast.waitFor({ state: 'detached' });
  check('Toast notification stays available while focused and dismisses on request');
  await page.getByText('Operations review recorded.', { exact: true }).waitFor();
  await page.getByText('This review covers the current work-order version and is ready for team-lead assignment.', { exact: true }).waitFor();
  await page.getByRole('region', { name: 'Current job step' }).getByText('Assign a qualified team lead.', { exact: true }).waitFor();

  await assertAuthenticatedZoom('operations-assignment', reviewer, orderId, async zoomPage => {
    await zoomPage.getByLabel('Team lead', { exact: true }).waitFor();
    await zoomPage.getByLabel('Assignment reason', { exact: true }).waitFor();
    await zoomPage.getByRole('button', { name: 'Assign team lead', exact: true }).waitFor();
  });
  const teamLeadSelect = page.getByLabel('Team lead', { exact: true });
  const teamLeadOptions = await teamLeadSelect.locator('option').allTextContents();
  assert(teamLeadOptions.every(label => !/[A-Z]+-(TEAM-LEAD|SUPERVISOR)/.test(label)),
    `Internal qualification codes must not appear in the team-lead choices: ${teamLeadOptions.join(', ')}`);
  check('Team-lead choices show staff names without internal qualification codes');
  await teamLeadSelect.selectOption(runtime.actors.teamLead.id);
  await page.getByLabel('Assignment reason', { exact: true }).fill('Synthetic qualified EV team-lead assignment recorded through the browser.');
  await page.getByRole('button', { name: 'Assign team lead', exact: true }).click();
  const concernTrigger = page.locator('#open-complaint-form');
  await concernTrigger.click();
  await page.getByRole('button', { name: 'Close form', exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-complaint-form',
    'Closing the concern form must return keyboard focus to its opening control.');

  await page.locator('#open-complaint-form').click();
  await page.locator('#new-complaint').fill('Synthetic value for validation association test.');
  const complaintRoute = '**/api/v1/sites/*/work-orders/*/complaints';
  await page.route(complaintRoute, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const requestBody = route.request().postDataJSON();
    const response = await route.fetch({ postData: JSON.stringify({ ...requestBody, wording: '' }) });
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Save concern', exact: true }).click();
  const concernError = page.locator('#new-complaint-error');
  await concernError.waitFor();
  assert.equal(await page.locator('#new-complaint').getAttribute('aria-invalid'), 'true');
  assert((await page.locator('#new-complaint').getAttribute('aria-describedby'))?.split(/\s+/).includes('new-complaint-error'),
    'A server validation error must be described by the matching concern field.');
  await page.unroute(complaintRoute);
  check('Server validation errors on work-order forms are linked to their matching control');
  await page.getByRole('button', { name: 'Close form', exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-complaint-form');

  const factsUrl = `${webOrigin}/api/v1/sites/${runtime.siteId}/work-orders/${orderId}/intake-facts`;
  await page.route(factsUrl, route => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'VALIDATION', message: 'Check the highlighted fields and try again.', fields: { 'fact.description': ['Describe what was observed.'] } } }),
  }));
  await page.getByLabel('Vehicle area', { exact: true }).fill('Synthetic test area');
  await page.getByLabel('What was observed or reported?', { exact: true }).fill('Synthetic observation for accessibility review.');
  await page.getByRole('button', { name: 'Record observation', exact: true }).click();
  const factError = page.locator('#intake-fact-description-error');
  await factError.waitFor();
  assert.equal(await page.locator('#intake-fact-description').getAttribute('aria-invalid'), 'true');
  assert((await page.locator('#intake-fact-description').getAttribute('aria-describedby'))?.split(/\s+/).includes('intake-fact-description-error'));
  await page.unroute(factsUrl);
  check('Reception observation server errors are linked to their matching field');

  const evidenceIntentUrl = `${webOrigin}/api/v1/sites/${runtime.siteId}/work-orders/${orderId}/evidence/intents`;
  await page.route(evidenceIntentUrl, route => route.fulfill({
    status: 413,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'FILE_TOO_LARGE', message: 'Choose a smaller file.', fields: { expectedBytes: ['File size exceeds the permitted limit.'] } } }),
  }));
  await page.locator('#work-order-evidence-file').setInputFiles({
    name: 'synthetic-oversize.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nSynthetic accessibility fixture\n%%EOF\n'),
  });
  await page.getByRole('button', { name: 'Upload evidence', exact: true }).click();
  await page.locator('#evidence-upload-error [role="alert"]').waitFor();
  assert.equal(await page.locator('#work-order-evidence-file').getAttribute('aria-invalid'), 'true');
  assert((await page.locator('#work-order-evidence-file').getAttribute('aria-describedby'))?.split(/\s+/).includes('evidence-upload-error'));
  await page.unroute(evidenceIntentUrl);
  await page.locator('#work-order-evidence-file').setInputFiles([]);
  check('Evidence upload errors are announced and described by the file picker');

  await assertAuthenticatedZoom('add-concern', reviewer, orderId, async zoomPage => {
    await zoomPage.getByRole('button', { name: 'Add concern', exact: true }).click();
    await zoomPage.getByLabel("Customer's wording", { exact: true }).waitFor();
  });
  await assertAuthenticatedZoom('plan-task', reviewer, orderId, async zoomPage => {
    await zoomPage.getByRole('button', { name: 'Plan task', exact: true }).click();
    await zoomPage.getByLabel('Proposed task', { exact: true }).waitFor();
  });
  await assertAuthenticatedZoom('report-hold', reviewer, orderId, async zoomPage => {
    await zoomPage.getByRole('button', { name: 'Report hold', exact: true }).click();
    await zoomPage.getByLabel('What does this hold apply to?', { exact: true }).waitFor();
  });
  await assertAuthenticatedZoom('intake-facts', reviewer, orderId, async zoomPage => {
    await zoomPage.getByRole('region', { name: 'Vehicle check-in notes' }).waitFor();
    await zoomPage.getByLabel('What are you recording?', { exact: true }).waitFor();
  });
  await assertAuthenticatedZoom('work-order-evidence', reviewer, orderId, async zoomPage => {
    await zoomPage.getByRole('region', { name: 'Evidence' }).waitFor();
    await zoomPage.getByLabel('Choose a file', { exact: true }).waitFor();
  });

  await page.locator('#open-diagnostic-form').click();
  await page.getByLabel('Observed condition', { exact: true }).fill('Synthetic accessibility observation.');
  await page.getByRole('button', { name: 'Add observation', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Added condition observation.' }).waitFor();
  await page.getByRole('button', { name: 'Remove observation 1', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Removed condition observation.' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'add-observation',
    'Removing the last diagnostic observation must return focus to Add observation.');
  await page.getByRole('button', { name: 'Close form', exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'open-diagnostic-form',
    'Closing the diagnostic form must return keyboard focus to its opening control.');
  check('Work-order form close and diagnostic observation add/remove preserve focus and announce changes through live status regions');

  const assignmentPanel = page.getByRole('region', { name: 'Team-lead assignment' });
  await assignmentPanel.getByText('Synthetic browser-team-lead', { exact: true }).waitFor();
  await assignmentPanel.getByText('Synthetic qualified EV team-lead assignment recorded through the browser.', { exact: true }).waitFor();
  const persisted = await (await reviewer.request.get(`${webOrigin}/api/v1${orderPath(orderId)}`)).json();
  assert.equal(persisted.workflowContext.stage, 'team-lead-work-plan');
  assert.equal(persisted.workflowContext.responsibility.name, 'Synthetic browser-team-lead');
  assert.equal(persisted.operationsReview.reviewedByName, 'Synthetic browser-creator');
  assert.equal(persisted.operationsReview.notes, 'Synthetic operations review recorded through the browser.');
  assert.equal(persisted.teamLeadAssignment.leadUserId, runtime.actors.teamLead.id);
  assert.equal(persisted.teamLeadAssignment.reason, 'Synthetic qualified EV team-lead assignment recorded through the browser.');
  check('Authorized Operations user records current review and qualified lead assignment through the real browser UI; persisted detail preserves reviewer, notes, lead and reason', {
    orderId,
    reviewerId: runtime.actors.creator.id,
    leadUserId: runtime.actors.teamLead.id,
  });
  assert(!(await queueItems(reviewer, 'operations')).some(item => item.id === orderId), 'Assigned work must leave the Operations queue.');
  assert((await queueItems(lead, 'team-lead')).some(item => item.id === orderId), 'The assigned team lead must see the work order in their queue.');
  assert(!(await queueItems(reviewer, 'team-lead')).some(item => item.id === orderId), 'The queue must not use a caller-supplied staff identity.');
  await page.goto(`${webOrigin}/sites/${runtime.siteId}/intake`);
  await page.getByLabel('Find an existing paying client').fill('Synthetic Work-plan Client');
  await page.getByRole('button', { name: 'Search paying clients', exact: true }).click();
  const existingClient = page.getByRole('button').filter({ hasText: 'Synthetic Work-plan Client' }).first();
  await existingClient.waitFor();
  await existingClient.click();
  await page.getByRole('status').filter({ hasText: 'Selected paying client Synthetic Work-plan Client.' }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'selected-client',
    'Selecting an existing client must announce the choice and focus the selected-client summary.');
  check('Selecting a prior paying client in intake returns focus to its summary and announces the selection');
  await page.locator('#booking-powertrain-class').selectOption('EV');
  await page.locator('form').first().evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const vinError = page.locator('#vehicle-vin-error');
  await vinError.waitFor();
  assert.equal(await page.locator('#vehicle-vin').getAttribute('aria-invalid'), 'true');
  assert((await page.locator('#vehicle-vin').getAttribute('aria-describedby'))?.split(/\s+/).includes('vehicle-vin-error'),
    'A server validation error must be described by the matching VIN error text.');
  assert((await vinError.innerText()).length > 0, 'The associated field error must be visible.');
  check('Server validation errors appear beside the matching intake field with invalid state and a description association');
  return { orderId, reportEvidenceId, taskIds: current.tasks.map(task => task.id), taskTitles: current.tasks.map(task => task.title) };
}

async function assertResponsive() {
  const viewports = [
    { width: 280, height: 653 },
    { width: 320, height: 568 },
    { width: 344, height: 882 },
    { width: 390, height: 844 },
    { width: 540, height: 720 },
    { width: 712, height: 853 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 882, height: 344 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  for (const { width, height } of viewports) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector('#work-plan-title')?.closest('section');
      return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      panel: (() => {
        const element = panel;
        const rect = element?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, width: rect.width } : null;
      })(),
      controls: [...(panel?.querySelectorAll('a,button,input,select,textarea') ?? [])]
        .filter(element => element.getClientRects().length > 0)
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
            left: rect.left, right: rect.right, width: rect.width, height: rect.height };
        }),
      overflowers: [...document.body.querySelectorAll('*')]
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { tag: element.tagName, id: element.id, className: typeof element.className === 'string' ? element.className : '',
            left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), scrollWidth: element.scrollWidth };
        })
        .filter(element => element.left < -1 || element.right > window.innerWidth + 1 || element.scrollWidth > element.width + 1)
        .slice(0, 20),
    }; });
    assert.equal(geometry.documentWidth, width, `${width}px work-plan page overflowed: ${JSON.stringify(geometry.overflowers)}`);
    assert(geometry.panel && geometry.panel.left >= -1 && geometry.panel.right <= width + 1, `${width}px work-plan panel is clipped.`);
    assert(geometry.controls.length > 0, `${width}px work-plan panel has no visible controls.`);
    for (const control of geometry.controls) {
      assert(control.width > 0 && control.height > 0 && control.left >= -1 && control.right <= width + 1,
        `${width}px work-plan control is missing or clipped: ${control.name}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function assertQueueResponsive(target = page, expectedQueue = 'team-lead') {
  const viewports = [
    { width: 280, height: 653 },
    { width: 320, height: 568 },
    { width: 344, height: 882 },
    { width: 390, height: 844 },
    { width: 540, height: 720 },
    { width: 712, height: 853 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 882, height: 344 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  for (const { width, height } of viewports) {
    await target.setViewportSize({ width, height });
    const expectedTitle = expectedQueue === 'team-lead'
      ? 'Jobs assigned to me as team lead'
      : 'Jobs assigned to me';
    try {
      await target.waitForFunction(({ expectedQueue, expectedTitle }) => {
        const section = document.querySelector('section[aria-labelledby="queue-title"]');
        const filter = document.querySelector('#queue-filter');
        return filter instanceof HTMLSelectElement && filter.value === expectedQueue
          && document.querySelector('#queue-title')?.textContent?.trim() === expectedTitle
          && section?.getAttribute('aria-busy') === 'false'
          && Boolean(document.querySelector('#queue-search'));
      }, { expectedQueue, expectedTitle });
    } catch (error) {
      const state = await target.evaluate(({ expectedQueue, expectedTitle }) => ({
        url: location.pathname + location.search,
        filter: (() => {
          const element = document.querySelector('#queue-filter');
          return element instanceof HTMLSelectElement ? element.value : null;
        })(),
        title: document.querySelector('#queue-title')?.textContent?.trim() ?? null,
        expectedQueue,
        expectedTitle,
        busy: document.querySelector('section[aria-labelledby="queue-title"]')?.getAttribute('aria-busy') ?? null,
        main: document.querySelector('#workspace-main')?.innerText.slice(0, 500) ?? null,
      }), { expectedQueue, expectedTitle });
      if (error instanceof Error) error.message += `\nQueue state at ${width}px: ${JSON.stringify(state)}`;
      throw error;
    }
    const geometry = await target.evaluate(() => {
      const bounds = element => {
        const rect = element?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, width: rect.width, height: rect.height } : null;
      };
      const controls = [...(document.querySelector('#workspace-main')?.querySelectorAll('a,button,input,select,textarea') ?? [])]
        .filter(element => element.getClientRects().length > 0)
        .map(element => ({ name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
          ...bounds(element) }));
      return {
        url: window.location.pathname + window.location.search,
        mainExcerpt: document.querySelector('#workspace-main')?.innerText.slice(0, 240),
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        queueFilter: bounds(document.querySelector('#queue-filter')),
        search: bounds(document.querySelector('#queue-search')),
        controls,
      };
    });
    assert.equal(geometry.documentWidth, width, `${width}px work queue page overflowed.`);
    for (const control of [geometry.queueFilter, geometry.search]) {
      assert(control && control.width > 0 && control.left >= -1 && control.right <= width + 1,
        `${width}px work queue control is missing or clipped: ${JSON.stringify({ control, geometry })}`);
    }
    for (const control of geometry.controls) {
      assert(control.width > 0 && control.height > 0 && control.left >= -1 && control.right <= width + 1,
        `${width}px visible work queue control is clipped: ${control.name}`);
    }
  }
  await target.setViewportSize({ width: 1440, height: 1000 });
}

try {
  await mkdir(output, { recursive: true });
  await unlink(resolve(output, 'failure.png')).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);

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
  report.browser = `Chromium ${browser.version()}`;
  reviewer = await newContext();
  lead = await newContext();
  await login(reviewer, runtime.actors.creator);
  await login(lead, runtime.actors.teamLead);
  const fixture = await buildWorkOrder();

  phase = 'assigned-lead';
  page = await lead.newPage();
  await page.goto(`${webOrigin}/sites/${runtime.siteId}/work-orders`);
  await page.getByRole('link', { name: 'Register a vehicle visit', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#queue-filter')?.querySelectorAll('option').length === 8);
  const queueOptions = await page.getByLabel('Show jobs').locator('option').allTextContents();
  assert(queueOptions.includes('Jobs assigned to me as team lead'), JSON.stringify(queueOptions));
  assert(queueOptions.includes('Jobs assigned to me'), JSON.stringify(queueOptions));
  check('Job filter and intake action use plain-language labels');
  await page.getByLabel('Show jobs').selectOption('team-lead');
  await page.waitForFunction(() => {
    const section = document.querySelector('section[aria-labelledby="queue-title"]');
    return document.querySelector('#queue-filter')?.value === 'team-lead'
      && document.querySelector('#queue-title')?.textContent?.trim() === 'Jobs assigned to me as team lead'
      && section?.getAttribute('aria-busy') === 'false'
      && Boolean(document.querySelector('#queue-search'));
  });
  const assigned = await lead.request.get(`${webOrigin}/api/v1${orderPath(fixture.orderId)}`);
  const assignedOrder = await responseJson(assigned);
  await page.getByText(assignedOrder.reference, { exact: true }).waitFor();
  await assertQueueResponsive();
  await page.goto(`${webOrigin}${orderPath(fixture.orderId)}`);
  await page.getByRole('link', { name: 'Print service report', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Workshop service report' }).waitFor();
  await page.getByText(assignedOrder.reference, { exact: true }).waitFor();
  const sectionNumbers = await page.locator('.work-order-print article > section h2 span').allTextContents();
  assert.deepEqual(sectionNumbers, sectionNumbers.map((_, index) => String(index + 1).padStart(2, '0')),
    `Visible report sections should be numbered without gaps: ${sectionNumbers.join(', ')}.`);
  const reportAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(reportAudit.violations.map(({ id, impact }) => ({ id, impact })), [],
    `Workshop Service Report has automated accessibility violations: ${JSON.stringify(reportAudit.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(({ target }) => target) })))}.`);
  check('Workshop Service Report passes automated WCAG 2.1 A/AA checks before print');
  await page.emulateMedia({ media: 'print' });
  const printLayout = await page.evaluate(() => ({
    printMode: window.matchMedia('print').matches,
    report: getComputedStyle(document.querySelector('.work-order-print')).visibility,
    reportText: getComputedStyle(document.querySelector('.work-order-print h1')).visibility,
    applicationNavigation: getComputedStyle(document.getElementById('workspace-navigation')).visibility,
    workspaceHeader: getComputedStyle(document.querySelector('#workspace-main')?.parentElement).visibility,
    toolbar: getComputedStyle(document.querySelector('.work-order-print-toolbar')).display,
    disclaimer: document.querySelector('.work-order-print footer')?.textContent,
  }));
  assert.equal(printLayout.printMode, true, JSON.stringify(printLayout));
  assert.equal(printLayout.report, 'visible', JSON.stringify(printLayout));
  assert.equal(printLayout.reportText, 'visible', JSON.stringify(printLayout));
  assert.equal(printLayout.applicationNavigation, 'hidden', JSON.stringify(printLayout));
  assert.equal(printLayout.workspaceHeader, 'hidden', JSON.stringify(printLayout));
  assert.equal(printLayout.toolbar, 'none', JSON.stringify(printLayout));
  assert.match(printLayout.disclaimer, /Not a work authorization/);
  const printable = await page.pdf({ printBackground: true });
  assert.equal(Buffer.from(printable).subarray(0, 5).toString('ascii'), '%PDF-');
  assert(Buffer.from(printable).length > 4000, 'The purpose-built report should produce substantive PDF content.');
  const printTemp = await mkdtemp(resolve(tmpdir(), 'vmms-work-order-print-'));
  try {
    const basePdf = resolve(printTemp, 'work-order-summary.pdf');
    await writeFile(basePdf, printable);
    const extracted = spawnSync('pdftotext', ['-layout', basePdf, '-'], { encoding: 'utf8', windowsHide: true });
    assert.equal(extracted.error, undefined, `Install Poppler's pdftotext to verify selectable PDF text: ${extracted.error?.message ?? ''}`);
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const expected of [assignedOrder.reference, assignedOrder.client.name, assignedOrder.vehicle.registration, 'Customer concerns and planned tasks', 'Recorded findings, tests and work', 'Not a work authorization']) {
      assert(extracted.stdout.includes(expected), `PDF text is missing the report field ${JSON.stringify(expected)}.`);
    }
    assert(!extracted.stdout.includes('Primary navigation'), 'Application chrome must not be included in the report PDF.');

    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.className = 'print-section whitespace-pre-wrap text-sm leading-6';
      paragraph.textContent = `PAGINATION START ${'Synthetic long report note for pagination and selectable text. '.repeat(900)} PAGINATION END`;
      document.querySelector('.work-order-print footer')?.before(paragraph);
    });
    const longPdf = resolve(printTemp, 'work-order-summary-long.pdf');
    await writeFile(longPdf, await page.pdf({ printBackground: true }));
    const properties = spawnSync('pdfinfo', [longPdf], { encoding: 'utf8', windowsHide: true });
    assert.equal(properties.error, undefined, `Install Poppler's pdfinfo to verify report pagination: ${properties.error?.message ?? ''}`);
    assert.equal(properties.status, 0, properties.stderr);
    const pageCount = Number(properties.stdout.match(/^Pages:\s+(\d+)$/m)?.[1]);
    assert(pageCount > 1, `Long report content should paginate across pages; got ${pageCount}.`);
    const longText = spawnSync('pdftotext', ['-layout', longPdf, '-'], { encoding: 'utf8', windowsHide: true });
    assert.equal(longText.status, 0, longText.stderr);
    assert(longText.stdout.includes('PAGINATION START') && longText.stdout.includes('PAGINATION END'), 'Long report text must remain selectable through the final page.');
    const firstPage = resolve(output, 'work-order-summary-pagination-first.png');
    const lastPage = resolve(output, 'work-order-summary-pagination-last.png');
    const firstRender = spawnSync('pdftoppm', ['-f', '1', '-l', '1', '-png', '-scale-to', '1200', longPdf, resolve(printTemp, 'first-page')], { encoding: 'utf8', windowsHide: true });
    assert.equal(firstRender.error, undefined, `Install Poppler's pdftoppm to render report pages for visual inspection: ${firstRender.error?.message ?? ''}`);
    assert.equal(firstRender.status, 0, firstRender.stderr);
    const lastRender = spawnSync('pdftoppm', ['-f', String(pageCount), '-l', String(pageCount), '-png', '-scale-to', '1200', longPdf, resolve(printTemp, 'last-page')], { encoding: 'utf8', windowsHide: true });
    assert.equal(lastRender.error, undefined, `Install Poppler's pdftoppm to render report pages for visual inspection: ${lastRender.error?.message ?? ''}`);
    assert.equal(lastRender.status, 0, lastRender.stderr);
    await copyFile(resolve(printTemp, 'first-page-01.png'), firstPage);
    await copyFile(resolve(printTemp, `last-page-${String(pageCount).padStart(2, '0')}.png`), lastPage);
    check(`Work-order summary PDF keeps selectable report fields, excludes application chrome, and paginates long text across ${pageCount} pages`);
  } finally {
    await rm(printTemp, { recursive: true, force: true });
  }
  await page.emulateMedia({ media: 'screen' });
  check('Purpose-built workshop service report prints its recorded details while excluding the workspace and report controls');
  await page.goto(`${webOrigin}${orderPath(fixture.orderId)}`);
  const plan = page.getByRole('region', { name: "Team lead's work plan" });
  await page.getByRole('region', { name: 'Current job step' }).getByText('Prepare the work plan.', { exact: true }).waitFor();
  await plan.waitFor();
  await page.getByText('Draft required', { exact: true }).waitFor();
  const handoff = page.getByRole('region', { name: 'Assign a supervisor' });
  await handoff.getByText('Prepare an up-to-date work-plan draft before assigning a supervisor. Any change to the plan or job requires a new handover.', { exact: true }).waitFor();
  assert.equal(await handoff.getByRole('button', { name: 'Assign supervisor', exact: true }).count(), 0,
    'Supervisor handoff must remain unavailable until the lead saves a current plan.');
  check('Supervisor assignment is gated until the current assigned lead saves a plan');
  await assertAuthenticatedZoom('team-lead-work-plan', lead, fixture.orderId, async zoomPage => {
    await zoomPage.getByLabel('Reason for this plan').waitFor();
    await zoomPage.locator('section[aria-labelledby="work-plan-title"] form').waitFor();
  });
  await page.getByLabel('Reason for this plan').fill('Inspect first, then prepare the vehicle for the next qualified technician.');
  const secondReference = await page.getByRole('button', { name: /Move .* up/ }).last().getAttribute('aria-label');
  assert(secondReference);
  await page.getByRole('button', { name: secondReference, exact: true }).click();
  const checks = plan.getByRole('checkbox');
  assert.equal(await checks.count(), 2);
  assert.equal(await checks.nth(0).isChecked(), true);
  assert.equal(await checks.nth(1).isChecked(), true);
  await assertResponsive();
  const save = page.getByRole('button', { name: 'Save work-plan draft', exact: true });
  const versionBump = await mutate(lead, `${orderPath(fixture.orderId)}/complaints`, {
    expectedVersion: assignedOrder.version,
    wording: 'Synthetic update used to verify stale plan recovery.',
  });
  await responseJson(versionBump);
  await save.click();
  const conflict = page.getByRole('alert').getByText('Review the current work order before retrying. Your form entries have been kept.', { exact: true });
  await conflict.waitFor();
  await page.getByText('Synthetic update used to verify stale plan recovery.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Reason for this plan').inputValue(),
    'Inspect first, then prepare the vehicle for the next qualified technician.');
  const revisionUrl = `${webOrigin}/api/v1${orderPath(fixture.orderId)}/work-plan-revisions`;
  let revisionRequestCount = 0;
  let firstCommandId;
  let retryCommandId;
  let firstPayload;
  let retryPayload;
  let firstCommit;
  await page.route(revisionUrl, async route => {
    revisionRequestCount += 1;
    const request = route.request();
    assert.equal(request.method(), 'POST');
    const commandId = request.headers()['idempotency-key'];
    const payload = request.postDataJSON();
    if (revisionRequestCount === 1) {
      firstCommandId = commandId;
      firstPayload = payload;
      const committedResponse = await route.fetch();
      assert.equal(committedResponse.status(), 200, `Plan command did not commit: ${await committedResponse.text()}`);
      firstCommit = await committedResponse.json();
      await route.abort('connectionreset');
      return;
    }
    retryCommandId = commandId;
    retryPayload = payload;
    await route.continue();
  });
  await save.click();
  await page.getByRole('alert').getByText('The server could not be reached. Your entries are still here. Check the connection before retrying.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Reason for this plan').inputValue(),
    'Inspect first, then prepare the vehicle for the next qualified technician.');
  const committedBeforeRetry = await responseJson(await lead.request.get(`${webOrigin}/api/v1${orderPath(fixture.orderId)}`));
  assert.equal(committedBeforeRetry.workPlan.id, firstCommit.workPlan.id);
  assert.equal(committedBeforeRetry.workPlan.revisionNumber, 1);
  assert.equal(committedBeforeRetry.version, firstCommit.version);
  check('Response-loss simulation confirms the first browser request committed once while the form retained its values');

  await save.click();
  await page.getByText('Work-plan draft saved.', { exact: true }).waitFor();
  await page.unroute(revisionUrl);
  assert.equal(revisionRequestCount, 2, 'One initial request and one user retry should reach the route.');
  assert.equal(retryCommandId, firstCommandId, 'The retry must reuse the original idempotency key.');
  assert.deepEqual(retryPayload, firstPayload, 'The retry must preserve the exact original command body.');
  await page.getByText('Latest draft', { exact: false }).waitFor();
  await plan.getByText('Inspect first, then prepare the vehicle for the next qualified technician.', { exact: true }).waitFor();
  await assertAuthenticatedZoom('supervisor-handoff', lead, fixture.orderId, async zoomPage => {
    await zoomPage.getByLabel('Work plan and handover note').waitFor();
    await zoomPage.getByRole('button', { name: 'Assign supervisor', exact: true }).waitFor();
  });
  check('Stale plan save explains the conflict, keeps entries and succeeds after the current version loads');

  const savedResponse = await lead.request.get(`${webOrigin}/api/v1${orderPath(fixture.orderId)}`);
  const saved = await responseJson(savedResponse);
  assert.equal(saved.workflowContext.stage, 'supervisor-handoff');
  assert.equal(saved.workflowContext.responsibility.name, 'Synthetic browser-team-lead');
  assert.equal(saved.workPlan.id, firstCommit.workPlan.id, 'Idempotent replay must return the original work-plan revision.');
  assert.equal(saved.workPlan.revisionNumber, 1, 'The lost-response retry must not append a second revision.');
  assert.equal(saved.version, firstCommit.version, 'An idempotent replay must not advance the work-order version twice.');
  check('Retry reuses the original idempotency key and body; committed revision and work-order version remain unchanged', {
    requestCount: revisionRequestCount,
    commandId: firstCommandId,
    workPlanRevisionId: saved.workPlan.id,
    revisionNumber: saved.workPlan.revisionNumber,
    version: saved.version,
  });
  assert.equal(saved.canPrepareWorkPlan, true);
  assert.equal(saved.workPlan.isCurrent, true);
  assert.deepEqual(saved.workPlan.tasks.map(task => task.taskId), [fixture.taskIds[1], fixture.taskIds[0]],
    'The plan API must preserve the reordered task sequence.');
  assert.equal(saved.workPlan.plannedBy, 'Synthetic browser-team-lead');

  await page.reload();
  await page.getByRole('region', { name: 'Current job step' }).getByText('Assign a qualified supervisor.', { exact: true }).waitFor();
  await plan.getByText('Latest draft', { exact: false }).waitFor();
  await plan.getByText('Inspect first, then prepare the vehicle for the next qualified technician.', { exact: true }).waitFor();
  const persistedTaskOrder = await plan.locator('ol > li').allTextContents();
  assert.match(persistedTaskOrder[0] ?? '', /Synthetic preparation task/);
  assert.match(persistedTaskOrder[1] ?? '', /Synthetic inspection task/);
  check('Reloading the real work-order page restores the saved rationale and reordered task sequence');

  await handoff.getByLabel('Qualified supervisor').selectOption(runtime.actors.supervisor.id);
  await handoff.getByLabel('Work plan and handover note').fill('The ordered draft is ready for supervised execution review.');
  await handoff.getByRole('button', { name: 'Assign supervisor', exact: true }).click();
  await handoff.getByText('Supervisor assigned', { exact: true }).waitFor();
  const handoffResponse = await lead.request.get(`${webOrigin}/api/v1${orderPath(fixture.orderId)}`);
  const afterHandoff = await responseJson(handoffResponse);
  assert.equal(afterHandoff.workflowContext.stage, 'supervisor-task-work');
  assert.equal(afterHandoff.workflowContext.responsibility.name, 'Synthetic browser-supervisor');
  assert.equal(afterHandoff.supervisorHandoff.supervisorUserId, runtime.actors.supervisor.id);
  assert.equal(afterHandoff.supervisorHandoff.workPlanRevisionId, saved.workPlan.id);
  assert.equal(afterHandoff.supervisorHandoff.workPlanRevisionNumber, saved.workPlan.revisionNumber);
  assert((await queueItems(lead, 'supervisor')).every(item => item.id !== fixture.orderId), 'Supervisor handoffs must be scoped to the assigned supervisor.');
  assert((await queueItems(reviewer, 'supervisor')).every(item => item.id !== fixture.orderId), 'Other staff must not see this handoff in their supervisor queue.');
  supervisor = await newContext();
  await login(supervisor, runtime.actors.supervisor);
  const supervisorPage = await supervisor.newPage();
  await supervisorPage.goto(`${webOrigin}/sites/${runtime.siteId}/work-orders`);
  await supervisorPage.getByLabel('Show jobs').selectOption('supervisor');
  await supervisorPage.getByText(afterHandoff.reference, { exact: true }).waitFor();
  await assertQueueResponsive(supervisorPage, 'supervisor');
  phase = 'supervisor-technician-allocation';
  await supervisorPage.goto(`${webOrigin}${orderPath(fixture.orderId)}`);
  await supervisorPage.getByRole('region', { name: 'Current job step' }).getByText('Assign tasks and record work progress.', { exact: true }).waitFor();
  const allocationPath = `${webOrigin}/api/v1/sites/${runtime.siteId}/work-orders/${fixture.orderId}/task-allocations`;
  const beforeAllocation = await responseJson(await supervisor.request.get(allocationPath));
  assert(beforeAllocation.tasks.length > 0, 'The handed-over plan must expose its planned tasks for allocation.');
  assert(beforeAllocation.assignees.some(person => person.staffUserId === runtime.actors.technician.id),
    'The active Technician reporting directly to this Supervisor must be selectable.');
  const allocatedTask = beforeAllocation.tasks[0];
  await supervisorPage.getByLabel(`Assigned team member for ${allocatedTask.reference}`, { exact: true })
    .selectOption(runtime.actors.technician.id);
  await supervisorPage.getByRole('button', { name: 'Save task assignments', exact: true }).click();
  await supervisorPage.getByText('Task assignments saved.', { exact: true }).waitFor();
  const afterAllocation = await responseJson(await supervisor.request.get(allocationPath));
  const committedAssignment = afterAllocation.tasks.find(task => task.taskId === allocatedTask.taskId);
  assert.equal(committedAssignment?.assigneeId, runtime.actors.technician.id,
    'The Supervisor UI assignment must be committed and returned by the real API.');
  await supervisorPage.getByLabel(`Assigned team member for ${allocatedTask.reference}`, { exact: true }).waitFor();
  assert.equal(await supervisorPage.getByLabel(`Assigned team member for ${allocatedTask.reference}`, { exact: true }).count(), 1,
    'The current Supervisor must have an assignment control for each planned task.');
  technician = await newContext('America/Los_Angeles');
  await login(technician, runtime.actors.technician);
  const technicianQueue = await responseJson(await technician.request.get(
    `${webOrigin}/api/v1/sites/${runtime.siteId}/my-tasks?page=1&pageSize=25`,
  ));
  const queuedAssignment = technicianQueue.items.find(task => task.taskId === allocatedTask.taskId);
  assert(queuedAssignment, `The committed allocation is missing from the Technician queue: ${JSON.stringify(technicianQueue)}`);
  assert.equal(queuedAssignment.workOrderId, fixture.orderId);
  const technicianPage = await technician.newPage();
  await technicianPage.goto(`${webOrigin}/sites/${runtime.siteId}/my-tasks`);
  await technicianPage.getByRole('heading', { name: 'My assigned tasks', exact: true }).waitFor();
  await technicianPage.getByText(afterHandoff.reference, { exact: true }).waitFor();
  await technicianPage.getByText(allocatedTask.reference, { exact: true }).waitFor();
  await technicianPage.getByText(allocatedTask.title, { exact: false }).waitFor();
  await technicianPage.getByText(`Synthetic ${runtime.actors.supervisor.username}`, { exact: true }).waitFor();
  await technicianPage.getByText('An assignment is for coordination only.', { exact: false }).waitFor();
  assert.equal(await technicianPage.getByRole('button', { name: /complete|sign off|start repair/i }).count(), 0,
    'The read-only Technician queue must not imply execution or sign-off controls.');
  check('Assigned Technician records a task progress update through the page and reads it back from the scoped API');
  const technicianTaskPanel = technicianPage.getByRole('region', { name: `Updates and work history for ${allocatedTask.reference}` });
  check('Assigned Technician can start, recover and stop a server-timed task session without changing task state');
  const laborSessionPath = `/api/v1/sites/${runtime.siteId}/my-task-labor-session`;
  const laborStartActionPath = `/api/v1/sites/${runtime.siteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/labor/start`;
  const laborSessionBefore = await responseJson(await technician.request.get(`${webOrigin}${laborSessionPath}`));
  assert.equal(laborSessionBefore.session, null);
  const workOrderVersionBeforeLabor = await responseJson(await technician.request.get(`${webOrigin}/api/v1${orderPath(fixture.orderId)}`));
  const startTimeButton = technicianPage.getByRole('button', { name: 'Record time', exact: true });
  await startTimeButton.focus();
  await startTimeButton.press('Enter');
  await technicianPage.getByRole('button', { name: 'Stop time', exact: true }).waitFor();
  const activeLabor = await responseJson(await technician.request.get(`${webOrigin}${laborSessionPath}`));
  assert.equal(activeLabor.session.workOrderId, fixture.orderId);
  assert.equal(activeLabor.session.taskId, allocatedTask.taskId);
  assert.equal(activeLabor.session.assignmentRevision, queuedAssignment.assignmentRevision);
  assert.equal(activeLabor.session.stoppedAt, null);
  const versionDuringLabor = await responseJson(await technician.request.get(`${webOrigin}/api/v1${orderPath(fixture.orderId)}`));
  assert.equal(versionDuringLabor.version, workOrderVersionBeforeLabor.version, 'Starting time must not advance the work-order version.');
  await technicianPage.reload();
  await technicianPage.getByRole('heading', { name: 'My assigned tasks', exact: true }).waitFor();
  await technicianPage.getByRole('button', { name: 'Stop time', exact: true }).waitFor();
  const recoveredLabor = await responseJson(await technician.request.get(`${webOrigin}${laborSessionPath}`));
  assert.equal(recoveredLabor.session.id, activeLabor.session.id, 'An active timer must survive page reload.');
  const stopTimeButton = technicianPage.getByRole('button', { name: 'Stop time', exact: true });
  await stopTimeButton.focus();
  await stopTimeButton.press('Enter');
  await technicianPage.waitForFunction(async (path) => {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return false;
    const body = await response.json();
    return body.session === null;
  }, laborSessionPath);
  const stoppedLabor = await responseJson(await technician.request.get(`${webOrigin}${laborSessionPath}`));
  assert.equal(stoppedLabor.session, null);
  const versionAfterLabor = await responseJson(await technician.request.get(`${webOrigin}/api/v1${orderPath(fixture.orderId)}`));
  assert.equal(versionAfterLabor.version, workOrderVersionBeforeLabor.version, 'Stopping time must not complete or sign off the task.');
  await technicianPage.waitForFunction(() => Array.from(document.querySelectorAll('button'))
    .some(button => button.textContent?.trim() === 'Record time' && !button.disabled));
  const staleLaborMessage = 'This assignment changed. Refresh your task list before starting time.';
  await technicianPage.route(`${webOrigin}${laborStartActionPath}`, route => route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'STALE_TASK_ASSIGNMENT', message: staleLaborMessage } }),
  }));
  await technicianPage.getByRole('button', { name: 'Record time', exact: true }).click();
  const laborError = technicianPage.getByText(staleLaborMessage, { exact: true });
  await laborError.waitFor();
  assert.equal(await laborError.getAttribute('role'), 'alert', 'Time-record errors must be announced to assistive technology.');
  await technicianPage.unroute(`${webOrigin}${laborStartActionPath}`);
  const laborAccessibility = await new AxeBuilder({ page: technicianPage }).analyze();
  assert.deepEqual(laborAccessibility.violations.map(({ id, impact }) => ({ id, impact })), [],
    'Task time controls must pass automated accessibility checks.');
  const laborLayouts = [];
  for (const width of [280, 320, 390, 768, 1024, 1440]) {
    await technicianPage.setViewportSize({ width, height: 900 });
    const dimensions = await technicianPage.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector('main')?.scrollWidth ?? 0,
    }));
    assert(dimensions.scrollWidth <= dimensions.width,
      `Task time controls overflow at ${width}px: ${JSON.stringify(dimensions)}`);
    laborLayouts.push({ viewportWidth: width, ...dimensions });
  }
  check('Task time controls start and stop by keyboard, announce stale errors, pass automated WCAG checks and fit phone, foldable, tablet and desktop widths');
  if (!process.argv.includes('--labor-only')) {
  await technicianTaskPanel.getByRole('button', { name: 'Update task', exact: true }).click();
  await technicianPage.getByLabel('Note', { exact: true }).fill('Synthetic verification: waiting for supervisor guidance.');
  await technicianPage.getByRole('button', { name: 'Save update', exact: true }).click();
  await technicianPage.getByText('Task update saved.', { exact: true }).waitFor();
  const activityPath = `/api/v1/sites/${runtime.siteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/activity`;
  const taskActivity = await responseJson(await technician.request.get(`${webOrigin}${activityPath}`));
  assert.equal(taskActivity.assignmentRevision, queuedAssignment.assignmentRevision);
  assert.equal(taskActivity.items.at(-1)?.entryType, 'progress');
  assert.equal(taskActivity.items.at(-1)?.progressState, 'working');
  assert.equal(taskActivity.items.at(-1)?.note, 'Synthetic verification: waiting for supervisor guidance.');
  const versionBeforeTaskUpload = (await responseJson(await technician.request.get(`${webOrigin}/api/v1${orderPath(fixture.orderId)}`))).version;
  await technicianTaskPanel.getByRole('button', { name: 'Record work', exact: true }).click();
  const taskEvidenceIntentPath = `/sites/${runtime.siteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/evidence/intents`;
  await technicianTaskPanel.getByLabel('Choose a file', { exact: true }).setInputFiles({
    name: taskEvidenceName,
    mimeType: 'application/pdf',
    buffer: taskEvidencePdf,
  });
  await technicianTaskPanel.getByLabel('Keep upload recovery details in this tab', { exact: true }).check();
  let taskEvidenceIntentId;
  let taskUploadResponseWasLost = false;
  await technicianPage.route(url => url.pathname === `/api/v1${taskEvidenceIntentPath}`
    && url.origin === webOrigin, async route => {
    const response = await route.fetch();
    const body = await response.json();
    taskEvidenceIntentId = body.id;
    await route.fulfill({ response, json: body });
  });
  await technicianPage.route(url => url.pathname.endsWith('/content')
    && url.pathname.includes(`/api/v1/sites/${runtime.siteId}/evidence/intents/`)
    && url.origin === webOrigin, async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 202);
    taskUploadResponseWasLost = true;
    await route.abort('failed');
  });
  await technicianTaskPanel.getByRole('button', { name: 'Upload file', exact: true }).click();
  try {
    await technicianTaskPanel.getByText('Security check in progress.', { exact: true }).waitFor();
  } catch (error) {
    const visibleTaskPanel = await technicianTaskPanel.innerText().catch(() => 'Task panel text unavailable.');
    throw new Error(`Task upload did not recover after the response was lost. Intent=${taskEvidenceIntentId ?? 'missing'}; responseLost=${taskUploadResponseWasLost}. Panel: ${visibleTaskPanel.slice(0, 1800)}`, { cause: error });
  }
  assert(taskUploadResponseWasLost, 'The upload response-loss case did not reach the server.');
  assert(taskEvidenceIntentId, 'The task upload intent was not observed.');
  await technicianPage.unrouteAll({ behavior: 'wait' });
  const recoveredTaskIntent = await responseJson(await technician.request.get(
    `${webOrigin}/api/v1/sites/${runtime.siteId}/evidence/intents/${taskEvidenceIntentId}`));
  assert.equal(recoveredTaskIntent.state, 'completed');
  taskEvidenceId = recoveredTaskIntent.evidenceId;
  const taskEvidenceIntentBody = {
    expectedWorkPlanRevisionId: queuedAssignment.workPlanRevisionId,
    expectedAssignmentRevision: queuedAssignment.assignmentRevision,
    displayName: taskEvidenceName,
    declaredMediaType: 'application/pdf',
    expectedBytes: taskEvidencePdf.length,
  };
  const wrongActorIntent = await mutate(lead, taskEvidenceIntentPath, taskEvidenceIntentBody);
  assert.equal(wrongActorIntent.status(), 409, await wrongActorIntent.text());
  assert.equal((await wrongActorIntent.json()).error.code, 'CURRENT_TASK_ASSIGNMENT_REQUIRED');
  const staleIntent = await mutate(technician, taskEvidenceIntentPath, {
    ...taskEvidenceIntentBody,
    expectedWorkPlanRevisionId: randomUUID(),
  });
  assert.equal(staleIntent.status(), 409, await staleIntent.text());
  assert.equal((await staleIntent.json()).error.code, 'STALE_TASK_ASSIGNMENT');
  const wrongSiteIntent = await mutate(technician,
    `/sites/${runtime.otherSiteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/evidence/intents`, taskEvidenceIntentBody);
  assert.equal(wrongSiteIntent.status(), 403, await wrongSiteIntent.text());
  const pendingEntry = await mutate(technician,
    `/sites/${runtime.siteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/work-entries`, {
      expectedWorkPlanRevisionId: queuedAssignment.workPlanRevisionId,
      expectedAssignmentRevision: queuedAssignment.assignmentRevision,
      kind: 'action', result: 'done', summary: 'Pending evidence must not attach',
      detail: 'Synthetic negative case before the scanner completes.', observedAt: null,
      evidenceIds: [taskEvidenceId], supersedesEntryId: null, correctionReason: null,
    });
  assert.equal(pendingEntry.status(), 409, await pendingEntry.text());
  assert.equal((await pendingEntry.json()).error.code, 'EVIDENCE_NOT_AVAILABLE');
  const pendingEntries = await responseJson(await technician.request.get(
    `${webOrigin}/api/v1/sites/${runtime.siteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/work-entries?page=1&pageSize=25`));
  assert.equal(pendingEntries.pagination.totalItems, 0, 'Rejected pending evidence must not leave a partial work entry.');
  check('Task upload recovers after its response is lost and rejects another staff member, stale assignment, wrong site and pending scan without partial work');
  assert.equal(await runtime.scanNext(), true, 'The task evidence security scan did not run.');
  await technicianTaskPanel.getByText(`Security check passed. Select “${taskEvidenceName}” below when saving the work entry.`, { exact: true }).waitFor();
  const versionAfterTaskUpload = (await responseJson(await technician.request.get(`${webOrigin}/api/v1${orderPath(fixture.orderId)}`))).version;
  assert.equal(versionAfterTaskUpload, versionBeforeTaskUpload,
    'A task-scoped upload must not append a work-order event or change its scope version.');
  check('Assigned Technician uploads and scans evidence after handoff without changing work-order scope');
  const workEvidencePath = `/api/v1/sites/${runtime.siteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/work-evidence?page=1&pageSize=50`;
  const workEvidenceOptions = await responseJson(await technician.request.get(`${webOrigin}${workEvidencePath}`));
  assert.equal(workEvidenceOptions.items.length, 2);
  const existingJobEvidence = workEvidenceOptions.items.find(item => item.evidenceId === fixture.reportEvidenceId);
  assert.equal(existingJobEvidence?.displayName, reportEvidenceName);
  assert.equal(existingJobEvidence?.state, 'attached');
  const readyTaskEvidence = workEvidenceOptions.items.find(item => item.evidenceId === taskEvidenceId);
  assert.equal(readyTaskEvidence?.displayName, taskEvidenceName);
  assert.equal(readyTaskEvidence?.state, 'ready');
  await technicianTaskPanel.getByLabel(`Attach ${taskEvidenceName}`, { exact: true }).check();
  await technicianTaskPanel.getByLabel('Record type', { exact: true }).selectOption('test');
  assert.equal(await technicianTaskPanel.getByLabel('Result', { exact: true }).inputValue(), 'inconclusive',
    'A new test must not default to a claim that the concern was reproduced.');
  await technicianTaskPanel.getByLabel('Record type', { exact: true }).selectOption('action');
  await technicianTaskPanel.getByLabel('Short summary', { exact: true }).fill('Synthetic verified-report work entry');
  await technicianTaskPanel.getByLabel('What happened?', { exact: true }).fill('Synthetic detail for the populated service-report PDF check.');
  await technicianTaskPanel.getByLabel('When did it happen? Optional').fill('2026-12-01T14:00');
  await technicianTaskPanel.getByRole('button', { name: 'Save work entry', exact: true }).click();
  await technicianTaskPanel.getByText('Work entry saved.', { exact: true }).waitFor();
  const workEntriesPath = `/api/v1/sites/${runtime.siteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/work-entries?page=1&pageSize=25`;
  const workEntries = await responseJson(await technician.request.get(`${webOrigin}${workEntriesPath}`));
  assert.equal(workEntries.pagination.totalItems, 1);
  assert.equal(workEntries.items[0].summary, 'Synthetic verified-report work entry');
  assert.equal(workEntries.items[0].observedAt, '2026-12-01T14:00:00.000Z',
    'A 2 pm service-centre entry must not be shifted by the Technician browser timezone.');
  assert.deepEqual(workEntries.items[0].evidenceIds, [taskEvidenceId]);
  const originalWorkEntryId = workEntries.items[0].id;
  await technicianTaskPanel.getByRole('button', { name: 'Correct entry', exact: true }).click();
  await technicianTaskPanel.getByRole('heading', { name: 'Correcting a recorded entry', exact: true }).waitFor();
  assert.equal(await technicianTaskPanel.getByLabel('Short summary', { exact: true }).inputValue(), 'Synthetic verified-report work entry');
  assert.equal(await technicianTaskPanel.getByLabel('What happened?', { exact: true }).inputValue(), 'Synthetic detail for the populated service-report PDF check.');
  assert.equal(await technicianTaskPanel.getByLabel('When did it happen? Optional').inputValue(), '2026-12-01T14:00',
    'Correction form must render the original instant in service-centre time.');
  await technicianTaskPanel.getByLabel('Short summary', { exact: true }).fill('Synthetic corrected-report work entry');
  await technicianTaskPanel.getByLabel('What happened?', { exact: true }).fill('Corrected synthetic report detail after review.');
  await technicianTaskPanel.getByLabel('Why is a correction needed?', { exact: true }).fill('The original summary needed clarification.');
  const correctionResponsePromise = technicianPage.waitForResponse(response =>
    response.request().method() === 'POST' && response.url().includes('/work-entries'));
  await technicianTaskPanel.getByRole('button', { name: 'Save correction', exact: true }).click();
  const correctionResponse = await correctionResponsePromise;
  assert.equal(correctionResponse.status(), 200, await correctionResponse.text());
  await technicianTaskPanel.getByText('Correction saved. The earlier entry remains in history.', { exact: true }).waitFor();
  const correctedWorkEntries = await responseJson(await technician.request.get(`${webOrigin}${workEntriesPath}`));
  assert.equal(correctedWorkEntries.pagination.totalItems, 2);
  assert(correctedWorkEntries.items.some(entry => entry.id === originalWorkEntryId && entry.summary === 'Synthetic verified-report work entry'),
    'The original work entry must stay in the immutable history.');
  const correctionEntry = correctedWorkEntries.items.find(entry => entry.supersedesEntryId === originalWorkEntryId);
  assert(correctionEntry);
  assert.equal(correctionEntry.summary, 'Synthetic corrected-report work entry');
  assert.equal(correctionEntry.correctionReason, 'The original summary needed clarification.');
  assert.deepEqual(correctionEntry.evidenceIds, [taskEvidenceId], 'The correction must preserve the selected task evidence.');
  for (let index = 1; index <= 99; index += 1) {
    const response = await mutate(technician, `/sites/${runtime.siteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/work-entries`, {
      expectedWorkPlanRevisionId: saved.workPlan.id,
      expectedAssignmentRevision: queuedAssignment.assignmentRevision,
      kind: 'action', result: 'done',
      summary: `Synthetic report page entry ${String(index).padStart(2, '0')}`,
      detail: 'Synthetic content used only by the disposable report pagination browser check.',
      observedAt: null, evidenceIds: [], supersedesEntryId: null, correctionReason: null,
    });
    await responseJson(response);
  }
  check('Assigned Technician records a work entry and appends a reasoned correction without rewriting the original');
  const deniedActivity = await supervisor.request.get(`${webOrigin}${activityPath}`);
  assert.equal(deniedActivity.status(), 403, 'A staff role without Technician, Engineer or Trainee access cannot read a task activity stream.');
  const supervisorActivityPath = `${webOrigin}/api/v1/sites/${runtime.siteId}/work-orders/${fixture.orderId}/task-activity?page=1&pageSize=25`;
  const supervisorActivity = await responseJson(await supervisor.request.get(supervisorActivityPath));
  assert.equal(supervisorActivity.items.length, 1);
  assert.equal(supervisorActivity.items[0].note, 'Synthetic verification: waiting for supervisor guidance.');
  await supervisorPage.reload();
  await supervisorPage.getByRole('heading', { name: 'Task updates from the team', exact: true }).waitFor();
  await supervisorPage.getByText('Synthetic verification: waiting for supervisor guidance.', { exact: true }).waitFor();
  const teamLeadUpdatesPage = await lead.newPage();
  await teamLeadUpdatesPage.goto(`${webOrigin}${orderPath(fixture.orderId)}`);
  await teamLeadUpdatesPage.getByRole('heading', { name: 'Tasks in the current work plan', exact: true }).waitFor();
  assert.equal(await teamLeadUpdatesPage.getByLabel(`Assigned team member for ${allocatedTask.reference}`, { exact: true }).count(), 0,
    'The Team Lead sees read-only work-plan assignments without disabled assignment controls.');
  await teamLeadUpdatesPage.getByText(`Assigned to Synthetic ${runtime.actors.technician.username}`, { exact: true }).waitFor();
  await teamLeadUpdatesPage.getByRole('heading', { name: 'Task updates from the team', exact: true }).waitFor();
  await teamLeadUpdatesPage.getByText('Updates from the current work plan.', { exact: false }).waitFor();
  await teamLeadUpdatesPage.getByText('Synthetic verification: waiting for supervisor guidance.', { exact: true }).waitFor();
  const populatedServiceReportPage = await lead.newPage();
  let releaseSecondReportPage;
  let reportPageTwoReached;
  const secondReportPageReached = new Promise(resolve => { reportPageTwoReached = resolve; });
  const secondReportPageGate = new Promise(resolve => { releaseSecondReportPage = resolve; });
  await populatedServiceReportPage.route(url => {
    const parsed = new URL(url);
    return parsed.pathname.endsWith('/service-report') && parsed.searchParams.get('page') === '2';
  }, async route => {
    reportPageTwoReached();
    await secondReportPageGate;
    await route.continue();
  });
  await populatedServiceReportPage.goto(`${webOrigin}/sites/${runtime.siteId}/work-orders/${fixture.orderId}/print`);
  await secondReportPageReached;
  assert.equal(await populatedServiceReportPage.getByRole('heading', { level: 1, name: 'Workshop service report', exact: true }).count(), 0,
    'The report must not render while a continuation page is still loading.');
  assert.equal(await populatedServiceReportPage.getByRole('button', { name: /print service report/i }).count(), 0,
    'Print must remain unavailable until all pages are validated.');
  releaseSecondReportPage();
  await populatedServiceReportPage.getByRole('heading', { level: 1, name: 'Workshop service report', exact: true }).waitFor();
  await populatedServiceReportPage.getByText('Synthetic corrected-report work entry', { exact: true }).waitFor();
  await populatedServiceReportPage.getByText('Corrected synthetic report detail after review.', { exact: true }).waitFor();
  await populatedServiceReportPage.getByText('Synthetic report page entry 99', { exact: true }).waitFor();
  const reportData = await responseJson(await lead.request.get(
    `${webOrigin}/api/v1/sites/${runtime.siteId}/work-orders/${fixture.orderId}/service-report?page=1`,
  ));
  const reportEntryWithEvidence = reportData.entries.find(entry => entry.summary === 'Synthetic verified-report work entry');
  assert.deepEqual(reportEntryWithEvidence?.evidence, [{
    evidenceId: taskEvidenceId,
    displayName: taskEvidenceName,
    mediaType: 'application/pdf',
  }]);
  assert(!JSON.stringify(reportData).includes('objectKey'), 'Service report JSON must not expose storage keys.');
  for (const width of [320, 390, 768, 1440]) {
    await populatedServiceReportPage.setViewportSize({ width, height: 1000 });
    const dimensions = await populatedServiceReportPage.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(dimensions.scrollWidth <= dimensions.clientWidth, `Service report overflow at ${width}px: ${JSON.stringify(dimensions)}`);
  }
  await populatedServiceReportPage.emulateMedia({ media: 'print' });
  const populatedServiceReportPdf = await populatedServiceReportPage.pdf({ printBackground: true });
  const serviceReportTemp = await mkdtemp(resolve(tmpdir(), 'vmms-populated-service-report-'));
  try {
    const serviceReportPdf = resolve(serviceReportTemp, 'service-report.pdf');
    await writeFile(serviceReportPdf, populatedServiceReportPdf);
    const extracted = spawnSync('pdftotext', ['-layout', serviceReportPdf, '-'], { encoding: 'utf8', windowsHide: true });
    assert.equal(extracted.error, undefined, `Install Poppler's pdftotext to verify populated service-report text: ${extracted.error?.message ?? ''}`);
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const expected of ['Workshop service report', 'Synthetic verified-report work entry', 'Synthetic corrected-report work entry', reportEvidenceName, 'Synthetic report page entry 01', 'Synthetic report page entry 99', 'Corrected synthetic report detail after review.', 'The original summary needed clarification.', 'Recorded by Synthetic ' + runtime.actors.technician.username, 'Not a work authorization']) {
      assert(extracted.stdout.includes(expected), `Populated service-report PDF is missing ${JSON.stringify(expected)}.`);
    }
    assert(!extracted.stdout.includes('Primary navigation'), 'Workspace navigation must not be included in the service-report PDF.');
  } finally {
    await rm(serviceReportTemp, { recursive: true, force: true });
  }
  check('Complete 101-entry workshop service report waits for all pages and prints attributed entries and accepted evidence labels as selectable text without application chrome');
  await populatedServiceReportPage.close();
  await teamLeadUpdatesPage.emulateMedia({ media: 'screen' });
  for (let index = 1; index <= 51; index += 1) {
    const entry = await mutate(technician, `/sites/${runtime.siteId}/my-tasks/${fixture.orderId}/${allocatedTask.taskId}/activity`, {
      expectedWorkPlanRevisionId: saved.workPlan.id,
      expectedAssignmentRevision: queuedAssignment.assignmentRevision,
      entryType: 'comment',
      progressState: null,
      requestType: null,
      note: `Synthetic pagination update ${String(index).padStart(2, '0')}`,
    });
    await responseJson(entry);
  }
  await supervisorPage.reload();
  await supervisorPage.getByText('Synthetic pagination update 51', { exact: true }).waitFor();
  await teamLeadUpdatesPage.getByRole('link', { name: 'Progress report', exact: true }).click();
  await teamLeadUpdatesPage.getByRole('heading', { name: 'Work order progress report', exact: true }).waitFor();
  await teamLeadUpdatesPage.getByText('Synthetic verification: waiting for supervisor guidance.', { exact: true }).waitFor();
  await teamLeadUpdatesPage.getByText('Synthetic pagination update 51', { exact: true }).waitFor();
  await teamLeadUpdatesPage.getByText('Progress · In progress', { exact: true }).waitFor();
  assert.equal(await teamLeadUpdatesPage.getByText(afterHandoff.client.name, { exact: true }).count(), 0,
    'The internal task-progress report must not include client contact or payer details.' );
  const progressA11y = await new AxeBuilder({ page: teamLeadUpdatesPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(progressA11y.violations, [], `Task progress report has automated accessibility violations: ${JSON.stringify(progressA11y.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(({ target }) => target) })))}.`);
  const reportWidths = [];
  for (const width of [320, 390, 768, 1024, 1440]) {
    await teamLeadUpdatesPage.setViewportSize({ width, height: 900 });
    const dimensions = await teamLeadUpdatesPage.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert(dimensions.scrollWidth <= dimensions.width, `Progress report overflows at ${width}px: ${JSON.stringify(dimensions)}`);
    reportWidths.push({ viewportWidth: width, ...dimensions });
  }
  await teamLeadUpdatesPage.emulateMedia({ media: 'print' });
  const progressPrintLayout = await teamLeadUpdatesPage.evaluate(() => ({
    report: getComputedStyle(document.querySelector('.task-progress-report')).visibility,
    workspace: getComputedStyle(document.getElementById('workspace-navigation')).visibility,
    toolbar: getComputedStyle(document.querySelector('.task-progress-report-toolbar')).display,
    disclaimer: document.querySelector('.task-progress-report footer')?.textContent,
  }));
  assert.equal(progressPrintLayout.report, 'visible', JSON.stringify(progressPrintLayout));
  assert.equal(progressPrintLayout.workspace, 'hidden', JSON.stringify(progressPrintLayout));
  assert.equal(progressPrintLayout.toolbar, 'none', JSON.stringify(progressPrintLayout));
  assert.match(progressPrintLayout.disclaimer, /do not confirm that repairs are complete/);
  const progressPdf = await teamLeadUpdatesPage.pdf({ printBackground: true });
  const progressTemp = await mkdtemp(resolve(tmpdir(), 'vmms-task-progress-print-'));
  try {
    const progressPdfPath = resolve(progressTemp, 'task-progress-report.pdf');
    await writeFile(progressPdfPath, progressPdf);
    const extracted = spawnSync('pdftotext', ['-layout', progressPdfPath, '-'], { encoding: 'utf8', windowsHide: true });
    assert.equal(extracted.error, undefined, `Install Poppler's pdftotext to verify selectable progress-report text: ${extracted.error?.message ?? ''}`);
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const expected of [afterHandoff.reference, allocatedTask.title, 'Updates from the team', 'Synthetic verification: waiting for supervisor guidance.', 'Synthetic pagination update 01', 'Synthetic pagination update 51', 'Internal workshop report']) {
      assert(extracted.stdout.includes(expected), `Progress report PDF is missing ${JSON.stringify(expected)}.`);
    }
    assert(!extracted.stdout.includes('Primary navigation'), 'Application navigation must not be included in the task-progress report PDF.');
    const properties = spawnSync('pdfinfo', [progressPdfPath], { encoding: 'utf8', windowsHide: true });
    assert.equal(properties.error, undefined, `Install Poppler's pdfinfo to verify task-progress pagination: ${properties.error?.message ?? ''}`);
    assert.equal(properties.status, 0, properties.stderr);
    const reportPageCount = Number(properties.stdout.match(/^Pages:\s+(\d+)$/m)?.[1]);
    assert(reportPageCount > 1, `A report with 52 updates should paginate beyond one page; got ${reportPageCount}.`);
  } finally {
    await rm(progressTemp, { recursive: true, force: true });
  }
  await teamLeadUpdatesPage.emulateMedia({ media: 'screen' });
  check('Authorized Team Lead generates a distinct, selectable-text task-progress PDF with scoped updates, no client details, print isolation, accessibility and responsive layout', {
    orderId: fixture.orderId,
    audience: 'assigned-team-lead',
    reportWidths,
    updateCount: 52,
    paginationExercise: '52 entries across two API pages',
  });
  const reportRacePage = await lead.newPage();
  let alteredReportPageCount = false;
  await reportRacePage.route(/\/task-activity\?page=2&pageSize=50$/, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.pagination.totalItems += 1;
    alteredReportPageCount = true;
    await route.fulfill({ status: response.status(), contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await reportRacePage.goto(`${webOrigin}/sites/${runtime.siteId}/work-orders/${fixture.orderId}/progress-report`);
  await reportRacePage.getByText('Task updates changed while this report was being prepared. Reload the work order and try again.', { exact: true }).waitFor();
  assert(alteredReportPageCount, 'The report should detect a changing result count while reading its second activity page.');
  check('Progress report fails closed when the activity result count changes between API pages');
  const headUpdatesPage = await reviewer.newPage();
  await headUpdatesPage.goto(`${webOrigin}${orderPath(fixture.orderId)}`);
  await headUpdatesPage.getByRole('heading', { name: 'Tasks in the current work plan', exact: true }).waitFor();
  assert.equal(await headUpdatesPage.getByLabel(`Assigned team member for ${allocatedTask.reference}`, { exact: true }).count(), 0,
    'The Head sees read-only work-plan assignments without disabled assignment controls.');
  await headUpdatesPage.getByText(`Assigned to Synthetic ${runtime.actors.technician.username}`, { exact: true }).waitFor();
  await headUpdatesPage.getByRole('heading', { name: 'Task updates from the team', exact: true }).waitFor();
  await headUpdatesPage.getByText('Updates from the current work plan.', { exact: false }).waitFor();
  await headUpdatesPage.getByText('Synthetic pagination update 51', { exact: true }).waitFor();
  await supervisorPage.getByRole('link', { name: 'Progress report', exact: true }).waitFor();
  await headUpdatesPage.getByRole('link', { name: 'Progress report', exact: true }).waitFor();
  assert.equal(await supervisorPage.getByRole('button', { name: /complete task|sign off|release to service/i }).count(), 0,
    'The read-only team activity panel must not grant completion or release authority.');
  assert.equal(await teamLeadUpdatesPage.getByRole('button', { name: /complete task|sign off|release to service/i }).count(), 0,
    'The Team Lead feed must not grant completion or release authority.');
  assert.equal(await headUpdatesPage.getByRole('button', { name: /complete task|sign off|release to service/i }).count(), 0,
    'The Head feed must not grant completion or release authority.');
  assert.equal(await technicianPage.getByRole('button', { name: /complete|sign off|start repair/i }).count(), 0,
    'Task progress must not expose completion, release, or repair-start actions.');
  const assignedTaskLayouts = [];
  for (const width of [320, 390, 768, 1024, 1440]) {
    await technicianPage.setViewportSize({ width, height: 900 });
    const dimensions = await technicianPage.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      contentWidth: document.querySelector('main')?.scrollWidth ?? 0,
    }));
    assert(dimensions.scrollWidth <= dimensions.width,
      `Assigned-task page overflows at ${width}px: ${JSON.stringify(dimensions)}`);
    assignedTaskLayouts.push({ viewportWidth: width, ...dimensions });
  }
  check('Supervisor, assigned Team Lead and Head see the properly scoped task progress feed without sign-off controls', {
    orderId: fixture.orderId,
    taskId: allocatedTask.taskId,
    supervisorId: runtime.actors.supervisor.id,
    technicianId: runtime.actors.technician.id,
    activityCount: taskActivity.items.length,
    supervisorActivityCount: supervisorActivity.items.length,
    oversightAudiences: ['assigned-team-lead', 'head-service-centre'],
    nonTechnicianReadStatus: deniedActivity.status(),
    responsiveLayouts: assignedTaskLayouts,
  });
  check('Team-lead and supervisor work-queue controls remain usable at phone, foldable, tablet, and desktop viewports without page overflow', {
    widths: [320, 390, 768, 1024, 1440],
    actorViews: ['team-lead', 'supervisor'],
  });
  check('Qualified assigned lead saves a versioned ordered draft through the browser and the API returns the same persisted order', {
    orderId: fixture.orderId,
    workPlanRevisionId: saved.workPlan.id,
    orderedTaskIds: [fixture.taskIds[1], fixture.taskIds[0]],
  });
  check('Team lead hands the exact current plan revision to a qualified supervisor; API detail binds the handoff to that plan', {
    handoffSupervisorId: runtime.actors.supervisor.id,
    workPlanRevisionId: afterHandoff.supervisorHandoff.workPlanRevisionId,
  });
  check('Operations, assigned team-lead and supervisor queues filter persisted work by current workflow assignments in the API and browser UI', {
    orderId: fixture.orderId,
    reference: afterHandoff.reference,
    operationQueueBeforeAssignment: true,
    leadQueueAfterAssignment: true,
    supervisorQueueAfterHandoff: true,
    crossActorQueueExclusion: true,
  });

  phase = 'unassigned-role-denial';
  const peer = await newContext();
  await login(peer, runtime.actors.peer);
  const peerPage = await peer.newPage();
  await peerPage.goto(`${webOrigin}${orderPath(fixture.orderId)}`);
  await peerPage.getByText('Only the assigned team lead can prepare this plan.', { exact: true }).waitFor();
  assert.equal(await peerPage.getByRole('heading', { name: 'Task updates from the team', exact: true }).count(), 0,
    'An unassigned Team Lead must not see the task update oversight feed.');
  assert.equal(await peerPage.getByLabel(`Assigned team member for ${allocatedTask.reference}`, { exact: true }).count(), 0,
    'An unassigned Team Lead sees no disabled task-allocation controls.');
  assert.equal(await peerPage.getByRole('button', { name: /Save work-plan draft|Save updated plan/ }).count(), 0);
  check('A same-site staff member who is not the assigned lead sees the clear block reason and cannot submit a plan');
  await peerPage.goto(`${webOrigin}/sites/${runtime.siteId}/work-orders/${fixture.orderId}/progress-report`);
  await peerPage.getByText('Task updates are available to the current Supervisor, assigned Team Lead and Head of Service Centre after the current work has been handed over.', { exact: true }).waitFor();
  check('An unassigned same-site Team Lead cannot open the task-progress report directly');

  await assertResponsive();
  await page.screenshot({ path: resolve(output, 'team-lead-work-plan-desktop.png'), fullPage: true });
  assert.deepEqual(errors, [], 'Unexpected browser errors or outbound requests.');
  check('Work-plan panel and submit controls fit 11 phone, foldable, tablet, desktop and landscape viewports without horizontal overflow');
  }
  report.result = 'VERIFIED';
} catch (error) {
  failed = true;
  report.result = 'FAILED';
  const failure = { phase, kind: error instanceof Error ? error.name : 'unknown' };
  if (error instanceof Error) failure.message = error.message;
  errors.push(failure);
  process.stderr.write(`FAILED: ${phase} (${failure.kind})\n${failure.message ?? ''}\n`);
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  if (technician) await technician.pages()[0]?.screenshot({ path: resolve(output, 'technician-failure.png'), fullPage: true }).catch(() => {});
} finally {
  phase = 'teardown';
  for (const [name, resource] of [['report-evidence-page', reportEvidencePage], ['reviewer-context', reviewer], ['lead-context', lead], ['supervisor-context', supervisor], ['technician-context', technician], ['browser', browser], ['vite', vite], ['isolated-runtime', runtime]]) {
    if (!resource) continue;
    try { await resource.close(); }
    catch (error) {
      failed = true;
      report.result = 'FAILED';
      errors.push({ phase, kind: 'cleanup-failed', resource: name, ...(name === 'isolated-runtime' ? { databaseName: runtime.databaseName } : {}) });
      process.stderr.write(`FAILED: cleanup ${name}\n${error instanceof Error ? error.message : ''}\n`);
    }
  }
  report.finishedAt = new Date().toISOString();
  report.errors = errors;
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (failed) process.exitCode = 1;
}
