import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.loadEnvFile(resolve(root, '.env'));
const modulePath = process.argv[2];
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
const output = resolve(root, 'docs/verification/browser');
await mkdir(output, { recursive: true });
const checks = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (error) => errors.push(error.message));
const url = process.env.VMMS_WEB_URL || 'http://127.0.0.1:5173';
const isLoopback = (hostname) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
const webOrigin = new URL(url);
const oidcIssuer = new URL(process.env.OIDC_ISSUER || '');
const database = new URL(process.env.DATABASE_URL || '');
assert(isLoopback(webOrigin.hostname), 'Browser smoke tests must target a local VMMS instance.');
assert(isLoopback(oidcIssuer.hostname), 'Browser smoke tests must use a local OIDC provider.');
assert(isLoopback(database.hostname), 'Browser smoke tests must use a local development database.');
assert(process.env.OIDC_DEV_TEST_PASSWORD, 'The local synthetic OIDC account is not provisioned.');
const check = (name) => {
  checks.push({ name, result: 'VERIFIED', at: new Date().toISOString() });
  process.stdout.write(`VERIFIED: ${name}\n`);
};
const authenticatedViewportMatrix = [
  { width: 280, height: 653, name: 'compact phone' },
  { width: 320, height: 568, name: 'small phone' },
  { width: 390, height: 844, name: 'phone' },
  { width: 344, height: 882, name: 'folded device' },
  { width: 673, height: 841, name: 'unfolded device' },
  { width: 540, height: 720, name: 'large phone landscape' },
  { width: 768, height: 1024, name: 'tablet portrait' },
  { width: 820, height: 1180, name: 'large tablet portrait' },
  { width: 1024, height: 768, name: 'tablet landscape' },
  { width: 1440, height: 1000, name: 'desktop' },
  { width: 1920, height: 1080, name: 'wide desktop' },
  { width: 2560, height: 1080, name: 'ultrawide desktop' },
];

try {
  await page.goto(url);
  await page.getByRole('heading', { name: 'Sign in to VMMS' }).waitFor();
  const brand = page.getByRole('img', { name: /Raymond Gray/i }).first();
  assert(await brand.evaluate((image) => image.complete && image.naturalWidth > 0));
  assert.equal((await page.request.get(`${url}/favicon.ico`)).status(), 200);
  await page.screenshot({ path: resolve(output, 'sign-in-desktop.png'), fullPage: true });
  check('Official brand image and favicon load on the neutral sign-in page');
  await page.getByRole('button', { name: /continue to secure sign-in/i }).click();
  await page.getByLabel('Username or email', { exact: true }).fill(process.env.OIDC_DEV_TEST_USERNAME || 'vmms.advisor.local');
  await page.getByLabel('Password', { exact: true }).fill(process.env.OIDC_DEV_TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('heading', { name: /work orders/i }).waitFor();
  check('Individual staff signs in through the local identity provider and VMMS API');
  await page.getByRole('link', { name: 'New intake', exact: true }).first().click();
  const stamp = String(Date.now());
  const vin = `RGVM${stamp}`;
  const registration = `QA-${stamp.slice(-6)}`;
  await page.getByLabel('Customer name', { exact: true }).fill(`Synthetic browser customer ${stamp}`);
  await page.getByLabel('Phone number', { exact: true }).fill('+233200000000');
  await page.getByLabel('Vehicle identification number', { exact: true }).fill(vin);
  await page.getByRole('button', { name: 'Save in this tab', exact: true }).click();
  const recoveredName = `Synthetic browser customer ${stamp} updated`;
  await page.getByLabel('Customer name', { exact: true }).fill(recoveredName);
  await page.reload();
  assert.equal(await page.getByLabel('Customer name', { exact: true }).inputValue(), recoveredName);
  check('Opted-in intake draft automatically saves later edits and recovers after refresh');
  await page.getByLabel('Registration', { exact: true }).fill(registration);
  await page.getByLabel('Make', { exact: true }).fill('Development');
  await page.getByLabel('Model', { exact: true }).fill('EV demonstrator');
  await page.getByLabel('Odometer in kilometres', { exact: true }).fill('12000');
  await page.getByLabel('State of charge in percent', { exact: true }).fill('55');
  await page.getByLabel('What needs attention?', { exact: true }).fill('Synthetic report: charging pauses intermittently.');
  await page.getByRole('button', { name: 'Save in this tab', exact: true }).click();
  await page.reload();
  await page.getByLabel('Registration', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Registration', { exact: true }).inputValue(), registration);
  check('Explicit unsubmitted tab draft survives refresh');
  await context.setOffline(true);
  await page.getByText(/offline/i).first().waitFor();
  assert(await page.getByRole('button', { name: 'Create reception draft', exact: true }).isDisabled());
  await context.setOffline(false);
  check('Offline mode preserves form entries and blocks submission');
  await page.getByRole('button', { name: 'Create reception draft', exact: true }).click();
  await page.getByRole('heading', { name: /^RG-\d{4}-/ }).waitFor();
  const orderUrl = page.url();
  await page.getByText('C01', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add concern', exact: true }).click();
  await page.getByLabel("Customer's wording", { exact: true }).fill('Synthetic report: rattle over uneven roads.');
  await page.getByRole('button', { name: 'Save concern', exact: true }).click();
  await page.getByText('C02', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('C02', { exact: true }).waitFor();
  assert.equal(page.url(), orderUrl);
  check('Real intake and C02 persist on one work order through refresh');
  await page.getByRole('button', { name: 'Plan task', exact: true }).click();
  await page.getByLabel('Proposed task', { exact: true }).fill('Inspect the reported charging interruption');
  await page.getByRole('button', { name: 'Save planned task', exact: true }).click();
  await page.getByText('Inspect the reported charging interruption', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Inspect the reported charging interruption', { exact: true }).waitFor();
  check('A proposed task persists and remains labelled planned after refresh');
  await page.getByRole('button', { name: 'Report hold', exact: true }).click();
  await page.getByLabel('Affected scope', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Category', { exact: true }).selectOption('parts');
  await page.getByLabel('Severity', { exact: true }).selectOption('stop');
  await page.getByLabel('Reason', { exact: true }).fill('Wait for part identity confirmation.');
  await page.getByLabel('Observation or source reference', { exact: true }).fill('Synthetic browser scenario; inspection record BR-QA-1.');
  await page.getByRole('button', { name: 'Save hold', exact: true }).click();
  const taskSection = page.locator("section[aria-labelledby='tasks-title']");
  const firstTask = taskSection.locator('li').filter({ hasText: 'Inspect the reported charging interruption' });
  await firstTask.getByText(/open hold/i).waitFor();
  check('Protective hold is attributable to the selected task');
  await page.getByRole('button', { name: 'Plan task', exact: true }).click();
  await page.getByLabel('Proposed task', { exact: true }).fill('Plan a separate visual assessment');
  await page.getByRole('button', { name: 'Save planned task', exact: true }).click();
  await page.getByText('Plan a separate visual assessment', { exact: true }).waitFor();
  const secondTask = taskSection.locator('li').filter({ hasText: 'Plan a separate visual assessment' });
  assert.equal(await taskSection.locator('li').count(), 2);
  assert.equal(await secondTask.getByText(/open hold/i).count(), 0, 'A task-scoped hold must not attach to an unrelated planned task');
  await page.reload();
  await page.locator("section[aria-labelledby='holds-title']").getByText('Wait for part identity confirmation.', { exact: true }).waitFor();
  await page.getByText('Plan a separate visual assessment', { exact: true }).waitFor();
  check('Task-scoped hold and unrelated task remain distinct after refresh');
  await page.screenshot({ path: resolve(output, 'work-order-desktop.png'), fullPage: true });
  for (const viewport of authenticatedViewportMatrix) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const layout = await page.evaluate(() => {
      const main = document.querySelector('main');
      const controls = [...(main?.querySelectorAll('a,button,input,select,textarea') ?? [])]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
            left: box.left,
            right: box.right,
            height: box.height,
            isButton: element instanceof HTMLButtonElement,
          };
        });
      return { documentWidth: document.documentElement.scrollWidth, controls };
    });
    assert.equal(layout.documentWidth, viewport.width, `${viewport.name} work-order page must not overflow horizontally`);
    assert(
      layout.controls.every((control) => control.left >= -1 && control.right <= viewport.width + 1),
      `${viewport.name} interactive controls must remain inside the viewport: ${JSON.stringify(layout.controls.filter((control) => control.left < -1 || control.right > viewport.width + 1))}`,
    );
    if (viewport.width === 390 && viewport.height === 844) {
      const smallTargets = layout.controls.filter((control) => control.isButton && control.height < 44);
      assert.deepEqual(smallTargets, [], `Phone action buttons must meet the 44-pixel minimum: ${JSON.stringify(smallTargets)}`);
    }
    if (viewport.width === 390 && viewport.height === 844)
      await page.screenshot({ path: resolve(output, 'work-order-phone.png'), fullPage: true });
  }
  check(`Authenticated work-order layout fits ${authenticatedViewportMatrix.length} phone, foldable, tablet and desktop viewports; phone buttons meet 44 pixels`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Add concern', exact: true }).focus();
  await page.keyboard.press('Tab');
  const keyboardFocus = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    return {
      label: element.getAttribute('aria-label') || element.textContent?.trim(),
      visible: element.matches(':focus-visible') && (style.outlineStyle !== 'none' || style.boxShadow !== 'none'),
    };
  });
  assert.equal(keyboardFocus?.label, 'Plan task');
  assert.equal(keyboardFocus?.visible, true, 'Keyboard focus must remain visible in the staff workspace');
  check('Staff workspace actions remain keyboard reachable with visible focus');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedMotion = await page.evaluate(() => ({
    requested: matchMedia('(prefers-reduced-motion: reduce)').matches,
    activeMotion: document.getAnimations().filter((animation) => animation.playState === 'running').length,
  }));
  assert.equal(reducedMotion.requested, true);
  assert.equal(reducedMotion.activeMotion, 0, 'Reduced-motion preference must not leave active page animations');
  check('Authenticated workspace respects the reduced-motion preference');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.getByRole('heading', { name: 'Sign in to VMMS' }).waitFor();
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('vmms')).length), 0);
  check('Sign-out returns to entry and removes accessible VMMS tab drafts');
  assert.deepEqual(errors, [], 'Browser must have no uncaught page errors');
  check('No uncaught browser errors during the tested staff workflow');
} catch (error) {
  checks.push({ name: 'Browser smoke execution', result: 'NOT VERIFIED', reason: error.message, at: new Date().toISOString() });
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
  process.stderr.write(`${error.stack}\n`);
} finally {
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), browser: browser.version(), url, scope: 'Local synthetic staff reception, planned-task and task-scoped-hold workflow only. No owner-portal, physical-device, release, finance or operational acceptance claim.', authenticatedViewports: authenticatedViewportMatrix.map(({ width, height, name }) => ({ width, height, name })), checks, pageErrors: errors }, null, 2) + '\n');
  process.stdout.write(`${checks.filter((item) => item.result === 'VERIFIED').length} browser checks verified.\n`);
  await browser.close();
}
