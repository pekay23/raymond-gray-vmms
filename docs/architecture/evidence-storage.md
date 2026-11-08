# VMMS evidence storage and upload quarantine

Status: accepted engineering design for implementation. Production storage, malware scanner, retention, backup destination and upload limits remain pending operational review. No production provider or secrets have been selected.

## Caller contract

Staff initiate an evidence upload for a supported purpose, stream the file to the same-origin VMMS API, and receive an evidence ID with a pending scan state. They can query that state. The browser never receives object-store credentials, a public object URL, or permission to mark a file safe. A work-order or owner-approval command can reference evidence only after the current server-side scan decision is accepted.

```ts
type EvidencePurpose =
  | { kind: "vehicle-owner-approval"; vehicleId: string; ownerAccountId: string }
  | { kind: "work-order"; workOrderId: string; evidenceKind: string };

type EvidenceState = "pending" | "quarantined" | "accepted" | "rejected";

type EvidenceView = {
  id: string;
  purpose: EvidencePurpose;
  displayName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  state: EvidenceState;
  uploadedAt: string;
};

createUploadIntent(scope, commandId, purpose, claimedMetadata)
  -> Promise<{ intentId: string; expiresAt: string; maxBytes: number }>;

uploadEvidence(scope, intentId, requestBody)
  -> Promise<{ evidenceId: string; state: "quarantined" }>;

readEvidence(scope, evidenceId)
  -> Promise<EvidenceView>;

downloadEvidence(scope, evidenceId)
  -> Promise<{ metadata: EvidenceView; stream: ReadableStream<Uint8Array> }>;
```

The API derives actor, organisation and site from its verified session. Purpose-specific authorization stays in the owning domain. A typed purpose is a request to stage evidence, not proof of an attachment or approval; domain commands create the durable, typed link. Future domains add their own target-specific association rather than a free-form table/ID pointer.

## Current system boundaries

- `evidence_records` already stores organisation/site, SHA-256, media type, byte size, creator, timestamp and coarse scan state. FORCE RLS and the composite site foreign key are present. The runtime has read-only access, while owner approval uses a security-definer lock that currently accepts only `scan_state = 'accepted'`.
- `apps/api/src/app.ts` owns Fastify routes, CSRF checks and derivation of the site scope. `apps/api/src/owner-access.ts` owns the owner-specific approval policy and must continue to check the latest accepted verdict in the same transaction as the approval command.
- There is no object store adapter, upload/download route, malware scan process or object backup proof. Production API startup is deliberately blocked. Development and integration testing use PostgreSQL with a separate non-owner runtime role.

## Selected shape

Use an API-streamed, same-origin upload into a private S3-compatible quarantine store. The evidence domain module owns upload-intent lifecycle, byte/type validation, hashing, scan state, access checks and access audit. A private-store adapter owns S3 protocol details. A scanner adapter owns its wire protocol. Fastify only validates the request boundary, requires CSRF, derives the authorised scope, streams bytes, and maps domain errors.

Candidate review scored API-streamed versus browser-to-store uploads on security enforcement, recovery, fit with current Fastify/PostgreSQL, backup operations, and caller complexity. The independent judge preferred API-streamed 22/25 to direct upload 20/25. The direct-upload candidate contributes the accepted queue behavior: worker leases, bounded retries, explicit state transitions, orphan reconciliation and database/object reconciliation manifests. Direct upload remains an option if measured file sizes make API bandwidth a real constraint and the selected provider can enforce upload size and checksum limits.

```ts
interface PrivateEvidenceStore {
  putQuarantine(key: string, body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<StoredObject>;
  readQuarantine(key: string): Promise<ReadableStream<Uint8Array>>;
  promoteAccepted(sourceKey: string, targetKey: string): Promise<void>;
  readAccepted(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
}

interface MalwareScanner {
  scan(input: ReadableStream<Uint8Array>): Promise<ScanVerdict>;
}

type ScanVerdict =
  | { kind: "clean"; sha256: string; engine: string; version: string; completedAt: Date }
  | { kind: "infected"; sha256: string; engine: string; version: string; code: string; completedAt: Date }
  | { kind: "unavailable"; retryable: boolean; code: string };
```

The application stores opaque random object keys only. Never put filenames, customer names, VINs, contact information or source record IDs into a storage key. Storage is private by default with no public-read or list capability. The API and scan worker use separate object-store identities: the API identity is limited to quarantine writes/deletes and accepted-object reads; the worker identity is limited to quarantine reads and accepted-object copies/reads. Neither identity receives bucket listing or public access. Production configuration must explicitly supply both roles, the scanner, file-size limit, allowlist and worker health; missing or failed configuration never marks an upload accepted.

## Lifecycle and failure behavior

1. A scoped, idempotent command creates a single-use upload intent with actor/site, typed purpose, safe display name, claimed media type, configured maximum size and expiry. The server allocates the opaque key. Unused intents expire.
2. Fastify streams request bytes to quarantine while counting bytes, computing SHA-256, and collecting only a bounded prefix for signature-based MIME detection. Empty, oversized, unsupported, or declared/detected-type mismatches are rejected. Partial objects are removed or left inaccessible for reconciliation.
3. In one PostgreSQL transaction, the API locks and consumes the intent, inserts immutable evidence metadata with `pending`/`quarantined` state, and creates a scan job. The canonical metadata and scan attempt are separate: a verdict never rewrites uploaded identity, purpose, hash, size, media type, creator or timestamp.
4. A worker leases scan jobs with `SKIP LOCKED`, verifies the quarantine object against the stored hash, and asks the configured scanner for a verdict. Clean bytes are promoted to a private accepted key and verified again before a narrow database transition can mark the evidence accepted. Infected content is rejected. Timeout, missing scanner, malformed response or hash mismatch remains unavailable and retryable or quarantined; no error path can become accepted.
5. Job claims, verdict writes, promotion, cleanup and upload retries are idempotent. The worker appends scan attempts with engine/version/hash/time and uses bounded retries. A reconciler removes expired intents and orphaned quarantine objects and reports accepted rows whose objects are missing. A repeat with the same command and bytes returns the same result; changed content under a consumed intent conflicts.
6. Each download rechecks current site membership and the domain-specific record/owner relationship, requires the latest clean verdict, writes a sensitive-access event, and streams accepted bytes through the authenticated VMMS API with a sanitized `Content-Disposition` and `Cache-Control: private, no-store`. Do not return raw S3/R2 URLs that remain usable after revocation. If a future client requires a link, use a short-lived VMMS-signed ticket whose redemption repeats current authorization.

Use a new migration to record the storage object version/key and safe display metadata, upload intents, append-only scan attempts/jobs, and sensitive access/export events. Scope every row by organisation/site and preserve composite foreign keys and FORCE RLS. Immutable metadata and scan events deny runtime update/delete. The API can only create evidence through a function that checks the active scoped intent and creates a non-accepted record; a narrow transition function accepts only verified scan outcomes. Update `lock_accepted_owner_evidence` to require the latest matching clean verdict, not a caller-editable status. Migration tests must preserve currently seeded owner evidence fixtures and prove forged accepted records cannot be created by the runtime role.

## Backup and verification

PostgreSQL PITR does not back up object bytes. The backup process must copy metadata and accepted objects to a separately configured destination, write a reconciliation manifest of evidence ID, object version, byte size and SHA-256, and report missing/orphaned objects. Restore into an isolated target and compare the restored bytes with the restored hashes before reporting success. A local backup test proves the procedure only for that local destination; production backup coverage stays pending until the real destination and restore drill pass.

Before exposing uploads, verify:

- empty, oversized, unsupported-signature, deceptive-name, type-mismatch and interrupted streams;
- hash consistency from request through quarantine, accepted object and download;
- clean, infected, unavailable, stale-signature, timeout, malformed response and retry behavior;
- one-use intent, idempotent replay, changed-payload conflict, expiry and orphan cleanup;
- runtime-role immutability, scope/RLS, forged actor/site denial, cross-organisation/site reads and unauthorized owner/record downloads;
- access event written before a successful response, no-store headers and denied reads after revocation;
- metadata plus object backup/restore reconciliation and a failed restore that does not report success.

Local S3 API integration may use Adobe S3Mock plus ClamAV, isolated to loopback and synthetic data. S3Mock is a test server only: it does not validate presigned URLs and cannot prove production IAM, KMS, provider versioning, or backup behavior. Do not use the archived MinIO Community repository as a new development dependency. Production provider, backup destination, availability/restore targets, approved file types, maximum size, quotas, retention/legal hold, scanner signature updates and named operations owner are recorded for review in [`review-register.md`](../decisions/review-register.md). The exact operational decisions are still open; do not deploy or claim full F-007 verification until they are resolved.

## Alternatives rejected

- **Direct browser upload to a presigned object URL:** less API bandwidth, but couples size/hash enforcement and upload completion to provider capabilities and makes revocation/URL leakage harder. Reconsider only after measured upload-size evidence and provider enforcement tests.
- **Store bytes in PostgreSQL:** rejected because it bloats the canonical transactional database and its backups.
- **Synchronous scan before returning the upload request:** rejected because scanner latency and outages would make user requests fragile and tempt fail-open handling; durable `quarantined` state is safer.
- **Public or merely hard-to-guess object URLs:** rejected because opaque identifiers do not implement authorization, scan gating or revocation.

## Source and review trail

- Requirements: [R-M-0176](../requirements/requirements.json), [R-U-0073](../requirements/requirements.json), source blocks `master-0176` and `upgrade-0073`.
- Current foundation: [vehicle-owner access](vehicle-owner-access.md), [system design](system-design.md), [task F-007](../delivery/tasks.json).
- Design candidates: [API-streamed quarantine](candidates/evidence-a.md), [direct quarantine upload](candidates/evidence-b.md); independent review was recorded during the 8 November 2026 design run.
- Runtime references: [Fastify stream parsing](https://fastify.dev/docs/latest/Reference/ContentTypeParser/), [ClamAV INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [S3Mock local integration limits](https://github.com/adobe/S3Mock), [archived MinIO Community upstream](https://github.com/minio/minio).
