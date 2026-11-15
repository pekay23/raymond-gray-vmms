import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';
import { z } from 'zod';
import { localRoleFixtureRoleCodes, seedLocalRoleFixtureDatabase, validateLocalRoleFixtureTarget, type LocalRoleFixtureIdentity } from './local-role-fixture-seed.js';

const environmentSchema = z.object({
  NODE_ENV: z.literal('development'),
  VMMS_ROLE_FIXTURE_ENABLED: z.literal('true'),
  VMMS_ROLE_FIXTURE_INSTALLATION_ID: z.string().uuid(),
  VMMS_ROLE_FIXTURE_INSTANCE: z.string().regex(/^[a-z0-9]{8}$/),
  VMMS_ROLE_FIXTURE_DATABASE_URL: z.url(),
  VMMS_ROLE_FIXTURE_DATABASE_NAME: z.string().regex(/^vmms_role_rehearsal_[a-z0-9]{8}$/),
  VMMS_ROLE_FIXTURE_DATABASE_OID: z.string().regex(/^[1-9][0-9]{0,9}$/),
  VMMS_ROLE_FIXTURE_DATABASE_CONTAINER_ID: z.string().regex(/^[a-f0-9]{64}$/i),
  VMMS_ROLE_FIXTURE_DATABASE_VOLUME: z.string().regex(/^vmms_role_rehearsal_data_[a-z0-9]{8}$/),
  VMMS_ROLE_FIXTURE_DATABASE_PORT: z.coerce.number().int().min(1024).max(65535),
  VMMS_ROLE_FIXTURE_CALLBACK_URL: z.url(),
  VMMS_ROLE_FIXTURE_WEB_ORIGIN: z.url(),
  VMMS_ROLE_FIXTURE_ISSUER: z.url(),
  VMMS_ROLE_FIXTURE_IDENTITY_RECEIPT: z.string().min(1),
});

const environment = environmentSchema.parse(process.env);
const target = validateLocalRoleFixtureTarget({
  nodeEnv: environment.NODE_ENV,
  enabled: environment.VMMS_ROLE_FIXTURE_ENABLED,
  instanceSlug: environment.VMMS_ROLE_FIXTURE_INSTANCE,
  installationId: environment.VMMS_ROLE_FIXTURE_INSTALLATION_ID,
  databaseUrl: environment.VMMS_ROLE_FIXTURE_DATABASE_URL,
  expectedDatabaseName: environment.VMMS_ROLE_FIXTURE_DATABASE_NAME,
  expectedDatabaseOid: environment.VMMS_ROLE_FIXTURE_DATABASE_OID,
  dockerContainerId: environment.VMMS_ROLE_FIXTURE_DATABASE_CONTAINER_ID,
  issuer: environment.VMMS_ROLE_FIXTURE_ISSUER,
});
if (target.databaseName !== `vmms_role_rehearsal_${environment.VMMS_ROLE_FIXTURE_INSTANCE}`) {
  throw new Error('The database name and rehearsal installation do not match.');
}
if (environment.VMMS_ROLE_FIXTURE_INSTALLATION_ID.replaceAll('-', '').slice(0, 8) !== environment.VMMS_ROLE_FIXTURE_INSTANCE) {
  throw new Error('The rehearsal instance slug does not match its installation ID.');
}
const callbackUrl = new URL(environment.VMMS_ROLE_FIXTURE_CALLBACK_URL);
const webOrigin = new URL(environment.VMMS_ROLE_FIXTURE_WEB_ORIGIN);
if (callbackUrl.protocol !== 'http:' || callbackUrl.hostname !== '127.0.0.1' || callbackUrl.pathname !== '/api/v1/auth/oidc/callback'
  || callbackUrl.search || callbackUrl.hash || callbackUrl.username || callbackUrl.password
  || webOrigin.protocol !== 'http:' || webOrigin.hostname !== '127.0.0.1' || webOrigin.pathname !== '/'
  || webOrigin.search || webOrigin.hash || webOrigin.username || webOrigin.password) {
  throw new Error('The rehearsal browser and callback endpoints must use exact loopback origins.');
}

const inspectTemplate = '{{.Id}}\n{{.Config.Image}}\n{{.State.Running}}\n{{index .Config.Labels "org.raymond-gray.vmms.role-rehearsal"}}\n{{json (index .NetworkSettings.Ports "5432/tcp")}}\n{{json .Mounts}}';
const inspection = execFileSync('docker', ['inspect', '--format', inspectTemplate, environment.VMMS_ROLE_FIXTURE_DATABASE_CONTAINER_ID], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split(/\r?\n/);
if (inspection.length !== 6) throw new Error('Could not verify the owned rehearsal database container.');
const [containerId, image, running, fixtureLabel, publishedPortsJson, mountsJson] = inspection;
if (containerId?.replace(/^sha256:/, '') !== environment.VMMS_ROLE_FIXTURE_DATABASE_CONTAINER_ID
  || image !== 'postgres:18.1' || running !== 'true' || fixtureLabel !== environment.VMMS_ROLE_FIXTURE_INSTANCE) {
  throw new Error('The rehearsal database container is not the recorded owned PostgreSQL instance.');
}
const publishedPorts = z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).parse(JSON.parse(publishedPortsJson ?? 'null'));
if (publishedPorts.length !== 1 || publishedPorts[0]?.HostIp !== '127.0.0.1' || Number(publishedPorts[0]?.HostPort) !== environment.VMMS_ROLE_FIXTURE_DATABASE_PORT) {
  throw new Error('The rehearsal database is not bound to the recorded loopback port.');
}
const mounts = z.array(z.object({ Type: z.string(), Name: z.string() })).parse(JSON.parse(mountsJson ?? 'null'));
if (mounts.length !== 1 || mounts[0]?.Type !== 'volume' || mounts[0]?.Name !== environment.VMMS_ROLE_FIXTURE_DATABASE_VOLUME) {
  throw new Error('The rehearsal database is not using the recorded owned volume.');
}

const manifestUrl = new URL('../../../scripts/local-role-fixtures/personas.json', import.meta.url);
const manifest = z.object({
  schemaVersion: z.literal(1),
  organisation: z.object({ key: z.literal('raymond-gray-rehearsal'), name: z.literal('Raymond Gray role rehearsal') }).strict(),
  site: z.object({ key: z.literal('site-1'), code: z.literal('RHR'), name: z.literal('Role rehearsal service centre') }).strict(),
  staff: z.array(z.object({
    key: z.string(), username: z.string(), displayName: z.string(), email: z.email(),
    roleCode: z.enum(localRoleFixtureRoleCodes), reportsTo: z.string().nullable(),
  }).strict()),
  owner: z.object({ key: z.literal('owner'), username: z.string(), displayName: z.string(), email: z.string().email() }).strict(),
}).strict().parse(JSON.parse(await readFile(manifestUrl, 'utf8')));
const receiptSchema = z.object({
  schemaVersion: z.literal(1),
  installationId: z.string().uuid(),
  issuer: z.url(),
  clientId: z.string().min(1),
  actors: z.array(z.object({ key: z.string(), subject: z.string().uuid() }).strict()),
}).strict();
const receiptPath = resolve(environment.VMMS_ROLE_FIXTURE_IDENTITY_RECEIPT);
const identityReceipt = receiptSchema.parse(JSON.parse(await readFile(receiptPath, 'utf8')));
if (identityReceipt.installationId !== environment.VMMS_ROLE_FIXTURE_INSTALLATION_ID
  || identityReceipt.issuer.replace(/\/$/, '') !== target.issuer) {
  throw new Error('The identity receipt belongs to a different rehearsal installation or issuer.');
}
const slotForIndex = new Map(manifest.staff.map((persona, index) => [persona.key, `p${String(index + 1).padStart(2, '0')}`]));
const keyForSlot = new Map([...slotForIndex].map(([key, slot]) => [slot, key]));
const staffReceipts = identityReceipt.actors.filter(actor => keyForSlot.has(actor.key));
if (!identityReceipt.actors.some(actor => actor.key === `p${String(manifest.staff.length + 1).padStart(2, '0')}`)
  || identityReceipt.actors.length !== manifest.staff.length + 1) {
  throw new Error('The identity receipt must include each staff account and the separate owner identity.');
}
const identities: LocalRoleFixtureIdentity[] = staffReceipts.map(actor => ({
  key: keyForSlot.get(actor.key) ?? actor.key,
  issuer: identityReceipt.issuer,
  subject: actor.subject,
}));
if (staffReceipts.some(actor => !keyForSlot.has(actor.key))) throw new Error('The identity receipt contains an unknown staff fixture slot.');

const pool = new pg.Pool({ connectionString: environment.VMMS_ROLE_FIXTURE_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
try {
  const connected = await pool.query(`SELECT current_database() AS name, oid::text AS oid
    FROM pg_database WHERE datname=current_database()`);
  const databaseIdentity = z.object({ name: z.string(), oid: z.string() }).parse(connected.rows[0]);
  const databaseUrl = new URL(environment.VMMS_ROLE_FIXTURE_DATABASE_URL);
  if (databaseIdentity.name !== environment.VMMS_ROLE_FIXTURE_DATABASE_NAME
    || databaseIdentity.oid !== environment.VMMS_ROLE_FIXTURE_DATABASE_OID
    || Number(databaseUrl.port) !== environment.VMMS_ROLE_FIXTURE_DATABASE_PORT) {
    throw new Error('The database connection does not match the owned rehearsal container and database.');
  }
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  execFileSync('node', ['--import', 'tsx', 'apps/api/scripts/migrate.ts'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', MIGRATION_DATABASE_URL: environment.VMMS_ROLE_FIXTURE_DATABASE_URL },
    stdio: ['ignore', 'inherit', 'pipe'],
  });
  const result = await seedLocalRoleFixtureDatabase(pool, {
    target: {
      nodeEnv: environment.NODE_ENV,
      enabled: environment.VMMS_ROLE_FIXTURE_ENABLED,
      instanceSlug: environment.VMMS_ROLE_FIXTURE_INSTANCE,
      installationId: environment.VMMS_ROLE_FIXTURE_INSTALLATION_ID,
      databaseUrl: environment.VMMS_ROLE_FIXTURE_DATABASE_URL,
      expectedDatabaseName: environment.VMMS_ROLE_FIXTURE_DATABASE_NAME,
      expectedDatabaseOid: environment.VMMS_ROLE_FIXTURE_DATABASE_OID,
      dockerContainerId: environment.VMMS_ROLE_FIXTURE_DATABASE_CONTAINER_ID,
      issuer: environment.VMMS_ROLE_FIXTURE_ISSUER,
    },
    instanceSlug: environment.VMMS_ROLE_FIXTURE_INSTANCE,
    installationId: environment.VMMS_ROLE_FIXTURE_INSTALLATION_ID,
    expectedDatabaseName: environment.VMMS_ROLE_FIXTURE_DATABASE_NAME,
    expectedDatabaseOid: environment.VMMS_ROLE_FIXTURE_DATABASE_OID,
    dockerContainerId: environment.VMMS_ROLE_FIXTURE_DATABASE_CONTAINER_ID,
    issuer: target.issuer,
    personas: manifest.staff,
    identities,
  });
  process.stdout.write(`Prepared isolated VMMS role rehearsal ${environment.VMMS_ROLE_FIXTURE_INSTANCE}: ${result.staffAccountCount} staff accounts, ${result.placementCount} role placements, ${result.operationalGrantCount} operational grants.\n`);
} finally {
  await pool.end();
}
