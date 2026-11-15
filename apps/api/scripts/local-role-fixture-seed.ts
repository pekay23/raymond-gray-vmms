import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '../src/db.js';

export const localRoleFixtureIdentity = '7c1f9f9d-1229-5f74-9c5c-ae2cd7d71010';
export const localRoleFixtureNamespace = 'd9c81266-21eb-5d26-908c-2d48284acfd8';
export const localRoleFixtureRoleCodes = [
  'head-service-centre', 'ev-team-lead', 'ice-team-lead', 'supervisor',
  'technician-engineer-trainee', 'service-advisor', 'quality-inspector',
  'parts-inventory', 'warranty-customer-support', 'finance-billing',
  'compliance-records-hr', 'pdi-observer', 'sales-representative', 'vmms-operator',
] as const;

export type LocalRoleFixturePersona = {
  key: string;
  username: string;
  displayName: string;
  roleCode: typeof localRoleFixtureRoleCodes[number];
  reportsTo: string | null;
};

export type LocalRoleFixtureIdentity = { key: string; issuer: string; subject: string };

export type LocalRoleFixtureTarget = {
  nodeEnv: string | undefined;
  enabled: string | undefined;
  instanceSlug: string | undefined;
  installationId: string | undefined;
  databaseUrl: string | undefined;
  expectedDatabaseName: string | undefined;
  expectedDatabaseOid: string | undefined;
  dockerContainerId: string | undefined;
  issuer: string | undefined;
};

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateLocalRoleFixtureTarget(input: LocalRoleFixtureTarget) {
  if (input.nodeEnv !== 'development' || input.enabled !== 'true') {
    throw new Error('Local role fixture seeding requires explicit development rehearsal mode.');
  }
  const installationId = input.installationId ?? '';
  if (!uuidShape.test(installationId)) throw new Error('The rehearsal installation ID must be a UUID.');
  const instanceSlug = input.instanceSlug ?? '';
  if (!/^[a-z0-9]{8}$/.test(instanceSlug) || installationId.replaceAll('-', '').slice(0, 8) !== instanceSlug) {
    throw new Error('The rehearsal instance slug does not match its installation ID.');
  }
  const databaseName = input.expectedDatabaseName ?? '';
  if (databaseName !== `vmms_role_rehearsal_${instanceSlug}`) {
    throw new Error('The expected database name does not match the rehearsal installation.');
  }
  if (!/^[1-9][0-9]{0,9}$/.test(input.expectedDatabaseOid ?? '')) throw new Error('The expected rehearsal database OID is missing.');
  if (!/^[a-f0-9]{64}$/i.test(input.dockerContainerId ?? '')) throw new Error('The owned rehearsal database container ID is missing.');
  const databaseUrl = new URL(input.databaseUrl ?? '');
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !loopbackHosts.has(databaseUrl.hostname)
    || databaseUrl.username !== 'vmms_role_fixture_owner' || !databaseUrl.password
    || databaseUrl.pathname !== `/${databaseName}` || databaseUrl.search || databaseUrl.hash) {
    throw new Error('The role fixture database must be the exact loopback rehearsal database.');
  }
  const issuer = new URL(input.issuer ?? '');
  const realm = issuer.pathname.split('/').filter(Boolean).at(-1) ?? '';
  if (issuer.protocol !== 'http:' || !['127.0.0.1', '::1'].includes(issuer.hostname) || realm !== `vmms-role-review-${instanceSlug}`
    || issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new Error('The role fixture issuer must be the exact loopback rehearsal realm.');
  }
  return { installationId, instanceSlug, databaseName, databaseUrl, issuer: issuer.toString().replace(/\/$/, '') };
}

export function fixtureUuid(key: string): string {
  const namespace = Buffer.from(localRoleFixtureNamespace.replaceAll('-', ''), 'hex');
  const digest = createHash('sha1').update(namespace).update(key).digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateLocalRoleFixtureManifest(personas: LocalRoleFixturePersona[], identities: LocalRoleFixtureIdentity[], issuer: string) {
  if (personas.length !== localRoleFixtureRoleCodes.length || new Set(personas.map(persona => persona.key)).size !== personas.length) {
    throw new Error('The role rehearsal manifest must include each staff role exactly once.');
  }
  if (new Set(personas.map(persona => persona.roleCode)).size !== localRoleFixtureRoleCodes.length
    || localRoleFixtureRoleCodes.some(code => !personas.some(persona => persona.roleCode === code))) {
    throw new Error('The role rehearsal manifest does not match the built-in role catalog.');
  }
  if (personas.some(persona => !/^[a-z][a-z0-9-]{1,63}$/.test(persona.key)
    || !/^vmms\.[a-z0-9.-]+\.local$/.test(persona.username)
    || !persona.displayName.startsWith('Synthetic ')
    || persona.reportsTo === persona.key)) {
    throw new Error('The role rehearsal manifest contains a non-synthetic or invalid staff persona.');
  }
  const byKey = new Map(personas.map(persona => [persona.key, persona]));
  for (const persona of personas) {
    if (persona.reportsTo && !byKey.has(persona.reportsTo)) throw new Error('A staff reporting link points outside the role rehearsal manifest.');
    if (persona.roleCode === 'vmms-operator' && persona.reportsTo) throw new Error('The VMMS Operator must remain outside the operational reporting chain.');
    if (persona.roleCode === 'head-service-centre' && persona.reportsTo) throw new Error('The Head of Service Centre must be a root of the operational reporting chain.');
  }
  const identityByKey = new Map(identities.map(identity => [identity.key, identity]));
  if (identities.length !== personas.length || identityByKey.size !== identities.length || personas.some(persona => !identityByKey.has(persona.key))) {
    throw new Error('Every synthetic staff persona must have exactly one OIDC identity receipt.');
  }
  if (identities.some(identity => identity.issuer.replace(/\/$/, '') !== issuer || !uuidShape.test(identity.subject))) {
    throw new Error('A synthetic OIDC receipt has the wrong issuer or an invalid subject.');
  }
}

async function assertExactlyOne(client: PoolClient, label: string, sql: string, values: unknown[], equals: (row: Record<string, unknown> | undefined) => boolean) {
  const result = await client.query(sql, values);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (result.rowCount !== 1 || !equals(row)) throw new Error(`The ${label} record is missing, changed, or occupied by unrelated data.`);
}

export async function seedLocalRoleFixtureDatabase(
  pool: Database,
  input: {
    target: LocalRoleFixtureTarget;
    instanceSlug: string;
    installationId: string;
    expectedDatabaseName: string;
    expectedDatabaseOid: string;
    dockerContainerId: string;
    issuer: string;
    personas: LocalRoleFixturePersona[];
    identities: LocalRoleFixtureIdentity[];
  },
) {
  const target = validateLocalRoleFixtureTarget(input.target);
  if (target.installationId !== input.installationId || target.instanceSlug !== input.instanceSlug || target.databaseName !== input.expectedDatabaseName
    || target.issuer !== input.issuer || input.target.expectedDatabaseOid !== input.expectedDatabaseOid
    || input.target.dockerContainerId !== input.dockerContainerId) {
    throw new Error('The rehearsal target does not match the recorded fixture identity.');
  }
  validateLocalRoleFixtureManifest(input.personas, input.identities, input.issuer);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const database = await client.query(`SELECT current_database() AS name, oid::text AS oid
      FROM pg_database WHERE datname=current_database()`);
    await assertExactlyOne(client, 'database identity', 'SELECT 1 WHERE current_database()=$1 AND (SELECT oid::text FROM pg_database WHERE datname=current_database())=$2',
      [input.expectedDatabaseName, input.expectedDatabaseOid], () => true);
    const db = database.rows[0] as { name: string; oid: string } | undefined;
    if (!db || db.name !== input.expectedDatabaseName || db.oid !== input.expectedDatabaseOid) throw new Error('The connected database does not match the recorded rehearsal container.');

    const migrations = await client.query("SELECT 1 FROM schema_migrations WHERE name='039_staff_account_provisioning_worker.sql'");
    if (migrations.rowCount !== 1) throw new Error('The rehearsal database is not fully migrated to the expected schema revision.');
    const catalog = await client.query('SELECT code FROM staff_role_profiles WHERE active ORDER BY code');
    const actualCodes = catalog.rows.map(row => String(row.code)).sort();
    if (actualCodes.length !== localRoleFixtureRoleCodes.length || localRoleFixtureRoleCodes.some(code => !actualCodes.includes(code))) {
      throw new Error('The active role catalog differs from the rehearsal manifest.');
    }

    await client.query(`CREATE TABLE IF NOT EXISTS public.vmms_local_fixture_installation (
      installation_id text PRIMARY KEY CHECK (installation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
      database_name text NOT NULL,
      database_oid text NOT NULL,
      docker_container_id text NOT NULL,
      manifest_version integer NOT NULL,
      issuer text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    const existingInstallation = await client.query('SELECT * FROM public.vmms_local_fixture_installation');
    const existing = existingInstallation.rows[0] as Record<string, unknown> | undefined;
    if (existingInstallation.rowCount && (existingInstallation.rowCount !== 1
      || existing?.installation_id !== input.installationId
      || existing?.database_name !== input.expectedDatabaseName
      || existing?.database_oid !== input.expectedDatabaseOid
      || existing?.docker_container_id !== input.dockerContainerId
      || Number(existing?.manifest_version) !== 1
      || existing?.issuer !== input.issuer)) {
      throw new Error('A different or unknown rehearsal installation already owns this database.');
    }
    if (!existing) {
      const counts = await client.query(`SELECT
        (SELECT count(*)::int FROM organisations) AS organisations,
        (SELECT count(*)::int FROM staff_users) AS staff_users,
        (SELECT count(*)::int FROM staff_identities) AS identities,
        (SELECT count(*)::int FROM memberships) AS memberships,
        (SELECT count(*)::int FROM staff_role_placements) AS placements`);
      const count = counts.rows[0] as Record<string, number>;
      if (Object.values(count).some(value => Number(value) !== 0)) throw new Error('The unmarked rehearsal database contains records; refusing to adopt it.');
      await client.query('INSERT INTO public.vmms_local_fixture_installation(installation_id,database_name,database_oid,docker_container_id,manifest_version,issuer) VALUES($1,$2,$3,$4,1,$5)',
        [input.installationId, input.expectedDatabaseName, input.expectedDatabaseOid, input.dockerContainerId, input.issuer]);
    }

    const organisationId = fixtureUuid('organisation');
    const siteId = fixtureUuid('site:site-1');
    const bootstrapId = fixtureUuid('actor:fixture-bootstrap');
    await client.query('INSERT INTO organisations(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING', [organisationId, 'Raymond Gray role rehearsal']);
    await assertExactlyOne(client, 'rehearsal organisation', 'SELECT name FROM organisations WHERE id=$1', [organisationId], row => row?.name === 'Raymond Gray role rehearsal');
    await client.query('INSERT INTO sites(id,organisation_id,code,name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
      [siteId, organisationId, 'RHR', 'Role rehearsal service centre']);
    await assertExactlyOne(client, 'rehearsal site', 'SELECT organisation_id,code,name FROM sites WHERE id=$1', [siteId], row => row?.organisation_id === organisationId && row?.code === 'RHR' && row?.name === 'Role rehearsal service centre');

    await client.query('INSERT INTO staff_users(id,username,display_name,password_hash,active) VALUES($1,$2,$3,$4,false) ON CONFLICT(id) DO NOTHING',
      [bootstrapId, 'vmms.fixture.bootstrap.local', 'Synthetic Fixture Bootstrap', '!OIDC_ONLY_INACTIVE_FIXTURE!']);
    await assertExactlyOne(client, 'fixture bootstrap actor', 'SELECT username,display_name,active FROM staff_users WHERE id=$1', [bootstrapId], row => row?.username === 'vmms.fixture.bootstrap.local' && row?.display_name === 'Synthetic Fixture Bootstrap' && row?.active === false);

    const identityByKey = new Map(input.identities.map(identity => [identity.key, identity]));
    const placementIds = new Map(input.personas.map(persona => [persona.key, fixtureUuid(`placement:${persona.key}`)]));
    for (const persona of input.personas) {
      const userId = fixtureUuid(`staff:${persona.key}`);
      await client.query('INSERT INTO staff_users(id,username,display_name,password_hash,active) VALUES($1,$2,$3,$4,true) ON CONFLICT(id) DO NOTHING',
        [userId, persona.username, persona.displayName, '!OIDC_ONLY_FIXTURE!']);
      await assertExactlyOne(client, `staff account ${persona.key}`, 'SELECT username,display_name,active FROM staff_users WHERE id=$1', [userId], row => row?.username === persona.username && row?.display_name === persona.displayName && row?.active === true);
      const identity = identityByKey.get(persona.key)!;
      await client.query('INSERT INTO staff_identities(issuer,subject,staff_user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [input.issuer, identity.subject, userId]);
      await assertExactlyOne(client, `identity mapping ${persona.key}`, 'SELECT staff_user_id FROM staff_identities WHERE issuer=$1 AND subject=$2', [input.issuer, identity.subject], row => row?.staff_user_id === userId);
      await client.query('INSERT INTO memberships(user_id,site_id,can_write,active) VALUES($1,$2,true,true) ON CONFLICT(user_id,site_id) DO NOTHING', [userId, siteId]);
      await assertExactlyOne(client, `site membership ${persona.key}`, 'SELECT can_write,active FROM memberships WHERE user_id=$1 AND site_id=$2', [userId, siteId], row => row?.can_write === true && row?.active === true);
    }

    const byKey = new Map(input.personas.map(persona => [persona.key, persona]));
    for (const persona of input.personas) {
      const userId = fixtureUuid(`staff:${persona.key}`);
      const placementId = placementIds.get(persona.key)!;
      const reportsToPlacementId = persona.reportsTo ? placementIds.get(persona.reportsTo) ?? null : null;
      if (persona.reportsTo && !reportsToPlacementId) throw new Error('The reporting chain does not resolve to an existing fixture persona.');
      if (persona.reportsTo && !byKey.has(persona.reportsTo)) throw new Error('The reporting chain points outside the fixture.');
      await client.query(`INSERT INTO staff_role_placements(id,organisation_id,site_id,staff_user_id,role_code,reports_to_placement_id,revision,state,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,1,'active',$7,$7) ON CONFLICT(id) DO NOTHING`,
        [placementId, organisationId, siteId, userId, persona.roleCode, reportsToPlacementId, bootstrapId]);
      await assertExactlyOne(client, `role placement ${persona.key}`, 'SELECT staff_user_id,role_code,reports_to_placement_id,revision,state FROM staff_role_placements WHERE id=$1',
        [placementId], row => row?.staff_user_id === userId && row?.role_code === persona.roleCode
          && row?.reports_to_placement_id === reportsToPlacementId && row?.revision === 1 && row?.state === 'active');
      const historyId = fixtureUuid(`placement-history:${persona.key}:1`);
      await client.query(`INSERT INTO staff_role_placement_history(id,organisation_id,site_id,placement_id,revision,staff_user_id,role_code,reports_to_placement_id,state,changed_by)
        VALUES($1,$2,$3,$4,1,$5,$6,$7,'active',$8) ON CONFLICT(id) DO NOTHING`,
        [historyId, organisationId, siteId, placementId, userId, persona.roleCode, reportsToPlacementId, bootstrapId]);
      await assertExactlyOne(client, `role placement history ${persona.key}`, 'SELECT placement_id,staff_user_id,role_code,reports_to_placement_id,state FROM staff_role_placement_history WHERE id=$1',
        [historyId], row => row?.placement_id === placementId && row?.staff_user_id === userId && row?.role_code === persona.roleCode
          && row?.reports_to_placement_id === reportsToPlacementId && row?.state === 'active');
    }
    const grants = await client.query('SELECT count(*)::int AS count FROM staff_authority_grants');
    if (Number(grants.rows[0]?.count) !== 0) throw new Error('Role rehearsal must not contain operational authority grants.');
    await client.query('COMMIT');
    return { organisationId, siteId, staffAccountCount: input.personas.length, placementCount: input.personas.length, operationalGrantCount: 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
