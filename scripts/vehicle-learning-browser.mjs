import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';
import { startEvidenceBrowserRuntime } from '../apps/api/test/support/evidence-browser-runtime.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv.includes('--run')) {
  process.stdout.write('Opt-in only: node --import tsx scripts/vehicle-learning-browser.mjs --run\n');
  process.exit(0);
}
loadEnv({ path: resolve(root, '.env'), quiet: true });

const output = resolve(root, 'docs/verification/vehicle-learning-browser');
const errors = [];
const report = {
  recordedAt: new Date().toISOString(),
  scope: 'Disposable PostgreSQL database, synthetic Team Lead identity, VMMS API and vehicle-learning browser page.',
  result: 'RUNNING',
  checks: [],
  limitations: ['No physical device, assistive technology, approved reviewer grants or business UAT were exercised.'],
};
let runtime, vite, browser, context, page, reviewerContext, reviewerPage;
let webOrigin = '';
let phase = 'startup';
let failed = false;

function check(name, details = {}) {
  report.checks.push({ name, details });
  process.stdout.write(`VERIFIED: ${name}\n`);
}

async function login(actor, targetContext = context) {
  const bootstrap = await targetContext.request.get(`${webOrigin}/api/v1/session`);
  assert.equal(bootstrap.status(), 200);
  const csrf = (await targetContext.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf, 'Session initialization did not set a CSRF cookie.');
  const response = await targetContext.request.post(`${webOrigin}/api/v1/session`, {
    headers: { Origin: webOrigin, 'X-CSRFToken': decodeURIComponent(csrf.value) },
    data: { username: actor.username, password: actor.password },
  });
  assert.equal(response.status(), 200, await response.text());
  assert.equal((await response.json()).authenticated, true);
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
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === webOrigin) return route.continue();
    errors.push('unexpected-outbound-request');
    return route.abort('blockedbyclient');
  });
  await login(runtime.actors.teamLead);

  page = await context.newPage();
  await page.goto(`${webOrigin}/sites/${runtime.siteId}/vehicle-learning`);
  await page.getByRole('heading', { name: 'Vehicle learning', exact: true }).waitFor();
  assert((await page.locator('body').innerText()).includes('Vehicle identification exercise'));
  await page.getByText('Source exercise: EV Afriq Service Centre', { exact: true }).click();
  assert((await page.locator('body').innerText()).includes('It is a student exercise, not an approved service procedure'),
    'The supplied PDF must be identified as a learning worksheet, not approved work instructions.');

  phase = 'save-revise-comment-submit';
  await page.getByLabel('Exercise title', { exact: true }).fill('Synthetic browser learning exercise');
  await page.getByLabel('Make, model or variant', { exact: true }).fill('Synthetic BYD test model');
  await page.locator('label').filter({ hasText: 'Likely vehicle type' }).locator('select').selectOption('BEV');
  await page.locator('label').filter({ hasText: 'Likely drivetrain' }).locator('select').selectOption('RWD');
  await page.getByLabel('First visible clue', { exact: true }).fill('Synthetic clue only.');
  await page.getByText('2. Check stronger evidence', { exact: true }).click();
  const axleQuestion = page.locator('article').filter({ hasText: 'Which axle or axles receive drive?' });
  await axleQuestion.locator('label').filter({ hasText: 'Finding status' }).locator('select').selectOption('documentary-confirmed');
  await axleQuestion.locator('label').filter({ hasText: 'Finding' }).locator('textarea').fill('Rear axle, synthetic test value.');
  await axleQuestion.locator('label').filter({ hasText: 'Source type' }).locator('select').selectOption('oem-document');
  await axleQuestion.locator('label').filter({ hasText: 'Document or screen' }).locator('input').fill('Synthetic source document');
  await axleQuestion.locator('label').filter({ hasText: 'Revision or date' }).locator('input').fill('rev test');
  await axleQuestion.locator('label').filter({ hasText: 'Page or section' }).locator('input').fill('Drive layout');
  await page.getByText('3. Identify systems and components', { exact: true }).click();
  const batterySystem = page.locator('article').filter({ hasText: 'HV traction battery pack' });
  await batterySystem.locator('label').filter({ hasText: 'Status' }).locator('select').selectOption('observed');
  await batterySystem.locator('label').filter({ hasText: 'Source type' }).locator('select').selectOption('visual');
  await batterySystem.locator('label').filter({ hasText: 'Document or screen' }).locator('input').fill('Synthetic battery cover label');
  await batterySystem.locator('label').filter({ hasText: 'Revision or date' }).locator('input').fill('2026-11-14');
  await batterySystem.locator('label').filter({ hasText: 'Page or section' }).locator('input').fill('Exterior view');
  await page.getByLabel('Questions or comments for later review', { exact: true }).fill('Synthetic question for later review.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Learning note saved.', { exact: true }).waitFor();
  const note = page.locator('li').filter({ hasText: 'Synthetic browser learning exercise' });
  await note.getByRole('button', { name: 'Continue draft', exact: true }).waitFor();
  await note.getByRole('button', { name: 'Continue draft', exact: true }).click();
  await page.locator('label').filter({ hasText: 'Questions or comments for later review' }).locator('textarea').fill('Synthetic question for later review. Second saved version.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Learning note saved.', { exact: true }).waitFor();
  await note.getByRole('button', { name: 'History and comments', exact: true }).click();
  await page.getByRole('heading', { name: 'Version 1 · Draft', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Version 2 · Draft', exact: true }).waitFor();
  const versionOne = page.locator('article').filter({ hasText: 'Version 1 · Draft' });
  await versionOne.getByRole('button', { name: 'Add a comment', exact: true }).click();
  await page.getByLabel('Your comment on version 1', { exact: true }).fill('Synthetic comment attached to version one.');
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await page.getByText('Comment added to the saved version.', { exact: true }).waitFor();
  await versionOne.getByText('Synthetic comment attached to version one.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save for review', exact: true }).click();
  await page.getByText('Saved for review. Staff with a separate review permission can see this submission.', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Version 3 · Submitted for review', exact: true }).waitFor();
  await note.getByText('View answers and evidence', { exact: true }).first().click();
  await note.getByText('Rear axle, synthetic test value.', { exact: false }).first().waitFor();
  await note.getByText('Synthetic battery cover label', { exact: false }).first().waitFor();
  await page.getByText('Submitted notes are visible only to staff with a current, separate learning-review permission', { exact: false }).waitFor();
  check('Staff save, revise and submit an exercise; author comments remain attached to the exact saved version', {
    role: 'team-lead', revisionCount: 3, commentRevision: 1,
  });

  phase = 'separate-reviewer-feedback-and-resubmission';
  await runtime.grantVehicleLearningReviewerForTest(runtime.actors.creator.id);
  reviewerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  reviewerContext.setDefaultTimeout(15000);
  reviewerContext.setDefaultNavigationTimeout(30000);
  reviewerContext.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
  await reviewerContext.route('**/*', route => {
    if (new URL(route.request().url()).origin === webOrigin) return route.continue();
    errors.push('unexpected-outbound-request');
    return route.abort('blockedbyclient');
  });
  await login(runtime.actors.creator, reviewerContext);
  reviewerPage = await reviewerContext.newPage();
  await reviewerPage.goto(`${webOrigin}/sites/${runtime.siteId}/vehicle-learning`);
  await reviewerPage.getByRole('heading', { name: 'Learning notes to review', exact: true }).waitFor();
  await reviewerPage.getByText('Synthetic browser learning exercise · Synthetic BYD test model', { exact: true }).click();
  await reviewerPage.getByRole('button', { name: 'History and comments', exact: true }).click();
  await reviewerPage.getByRole('heading', { name: 'Version 3 · Submitted for review', exact: true }).waitFor();
  assert.equal(await reviewerPage.getByRole('heading', { name: 'Version 1 · Draft', exact: true }).count(), 0,
    'The reviewer must not see the author’s earlier private drafts.');
  await reviewerPage.getByRole('button', { name: 'Add a comment', exact: true }).click();
  await reviewerPage.getByLabel('Your comment on version 3', { exact: true }).fill('Synthetic reviewer asks for the evidence source to be clearer.');
  await reviewerPage.getByRole('button', { name: 'Save comment', exact: true }).click();
  await reviewerPage.getByText('Comment added to the saved version.', { exact: true }).waitFor();
  await reviewerPage.getByLabel('Review feedback', { exact: true }).fill('Clarify the evidence source for the driven axle.');
  await reviewerPage.getByRole('button', { name: 'Request changes', exact: true }).click();
  await reviewerPage.getByText('Changes requested from the learner.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Vehicle learning', exact: true }).waitFor();
  const returnedNote = page.locator('li').filter({ hasText: 'Synthetic browser learning exercise' });
  await returnedNote.getByText('Changes requested', { exact: false }).waitFor();
  await returnedNote.getByRole('button', { name: 'History and comments', exact: true }).click();
  await returnedNote.getByText('Clarify the evidence source for the driven axle.', { exact: true }).waitFor();
  await returnedNote.getByText('Synthetic reviewer asks for the evidence source to be clearer.', { exact: true }).waitFor();
  await returnedNote.getByRole('button', { name: 'Update note', exact: true }).click();
  await page.getByLabel('Questions or comments for later review', { exact: false }).fill('Updated after reviewer feedback with the document section to confirm later.');
  await page.getByRole('button', { name: 'Save for review', exact: true }).click();
  await page.getByText('Saved for review. Staff with a separate review permission can see this submission.', { exact: true }).waitFor();
  await reviewerPage.reload();
  await reviewerPage.getByText('Synthetic browser learning exercise · Synthetic BYD test model', { exact: true }).click();
  await reviewerPage.getByRole('button', { name: 'History and comments', exact: true }).click();
  await reviewerPage.getByRole('heading', { name: 'Version 4 · Submitted for review', exact: true }).waitFor();
  await reviewerPage.getByLabel('Review feedback', { exact: true }).fill('The learner recorded the uncertainty and the source needed for follow-up.');
  await reviewerPage.getByLabel('I checked that this note contains no client, staff or vehicle identifiers or other private details, and I want to share it with all after-sales staff at this site.', { exact: true }).check();
  await reviewerPage.getByRole('button', { name: 'Mark reviewed and share', exact: true }).click();
  await reviewerPage.getByText('Learning note marked as reviewed and shared with after-sales staff.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Learning notes shared by the team', exact: true }).waitFor();
  await page.getByLabel('Find a make, model or note', { exact: true }).fill('Synthetic BYD test model');
  await page.getByRole('button', { name: 'Search notes', exact: true }).click();
  await page.getByText('Synthetic BYD test model · Synthetic browser learning exercise', { exact: true }).waitFor();
  await page.getByText('Reviewed learning notes are unverified training content.', { exact: false }).waitFor();
  await page.getByText('Synthetic BYD test model · Synthetic browser learning exercise', { exact: true }).click();
  await page.getByText('View answers and evidence', { exact: true }).click();
  await page.getByText('Updated after reviewer feedback with the document section to confirm later.', { exact: false }).waitFor();
  const completedNote = page.locator('li').filter({ hasText: 'Synthetic browser learning exercise' });
  await completedNote.getByText('Reviewed as a learning note', { exact: false }).waitFor();
  await completedNote.getByRole('button', { name: 'History and comments', exact: true }).click();
  await completedNote.getByText('This does not verify vehicle facts or approve work.', { exact: true }).waitFor();
  await reviewerPage.reload();
  await reviewerPage.getByRole('heading', { name: 'Learning notes shared by the team', exact: true }).waitFor();
  await reviewerPage.getByLabel('Find a make, model or note', { exact: true }).fill('Synthetic BYD test model');
  await reviewerPage.getByRole('button', { name: 'Search notes', exact: true }).click();
  await reviewerPage.getByText('Synthetic BYD test model · Synthetic browser learning exercise', { exact: true }).click();
  await reviewerPage.getByRole('button', { name: 'Remove from shared library', exact: true }).click();
  await reviewerPage.getByLabel('Why should this note be removed?', { exact: true }).fill('Synthetic privacy correction after sharing.');
  await reviewerPage.getByRole('button', { name: 'Remove from library', exact: true }).click();
  await reviewerPage.getByText('Removed from the shared learning library. Review history is retained.', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('No shared notes found', { exact: true }).waitFor();
  check('A granted reviewer can withdraw a shared note; staff library hides it while immutable review history remains');
  check('Separate HSC review grant exposes only submitted revisions, supports feedback and author resubmission; explicit sharing adds a same-site learning-library note', {
    authorRole: 'ev-team-lead', reviewerRole: 'head-service-centre', grant: 'synthetic test only',
    decisions: ['changes-requested', 'reviewed-learning-record'],
  });

  phase = 'accessibility-and-responsive';
  const sourceSummary = page.getByText('Source exercise: EV Afriq Service Centre', { exact: true });
  await sourceSummary.click();
  const sourceTranscript = page.locator('pre[aria-label="Complete EV Afriq Service Centre source transcription"]');
  await sourceSummary.focus();
  await page.keyboard.press('Tab');
  assert.equal(await sourceTranscript.evaluate(element => element === document.activeElement), true,
    'Keyboard Tab from the expanded source summary must focus the scrollable transcription.');
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(accessibility.violations.map(issue => ({
    id: issue.id,
    impact: issue.impact,
    description: issue.description,
    nodes: issue.nodes.map(node => node.target),
  })), [], 'Vehicle learning page must pass automated WCAG 2.1 A/AA checks.');
  const reviewerAccessibility = await new AxeBuilder({ page: reviewerPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(reviewerAccessibility.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), [],
    'Vehicle learning reviewer page must pass automated WCAG 2.1 A/AA checks.');
  const layouts = [];
  for (const width of [280, 320, 390, 540, 768, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert(dimensions.scrollWidth <= dimensions.width, `Vehicle learning page overflows at ${width}px: ${JSON.stringify(dimensions)}`);
    await reviewerPage.setViewportSize({ width, height: 900 });
    const reviewDimensions = await reviewerPage.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert(reviewDimensions.scrollWidth <= reviewDimensions.width, `Vehicle learning reviewer page overflows at ${width}px: ${JSON.stringify(reviewDimensions)}`);
    layouts.push({ viewportWidth: width, author: dimensions, reviewer: reviewDimensions });
    if (width === 390) await page.screenshot({ path: resolve(output, 'vehicle-learning-phone.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(output, 'vehicle-learning-desktop.png'), fullPage: true });
  await reviewerPage.setViewportSize({ width: 1440, height: 1000 });
  await reviewerPage.screenshot({ path: resolve(output, 'vehicle-learning-reviewer-desktop.png'), fullPage: true });
  assert.deepEqual(errors, [], 'Unexpected browser errors or outbound requests.');
  check('Vehicle learning page passes automated WCAG 2.1 A/AA checks and fits phone, tablet, foldable and desktop widths', {
    accessibilityViolations: accessibility.violations.length + reviewerAccessibility.violations.length,
    layouts,
  });
  report.result = 'VERIFIED';
} catch (error) {
  failed = true;
  report.result = 'FAILED';
  const detail = { phase, kind: error instanceof Error ? error.name : 'unknown' };
  if (error instanceof Error) detail.message = error.message;
  errors.push(detail);
  process.stderr.write(`FAILED: ${phase} (${detail.kind})\n${detail.message ?? ''}\n`);
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  for (const [name, resource] of [['reviewer-browser-context', reviewerContext], ['browser-context', context], ['browser', browser], ['vite', vite], ['isolated-runtime', runtime]]) {
    if (!resource) continue;
    try { await resource.close(); }
    catch (error) {
      failed = true;
      report.result = 'FAILED';
      errors.push({ phase: 'teardown', kind: 'cleanup-failed', resource: name, message: error instanceof Error ? error.message : '' });
    }
  }
  report.finishedAt = new Date().toISOString();
  report.errors = errors;
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (failed) process.exitCode = 1;
}
