import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  fixtureUuid,
  localRoleFixtureRoleCodes,
  validateLocalRoleFixtureManifest,
  validateLocalRoleFixtureTarget,
  type LocalRoleFixtureIdentity,
  type LocalRoleFixturePersona,
  type LocalRoleFixtureTarget,
} from '../scripts/local-role-fixture-seed.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifestPath = `${root}/scripts/local-role-fixtures/personas.json`;
const issuer = 'http://127.0.0.1:8180/realms/vmms-role-review-a1b2c3d4';
const target: LocalRoleFixtureTarget = {
  nodeEnv: 'development',
  enabled: 'true',
  instanceSlug: 'a1b2c3d4',
  installationId: 'a1b2c3d4-1122-4334-8556-aabbccddeeff',
  databaseUrl: 'postgres://vmms_role_fixture_owner:local-only@127.0.0.1:55439/vmms_role_rehearsal_a1b2c3d4',
  expectedDatabaseName: 'vmms_role_rehearsal_a1b2c3d4',
  expectedDatabaseOid: '812345',
  dockerContainerId: 'a'.repeat(64),
  issuer,
};

async function readManifest() {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as {
    staff: LocalRoleFixturePersona[];
    owner: { key: string; username: string; displayName: string; email: string };
  };
}

async function identityReceipts(personas: LocalRoleFixturePersona[]): Promise<LocalRoleFixtureIdentity[]> {
  return personas.map((persona, index) => ({
    key: persona.key,
    issuer,
    subject: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }));
}

test('fixture IDs are stable UUID v5 values and distinct by key', () => {
  assert.equal(fixtureUuid('staff:head'), fixtureUuid('staff:head'));
  assert.notEqual(fixtureUuid('staff:head'), fixtureUuid('staff:operator'));
  assert.match(fixtureUuid('staff:head'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('fixture target is limited to an explicitly named local rehearsal database and Keycloak realm', () => {
  assert.equal(validateLocalRoleFixtureTarget(target).databaseName, 'vmms_role_rehearsal_a1b2c3d4');
  assert.throws(() => validateLocalRoleFixtureTarget({ ...target, nodeEnv: 'production' }), /development rehearsal mode/);
  assert.throws(() => validateLocalRoleFixtureTarget({ ...target, enabled: undefined }), /development rehearsal mode/);
  assert.throws(() => validateLocalRoleFixtureTarget({ ...target, databaseUrl: target.databaseUrl!.replace('127.0.0.1', 'db.example.test') }), /exact loopback rehearsal database/);
  assert.throws(() => validateLocalRoleFixtureTarget({ ...target, expectedDatabaseName: 'vmms' }), /does not match the rehearsal installation/);
  assert.throws(() => validateLocalRoleFixtureTarget({ ...target, issuer: 'https://auth.raymond-gray.org/realms/raymond-gray' }), /exact loopback rehearsal realm/);
  assert.throws(() => validateLocalRoleFixtureTarget({ ...target, issuer: 'http://127.0.0.1:8180/realms/raymond-gray-dev' }), /exact loopback rehearsal realm/);
});

test('manifest covers all built-in staff roles and keeps Operator distinct from the Head', async () => {
  const manifest = await readManifest();
  assert.deepEqual([...new Set(manifest.staff.map(persona => persona.roleCode))].sort(), [...localRoleFixtureRoleCodes].sort());
  assert.equal(manifest.staff.find(persona => persona.roleCode === 'vmms-operator')?.reportsTo, null);
  assert.equal(manifest.staff.find(persona => persona.roleCode === 'head-service-centre')?.reportsTo, null);
  assert.notEqual(manifest.staff.find(persona => persona.roleCode === 'vmms-operator')?.key,
    manifest.staff.find(persona => persona.roleCode === 'head-service-centre')?.key);
  assert.equal(manifest.owner.key, 'owner');
  assert.match(manifest.owner.email, /\.invalid$/);
});

test('persona and OIDC receipts must match exactly, including issuer, identity count, and report targets', async () => {
  const manifest = await readManifest();
  const receipts = await identityReceipts(manifest.staff);
  assert.doesNotThrow(() => validateLocalRoleFixtureManifest(manifest.staff, receipts, issuer));
  assert.throws(() => validateLocalRoleFixtureManifest(manifest.staff, receipts.slice(1), issuer), /exactly one OIDC identity receipt/);
  assert.throws(() => validateLocalRoleFixtureManifest(manifest.staff, receipts.map((identity, index) => index === 0 ? { ...identity, issuer: 'http://localhost:8080/realms/raymond-gray-dev' } : identity), issuer), /wrong issuer/);
  assert.throws(() => validateLocalRoleFixtureManifest(manifest.staff.map(persona => persona.key === 'operator' ? { ...persona, reportsTo: 'head' } : persona), receipts, issuer), /Operator must remain outside/);
  assert.throws(() => validateLocalRoleFixtureManifest(manifest.staff.map(persona => persona.key === 'technician' ? { ...persona, reportsTo: 'missing' } : persona), receipts, issuer), /points outside/);
});
