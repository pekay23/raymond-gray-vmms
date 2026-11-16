# VMMS evidence storage and upload quarantine

16 November 2026 target amendment: the owner rejects Railway and user-managed containers. Follow the [managed-services redesign plan](../delivery/managed-services-redesign-plan-2026-11-16.md) for the proposed replacement. The conditional Supabase/Vercel/Cloudflare recommendation supersedes earlier future-hosting assumptions; existing implementation and verification described below remain historical/current facts until migration is proved. No provider or DNS change is implied.

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
- The repository now contains a private S3-compatible store adapter, streamed upload and download routes, and a leased malware-scan worker. Local synthetic tests exercise the API/storage boundary; production API startup remains deliberately blocked until the approved production store, scanner, IAM, retention and backup controls exist. Development and integration testing use PostgreSQL with a separate non-owner runtime role.
- New object keys use only a cryptographically random evidence UUID under the private `quarantine/` or `accepted/` prefix. Tenant, site and customer identifiers are not embedded in object names; access still depends on database scope and relationship checks. Migration 011 changes key construction for new evidence while leaving existing stored keys untouched. There are no production records to re-key; any non-empty deployment adopting this migration must copy and verify its objects before changing stored key references.

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

The ClamAV response timeout is configured by `VMMS_EVIDENCE_CLAMAV_TIMEOUT_MS`, defaults to 60,000 ms, and is limited to 1,000–60,000 ms. Connect, write and idle-response timeouts and premature socket closure all produce an unavailable scan result. Each NUL-terminated scanner response also has an absolute deadline and a 4 KiB size limit so a slow-trickle or oversized response cannot hold a scan open indefinitely. Unavailable results stay quarantined and cannot be downloaded.

## Lifecycle and failure behavior

1. A scoped, idempotent command creates a single-use upload intent with actor/site, typed purpose, safe display name, claimed media type, configured maximum size and expiry. The server allocates the opaque key. Unused intents expire.
2. Fastify streams request bytes to quarantine while counting bytes, computing SHA-256, and collecting only a bounded prefix for signature-based MIME detection. Empty, oversized, unsupported, or declared/detected-type mismatches are rejected. Partial objects are removed or left inaccessible for reconciliation.
3. In one PostgreSQL transaction, the API locks and consumes the intent, inserts immutable evidence metadata with `pending`/`quarantined` state, and creates a scan job. The canonical metadata and scan attempt are separate: a verdict never rewrites uploaded identity, purpose, hash, size, media type, creator or timestamp.
4. A worker leases scan jobs with `SKIP LOCKED`, verifies the quarantine object against the stored hash, and asks the configured scanner for a verdict. Clean bytes are promoted to a private accepted key and verified again before a narrow database transition can mark the evidence accepted. Infected content is rejected. Timeout, missing scanner, malformed response or hash mismatch remains unavailable and retryable or quarantined; no error path can become accepted.
5. Job claims, verdict writes, promotion, cleanup and upload retries are idempotent. The worker appends scan attempts with engine/version/hash/time and uses bounded retries. A reconciler removes expired intents and orphaned quarantine objects and reports accepted rows whose objects are missing. A repeat with the same command and bytes returns the same result; changed content under a consumed intent conflicts.
6. Each download rechecks current site membership and the domain-specific record/owner relationship, requires the latest clean verdict, writes a sensitive-access event, and streams accepted bytes through the authenticated VMMS API with a sanitized `Content-Disposition` and `Cache-Control: private, no-store`. Do not return raw S3/R2 URLs that remain usable after revocation. If a future client requires a link, use a short-lived VMMS-signed ticket whose redemption repeats current authorization.

The long-running worker emits a fixed structured error event when its claim or processing loop fails, then retries after a bounded delay. The event excludes the raw exception so provider details and credentials cannot be copied into logs. Both idle and retry waits release their abort listeners on completion or shutdown. This is diagnostic output only; production supervision, liveness checks, log retention and alert ownership still require deployment review.

`EvidenceServices` owns the S3 client it creates and exposes one cached, idempotent `close()` operation; with storage disabled, close is a no-op. Configuration is fully validated before creating the client. Passing a service bundle to `createApp()` transfers its lifetime to Fastify, which awaits both service disposal and database-pool shutdown and attempts both even if one fails. `runEvidenceWorker()` similarly owns its service bundle and disposes it on abort or unexpected loop exit; the worker entrypoint closes its database pool in its own `finally` path. Cleanup errors use a fixed safe message and never include SDK or connection exception text. This proves local process resource cleanup, not provider recovery, process supervision, or deployment behavior.

Use a new migration to record the storage object version/key and safe display metadata, upload intents, append-only scan attempts/jobs, and sensitive access/export events. Scope every row by organisation/site and preserve composite foreign keys and FORCE RLS. Immutable metadata and scan events deny runtime update/delete. The API can only create evidence through a function that checks the active scoped intent and creates a non-accepted record; a narrow transition function accepts only verified scan outcomes. Update `lock_accepted_owner_evidence` to require the latest matching clean verdict, not a caller-editable status. Migration tests must preserve currently seeded owner evidence fixtures and prove forged accepted records cannot be created by the runtime role.

## Backup and verification

PostgreSQL PITR does not back up object bytes. The backup process must copy metadata and accepted objects to a separately configured destination, write a reconciliation manifest of evidence ID, object version, byte size and SHA-256, and report missing/orphaned objects. Restore into an isolated target and compare the restored bytes with the restored hashes before reporting success. A local backup test proves the procedure only for that local destination; production backup coverage stays pending until the real destination and restore drill pass. The current offline package-consistency checker in `../verification/evidence-backup-verifier.md` checks a provider-produced manifest, non-empty database snapshot bytes, non-null version identifiers, matching snapshot labels on source/restored evidence catalogs, object hashes, non-overlapping artifact folders and orphan detection. It does not create or restore provider backups, prove catalog provenance, or validate provider-returned version IDs; production execution and a real isolated restore remain required.

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

## Work-order attachment integration

Status: accepted implementation contract for the web workflow. The upload and scan service, typed work-order relationship, versioned API command, staff interface and creator-scoped intent recovery are implemented. PostgreSQL integration now exercises clean-only attachment, no download before linking, durable-link download, audit, lost upload-response lookup and attachment replay. Responsive browser refresh/reselection is verified with deterministic intent/upload API stubs; local PostgreSQL/S3Mock/ClamAV integration verifies the storage lifecycle, infected-fixture denial, single-lease contention, and recovery after an expired worker lease (second claim, accepted state, and one persisted verdict). Real browser-to-storage coverage and operational storage/recovery proof remain open. This contract is grounded in `master-0176`, `upgrade-0073`, `USER-004`, and the existing command/event/outbox model.

### Synthesis decision

Two independently sketched designs agreed that an upload and a work-order attachment are different actions. Candidate B is the base because its surface is smaller: use the existing upload/status/download endpoints, add an append-only typed link, add a versioned attachment command, and project links on the work order. Graft Candidate A's server-led recovery after a lost upload response and its more explicit scan-delay, expiry, network and storage-failure states. Keep staged, unattached evidence visible only to its creator; exposing every target-bound upload to all work-order readers was rejected. The cross-review scored both designs 5/5 on typed scope and scan-state safety; B scored 5/5 for API simplicity, while A scored 5/5 for recovery detail. The synthesis is recorded here; scratch candidates were not promoted to project policy.

### Lifecycle and authorization

1. A writable staff member creates an upload intent for a work order. For `purpose = 'work-order'`, the server requires a target work order in the authenticated organisation/site and binds the intent to that ID; caller-supplied alternate purpose/target values are not used by the work-order UI.
2. The existing same-origin streaming route writes bytes to private quarantine and returns a pending evidence ID. The browser cannot claim acceptance or receive an object-store URL.
3. The UI reads status from the server. Pending, quarantined, unavailable, rejected and accepted remain distinct. Only the current accepted record with a latest clean verdict whose scanned hash equals the stored evidence hash, and a non-empty accepted object key, may be attached.
4. A named `work-order.evidence-attached` staff command carries the evidence ID and current work-order version. Within `runStaffCommand`, current membership is checked, the work order is locked/version-checked, the evidence target and latest scan are checked again, and the typed relationship is inserted. The work-order version, domain event, idempotency receipt and outbox item commit atomically. Attachment does not approve diagnostic consent, repair scope, QA, technical release, commercial closure or vehicle handover.
5. The relation uses an append-only `work_order_evidence_links` table with organisation/site-scoped composite foreign keys, uniqueness, forced RLS, and no runtime update/delete grant. A narrow database function repeats the target and latest-clean checks so direct runtime SQL cannot bypass scan safety.
6. Linked evidence appears to work-order readers with server-derived scan metadata. An unlinked stage is visible only to its creator. Download requires a durable work-order link, current site membership, accepted state, the latest matching clean scan, an access audit written before streaming, and a private/no-store authenticated response. No public or signed object-store URL is returned.

### Recovery and interface

- Store no file bytes in browser storage. Evidence entry may save only a short-lived, tab-scoped pointer (intent ID and safe selection metadata) after explicit staff opt-in. The existing eight-hour draft lifetime remains a proposed policy pending `REV-026` review.
- A creator-scoped intent-status read resolves an upload whose successful response was lost by joining the completed intent to its evidence record through the unique `upload_intent_id`. PostgreSQL integration verifies the uploader can recover their intent before and after upload, while a different same-site staff account and a different-tenant account receive no record. For an issued intent, the user must reselect the file after refresh and confirm filename, size and media type before resending. An expired intent starts a new upload.
- A lost attachment response is resolved from the work-order projection and the same idempotent command receipt. Changed payloads never reuse a command ID; a stale version requires refresh and deliberate resubmission.
- Keep the existing Workshop visual baseline. Use native file input and buttons, visible focus, live status and error messages, phone-friendly reflow and non-color-only state labels. No new artistic direction is introduced by this workflow.

### Verification and boundaries

Remaining verification includes staged evidence visibility; pending, rejected, stale-scan and wrong-target attachment denial; receipt/outbox rollback on injected failure; concurrent duplicate upload/attachment attempts; upload response loss in a browser, refresh/reselection against real storage, expiry, sign-out/site switch, offline and service failure; and keyboard/mobile browser behavior. The API integration proves clean attachment increments version once and creates one event/receipt, replay is idempotent, unlinked work-order evidence cannot download, and linked evidence is audited. It does not close EVID-001 through EVID-006 or F-007 by itself. Scanner timeout/expired-lease recovery, the broader failure matrix, production IAM/KMS, retention, object backup/restore, and operational ownership remain open gates.

## Source and review trail

- Requirements: [R-M-0176](../requirements/requirements.json), [R-U-0073](../requirements/requirements.json), source blocks `master-0176` and `upgrade-0073`.
- Current foundation: [vehicle-owner access](vehicle-owner-access.md), [system design](system-design.md), [task F-007](../delivery/tasks.json).
- Design candidates: [API-streamed quarantine](candidates/evidence-a.md), [direct quarantine upload](candidates/evidence-b.md); independent review was recorded during the 8 November 2026 design run.
- Work-order flow synthesis: this document records Candidate B as the API/command base, with Candidate A's lost-response recovery and granular interface states. It is scoped to work-order evidence and does not approve new visual art direction.
- Runtime references: [Fastify stream parsing](https://fastify.dev/docs/latest/Reference/ContentTypeParser/), [ClamAV INSTREAM protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [S3Mock local integration limits](https://github.com/adobe/S3Mock), [archived MinIO Community upstream](https://github.com/minio/minio).
