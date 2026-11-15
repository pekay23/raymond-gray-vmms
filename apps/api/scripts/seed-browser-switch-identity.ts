import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv, parse } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';

const vmmsRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: resolve(vmmsRoot, '.env'), quiet: true });
if (process.env.NODE_ENV === 'production') throw new Error('The browser-switch identity seed is local development only.');

const loopback = new Set(['localhost', '127.0.0.1', '::1']);
const issuer = new URL(z.url().parse(process.env.OIDC_ISSUER));
const databaseUrl = new URL(z.url().parse(process.env.MIGRATION_DATABASE_URL));
if (issuer.protocol !== 'http:' || !loopback.has(issuer.hostname)) throw new Error('The browser-switch identity seed requires a loopback OIDC issuer.');
if (!loopback.has(databaseUrl.hostname)) throw new Error('The browser-switch identity seed requires a loopback migration database.');

const testPassword = z.string().min(12).parse(process.env.OIDC_DEV_TEST_PASSWORD);
const realm = z.string().min(1).parse(issuer.pathname.split('/').filter(Boolean).at(-1));
const authRoot = resolve(vmmsRoot, '..', 'raymond-gray-auth');
const authEnv = parse(await readFile(resolve(authRoot, '.env')));
const adminUsername = z.string().min(1).parse(authEnv.KC_BOOTSTRAP_ADMIN_USERNAME);
const adminPassword = z.string().min(1).parse(authEnv.KC_BOOTSTRAP_ADMIN_PASSWORD);

const username = 'vmms.browser.switch.local';
const displayName = 'Synthetic QA Browser User';
const markerName = 'vmms_local_fixture';
const markerValue = 'browser-account-switch-v1';
const staffUserId = '10000000-0000-4000-8000-000000000005';
const organisationId = '10000000-0000-4000-8000-000000000001';

const tokenResponse = await fetch(new URL('/realms/master/protocol/openid-connect/token', issuer.origin), {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: adminUsername,
    password: adminPassword,
  }),
});
if (!tokenResponse.ok) throw new Error(`Local Keycloak admin authentication failed (${tokenResponse.status}).`);
const tokenBody: unknown = await tokenResponse.json();
const accessToken = z.object({ access_token: z.string().min(1) }).parse(tokenBody).access_token;

async function keycloakRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(`/admin/realms/${encodeURIComponent(realm)}${path}`, issuer.origin), {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Local Keycloak request failed (${response.status}).`);
  return response;
}

const usersResponse = await keycloakRequest(`/users?username=${encodeURIComponent(username)}&exact=true`);
const users = z.array(z.object({ id: z.string().min(1) })).parse(await usersResponse.json());
let subject: string;
if (users.length === 0) {
  const createResponse = await keycloakRequest('/users', {
    method: 'POST',
    body: JSON.stringify({
      username,
      enabled: true,
      email: 'vmms-browser-switch@example.invalid',
      emailVerified: true,
      firstName: 'Synthetic QA',
      lastName: 'Browser User',
      attributes: { [markerName]: [markerValue] },
    }),
  });
  if (createResponse.status !== 201) throw new Error(`Local Keycloak did not create the synthetic account (${createResponse.status}).`);
  const location = createResponse.headers.get('location');
  if (!location) throw new Error('Local Keycloak did not return the new synthetic account identifier.');
  subject = new URL(location).pathname.split('/').at(-1) ?? '';
  subject = z.string().uuid().parse(subject);
} else {
  if (users.length !== 1) throw new Error('The local browser-switch username is not unique; no identity was changed.');
  subject = users[0]!.id;
  const userResponse = await keycloakRequest(`/users/${encodeURIComponent(subject)}`);
  const user = z.object({
    id: z.string(),
    enabled: z.boolean(),
    email: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    attributes: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  }).parse(await userResponse.json());
  const marker = user.attributes?.[markerName];
  const marked = marker === markerValue || (Array.isArray(marker) && marker.includes(markerValue));
  const hasFixtureIdentity = user.email === 'vmms-browser-switch@example.invalid'
    && user.firstName === 'Synthetic QA'
    && user.lastName === 'Browser User';
  if (user.id !== subject || !user.enabled || (!marked && !hasFixtureIdentity)) {
    throw new Error('An unrelated or disabled account already uses the synthetic browser-switch username; no identity was changed.');
  }
}

await keycloakRequest(`/users/${encodeURIComponent(subject)}/reset-password`, {
  method: 'PUT',
  body: JSON.stringify({ type: 'password', value: testPassword, temporary: false }),
});

const pool = new pg.Pool({ connectionString: databaseUrl.toString() });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,NULL) ON CONFLICT(id) DO NOTHING',
      [staffUserId, username, displayName],
    );
    const staff = await client.query('SELECT username,display_name,active FROM staff_users WHERE id=$1', [staffUserId]);
    const staffRow = z.object({ username: z.string(), display_name: z.string(), active: z.boolean() }).optional().parse(staff.rows[0]);
    if (!staffRow || staffRow.username !== username || staffRow.display_name !== displayName || !staffRow.active) {
      throw new Error('The VMMS development account ID is occupied by an unrelated or inactive record.');
    }

    const site = await client.query('SELECT id FROM sites WHERE organisation_id=$1 AND code=$2', [organisationId, 'QA']);
    if (site.rowCount !== 1) throw new Error('Run the VMMS development seed first; exactly one synthetic QA site is required.');
    const qaSiteId = z.object({ id: z.uuid() }).parse(site.rows[0]).id;
    await client.query(
      'INSERT INTO memberships(user_id,site_id,can_write) VALUES($1,$2,false) ON CONFLICT(user_id,site_id) DO NOTHING',
      [staffUserId, qaSiteId],
    );
    const memberships = await client.query('SELECT site_id,can_write,active FROM memberships WHERE user_id=$1', [staffUserId]);
    const membershipRows = z.array(z.object({ site_id: z.uuid(), can_write: z.boolean(), active: z.boolean() })).parse(memberships.rows);
    if (membershipRows.length !== 1 || membershipRows[0]!.site_id !== qaSiteId || membershipRows[0]!.can_write || !membershipRows[0]!.active) {
      throw new Error('The synthetic browser-switch user must have only read-only QA site access.');
    }

    await client.query(
      'INSERT INTO staff_identities(issuer,subject,staff_user_id) VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO NOTHING',
      [issuer.toString().replace(/\/$/, ''), subject, staffUserId],
    );
    const identity = await client.query('SELECT staff_user_id FROM staff_identities WHERE issuer=$1 AND subject=$2', [issuer.toString().replace(/\/$/, ''), subject]);
    const mapping = z.object({ staff_user_id: z.uuid() }).optional().parse(identity.rows[0]);
    if (mapping?.staff_user_id !== staffUserId) throw new Error('The local OIDC subject is already linked to a different VMMS staff account.');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

process.stdout.write('Provisioned the marked local synthetic QA viewer for browser account-switch checks; no technical or financial grants were created.\n');
