import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import { Readable } from 'node:stream';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { type Database, scoped, type Scope, uuid } from './db.js';

const MiB = 1024 * 1024;
const uploadName = z.string().trim().min(1).max(255);
const declaredMediaType = z.string().trim().toLowerCase().min(1).max(160);
const uploadPurpose = z.enum([
  'work-order',
  'vehicle-owner-approval',
  'diagnostic',
  'test',
  'procedure-reference',
  'attachment',
]);

export const createEvidenceIntentSchema = z.object({
  purpose: uploadPurpose,
  targetId: uuid.optional(),
  displayName: uploadName,
  declaredMediaType,
  expectedBytes: z.number().int().positive(),
}).strict();

const evidenceState = z.enum(['pending', 'quarantined', 'accepted', 'rejected']);
const evidenceViewSchema = z.object({
  id: uuid,
  purpose: uploadPurpose,
  targetId: uuid.nullable(),
  displayName: z.string(),
  mediaType: z.string(),
  declaredMediaType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  state: evidenceState,
  uploadedAt: z.union([z.date(), z.iso.datetime({ offset: true })]).transform((value) => value instanceof Date ? value.toISOString() : value),
  scanDetailCode: z.string().nullable(),
});
export type EvidenceView = z.infer<typeof evidenceViewSchema>;
export type EvidenceIntentInput = z.infer<typeof createEvidenceIntentSchema>;

export type StoredEvidenceIntent = {
  id: string;
  expiresAt: string;
  maxBytes: number;
  expectedBytes: number;
  displayName: string;
  declaredMediaType: string;
  state: 'issued' | 'completed';
};

export type ScanVerdict =
  | { kind: 'clean' | 'infected'; sha256: string; engine: string; version: string; detailCode: string; scannedAt: Date }
  | { kind: 'unavailable'; engine: string; version: string; detailCode: string; scannedAt: Date }
  | { kind: 'error' | 'hash-mismatch'; sha256?: string; engine: string; version: string; detailCode: string; scannedAt: Date };

export type EvidenceScanJob = {
  jobId: string;
  evidenceId: string;
  organisationId: string;
  siteId: string;
  leaseToken: string;
  attemptNo: number;
  expectedSha256: string;
  quarantineKey: string;
  acceptedKey: string;
  mediaType: string;
  sizeBytes: number;
};

export interface PrivateEvidenceStore {
  putQuarantine(key: string, body: Readable, sizeBytes: number): Promise<void>;
  readQuarantine(key: string): Promise<ReadableStream<Uint8Array>>;
  promoteAccepted(sourceKey: string, targetKey: string): Promise<void>;
  readAccepted(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
}

export interface MalwareScanner {
  scan(input: ReadableStream<Uint8Array>): Promise<ScanVerdict>;
}

export type EvidenceServices = {
  store: PrivateEvidenceStore | null;
  scanner: MalwareScanner | null;
  maxUploadBytes: number;
  allowedMediaTypes: ReadonlySet<string>;
};

export function createEvidenceServices(
  env: NodeJS.ProcessEnv = process.env,
  role: 'api' | 'worker' = 'api',
): EvidenceServices {
  const endpoint = env.VMMS_EVIDENCE_S3_ENDPOINT?.trim();
  const bucket = env.VMMS_EVIDENCE_S3_BUCKET?.trim();
  const accessKeyId = env[role === 'api' ? 'VMMS_EVIDENCE_S3_ACCESS_KEY_ID' : 'VMMS_EVIDENCE_WORKER_S3_ACCESS_KEY_ID']?.trim();
  const secretAccessKey = env[role === 'api' ? 'VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY' : 'VMMS_EVIDENCE_WORKER_S3_SECRET_ACCESS_KEY']?.trim();
  const suppliedStorageValues = [endpoint, bucket, accessKeyId, secretAccessKey].filter(Boolean).length;
  if (suppliedStorageValues !== 0 && suppliedStorageValues !== 4) {
    throw new Error(`VMMS evidence object-store configuration is incomplete for the ${role} role.`);
  }
  let store: PrivateEvidenceStore | null = null;
  if (endpoint && bucket && accessKeyId && secretAccessKey) {
    const parsedEndpoint = z.url().parse(endpoint);
    if (!['http:', 'https:'].includes(new URL(parsedEndpoint).protocol)) {
      throw new Error('VMMS evidence object-store endpoint must use HTTP or HTTPS.');
    }
    const client = new S3Client({
      endpoint: parsedEndpoint,
      region: env.VMMS_EVIDENCE_S3_REGION?.trim() || 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    store = new S3PrivateEvidenceStore(client, bucket);
  }

  const host = env.VMMS_EVIDENCE_CLAMAV_HOST?.trim();
  const portValue = env.VMMS_EVIDENCE_CLAMAV_PORT?.trim();
  if (Boolean(host) !== Boolean(portValue)) {
    throw new Error('VMMS evidence scanner host and port must be configured together.');
  }
  let scanner: MalwareScanner | null = null;
  if (host && portValue) {
    const port = z.coerce.number().int().min(1).max(65535).parse(portValue);
    scanner = new ClamAvScanner(host, port, 60_000);
  }

  const maxUploadBytes = z.coerce.number().int().min(1024).max(100 * MiB)
    .parse(env.VMMS_EVIDENCE_MAX_UPLOAD_BYTES || 10 * MiB);
  const mediaTypes = (env.VMMS_EVIDENCE_ALLOWED_MIME_TYPES || '')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const allowedMediaTypes = new Set(mediaTypes);
  for (const type of allowedMediaTypes) {
    if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(type)) {
      throw new Error('VMMS_EVIDENCE_ALLOWED_MIME_TYPES contains an invalid media type.');
    }
  }
  return { store, scanner, maxUploadBytes, allowedMediaTypes };
}

class S3PrivateEvidenceStore implements PrivateEvidenceStore {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

  async putQuarantine(key: string, body: Readable, sizeBytes: number): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentLength: sizeBytes,
      ContentType: 'application/octet-stream',
      Metadata: { 'vmms-private-state': 'quarantine' },
    }));
  }

  async readQuarantine(key: string): Promise<ReadableStream<Uint8Array>> {
    return objectStream(await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })));
  }

  async promoteAccepted(sourceKey: string, targetKey: string): Promise<void> {
    const source = `/${this.bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`;
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      Key: targetKey,
      CopySource: source,
      MetadataDirective: 'REPLACE',
      ContentType: 'application/octet-stream',
      Metadata: { 'vmms-private-state': 'accepted' },
    }));
  }

  async readAccepted(key: string): Promise<ReadableStream<Uint8Array>> {
    return objectStream(await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function objectStream(response: GetObjectCommandOutput): ReadableStream<Uint8Array> {
  const body = response.Body;
  if (!body?.transformToWebStream) throw new Error('Object store returned an empty or unsupported body.');
  return body.transformToWebStream();
}

class ClamAvScanner implements MalwareScanner {
  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs: number) {}

  async scan(input: ReadableStream<Uint8Array>): Promise<ScanVerdict> {
    const scannedAt = new Date();
    const digest = createHash('sha256');
    let version = 'unknown';
    let versionSocket: net.Socket | undefined;
    let scanSocket: net.Socket | undefined;
    try {
      versionSocket = net.createConnection({ host: this.host, port: this.port });
      versionSocket.setTimeout(this.timeoutMs);
      await connectSocket(versionSocket);
      await writeSocket(versionSocket, Buffer.from('zVERSION\0'));
      version = await readNulTerminated(versionSocket);
      versionSocket.destroy();
      versionSocket = undefined;

      scanSocket = net.createConnection({ host: this.host, port: this.port });
      scanSocket.setTimeout(this.timeoutMs);
      await connectSocket(scanSocket);
      await writeSocket(scanSocket, Buffer.from('zINSTREAM\0'));
      for await (const raw of Readable.fromWeb(input)) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
        if (chunk.length === 0) continue;
        digest.update(chunk);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        await writeSocket(scanSocket, size);
        await writeSocket(scanSocket, chunk);
      }
      await writeSocket(scanSocket, Buffer.alloc(4));
      const response = await readNulTerminated(scanSocket);
      const sha256 = digest.digest('hex');
      if (/^stream:\s*OK$/i.test(response)) {
        return { kind: 'clean', sha256, engine: 'ClamAV', version: version.slice(0, 160), detailCode: 'clean', scannedAt };
      }
      if (/\sFOUND$/i.test(response)) {
        return { kind: 'infected', sha256, engine: 'ClamAV', version: version.slice(0, 160), detailCode: 'signature-found', scannedAt };
      }
      return { kind: 'unavailable', engine: 'ClamAV', version: version.slice(0, 160), detailCode: 'scanner-protocol-error', scannedAt };
    } catch {
      versionSocket?.destroy();
      scanSocket?.destroy();
      return { kind: 'unavailable', engine: 'ClamAV', version: version.slice(0, 160), detailCode: 'scanner-unavailable', scannedAt };
    } finally {
      versionSocket?.end();
      scanSocket?.end();
    }
  }
}

function connectSocket(socket: net.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onConnect = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('error', onError);
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
}

function writeSocket(socket: net.Socket, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onDrain = () => { cleanup(); resolve(); };
    const cleanup = () => {
      socket.off('error', onError);
      socket.off('drain', onDrain);
    };
    socket.once('error', onError);
    if (socket.write(bytes)) {
      cleanup();
      resolve();
    } else {
      socket.once('drain', onDrain);
    }
  });
}

function readNulTerminated(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      const end = data.indexOf(0);
      if (end < 0) return;
      cleanup();
      resolve(data.subarray(0, end).toString('utf8'));
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onTimeout = () => { cleanup(); reject(new Error('ClamAV response timed out.')); };
    const onEnd = () => { cleanup(); reject(new Error('ClamAV closed the connection before completing its response.')); };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
      socket.off('end', onEnd);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    socket.once('end', onEnd);
  });
}

export async function createEvidenceIntent(
  pool: Database,
  scope: Scope,
  commandId: string,
  input: EvidenceIntentInput,
  services: EvidenceServices,
): Promise<StoredEvidenceIntent> {
  if (!services.store) throw new ApiError(503, 'EVIDENCE_STORAGE_UNAVAILABLE', 'Evidence storage is not configured.');
  if (input.expectedBytes > services.maxUploadBytes) throw new ApiError(413, 'EVIDENCE_TOO_LARGE', 'The selected file exceeds the configured upload limit.');
  if (!services.allowedMediaTypes.has(input.declaredMediaType)) throw new ApiError(415, 'EVIDENCE_TYPE_NOT_ALLOWED', 'This file type is not enabled for evidence uploads.');
  return scoped(pool, scope, async (client) => {
    const values = [randomUUID(), scope.organisationId, scope.siteId, scope.actorId, commandId, input.purpose,
      input.targetId ?? null, input.displayName, input.declaredMediaType, input.expectedBytes];
    const inserted = await client.query(`
      INSERT INTO evidence_upload_intents (
        id, organisation_id, site_id, created_by, command_id, purpose_kind, target_id,
        display_name, declared_media_type, expected_bytes, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '20 minutes')
      ON CONFLICT (organisation_id,site_id,created_by,command_id) DO NOTHING
      RETURNING id,expires_at,expected_bytes,display_name,declared_media_type,state`, values);
    let row = inserted.rows[0];
    if (!row) {
      const prior = await client.query(`
        SELECT id,expires_at,expected_bytes,display_name,declared_media_type,state,
               purpose_kind,target_id
        FROM evidence_upload_intents
        WHERE organisation_id=$1 AND site_id=$2 AND created_by=$3 AND command_id=$4
        `, [scope.organisationId, scope.siteId, scope.actorId, commandId]);
      row = prior.rows[0];
      if (!row) throw new ApiError(409, 'EVIDENCE_INTENT_CONFLICT', 'The upload request could not be resumed. Start a new upload.');
      const same = row.expected_bytes === input.expectedBytes && row.display_name === input.displayName
        && row.declared_media_type === input.declaredMediaType && row.purpose_kind === input.purpose
        && row.target_id === (input.targetId ?? null);
      if (!same) throw new ApiError(409, 'EVIDENCE_INTENT_CONFLICT', 'This upload command was already used with different file details.');
    }
    return {
      id: uuid.parse(row.id),
      expiresAt: z.iso.datetime({ offset: true }).parse(new Date(row.expires_at).toISOString()),
      maxBytes: services.maxUploadBytes,
      expectedBytes: Number(row.expected_bytes),
      displayName: z.string().parse(row.display_name),
      declaredMediaType: z.string().parse(row.declared_media_type),
      state: z.enum(['issued','completed']).parse(row.state),
    };
  });
}

async function readIntentForUpload(pool: Database, scope: Scope, intentId: string): Promise<StoredEvidenceIntent> {
  return scoped(pool, scope, async (client) => {
    const found = await client.query(`
      SELECT id,expires_at,expected_bytes,display_name,declared_media_type,state
      FROM evidence_upload_intents WHERE id=$1 AND created_by=$2`, [intentId, scope.actorId]);
    const row = found.rows[0];
    if (!row) throw new ApiError(404, 'EVIDENCE_INTENT_NOT_FOUND', 'The upload request was not found.');
    if (row.state === 'completed') throw new ApiError(409, 'EVIDENCE_INTENT_CONSUMED', 'This upload request has already been used.');
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new ApiError(410, 'EVIDENCE_INTENT_EXPIRED', 'This upload request expired. Start a new upload.');
    return {
      id: uuid.parse(row.id),
      expiresAt: new Date(row.expires_at).toISOString(),
      maxBytes: Number.MAX_SAFE_INTEGER,
      expectedBytes: Number(row.expected_bytes),
      displayName: z.string().parse(row.display_name),
      declaredMediaType: z.string().parse(row.declared_media_type),
      state: 'issued',
    };
  });
}

async function prefixAndRemainder(body: Readable, maxPrefixBytes: number) {
  const iterator = body[Symbol.asyncIterator]();
  const prefixChunks: Buffer[] = [];
  let prefixLength = 0;
  let ended = false;
  while (prefixLength < maxPrefixBytes) {
    const item = await iterator.next();
    if (item.done) { ended = true; break; }
    const chunk = Buffer.isBuffer(item.value) ? item.value : Buffer.from(item.value as Uint8Array);
    prefixChunks.push(chunk);
    prefixLength += chunk.length;
    if (prefixLength >= maxPrefixBytes) break;
  }
  const prefix = Buffer.concat(prefixChunks, prefixLength);
  const remainder = Readable.from((async function* () {
    for (const chunk of prefixChunks) yield chunk;
    if (!ended) {
      for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    }
  })());
  return { prefix, remainder };
}

export async function uploadEvidence(
  pool: Database,
  scope: Scope,
  intentId: string,
  body: Readable,
  contentLength: number,
  services: EvidenceServices,
): Promise<{ evidenceId: string; state: 'pending'; sha256: string; sizeBytes: number; mediaType: string }> {
  const intent = await readIntentForUpload(pool, scope, intentId);
  if (!services.store) throw new ApiError(503, 'EVIDENCE_STORAGE_UNAVAILABLE', 'Evidence storage is not configured.');
  if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength !== intent.expectedBytes || contentLength > services.maxUploadBytes) {
    body.destroy();
    throw new ApiError(413, 'EVIDENCE_SIZE_MISMATCH', 'The uploaded file size does not match the upload request.');
  }

  const { prefix, remainder } = await prefixAndRemainder(body, 4100);
  const detected = await fileTypeFromBuffer(prefix);
  if (!detected || !services.allowedMediaTypes.has(detected.mime)) {
    body.destroy();
    throw new ApiError(415, 'EVIDENCE_TYPE_NOT_ALLOWED', 'The file contents do not match an enabled evidence type.');
  }
  if (detected.mime !== intent.declaredMediaType) {
    body.destroy();
    throw new ApiError(415, 'EVIDENCE_TYPE_MISMATCH', 'The file contents do not match the declared file type.');
  }

  const evidenceId = randomUUID();
  const quarantineKey = `quarantine/${scope.organisationId}/${scope.siteId}/${evidenceId}`;
  const digest = createHash('sha256');
  let sizeBytes = 0;
  const metered = Readable.from((async function* () {
    for await (const raw of remainder) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      sizeBytes += chunk.length;
      if (sizeBytes > intent.expectedBytes || sizeBytes > services.maxUploadBytes) {
        throw new ApiError(413, 'EVIDENCE_TOO_LARGE', 'The upload exceeded its declared or configured size.');
      }
      digest.update(chunk);
      yield chunk;
    }
    if (sizeBytes !== intent.expectedBytes) throw new ApiError(400, 'EVIDENCE_SIZE_MISMATCH', 'The uploaded file was incomplete.');
  })());

  try {
    await services.store.putQuarantine(quarantineKey, metered, intent.expectedBytes);
    const sha256 = digest.digest('hex');
    await scoped(pool, scope, async (client) => {
      await client.query('SELECT public.finalize_evidence_upload($1,$2,$3,$4,$5)', [intent.id, evidenceId, detected.mime, sizeBytes, sha256]);
    });
    return { evidenceId, state: 'pending', sha256, sizeBytes, mediaType: detected.mime };
  } catch (error) {
    await services.store.delete(quarantineKey).catch(() => {});
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'EVIDENCE_UPLOAD_FAILED', 'The file could not be stored safely. Start a new upload.');
  }
}

export async function readEvidence(pool: Database, scope: Scope, evidenceId: string): Promise<EvidenceView> {
  return scoped(pool, scope, async (client) => {
    const result = await client.query(`
      SELECT e.id,e.purpose_kind AS purpose,e.target_id AS "targetId",e.display_name AS "displayName",
             e.media_type AS "mediaType",e.declared_media_type AS "declaredMediaType",
             e.size_bytes::int AS "sizeBytes",e.sha256,e.scan_state AS state,e.created_at AS "uploadedAt",
             latest.detail_code AS "scanDetailCode"
      FROM evidence_records e
      LEFT JOIN LATERAL (
        SELECT a.detail_code FROM evidence_scan_attempts a
        WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
        ORDER BY a.attempt_no DESC LIMIT 1
      ) latest ON true
      WHERE e.id=$1 AND e.organisation_id=$2 AND e.site_id=$3 AND e.upload_intent_id IS NOT NULL`,
      [evidenceId, scope.organisationId, scope.siteId]);
    if (!result.rowCount) throw new ApiError(404, 'EVIDENCE_NOT_FOUND', 'The evidence record was not found.');
    return evidenceViewSchema.parse(result.rows[0]);
  });
}

export async function beginEvidenceDownload(
  pool: Database,
  scope: Scope,
  evidenceId: string,
  requestId: string,
): Promise<{ evidence: EvidenceView; acceptedKey: string }> {
  return scoped(pool, scope, async (client) => {
    const result = await client.query(`
      SELECT e.id,e.purpose_kind AS purpose,e.target_id AS "targetId",e.display_name AS "displayName",
             e.media_type AS "mediaType",e.declared_media_type AS "declaredMediaType",
             e.size_bytes::int AS "sizeBytes",e.sha256,e.scan_state AS state,e.created_at AS "uploadedAt",
             e.accepted_key AS "acceptedKey",latest.detail_code AS "scanDetailCode"
      FROM evidence_records e
      LEFT JOIN LATERAL (
        SELECT a.detail_code,a.verdict,a.scanned_sha256 FROM evidence_scan_attempts a
        WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
        ORDER BY a.attempt_no DESC LIMIT 1
      ) latest ON true
      WHERE e.id=$1 AND e.organisation_id=$2 AND e.site_id=$3 AND e.upload_intent_id IS NOT NULL
        AND e.scan_state='accepted' AND e.accepted_key IS NOT NULL
        AND latest.verdict='clean' AND latest.scanned_sha256=e.sha256
      `, [evidenceId, scope.organisationId, scope.siteId]);
    if (!result.rowCount) throw new ApiError(404, 'EVIDENCE_NOT_FOUND', 'The evidence record was not found.');
    const row = result.rows[0] as Record<string, unknown>;
    const evidence = evidenceViewSchema.parse(row);
    const acceptedKey = z.string().min(1).parse(row.acceptedKey);
    await client.query(`
      INSERT INTO evidence_access_events (id,organisation_id,site_id,evidence_id,actor_id,action,request_id)
      VALUES ($1,$2,$3,$4,$5,'download-started',$6)`,
    [randomUUID(), scope.organisationId, scope.siteId, evidenceId, scope.actorId, requestId]);
    return { evidence, acceptedKey };
  });
}

async function measureObject(stream: ReadableStream<Uint8Array>): Promise<{ sha256: string; sizeBytes: number }> {
  const digest = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of Readable.fromWeb(stream)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    sizeBytes += bytes.length;
    digest.update(bytes);
  }
  return { sha256: digest.digest('hex'), sizeBytes };
}

export async function processNextEvidenceScanJob(pool: Database, services: EvidenceServices): Promise<boolean> {
  const claim = await pool.query('SELECT * FROM public.claim_evidence_scan_job($1)', [120]);
  const raw = claim.rows[0] as Record<string, unknown> | undefined;
  if (!raw) return false;
  const job: EvidenceScanJob = {
    jobId: uuid.parse(raw.job_id),
    evidenceId: uuid.parse(raw.evidence_id),
    organisationId: uuid.parse(raw.organisation_id),
    siteId: uuid.parse(raw.site_id),
    leaseToken: uuid.parse(raw.lease_token),
    attemptNo: z.number().int().positive().parse(raw.attempt_no),
    expectedSha256: z.string().regex(/^[0-9a-f]{64}$/).parse(raw.expected_sha256),
    quarantineKey: z.string().min(1).parse(raw.quarantine_key),
    acceptedKey: z.string().min(1).parse(raw.accepted_key),
    mediaType: z.string().min(1).parse(raw.media_type),
    sizeBytes: Number(raw.size_bytes),
  };
  let verdict: ScanVerdict;
  let acceptedReady = false;
  if (!services.scanner) {
    verdict = { kind: 'unavailable', engine: 'unconfigured', version: 'n/a', detailCode: 'scanner-unconfigured', scannedAt: new Date() };
  } else if (!services.store) {
    verdict = { kind: 'error', engine: 'vmms-storage', version: 'n/a', detailCode: 'storage-unconfigured' , scannedAt: new Date() };
  } else {
    try {
      const quarantine = await measureObject(await services.store.readQuarantine(job.quarantineKey));
      if (quarantine.sha256 !== job.expectedSha256 || quarantine.sizeBytes !== job.sizeBytes) {
        verdict = { kind: 'hash-mismatch', sha256: quarantine.sha256, engine: 'vmms-storage', version: 'n/a', detailCode: 'quarantine-object-metadata-mismatch', scannedAt: new Date() };
      } else {
        verdict = await services.scanner.scan(await services.store.readQuarantine(job.quarantineKey));
      }
      if (verdict.kind === 'clean' && verdict.sha256 === job.expectedSha256 && quarantine.sha256 === job.expectedSha256) {
        await services.store.promoteAccepted(job.quarantineKey, job.acceptedKey);
        const accepted = await measureObject(await services.store.readAccepted(job.acceptedKey));
        if (accepted.sha256 !== job.expectedSha256 || accepted.sizeBytes !== job.sizeBytes) {
          verdict = { kind: 'hash-mismatch', sha256: accepted.sha256, engine: verdict.engine, version: verdict.version, detailCode: 'accepted-object-metadata-mismatch', scannedAt: new Date() };
        } else {
          acceptedReady = true;
        }
      } else if (verdict.kind === 'clean') {
        verdict = { kind: 'hash-mismatch', sha256: verdict.sha256, engine: verdict.engine, version: verdict.version, detailCode: 'scanner-hash-mismatch', scannedAt: verdict.scannedAt };
      }
    } catch {
      verdict = { kind: 'error', engine: 'vmms-storage', version: 'n/a', detailCode: 'quarantine-read-or-promotion-failed', scannedAt: new Date() };
    }
  }
  if (verdict.kind === 'clean' && !acceptedReady) {
    verdict = { kind: 'error', engine: verdict.engine, version: verdict.version, detailCode: 'accepted-copy-not-verified', scannedAt: new Date() };
  }
  const completed = await pool.query(`
    SELECT public.complete_evidence_scan_job($1,$2,$3,$4,$5,$6,$7,$8) AS completed`,
  [job.jobId, job.leaseToken, verdict.kind, 'sha256' in verdict ? verdict.sha256 : null,
    verdict.engine, verdict.version, verdict.detailCode, verdict.scannedAt]);
  if (!z.boolean().parse(completed.rows[0]?.completed)) return true;
  return true;
}

export async function runEvidenceWorker(pool: Database, services: EvidenceServices, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const processed = await processNextEvidenceScanJob(pool, services);
      if (!processed) await delay(1000, signal);
    } catch {
      await delay(3000, signal);
    }
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export const evidenceUuid = uuid;
