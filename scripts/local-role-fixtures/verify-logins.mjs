import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const installationId = process.env.VMMS_ROLE_REHEARSAL_ID;
assert.match(installationId ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Set VMMS_ROLE_REHEARSAL_ID to the exact synthetic local installation UUID.');
const stateRoot = path.resolve(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'VMMS-Role-Rehearsal');
const stateDirectory = path.join(stateRoot, installationId);
const statePath = path.join(stateDirectory, 'state.json');
const privatePath = path.join(stateDirectory, 'identity-credentials.json');
const manifestPath = path.resolve('scripts/local-role-fixtures/personas.json');

async function readFixtureJson(filePath, { privateFile = false } = {}) {
  const info = await stat(filePath);
  assert(info.isFile(), 'Fixture inputs must be regular files.');
  if (privateFile && process.platform === 'win32') {
    const acl = execFileSync('icacls', [filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toLocaleLowerCase();
    const owner = execFileSync('whoami', [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLocaleLowerCase();
    const entries = acl.split(/\r?\n/).slice(1).filter(line => line.includes('('));
    const allowed = [owner, 'nt authority\\system', 'builtin\\administrators', 's-1-5-18', 's-1-5-32-544'];
    assert(entries.some(line => allowed.some(principal => line.trim().startsWith(`${principal}:`))), 'Credential file must be owned by the current account or local system administrators.');
    assert(!entries.some(line => /everyone|authenticated users|\\users|\(i\)/i.test(line)), 'Credential file ACL must not be inherited or broadly shared.');
  } else if (privateFile) {
    assert.equal(info.mode & 0o077, 0, 'Credential file must be readable only by its owner.');
  }
  return JSON.parse(await readFile(filePath, 'utf8'));
}

const state = await readFixtureJson(statePath);
assert.equal(state.installationId, installationId, 'The local state file must match the requested installation.');
const webOrigin = new URL(state.webOrigin);
const issuer = new URL(state.issuer);
for (const url of [webOrigin, issuer, new URL(state.callbackUri)]) {
  assert.equal(url.protocol, 'http:');
  assert(['127.0.0.1', '::1'].includes(url.hostname), 'Role login rehearsal may use loopback origins only.');
}
const manifest = await readFixtureJson(manifestPath);
const credentials = await readFixtureJson(privatePath, { privateFile: true });
assert.equal(credentials.actors && Object.keys(credentials.actors).length, manifest.staff.length + 1,
  'Private credentials must contain each staff slot and the separate owner slot.');

const checks = [];
const errors = [];
const browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });
try {
  for (const [index, persona] of manifest.staff.entries()) {
    const slot = `p${String(index + 1).padStart(2, '0')}`;
    const password = credentials.actors[slot];
    assert.equal(typeof password, 'string');
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${persona.roleCode}: ${error.name}`));
    await page.goto(webOrigin.origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Continue to secure sign-in' }).click();
    await page.locator('input[name="username"]').waitFor({ state: 'visible' });
    await page.locator('input[name="username"]').fill(`vmms.review.${String(index + 1).padStart(2, '0')}`);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('#kc-login').click();
    await page.waitForURL(url => url.origin === webOrigin.origin, { timeout: 30000 });

    const sessionResponse = await context.request.get(new URL('/api/v1/session', webOrigin).href);
    assert.equal(sessionResponse.status(), 200, `Session endpoint failed for ${persona.roleCode}.`);
    const session = await sessionResponse.json();
    assert.equal(session.authenticated, true, `${persona.roleCode} did not receive a VMMS session.`);
    assert.equal(session.sites.length, 1, `${persona.roleCode} must be scoped to one rehearsal site.`);
    const site = session.sites[0];
    assert.equal(site.code, manifest.site.code);
    assert.deepEqual(site.roleCodes, [persona.roleCode], `${persona.roleCode} must receive only its manifest role.`);

    if (persona.roleCode === 'vmms-operator') {
      for (const endpoint of ['staff/organogram', 'workforce/overview', 'work-orders']) {
        const denied = await context.request.get(new URL(`/api/v1/sites/${site.id}/${endpoint}`, webOrigin).href);
        assert.equal(denied.status(), 403, `Operator must be denied ${endpoint}.`);
        assert.equal((await denied.json()).error.code, 'WORK_ROLE_REQUIRED');
      }
      await page.goto(new URL(`/sites/${site.id}/work-orders`, webOrigin).href);
      await page.getByRole('heading', { level: 1, name: 'Staff account requests' }).waitFor();
      checks.push({ role: persona.roleCode, result: 'signed in; workshop routes denied; account page opened' });
    } else if (persona.roleCode === 'head-service-centre') {
      const denied = await context.request.get(new URL(`/api/v1/sites/${site.id}/staff/account-provisioning-requests`, webOrigin).href);
      assert.equal(denied.status(), 403, 'Head must not receive Operator account requests.');
      assert.equal((await denied.json()).error.code, 'OPERATOR_REQUIRED');
      await page.goto(new URL(`/sites/${site.id}/staff/accounts`, webOrigin).href);
      await page.waitForURL(url => url.pathname === `/sites/${site.id}/today`);
      await page.getByRole('heading', { level: 1, name: 'Today' }).waitFor();
      checks.push({ role: persona.roleCode, result: 'signed in; Operator account API denied and page returned to role home' });
    } else if (persona.roleCode === 'sales-representative' || persona.roleCode === 'pdi-observer') {
      await page.goto(new URL(`/sites/${site.id}/sales-deliveries`, webOrigin).href);
      await page.getByRole('heading', { level: 1, name: 'Sales and deliveries' }).waitFor();
      checks.push({ role: persona.roleCode, result: 'signed in; sales and vehicle-history workspace opened' });
    } else {
      await page.goto(new URL(`/sites/${site.id}/work-orders`, webOrigin).href);
      await page.getByRole('heading', { level: 1, name: 'Work orders' }).waitFor();
      checks.push({ role: persona.roleCode, result: 'signed in; site and role scope verified' });
    }

    const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
    assert(csrf, 'Authenticated session must retain its CSRF cookie.');
    const logout = await context.request.delete(new URL('/api/v1/session', webOrigin).href, {
      headers: { Origin: webOrigin.origin, 'X-CSRFToken': decodeURIComponent(csrf.value) },
    });
    assert.equal(logout.status(), 200, `${persona.roleCode} logout failed.`);
    const signedOut = await (await context.request.get(new URL('/api/v1/session', webOrigin).href)).json();
    assert.equal(signedOut.authenticated, false, `${persona.roleCode} session was not revoked at logout.`);
    await context.close();
  }
  assert.deepEqual(errors, [], `Browser errors occurred: ${errors.join(', ')}`);
  process.stdout.write(`${JSON.stringify({ result: 'passed', identityProvider: 'isolated local Keycloak', vmmsSite: manifest.site.code, staffRoles: checks.length, checks, ownerInvitationClaim: 'not exercised by this staff-login runner; see docs/verification/checks/auth-owner-claim-2026-11-10.md' }, null, 2)}\n`);
} finally {
  await browser.close();
}
