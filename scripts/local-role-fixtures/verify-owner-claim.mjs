import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';

const { Pool } = pg;
const installationId = process.env.VMMS_ROLE_REHEARSAL_ID;
assert.match(installationId ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  'Set VMMS_ROLE_REHEARSAL_ID to the exact synthetic local installation UUID.');
const stateDirectory = path.resolve(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'VMMS-Role-Rehearsal', installationId);

async function readJson(filePath, privateFile = false) {
  const info = await stat(filePath);
  assert(info.isFile(), 'Fixture inputs must be regular files.');
  if (privateFile && process.platform === 'win32') {
    const acl = execFileSync('icacls', [filePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toLocaleLowerCase();
    const owner = execFileSync('whoami', [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLocaleLowerCase();
    const entries = acl.split(/\r?\n/).slice(1).filter(line => line.includes('('));
    const allowed = [owner, 'nt authority\\system', 'builtin\\administrators', 's-1-5-18', 's-1-5-32-544'];
    assert(entries.some(line => allowed.some(principal => line.trim().startsWith(`${principal}:`))), 'Private fixture file is not owned by this account or local administrators.');
    assert(!entries.some(line => /everyone|authenticated users|\\users|\(i\)/i.test(line)), 'Private fixture file has broad or inherited access.');
  } else if (privateFile) {
    assert.equal(info.mode & 0o077, 0, 'Private fixture file is readable by other users.');
  }
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function fixtureUuid(key) {
  const namespace = Buffer.from('d9c8126621eb5d26908c2d48284acfd8', 'hex');
  const digest = createHash('sha1').update(namespace).update(key).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertLoopbackUrl(value, label) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:', `${label} must use local HTTP.`);
  assert(['127.0.0.1', '::1'].includes(url.hostname), `${label} must use loopback only.`);
  assert(!url.username && !url.password && !url.search && !url.hash, `${label} has unexpected URL components.`);
  return url;
}

const state = await readJson(path.join(stateDirectory, 'state.json'));
assert.equal(state.installationId, installationId, 'Fixture state belongs to another installation.');
const privateConfig = await readJson(state.privateConfigPath, true);
const credentials = await readJson(state.identityCredentialsPath, true);
const identityRequest = await readJson(path.join(stateDirectory, 'identity-request.json'), true);
const identityReceipt = await readJson(state.identityReceiptPath, true);
const personas = await readJson(path.resolve('scripts/local-role-fixtures/personas.json'));
const webOrigin = assertLoopbackUrl(state.webOrigin, 'VMMS web origin');
const issuer = assertLoopbackUrl(state.issuer, 'Identity issuer');
assert.equal(issuer.href.replace(/\/$/, ''), identityReceipt.issuer.replace(/\/$/, ''), 'Identity receipt issuer does not match this fixture.');
assert.equal(identityReceipt.installationId, installationId, 'Identity receipt belongs to another fixture.');
assert.equal(state.databaseName, `vmms_role_rehearsal_${installationId.replaceAll('-', '').slice(0, 8)}`, 'Database name is not the installation-specific rehearsal database.');
assert.equal(state.vmmsComposeProject, `vmms-role-${installationId.replaceAll('-', '').slice(0, 8)}`, 'Database compose project is not the installation-specific rehearsal project.');
const ownerSlot = `p${String(personas.staff.length + 1).padStart(2, '0')}`;
const headIndex = personas.staff.findIndex(persona => persona.roleCode === 'head-service-centre');
assert.notEqual(headIndex, -1, 'The persona manifest is missing the Head role.');
const headSlot = `p${String(headIndex + 1).padStart(2, '0')}`;
const ownerIdentity = identityReceipt.actors.find(actor => actor.key === ownerSlot);
const ownerLogin = identityRequest.actors.find(actor => actor.key === ownerSlot);
const headLogin = identityRequest.actors.find(actor => actor.key === headSlot);
const headPersona = personas.staff[headIndex];
assert.equal(headPersona.roleCode, 'head-service-centre', 'The role rehearsal manifest must include the Head persona.');
assert(ownerIdentity?.subject && ownerLogin?.username && headLogin?.username, 'The private identity receipt is incomplete.');
assert.equal(credentials.actors?.[ownerSlot] && typeof credentials.actors[ownerSlot], 'string', 'Owner test password is missing.');
assert.equal(credentials.actors?.[headSlot] && typeof credentials.actors[headSlot], 'string', 'Head test password is missing.');

const containerName = `${state.vmmsComposeProject}-postgres-1`;
const container = JSON.parse(execFileSync('docker', ['inspect', containerName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0];
assert.equal(container?.State?.Status, 'running', 'The owned rehearsal database container is not running.');
assert.equal(container?.Config?.Labels?.['com.docker.compose.project'], state.vmmsComposeProject, 'Database container project marker does not match.');
assert.equal(container?.Config?.Labels?.['com.docker.compose.service'], 'postgres', 'Expected the fixture PostgreSQL service.');
assert.equal(container?.Config?.Labels?.['org.raymond-gray.vmms.role-rehearsal'], installationId.replaceAll('-', '').slice(0, 8), 'Database container owner marker does not match.');
assert.equal(container?.Config?.Labels?.['com.docker.compose.project.config_files'], path.resolve('scripts/local-role-fixtures/compose.yaml'), 'Database container uses an unexpected compose file.');
assert(container.Mounts?.some(mount => mount.Name === state.databaseVolume && mount.Destination === '/var/lib/postgresql'), 'Database volume does not match the private fixture state.');

const pool = new Pool({
  host: '127.0.0.1', port: state.vmmsDatabasePort, database: state.databaseName,
  user: 'vmms_role_fixture_owner', password: privateConfig.databasePassword,
  max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000,
});
const keys = {
  ownerAccountId: fixtureUuid(`owner-rehearsal:${installationId}:owner-account`),
  vehicleId: fixtureUuid(`owner-rehearsal:${installationId}:vehicle`),
  evidenceId: fixtureUuid(`owner-rehearsal:${installationId}:accepted-evidence-v2`),
  scanAttemptId: fixtureUuid(`owner-rehearsal:${installationId}:synthetic-clean-scan-attempt-v2`),
  grantId: fixtureUuid(`owner-rehearsal:${installationId}:temporary-approver-grant-v2`),
};
const syntheticEvidence = Buffer.from(`Synthetic local vehicle-owner approval evidence for ${installationId}. No customer document is represented.`);
const evidenceHash = createHash('sha256').update(syntheticEvidence).digest('hex');
const syntheticRegistration = `RG-QA-${installationId.replaceAll('-', '').slice(0, 6).toUpperCase()}`;
const syntheticVin = `RG${'0'.repeat(14)}1`;
const syntheticQuarantineKey = `fixture-only/owner-approval/${installationId}/${keys.evidenceId}/quarantine`;
const syntheticAcceptedKey = `fixture-only/owner-approval/${installationId}/${keys.evidenceId}`;
assert.equal(syntheticVin.length, 17);
const checks = [];
const browserErrors = [];
let grantSeeded = false;
let browser;
let invitationToken;
let ownerContext;
let headContext;
let headAuthenticated = false;
let ownerAuthenticated = false;
let failure;
let phase = 'startup';

async function seedFixture() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const database = await client.query('SELECT current_database() AS name, oid::text AS oid FROM pg_database WHERE datname=current_database()');
    assert.equal(database.rows[0]?.name, state.databaseName, 'Connected to an unexpected database.');
    const organisations = await client.query("SELECT id FROM organisations WHERE name='Raymond Gray role rehearsal'");
    assert.equal(organisations.rowCount, 1, 'Expected exactly one marked rehearsal organisation.');
    const organisationId = organisations.rows[0].id;
    const sites = await client.query('SELECT id FROM sites WHERE organisation_id=$1 AND code=$2 AND name=$3', [organisationId, personas.site.code, personas.site.name]);
    assert.equal(sites.rowCount, 1, 'Expected exactly one marked rehearsal site.');
    const siteId = sites.rows[0].id;
    const heads = await client.query('SELECT id FROM staff_users WHERE username=$1 AND active', [headPersona.username]);
    assert.equal(heads.rowCount, 1, 'The active Head fixture account is missing or ambiguous.');
    const headId = heads.rows[0].id;
    const ownerMembership = await client.query('SELECT staff_user_id FROM staff_identities WHERE issuer=$1 AND subject=$2', [state.issuer.replace(/\/$/, ''), ownerIdentity.subject]);
    assert.equal(ownerMembership.rowCount, 0, 'The owner identity is already linked as staff; refusing to mix audiences.');

    await client.query(`INSERT INTO vehicle_owner_accounts(id,organisation_id,issuer,subject,active)
      VALUES($1,$2,$3,$4,true) ON CONFLICT(id) DO NOTHING`,
    [keys.ownerAccountId, organisationId, state.issuer.replace(/\/$/, ''), ownerIdentity.subject]);
    const account = await client.query('SELECT organisation_id,issuer,subject,active FROM vehicle_owner_accounts WHERE id=$1', [keys.ownerAccountId]);
    assert.equal(account.rowCount, 1, 'The synthetic vehicle-owner account was not created.');
    assert.deepEqual(account.rows[0], {
      organisation_id: organisationId, issuer: state.issuer.replace(/\/$/, ''), subject: ownerIdentity.subject, active: true,
    }, 'The deterministic owner account ID is occupied by unrelated or changed data.');

    await client.query(`INSERT INTO vehicles(id,organisation_id,customer_id,vin,registration,make,model,variant,powertrain)
      VALUES($1,$2,NULL,$3,$4,'Rehearsal','Owner Access Vehicle','Synthetic fixture','EV') ON CONFLICT(id) DO NOTHING`,
    [keys.vehicleId, organisationId, syntheticVin, syntheticRegistration]);
    const vehicle = await client.query('SELECT organisation_id,customer_id,vin,registration,make,model,variant,powertrain FROM vehicles WHERE id=$1', [keys.vehicleId]);
    assert.equal(vehicle.rowCount, 1, 'The synthetic rehearsal vehicle was not created.');
    assert.deepEqual(vehicle.rows[0], {
      organisation_id: organisationId, customer_id: null, vin: syntheticVin, registration: syntheticRegistration,
      make: 'Rehearsal', model: 'Owner Access Vehicle', variant: 'Synthetic fixture', powertrain: 'EV',
    }, 'The deterministic vehicle ID is occupied by unrelated or changed data.');

    await client.query(`INSERT INTO evidence_records(id,organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,
      purpose_kind,target_id,display_name,declared_media_type,quarantine_key,accepted_key,upload_intent_id)
      VALUES($1,$2,$3,'accepted',$4,'application/pdf',$5,$6,'vehicle-owner-approval',$7,
        'Synthetic owner access approval evidence v2','application/pdf',$8,$9,NULL) ON CONFLICT(id) DO NOTHING`,
    [keys.evidenceId, organisationId, siteId, evidenceHash, syntheticEvidence.length, headId, keys.vehicleId, syntheticQuarantineKey, syntheticAcceptedKey]);
    const evidence = await client.query(`SELECT organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,purpose_kind,
      target_id,display_name,declared_media_type,quarantine_key,accepted_key,upload_intent_id FROM evidence_records WHERE id=$1`, [keys.evidenceId]);
    assert.equal(evidence.rowCount, 1, 'The synthetic accepted evidence metadata was not created.');
    const expectedEvidence = {
      organisation_id: organisationId, site_id: siteId, scan_state: 'accepted', sha256: evidenceHash,
      media_type: 'application/pdf', size_bytes: String(syntheticEvidence.length), created_by: headId,
      purpose_kind: 'vehicle-owner-approval', target_id: keys.vehicleId,
      display_name: 'Synthetic owner access approval evidence v2', declared_media_type: 'application/pdf',
      quarantine_key: syntheticQuarantineKey, accepted_key: syntheticAcceptedKey, upload_intent_id: null,
    };
    assert.deepEqual(evidence.rows[0], expectedEvidence, 'The deterministic evidence ID is occupied by unrelated or changed data.');

    await client.query(`INSERT INTO evidence_scan_attempts(id,organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code,scanned_at)
      VALUES($1,$2,$3,$4,1,'clean',$5,'Synthetic fixture metadata','fixture-only','synthetic-fixture-clean',transaction_timestamp())
      ON CONFLICT(id) DO NOTHING`, [keys.scanAttemptId, organisationId, siteId, keys.evidenceId, evidenceHash]);
    const scanAttempt = await client.query(`SELECT organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code
      FROM evidence_scan_attempts WHERE id=$1`, [keys.scanAttemptId]);
    assert.equal(scanAttempt.rowCount, 1, 'The synthetic accepted-evidence scan metadata was not created.');
    assert.deepEqual(scanAttempt.rows[0], {
      organisation_id: organisationId, site_id: siteId, evidence_id: keys.evidenceId, attempt_no: 1,
      verdict: 'clean', scanned_sha256: evidenceHash, engine: 'Synthetic fixture metadata',
      engine_version: 'fixture-only', detail_code: 'synthetic-fixture-clean',
    }, 'The deterministic synthetic scan record ID is occupied by unrelated or changed data.');

    const grantReason = `Synthetic local owner-access rehearsal only: ${installationId}.`;
    const priorGrant = await client.query('SELECT organisation_id,site_id,staff_user_id,capability,granted_by,evidence_record_id,reason FROM owner_access_approver_grants WHERE id=$1', [keys.grantId]);
    if (priorGrant.rowCount) {
      assert.deepEqual(priorGrant.rows[0], {
        organisation_id: organisationId, site_id: siteId, staff_user_id: headId,
        capability: 'vehicle-owner-access.manage', granted_by: headId, evidence_record_id: keys.evidenceId, reason: grantReason,
      }, 'The fixture-only grant ID is occupied by unrelated or changed data.');
      await client.query(`UPDATE owner_access_approver_grants
        SET valid_from=transaction_timestamp()-interval '1 minute',valid_until=transaction_timestamp()+interval '30 minutes',revoked_at=NULL
        WHERE id=$1`, [keys.grantId]);
    } else {
      await client.query(`INSERT INTO owner_access_approver_grants(id,organisation_id,site_id,staff_user_id,capability,granted_by,evidence_record_id,reason,valid_from,valid_until)
        VALUES($1,$2,$3,$4,'vehicle-owner-access.manage',$4,$5,$6,transaction_timestamp()-interval '1 minute',transaction_timestamp()+interval '30 minutes')`,
      [keys.grantId, organisationId, siteId, headId, keys.evidenceId, grantReason]);
    }
    grantSeeded = true;
    const access = await client.query(`SELECT s.id AS access_scope_id,s.version,r.id AS relationship_id,v.state,
        v.effective_from,v.effective_until
      FROM vehicle_owner_access_scopes s
      LEFT JOIN vehicle_owner_relationships r ON r.organisation_id=s.organisation_id AND r.site_id=s.site_id AND r.access_scope_id=s.id AND r.owner_account_id=$4
      LEFT JOIN LATERAL (SELECT state,effective_from,effective_until FROM vehicle_owner_revisions WHERE relationship_id=r.id ORDER BY revision DESC LIMIT 1) v ON true
      WHERE s.organisation_id=$1 AND s.site_id=$2 AND s.vehicle_id=$3`, [organisationId, siteId, keys.vehicleId, keys.ownerAccountId]);
    await client.query('COMMIT');
    return { organisationId, siteId, headId, access: access.rows[0] ?? null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function sessionBootstrap(context, endpoint) {
  const response = await context.request.get(new URL(endpoint, webOrigin).href);
  assert.equal(response.status(), 200, `${endpoint} session bootstrap failed.`);
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(csrf, `${endpoint} did not issue a CSRF cookie.`);
  return { Origin: webOrigin.origin, 'X-CSRFToken': decodeURIComponent(csrf.value), 'Content-Type': 'application/json' };
}

async function authenticate(page, actor, password) {
  await page.locator('input[name="username"]').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('input[name="username"]').fill(actor.username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('#kc-login').click();
  await page.waitForURL(url => url.origin === webOrigin.origin, { timeout: 30000 });
}

try {
  phase = 'health and fixture setup';
  const health = await fetch(new URL('/api/v1/health', webOrigin));
  assert.equal(health.status, 200, 'The local VMMS API is not healthy through the web proxy.');
  assert.equal((await health.json()).status, 'ready');
  const setup = await seedFixture();
  browser = await chromium.launch({ headless: true, channel: process.env.VMMS_BROWSER_CHANNEL || 'msedge' });

  headContext = await browser.newContext({ serviceWorkers: 'block' });
  phase = 'Head OIDC login';
  const headPage = await headContext.newPage();
  headPage.on('pageerror', error => browserErrors.push(`Head: ${error.name}`));
  await headPage.goto(webOrigin.origin, { waitUntil: 'domcontentloaded' });
  await headPage.getByRole('button', { name: 'Continue to secure sign-in' }).click();
  await authenticate(headPage, headLogin, credentials.actors[headSlot]);
  const headSessionResponse = await headContext.request.get(new URL('/api/v1/session', webOrigin).href);
  assert.equal(headSessionResponse.status(), 200);
  const headSession = await headSessionResponse.json();
  assert.equal(headSession.authenticated, true, 'Head OIDC sign-in did not produce a VMMS staff session.');
  headAuthenticated = true;
  const site = headSession.sites.find(item => item.id === setup.siteId);
  assert(site, 'The Head session does not include the fixture site.');
  assert.equal(site.canWrite, true, 'The rehearsal Head membership must be writable.');
  assert.deepEqual(site.roleCodes, ['head-service-centre'], 'The test actor must have only the Head role.');
  assert.equal(headSession.user.id, setup.headId, 'The OIDC Head identity does not match the fixture approver.');

  const staffHeaders = await sessionBootstrap(headContext, '/api/v1/session');
  phase = 'vehicle-owner approval';
  if (!setup.access?.relationship_id || setup.access.state !== 'approved'
      || (setup.access.effective_until && new Date(setup.access.effective_until) <= new Date())) {
    const expectedVersion = setup.access?.version ?? 0;
    const approval = await headContext.request.post(new URL(`/api/v1/sites/${site.id}/vehicles/${keys.vehicleId}/owner-access/approve`, webOrigin).href, {
      headers: { ...staffHeaders, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion, ownerAccountId: keys.ownerAccountId, evidenceRecordId: keys.evidenceId, reason: `Synthetic owner access rehearsal ${installationId}` },
    });
    if (approval.status() !== 200) {
      const error = await approval.json().catch(() => ({}));
      throw new Error(`Owner access approval command failed (${approval.status()}:${error.error?.code ?? 'unknown'}).`);
    }
    const approved = await approval.json();
    assert.equal(approved.vehicleId, keys.vehicleId);
    assert(approved.relationships.some(item => item.ownerAccountId === keys.ownerAccountId && item.state === 'approved' && item.currentlyValid));
    checks.push('real owner access approval command');
  } else {
    assert.equal(setup.access.state, 'approved');
    assert(new Date(setup.access.effective_from) <= new Date());
    checks.push('existing marked owner access relationship verified');
  }

  const activeInvitation = await pool.query(`SELECT id,reason FROM vehicle_owner_invitations
    WHERE organisation_id=$1 AND site_id=$2 AND owner_account_id=$3 AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at>now()`,
  [setup.organisationId, setup.siteId, keys.ownerAccountId]);
  assert(activeInvitation.rowCount <= 1, 'More than one active synthetic owner invitation exists.');
  if (activeInvitation.rowCount) {
    phase = 'resolve prior invitation';
    assert.equal(activeInvitation.rows[0].reason, `Synthetic owner role rehearsal invitation (${installationId})`, 'An unrelated active invitation exists for the synthetic owner.');
    const revokeHeaders = await sessionBootstrap(headContext, '/api/v1/session');
    const revoked = await headContext.request.post(new URL(`/api/v1/sites/${site.id}/owner-access/invitations/${activeInvitation.rows[0].id}/revoke`, webOrigin).href, {
      headers: { ...revokeHeaders, 'Idempotency-Key': randomUUID() },
      data: { expectedVersion: 1, evidenceRecordId: keys.evidenceId, reason: `Resolve prior interrupted synthetic owner rehearsal ${installationId}` },
    });
    assert.equal(revoked.status(), 200, 'A marked prior owner invitation could not be revoked through the real command.');
    assert.equal((await revoked.json()).status, 'revoked');
    checks.push('prior interrupted synthetic invitation revoked by real command');
  }
  const invitationHeaders = await sessionBootstrap(headContext, '/api/v1/session');
  phase = 'owner invitation issue';
  const issuedResponse = await headContext.request.post(new URL(`/api/v1/sites/${site.id}/owner-access/invitations`, webOrigin).href, {
    headers: { ...invitationHeaders, 'Idempotency-Key': randomUUID() },
    data: { ownerAccountId: keys.ownerAccountId, evidenceRecordId: keys.evidenceId, reason: `Synthetic owner role rehearsal invitation (${installationId})`, expiresInHours: 1 },
  });
  if (issuedResponse.status() !== 200) {
    const error = await issuedResponse.json().catch(() => ({}));
    throw new Error(`Owner invitation command failed (${issuedResponse.status()}:${error.error?.code ?? 'unknown'}).`);
  }
  const issued = await issuedResponse.json();
  assert.equal(issued.status, 'issued');
  assert.equal(issued.ownerAccountId, keys.ownerAccountId);
  assert.match(issued.claimToken ?? '', /^[A-Za-z0-9_-]{43,128}$/);
  invitationToken = issued.claimToken;
  checks.push('real single-use owner invitation command');

  const staffCsrf = (await headContext.cookies()).find(cookie => cookie.name === 'vmms_csrf');
  assert(staffCsrf, 'Head session did not retain a CSRF cookie for logout.');
  phase = 'Head logout';
  const staffLogout = await headContext.request.delete(new URL('/api/v1/session', webOrigin).href, {
    headers: { Origin: webOrigin.origin, 'X-CSRFToken': decodeURIComponent(staffCsrf.value) },
  });
  assert.equal(staffLogout.status(), 200);
  headAuthenticated = false;
  await headContext.close();
  headContext = undefined;

  ownerContext = await browser.newContext({ serviceWorkers: 'block' });
  phase = 'owner invitation OIDC login';
  const ownerPage = await ownerContext.newPage();
  ownerPage.on('pageerror', error => browserErrors.push(`Owner: ${error.name}`));
  await ownerPage.goto(`${webOrigin.origin}/#owner-invitation=${encodeURIComponent(invitationToken)}`, { waitUntil: 'domcontentloaded' });
  await ownerPage.getByRole('heading', { name: 'Vehicle owner sign in' }).waitFor({ timeout: 10000 });
  await ownerPage.waitForFunction(() => window.location.hash === '', { timeout: 10000 });
  assert.equal(await ownerPage.evaluate(() => window.location.href.includes('owner-invitation=')), false, 'The claim token remained in browser history after invitation capture.');
  await ownerPage.getByRole('button', { name: 'Continue with invitation' }).click();
  await authenticate(ownerPage, ownerLogin, credentials.actors[ownerSlot]);

  phase = 'owner session and vehicle data';
  const ownerSessionResponse = await ownerContext.request.get(new URL('/api/v1/owner/session', webOrigin).href);
  assert.equal(ownerSessionResponse.status(), 200);
  assert.deepEqual(await ownerSessionResponse.json(), { authenticated: true, audience: 'owner' }, 'Invitation claim did not create an owner-only session.');
  ownerAuthenticated = true;
  const staffSessionResponse = await ownerContext.request.get(new URL('/api/v1/session', webOrigin).href);
  assert.equal(staffSessionResponse.status(), 200);
  assert.equal((await staffSessionResponse.json()).authenticated, false, 'Owner sign-in unexpectedly created a staff session.');
  const vehiclesResponse = await ownerContext.request.get(new URL('/api/v1/owner/vehicles', webOrigin).href);
  assert.equal(vehiclesResponse.status(), 200);
  const ownerVehicles = await vehiclesResponse.json();
  assert.deepEqual(ownerVehicles.vehicles, [{ id: keys.vehicleId, registration: syntheticRegistration, make: 'Rehearsal', model: 'Owner Access Vehicle' }], 'Owner session returned data outside the exact synthetic vehicle allowlist.');
  await ownerPage.getByRole('heading', { name: 'Your account is connected' }).waitFor();
  await ownerPage.getByRole('heading', { name: 'Rehearsal Owner Access Vehicle' }).waitFor();
  checks.push('real OIDC invitation claim and owner-only session');
  checks.push('only the marked synthetic vehicle is visible');

  const ownerHeaders = await sessionBootstrap(ownerContext, '/api/v1/owner/session');
  phase = 'owner logout';
  const ownerLogout = await ownerContext.request.delete(new URL('/api/v1/owner/session', webOrigin).href, {
    headers: { Origin: ownerHeaders.Origin, 'X-CSRFToken': ownerHeaders['X-CSRFToken'] },
  });
  assert.equal(ownerLogout.status(), 200);
  assert.deepEqual(await ownerLogout.json(), { authenticated: false });
  assert.deepEqual(await (await ownerContext.request.get(new URL('/api/v1/owner/session', webOrigin).href)).json(), { authenticated: false });
  const afterLogout = await ownerContext.request.get(new URL('/api/v1/owner/vehicles', webOrigin).href);
  assert.equal(afterLogout.status(), 401, 'Owner vehicle data remained available after logout.');
  ownerAuthenticated = false;
  checks.push('owner logout revoked the server session');
  assert.deepEqual(browserErrors, [], `Browser errors occurred: ${browserErrors.join(', ')}`);
} catch (error) {
  failure = error;
} finally {
  if (headContext && headAuthenticated) {
    try {
      const csrf = (await headContext.cookies()).find(cookie => cookie.name === 'vmms_csrf');
      assert(csrf);
      const response = await headContext.request.delete(new URL('/api/v1/session', webOrigin).href, {
        headers: { Origin: webOrigin.origin, 'X-CSRFToken': decodeURIComponent(csrf.value) },
      });
      assert.equal(response.status(), 200);
      headAuthenticated = false;
    } catch {
      failure ??= new Error('The Head browser session could not be cleaned up.');
    }
  }
  if (ownerContext && ownerAuthenticated) {
    try {
      const headers = await sessionBootstrap(ownerContext, '/api/v1/owner/session');
      const response = await ownerContext.request.delete(new URL('/api/v1/owner/session', webOrigin).href, {
        headers: { Origin: headers.Origin, 'X-CSRFToken': headers['X-CSRFToken'] },
      });
      assert.equal(response.status(), 200);
      const session = await ownerContext.request.get(new URL('/api/v1/owner/session', webOrigin).href);
      assert.deepEqual(await session.json(), { authenticated: false });
      ownerAuthenticated = false;
    } catch {
      failure ??= new Error('The owner browser session could not be cleaned up.');
    }
  }
  if (headContext) await headContext.close().catch(() => {});
  if (ownerContext) await ownerContext.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (grantSeeded) {
    try {
      await pool.query(`UPDATE owner_access_approver_grants
        SET revoked_at=COALESCE(revoked_at,transaction_timestamp())
        WHERE id=$1 AND reason=$2`,
      [keys.grantId, `Synthetic local owner-access rehearsal only: ${installationId}.`]);
      const remaining = await pool.query(`SELECT count(*)::int AS active FROM owner_access_approver_grants
        WHERE id=$1 AND revoked_at IS NULL AND valid_from<=now() AND (valid_until IS NULL OR now()<valid_until)`, [keys.grantId]);
      assert.equal(remaining.rows[0]?.active, 0, 'The temporary synthetic owner-approval capability is still active.');
    } catch (error) {
      failure ??= new Error('The temporary fixture-only owner approval grant could not be confirmed revoked.');
    }
  }
  await pool.end().catch(() => {});
}

if (failure) {
  process.stderr.write(`Owner role rehearsal failed during ${phase}: ${failure.message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ result: 'passed', site: 'RHR', ownerAudience: 'isolated owner session', checks, temporaryGrant: 'revoked', claimToken: 'not logged or persisted' }, null, 2)}\n`);
}
