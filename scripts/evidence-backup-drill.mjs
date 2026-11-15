#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const runId = randomUUID().replaceAll('-', '');
const sourceDb = `vmms_evid_drill_src_${runId}`;
const restoreDb = `vmms_evid_drill_restore_${runId}`;
const namePattern = /^vmms_evid_drill_(?:src|restore)_[a-f0-9]{32}$/;
const evidenceId = randomUUID();
const organisationId = randomUUID();
const siteId = randomUUID();
const staffId = randomUUID();
const syntheticBytes = Buffer.from(`SYNTHETIC VMMS EVIDENCE BACKUP DRILL ${runId}\n`, 'utf8');
const sha256 = createHash('sha256').update(syntheticBytes).digest('hex');
const sourceKey = `accepted/${evidenceId}`;
const restoredObjectKey = `drill-restore-${runId}/${sourceKey}`;
const bucket = process.env.VMMS_DRILL_S3_BUCKET ?? 'vmms-test-evidence';
const endpoint = process.env.VMMS_DRILL_S3_ENDPOINT ?? 'http://127.0.0.1:19091';
const accessKeyId = process.env.VMMS_DRILL_S3_ACCESS_KEY_ID ?? 'vmms-local-test';
const secretAccessKey = process.env.VMMS_DRILL_S3_SECRET_ACCESS_KEY ?? 'vmms-local-test-secret';
const host = process.env.VMMS_DRILL_PGHOST ?? '127.0.0.1';
const port = Number(process.env.VMMS_DRILL_PGPORT ?? '55432');
const user = process.env.VMMS_DRILL_PGUSER ?? 'vmms_owner';
const password = process.env.VMMS_DRILL_PGPASSWORD ?? 'vmms_local_development_only';
const adminDatabase = 'postgres';
let tempRoot;
let backupRoot;
let restoreRoot;
let dbDumpPath;
let manifestPath;
let sourceCatalogPath;
let restoredCatalogPath;

if (!namePattern.test(sourceDb) || !namePattern.test(restoreDb) || sourceDb === restoreDb) {
  throw new Error('Generated scratch database names failed their safety check.');
}
if (!Number.isInteger(port) || port < 1 || port > 65535 || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('The drill only connects to a local PostgreSQL endpoint. Configure a loopback VMMS_DRILL_PGHOST and valid port.');
}
if (!/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(endpoint)) {
  throw new Error('The drill only connects to a loopback S3Mock endpoint.');
}

const adminUrl = connectionUrl(adminDatabase);
const s3 = new S3Client({
  endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const createdDatabases = new Set();
const createdObjects = new Set();

function connectionUrl(database) {
  const url = new URL('postgresql://localhost');
  url.hostname = host;
  url.port = String(port);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

function checkedScratchRoot(root) {
  const resolved = path.resolve(root);
  const temp = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith(`vmms-evidence-drill-${runId}-`)) {
    throw new Error('Refusing recursive cleanup outside this drill run’s exact temporary directory.');
  }
  return resolved;
}

function quoteGeneratedDatabase(name) {
  if (!namePattern.test(name)) throw new Error('Refusing an unrecognized database identifier.');
  return `"${name}"`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, windowsHide: true, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      : reject(new Error(`${path.basename(command)} exited ${code}: ${(stderr || stdout).trim()}`)));
  });
}

async function streamCommand(command, args, direction, filePath, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, windowsHide: true, env });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    const fileStream = direction === 'output'
      ? createWriteStream(filePath, { flags: 'wx' })
      : createReadStream(filePath);
    const stream = direction === 'output' ? child.stdout : fileStream;
    const sink = direction === 'output' ? fileStream : child.stdin;
    stream.pipe(sink);
    const fail = error => { child.kill(); reject(error); };
    fileStream.on('error', fail);
    child.on('error', fail);
    child.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(command)} exited ${code}: ${stderr.trim()}`)));
  });
}

async function createDatabase(name) {
  if (!namePattern.test(name)) throw new Error('Refusing to create a database outside the generated scratch-name pattern.');
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const present = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (present.rowCount !== 0) throw new Error(`Generated database ${name} already exists; refusing to reuse it.`);
    await client.query(`CREATE DATABASE ${quoteGeneratedDatabase(name)}`);
    createdDatabases.add(name);
  } finally {
    await client.end();
  }
}

async function seedSourceDatabase() {
  const client = new pg.Client({ connectionString: connectionUrl(sourceDb), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO organisations(id,name) VALUES($1,$2)', [organisationId, `Synthetic backup drill ${runId}`]);
    await client.query('INSERT INTO sites(id,organisation_id,code,name) VALUES($1,$2,$3,$4)', [siteId, organisationId, `DRILL-${runId.slice(0, 8)}`, 'Synthetic backup drill site']);
    await client.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)', [staffId, `synthetic-drill-${runId}`, 'Synthetic drill fixture', 'not-a-login-password']);
    await client.query(`
      INSERT INTO evidence_records(
        id,organisation_id,site_id,scan_state,sha256,media_type,size_bytes,created_by,
        purpose_kind,target_id,display_name,declared_media_type,quarantine_key,accepted_key
      ) VALUES($1,$2,$3,'accepted',$4,'text/plain',$5,$6,'attachment',NULL,
        'synthetic-backup-drill.txt','text/plain',$7,$8)
    `, [evidenceId, organisationId, siteId, sha256, syntheticBytes.length, staffId, `quarantine/${evidenceId}`, sourceKey]);
    await client.query(`
      INSERT INTO evidence_scan_attempts(
        id,organisation_id,site_id,evidence_id,attempt_no,verdict,scanned_sha256,engine,engine_version,detail_code,scanned_at
      ) VALUES($1,$2,$3,$4,1,'clean',$5,'synthetic-drill','1','clean',now())
    `, [randomUUID(), organisationId, siteId, evidenceId, sha256]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function exportCatalog(database, snapshotId, filePath) {
  const client = new pg.Client({ connectionString: connectionUrl(database), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT id::text AS "evidenceId",
        CASE WHEN scan_state='accepted' THEN 'accepted' ELSE 'quarantine' END AS "objectType",
        CASE WHEN scan_state='accepted' THEN accepted_key ELSE quarantine_key END AS "objectKey",
        size_bytes::int AS "sizeBytes", sha256
      FROM evidence_records
      WHERE id=$1 AND organisation_id=$2 AND site_id=$3
    `, [evidenceId, organisationId, siteId]);
    if (result.rowCount !== 1) throw new Error(`Expected one synthetic evidence row in ${database}; found ${result.rowCount}.`);
    await writeFile(filePath, JSON.stringify({ databaseSnapshotId: snapshotId, entries: result.rows }, null, 2), { flag: 'wx' });
  } finally {
    await client.end();
  }
}

async function objectBytes(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function ensureDockerPostgres() {
  const { stdout } = await run('docker', ['compose', 'ps', '-q', 'postgres']);
  const containerId = stdout.split(/\r?\n/)[0]?.trim();
  if (!containerId || !/^[a-f0-9]{12,64}$/i.test(containerId)) {
    throw new Error('The existing local PostgreSQL Compose service is not running. Start it separately, then rerun the drill.');
  }
  return containerId;
}

async function copyAndRestoreObject() {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: sourceKey, Body: syntheticBytes, ContentType: 'text/plain' }));
  createdObjects.add(sourceKey);
  const downloaded = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sourceKey }));
  const sourceObjectBytes = await objectBytes(downloaded.Body);
  const backupObjectPath = path.join(backupRoot, 'objects', sourceKey);
  await mkdir(path.dirname(backupObjectPath), { recursive: true });
  await writeFile(backupObjectPath, sourceObjectBytes, { flag: 'wx' });
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: restoredObjectKey, Body: sourceObjectBytes, ContentType: 'text/plain' }));
  createdObjects.add(restoredObjectKey);
  const restored = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: restoredObjectKey }));
  const restoredBytes = await objectBytes(restored.Body);
  const restoredObjectPath = path.join(restoreRoot, sourceKey);
  await mkdir(path.dirname(restoredObjectPath), { recursive: true });
  await writeFile(restoredObjectPath, restoredBytes, { flag: 'wx' });
}

async function cleanup() {
  const failures = [];
  for (const key of createdObjects) {
    try { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }
    catch (error) { failures.push(`S3Mock object ${key}: ${error.message}`); }
  }
  if (createdDatabases.size) {
    const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      for (const database of createdDatabases) {
        try {
          await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]);
          await client.query(`DROP DATABASE IF EXISTS ${quoteGeneratedDatabase(database)}`);
        } catch (error) {
          failures.push(`Scratch database ${database}: ${error.message}`);
        }
      }
    } catch (error) {
      failures.push(`Connect to local PostgreSQL for scratch cleanup: ${error.message}`);
    } finally {
      await client.end().catch(() => {});
    }
  }
  if (tempRoot) {
    try { await rm(checkedScratchRoot(tempRoot), { recursive: true, force: true }); }
    catch (error) { failures.push(`Temporary artifacts: ${error.message}`); }
  }
  return failures;
}

let report;
try {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), `vmms-evidence-drill-${runId}-`));
  backupRoot = path.join(tempRoot, 'backup');
  restoreRoot = path.join(tempRoot, 'restore');
  dbDumpPath = path.join(backupRoot, 'database.dump');
  manifestPath = path.join(tempRoot, 'manifest.json');
  sourceCatalogPath = path.join(tempRoot, 'source-catalog.json');
  restoredCatalogPath = path.join(tempRoot, 'restored-catalog.json');
  await mkdir(path.join(backupRoot, 'objects'), { recursive: true });
  await mkdir(restoreRoot, { recursive: true });
  const containerId = await ensureDockerPostgres();
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  await admin.connect();
  const runtimeRole = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'vmms_runtime'");
  await admin.end();
  if (runtimeRole.rowCount !== 1) {
    throw new Error('The local VMMS runtime role must already exist; the drill will not create shared PostgreSQL roles.');
  }

  await createDatabase(sourceDb);
  await createDatabase(restoreDb);

  const migrationEnv = {
    ...process.env,
    NODE_ENV: 'test',
    MIGRATION_DATABASE_URL: connectionUrl(sourceDb),
  };
  await run(process.execPath, [path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'apps/api/scripts/migrate.ts'], { env: migrationEnv });
  await seedSourceDatabase();

  const dockerEnv = { ...process.env, PGPASSWORD: password };
  await streamCommand('docker', ['exec', '-i', '-e', 'PGPASSWORD', containerId, 'pg_dump', '--format=custom', '--no-owner', '--no-acl', '-U', user, '-d', sourceDb], 'output', dbDumpPath, dockerEnv);
  const dumpBytes = await readFile(dbDumpPath);
  if (dumpBytes.length === 0) throw new Error('pg_dump produced an empty scratch database snapshot.');
  await streamCommand('docker', ['exec', '-i', '-e', 'PGPASSWORD', containerId, 'pg_restore', '--no-owner', '--no-acl', '--exit-on-error', '--dbname', restoreDb, '-U', user], 'input', dbDumpPath, dockerEnv);

  const snapshotId = `synthetic-db-snapshot-${runId}`;
  await exportCatalog(sourceDb, snapshotId, sourceCatalogPath);
  await exportCatalog(restoreDb, snapshotId, restoredCatalogPath);
  await copyAndRestoreObject();

  const databaseHash = createHash('sha256').update(dumpBytes).digest('hex');
  const manifest = {
    schemaVersion: 1,
    backupId: `synthetic-backup-${runId}`,
    databaseSnapshot: {
      snapshotId,
      backupVersionId: `SIMULATED-S3MOCK-DB-BACKUP-${runId}`,
      artifactPath: 'database.dump',
      sizeBytes: dumpBytes.length,
      sha256: databaseHash,
    },
    objects: [{
      evidenceId,
      objectType: 'accepted',
      objectKey: sourceKey,
      sourceVersionId: `SIMULATED-S3MOCK-SOURCE-${runId}`,
      backupVersionId: `SIMULATED-S3MOCK-BACKUP-${runId}`,
      backupPath: `objects/${sourceKey}`,
      sizeBytes: syntheticBytes.length,
      sha256,
    }],
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });

  const verifier = await run('python', [
    path.join(repo, 'scripts', 'verify-evidence-backup.py'),
    '--manifest', manifestPath,
    '--backup-root', backupRoot,
    '--restore-root', restoreRoot,
    '--source-catalog', sourceCatalogPath,
    '--restored-catalog', restoredCatalogPath,
  ]);
  report = {
    verifierOutput: verifier.stdout,
    drill: {
      drill: 'synthetic-local-evidence-backup-restore',
      sourceDatabase: sourceDb,
      restoredDatabase: restoreDb,
      evidenceObjects: 1,
      databaseSnapshotBytes: dumpBytes.length,
      objectBytes: syntheticBytes.length,
      versionIdentifiers: 'simulated manifest values; not provider-returned or independently validated',
      productionCoverage: false,
      limitations: [
        'Uses only a synthetic evidence row and synthetic object bytes.',
        'S3Mock transfer and local pg_dump/pg_restore do not prove a production provider backup or recovery.',
        'Version identifiers in the manifest are simulated; S3Mock versioning and provider-returned IDs are not asserted.',
        'Does not prove production destination isolation, IAM, encryption, retention, availability, RPO, RTO, or ownership.',
        'Does not constitute UAT or close production EVID-006.',
      ],
    },
  };
} finally {
  const failures = await cleanup();
  try { await s3.destroy(); } catch (error) { failures.push(`Close S3 client: ${error.message}`); }
  if (failures.length) throw new Error(`Recovery drill cleanup failed; do not treat the run as passed: ${failures.join('; ')}`);
}

console.log(report.verifierOutput);
console.log(JSON.stringify(report.drill, null, 2));
