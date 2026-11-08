# Evidence storage candidate A: API-streamed quarantine

Status: design candidate only. No upload code, provider, bucket, DNS, or production configuration has been changed.

## Problem

F-007 must validate uploads, keep sensitive objects private, hash the stored bytes, accept evidence only after a configured malware scan, authorize each read, preserve immutable metadata, and prove backup coverage. VMMS already has `evidence_records` with organisation/site scope and a `scan_state`; `lock_accepted_owner_evidence` allows owner-relationship approvals to reference only accepted evidence. The table has no object key, upload path, scanner, download path, or object backup proof, and `vmms_runtime` currently has `SELECT` only. The API is Fastify with a PostgreSQL runtime role, so a boundary adapter can keep object storage and scanning replaceable.

## Usage (caller’s view)

The browser creates a scoped upload intent for a domain purpose, then streams the file to VMMS. It sees a pending result until the scanner records a clean verdict. It never receives a storage credential or public object URL.

```ts
const intent = await createEvidenceIntent(scope, {
  purpose: { kind: "vehicle-owner-approval", vehicleId, ownerAccountId },
  fileName: file.name,
  declaredType: file.type,
});

const result = await streamEvidence(scope, intent.id, file.stream());
// { evidenceId, state: "scan-pending" }

const accepted = await getEvidenceStatus(scope, result.evidenceId);
// { evidenceId, state: "accepted" | "scan-pending" | "quarantined" | "rejected" }
```

An owner-approval command continues to accept an evidence ID, but succeeds only when the current scan verdict is clean and the evidence belongs to the command’s organisation and site. Other domains attach evidence through their own typed association and policy checks; a caller cannot select an arbitrary record ID and turn it into an unrestricted attachment.

## Shape

```ts
type EvidenceState = "scan-pending" | "accepted" | "quarantined" | "rejected";

type EvidencePurpose =
  | { kind: "vehicle-owner-approval"; vehicleId: string; ownerAccountId: string }
  | { kind: "work-order"; workOrderId: string; evidenceKind: string };

type EvidenceMetadata = {
  id: string;
  organisationId: string;
  siteId: string;
  uploadedBy: string;
  purpose: EvidencePurpose;
  displayName: string;
  mediaType: string; // detected from bytes, not trusted from the request
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
};

type ScanDecision = {
  state: Exclude<EvidenceState, "scan-pending">;
  scannedSha256: string;
  engine: string;
  engineVersion: string;
  scannedAt: string;
  detailCode: string;
};

interface PrivateEvidenceStore {
  putQuarantine(key: string, body: AsyncIterable<Uint8Array>, limit: number): Promise<StoredObject>;
  openQuarantine(key: string): Promise<ReadableStream<Uint8Array>>;
  deleteQuarantine(key: string): Promise<void>;
}

interface MalwareScanner {
  scan(body: ReadableStream<Uint8Array>): Promise<ScanDecision>;
}

async function createEvidenceIntent(
  pool: Database,
  scope: Scope,
  commandId: string,
  purpose: EvidencePurpose,
  metadata: { fileName: string; declaredType: string },
): Promise<{ id: string; expiresAt: string }>;

async function streamEvidence(
  pool: Database,
  store: PrivateEvidenceStore,
  scope: Scope,
  input: { intentId: string; body: AsyncIterable<Uint8Array>; declaredType: string },
): Promise<{ evidenceId: string; state: "scan-pending" }>;

async function scanEvidence(
  pool: Database,
  store: PrivateEvidenceStore,
  scanner: MalwareScanner,
  job: EvidenceScanJob,
): Promise<void>;

async function streamAuthorizedEvidence(
  pool: Database,
  store: PrivateEvidenceStore,
  scope: Scope,
  evidenceId: string,
): Promise<{ metadata: EvidenceMetadata; body: ReadableStream<Uint8Array> }>;
```

### Module boundaries

- `apps/api/src/evidence.ts` owns intent lifecycle, policy checks, type sniffing, hashing, scan state, and access audit. It receives a verified `Scope`; it does not parse framework requests or trust browser actor/site values.
- Fastify routes only authenticate, validate the route/body boundary, enforce CSRF on writes, acquire the authorised site scope, stream request bytes into the module, and map errors to existing API responses.
- `PrivateEvidenceStore` hides provider wire details. Production can use S3-compatible private buckets, including a future R2 adapter; local verification can use MinIO. The adapter must have no public-read mode and use opaque generated object keys.
- `MalwareScanner` is configured explicitly, e.g. a private ClamAV service. Missing scanner configuration, timeout, malformed response, or hash disagreement leaves the object unavailable. No implicit “clean” fallback exists.
- A scan outbox/job is committed with the metadata. A separate worker claims jobs, reads only quarantine objects, scans them, and appends a verdict. Owner-access functions must be changed to check the current accepted verdict rather than trusting a mutable free-form state.
- Domain modules own target authorization and typed evidence links. Keep organisation/site plus evidence foreign keys; avoid a polymorphic `record_type/record_id` without database-enforced target integrity.

### Lifecycle and failure handling

1. In a short PostgreSQL transaction, authorize the intended purpose, create a site-scoped single-use upload intent with a command receipt, a random ID, actor, safe display-name metadata, and expiry. Enforce a configured byte limit and detected-type allowlist. Do not put the user filename in the object key.
2. Stream bytes through Fastify without buffering the full file. Enforce the size limit while reading; capture a small prefix for signature-based type detection; compute SHA-256 in the same pass; compare declared type and detected type. Reject empty, unsupported, mismatched, or oversized content and delete any partial quarantine object.
3. Write to a private quarantine key derived from the random intent ID. Do not issue a storage URL. If the database finalization fails after object storage succeeds, the intent remains incomplete and a TTL cleanup job deletes the orphan; cleanup never changes accepted metadata.
4. In one PostgreSQL transaction, finalize the intent, insert immutable evidence metadata and a `scan-pending` event, then enqueue a scan job. Unique intent/command constraints make retries safe. A repeated identical upload returns the same result; different bytes under the same key conflict.
5. The scanner reads the quarantine object and verifies its SHA-256 against the finalized metadata. Append a terminal verdict with engine/version/hash/time. Only a clean verdict matching the stored hash makes evidence usable; malware, scanner unavailability, timeout, or mismatch stays quarantined/rejected. A retry appends another attributable attempt and cannot erase the earlier decision.
6. Download routes re-evaluate current staff site access or current owner relationship plus document publication on every request, append a sensitive-access audit record, and stream from the private store with `Cache-Control: no-store` and sanitized `Content-Disposition`. A short-lived signed VMMS download ticket may be used for handoff, but redemption must still repeat authorization; raw S3/R2 signed URLs must never bypass revocation.
7. Delete/revocation and retention are controlled state changes with audit, not object-key exposure. The retention duration and legal hold rules remain owner decisions. A backup job includes the PostgreSQL metadata/audit and a versioned object manifest, copies objects to the configured independent backup destination, and verifies restored object hash against metadata.

Immutable metadata and changing scan state are separate concepts: the uploaded identity, purpose, bytes, size, detected type, hash, actor, and timestamp never update. Scan attempts are append-only decisions referencing that immutable hash. This requires a migration to replace direct trust in `evidence_records.scan_state`, retain compatibility for existing owner checks, and ensure the application runtime cannot update or delete either metadata or scan history. Only a narrow scan-worker path may append verdicts.

## Verification plan

- Pure boundary tests: empty/oversized streams, declared-vs-detected MIME mismatch, unsupported signatures, deceptive filenames, stream errors, and deterministic SHA-256.
- PostgreSQL runtime-role tests: scoped intent creation, cross-site denial, same-key replay and changed-payload conflict, immutable metadata update/delete denied, scan-decision append constraints, current-accepted-evidence lock, and atomic rollback of intent/metadata/scan-job/receipt on forced failure.
- Local object-store integration: private bucket denies anonymous read/list; partial/failed writes are inaccessible; the uploaded hash equals metadata; rejected or pending objects cannot be downloaded.
- Local scanner integration: clean, infected test fixture, timeout/unavailable service, hash mismatch, retry, and duplicate job. No unavailable/error path may yield `accepted`.
- Download tests: revoked staff membership, expired/revoked owner relationship, wrong-site scope, unpublished document, guessed ID and expired ticket all fail without object bytes; successful access is audited and no-store.
- Backup test: snapshot both metadata and object bytes, restore into an isolated destination, reconcile manifest counts and SHA-256, and verify access remains private. A test backup is not production backup evidence.
- Browser: upload progress, scan-pending, rejection and retry states; accessible errors; no file content shown before authorization.

## Synthesis decision

This is the API-streamed candidate. It prioritizes one server-enforced security boundary and simple revocation semantics. A separate candidate explores direct-to-private-store upload and is the comparison point; neither design is selected until the parent agent scores both against the repository rubric.

## Tradeoffs accepted

- Stream bytes through the API in exchange for one place to enforce scope, size, hash, content detection, and audit; accept API egress and request-duration cost, and set explicit limits.
- Keep originals private and scan asynchronously in exchange for predictable API latency; evidence can remain pending if the worker or scanner is unavailable.
- Keep a provider-neutral adapter in exchange for a small interface and integration burden; do not claim provider portability until MinIO and the selected production object store pass the same contract suite.
- Preserve immutable metadata and append-only scan history in exchange for a migration and a narrow privileged scanner boundary.

## Alternatives considered

- **Direct browser upload to a presigned quarantine object:** lower API bandwidth, but exposes more storage-specific request behavior and complicates size enforcement, completion/idempotency, hash verification, and URL revocation. Candidate B assesses this form.
- **Store files in PostgreSQL bytea:** transactional bytes and metadata are simple, but large binary content bloats the canonical database, backup/restore, and query path. It does not fit the existing S3-compatible system design.
- **Accept after synchronous upload without a scan queue:** fewer tables and worker code, but request timeouts leave ambiguous states and scanner outages tempt fail-open behavior. Rejected; scan-pending must be explicit and durable.

## Open questions and risks

- Which object store and independent backup destination will be provisioned, and which region/residency rules apply?
- Which scanner and supported file-type allowlist are approved, with what maximum size, timeout, retry and retention policy?
- Which domains can upload each evidence purpose, and what named grants are required for each category?
- Which download events require signed one-time tickets versus the existing authenticated session endpoint?
- Who operates and monitors the scan worker and backup restore drills?

## Next implementation step

After comparing the API-streamed and direct-upload candidates, write the selected state model and typed boundary into the accepted evidence-storage architecture, then add the migration and a local private MinIO/scanner contract test before exposing any customer route.
