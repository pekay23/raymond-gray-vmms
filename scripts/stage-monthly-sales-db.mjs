import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
loadEnv({ path: resolve(root, '.env'), quiet: true });

function requireLocalUrl(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is required.`);
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error(`${name} must target loopback PostgreSQL.`);
  if (url.pathname !== '/vmms' || url.search || url.hash) throw new Error(`${name} must target the local VMMS development database.`);
  return url;
}

function batchIdFor(hash) {
  const bytes = createHash('sha256').update(`raymond-gray-vmms:monthly-sales:${hash}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function validateSource(batch) {
  if (batch?.schemaVersion !== 1 || batch?.mappingVersion !== 'rg-monthly-sales-report-v1') throw new Error('The private source batch has an unsupported format.');
  if (!/^[a-f0-9]{64}$/.test(batch.batch?.sourceFileSha256 ?? '') || !Array.isArray(batch.records)) throw new Error('The private source batch is incomplete.');
  if (batch.batch?.operationalRecordsWritten !== false || batch.batch?.worksheet !== 'SUMMARY' || batch.policy?.promotionState !== 'staging-only') throw new Error('The source batch must remain staging-only.');
  if (batch.policy?.createsServiceClient !== false || batch.policy?.verifiesCurrentVehicleOwner !== false || batch.policy?.createsOwnerAccess !== false || batch.policy?.createsWorkOrders !== false || batch.policy?.importsSalesRepresentative !== false) throw new Error('The source batch has an unsafe promotion policy.');
  if (batch.records.length !== batch.counts?.rows || batch.records.length > 100_000) throw new Error('The source batch row count does not reconcile.');
  const sourceRows = new Set();
  for (const record of batch.records) {
    if (typeof record.sourceRowId !== 'string' || sourceRows.has(record.sourceRowId)) throw new Error('The source batch contains a missing or duplicate row reference.');
    sourceRows.add(record.sourceRowId);
    if (record.state !== 'source-staging-only' || !Array.isArray(record.reviewFlags) || 'salesRep' in record || 'salesRepresentative' in record) throw new Error('The source batch contains an unexpected field or state.');
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Source staging cannot run in production.');
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source');
  if (sourceIndex < 0 || !args[sourceIndex + 1]) throw new Error('Pass --source with the protected sales-claims.json path.');
  const sourcePath = resolve(args[sourceIndex + 1]);
  const appData = process.env.LOCALAPPDATA;
  if (process.platform !== 'win32' || !appData) throw new Error('Database staging requires the protected Windows local staging directory.');
  const allowedRoot = resolve(appData, 'VMMS-Import-Staging');
  const rel = relative(allowedRoot, sourcePath);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || !sourcePath.toLowerCase().endsWith(`${sep}sales-claims.json`.toLowerCase())) {
    throw new Error('The source file must be inside the protected local VMMS import staging directory.');
  }
  const batch = JSON.parse(await readFile(sourcePath, 'utf8'));
  validateSource(batch);
  const migrationUrl = requireLocalUrl('MIGRATION_DATABASE_URL');
  const runtimeUrl = requireLocalUrl('DATABASE_URL');
  if (migrationUrl.hostname !== runtimeUrl.hostname || migrationUrl.port !== runtimeUrl.port) throw new Error('Migration and runtime URLs must target the same local PostgreSQL instance.');

  const pool = new pg.Pool({ connectionString: migrationUrl.toString(), connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  const client = await pool.connect();
  const batchId = batchIdFor(batch.batch.sourceFileSha256);
  let inserted = false;
  try {
    const identity = await client.query(`SELECT current_database() AS database, current_user AS role,
      (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged,
      to_regclass('vmms_import_staging.sales_batches') IS NOT NULL AS staging_ready`);
    const db = identity.rows[0];
    if (db?.database !== 'vmms' || !db.privileged || !db.staging_ready) throw new Error('The connection is not the expected local VMMS staging database.');

    await client.query('BEGIN');
    const policy = { sourceMeaning: 'unconfirmed-sales-customer-claim', operationalEffects: 'none', scopeState: 'pending-owner-review' };
    const batchInsert = await client.query(`INSERT INTO vmms_import_staging.sales_batches
      (batch_id,source_file_sha256,source_file_name,mapping_version,worksheet,report_period_from,report_period_through,row_count,policy)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(source_file_sha256) DO NOTHING`, [
      batchId, batch.batch.sourceFileSha256, batch.batch.sourceFileName, batch.mappingVersion, batch.batch.worksheet,
      batch.batch.reportTitlePeriod.from, batch.batch.reportTitlePeriod.through, batch.records.length, JSON.stringify(policy),
    ]);
    inserted = batchInsert.rowCount === 1;
    const storedBatch = await client.query(`SELECT batch_id,source_file_name,mapping_version,worksheet,report_period_from::text,report_period_through::text,row_count,policy
      FROM vmms_import_staging.sales_batches WHERE source_file_sha256=$1 FOR UPDATE`, [batch.batch.sourceFileSha256]);
    const expectedBatch = [batchId,batch.batch.sourceFileName,batch.mappingVersion,batch.batch.worksheet,batch.batch.reportTitlePeriod.from,batch.batch.reportTitlePeriod.through,batch.records.length,policy];
    const actualBatch = storedBatch.rows[0] && [storedBatch.rows[0].batch_id,storedBatch.rows[0].source_file_name,storedBatch.rows[0].mapping_version,storedBatch.rows[0].worksheet,storedBatch.rows[0].report_period_from,storedBatch.rows[0].report_period_through,storedBatch.rows[0].row_count,storedBatch.rows[0].policy];
    if (!actualBatch || canonical(actualBatch) !== canonical(expectedBatch)) throw new Error('An existing source batch uses this file hash with different metadata.');

    const rows = batch.records.map(record => ({
      source_row_id: record.sourceRowId,
      source_row_number: record.sourceRowNumber,
      delivery_date_raw: record.deliveryDateRaw,
      delivery_date_normalized: record.deliveryDateNormalized,
      vehicle_model_raw: record.vehicleModelRaw,
      chassis_number_raw: record.chassisNumberRaw,
      chassis_number_candidate: record.chassisNumberCandidate,
      registration_raw: record.registrationRaw,
      sales_customer_name_claim_raw: record.salesCustomerNameClaimRaw,
      review_flags: record.reviewFlags,
      source_row_sha256: createHash('sha256').update(canonical(record)).digest('hex'),
    }));
    await client.query(`INSERT INTO vmms_import_staging.sales_source_rows
      (batch_id,source_row_id,source_row_number,delivery_date_raw,delivery_date_normalized,vehicle_model_raw,chassis_number_raw,chassis_number_candidate,registration_raw,sales_customer_name_claim_raw,review_flags,source_row_sha256)
      SELECT $1,r.source_row_id,r.source_row_number,r.delivery_date_raw,r.delivery_date_normalized,r.vehicle_model_raw,r.chassis_number_raw,r.chassis_number_candidate,r.registration_raw,r.sales_customer_name_claim_raw,r.review_flags,r.source_row_sha256
      FROM jsonb_to_recordset($2::jsonb) AS r(source_row_id text,source_row_number text,delivery_date_raw text,delivery_date_normalized date,vehicle_model_raw text,chassis_number_raw text,chassis_number_candidate text,registration_raw text,sales_customer_name_claim_raw text,review_flags jsonb,source_row_sha256 text)
      ON CONFLICT(batch_id,source_row_id) DO NOTHING`, [batchId, JSON.stringify(rows)]);
    const verify = await client.query(`SELECT count(*)::int AS count,
      count(*) FILTER(WHERE s.source_row_sha256 IS DISTINCT FROM e.source_row_sha256)::int AS changed
      FROM vmms_import_staging.sales_source_rows s
      LEFT JOIN jsonb_to_recordset($2::jsonb) AS e(source_row_id text,source_row_sha256 text) USING(source_row_id)
      WHERE s.batch_id=$1`, [batchId, JSON.stringify(rows)]);
    if (verify.rows[0]?.count !== rows.length || verify.rows[0]?.changed !== 0) throw new Error('Database staging rows did not reconcile to the source batch.');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const runtimePool = new pg.Pool({ connectionString: runtimeUrl.toString(), connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    let denied = false;
    try {
      await runtimePool.query('SELECT 1 FROM vmms_import_staging.sales_source_rows LIMIT 1');
    } catch (error) {
      denied = error?.code === '42501';
    }
    if (!denied) throw new Error('The VMMS runtime role can access restricted sales staging.');
  } finally {
    await runtimePool.end();
  }
  process.stdout.write(JSON.stringify({ ok: true, batchId, rows: batch.records.length, state: 'source-staged', operationalRecordsWritten: false, runtimeAccess: 'denied', replay: !inserted }) + '\n');
}

main().catch(error => {
  const safeMessage = typeof error?.message === 'string' && /^(The |An |Pass |Source |Database |Migration |The connection |An existing |Database staging |The VMMS )/.test(error.message)
    ? error.message
    : 'Local sales staging failed; no operational records were promoted.';
  process.stderr.write(`${safeMessage}\n`);
  process.exitCode = 1;
});
