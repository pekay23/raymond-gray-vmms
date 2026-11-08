# Candidate B — scoped direct upload into quarantine

## Problem

F-007 must protect sensitive attachments from the moment they are uploaded through access, export and backup. Current `evidence_records` rows describe site scope, hash, media type, size, creator, and a coarse scan state, but there is no object-store adapter, upload route, scanner workflow, download path, or backup proof. The Node/Fastify API uses PostgreSQL, server-derived `Scope`, RLS, and per-domain authorization. Existing owner approval commands require an accepted evidence record; the API role currently cannot insert or change those records directly.

The direct-upload shape keeps file bytes out of the request API while preserving server control over whether an upload becomes evidence. It is acceptable only with a provider that can enforce the configured size policy at upload time or with a hard private-site quota plus immediate post-upload rejection and cleanup.

## Usage

```ts
const intent = await evidence.createUploadIntent(scope, {
  commandId,
  target: { kind: "owner-access-approval", vehicleId, ownerAccountId },
  file: { displayName, claimedMediaType, claimedSize },
});

await fetch(intent.putUrl, {
  method: "PUT",
  headers: intent.requiredHeaders,
  body: file,
});

const result = await evidence.finalizeUpload(scope, intent.id);
// result is quarantined; never treat finalize as proof that content is safe.
```

Callers receive an opaque intent ID, one short-lived, single-object PUT URL, the exact required headers, and an expiry. They never choose the storage key or provide trusted organisation, site, actor, detected media type, scan result, or accepted state. The UI polls the VMMS API for the scan state and displays `quarantined`, `accepted`, or `rejected`; only `accepted` can satisfy an evidence requirement.

## Shape

```ts
type EvidenceState = "quarantined" | "accepted" | "rejected";
type ScanOutcome =
  | { kind: "clean"; engine: string; engineVersion: string; signatureSet?: string }
  | { kind: "infected"; engine: string; engineVersion: string; detectionCode: string }
  | { kind: "unavailable"; retryAfter?: Date };

type EvidenceTarget =
  | { kind: "owner-access-approval"; vehicleId: string; ownerAccountId: string }
  | { kind: "work-order"; workOrderId: string; taskId?: string }
  | { kind: "intake"; visitId: string };

interface PrivateObjectStore {
  createUploadGrant(input: {
    quarantineKey: string;
    expiresAt: Date;
    contentType: string;
    maxBytes: number;
    checksumSha256?: string;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  headQuarantine(key: string): Promise<{ sizeBytes: number; contentType?: string; etag?: string }>;
  readQuarantine(key: string): Promise<ReadableStream<Uint8Array>>;
  promoteVerified(sourceKey: string, destinationKey: string): Promise<void>;
  createDownloadGrant(key: string, expiresAt: Date, disposition: string): Promise<string>;
  deleteQuarantine(key: string): Promise<void>;
}

interface MalwareScanner {
  scan(content: ReadableStream<Uint8Array>): Promise<ScanOutcome>;
}

createUploadIntent(pool, scope, commandId, target, fileMetadata)
  -> Promise<UploadIntentView>
finalizeUpload(pool, scope, intentId)
  -> Promise<QuarantinedEvidenceView>
processEvidenceScan(pool, store, scanner, leasedJob)
  -> Promise<"accepted" | "rejected" | "retry">
issueEvidenceDownload(pool, store, scope, evidenceId, purpose)
  -> Promise<{ url: string; expiresAt: Date }>
```

`evidence.ts` owns upload intent, finalize, scan transition, evidence reads, and download policy. `private-object-store.ts` owns S3-compatible provider operations. `malware-scanner.ts` owns the configured scanner protocol. `app.ts` only parses route input, requires CSRF for writes, derives staff scope with `authorisedScope`, calls the domain functions, and serializes their typed results. No route accepts raw storage credentials or an object key.

`EvidenceTarget` is a discriminated union rather than a free-form table/ID pair. Attachment relations are stored in target-specific tables with organisation/site foreign keys, or in existing typed revision rows where evidence is already part of the decision. Avoid a polymorphic target pointer that the database cannot foreign-key. Adding a new target requires a new domain-specific link, not an unchecked string.

## State and failure flow

1. In a scoped transaction, `createUploadIntent` validates the configured allowlist and maximum size, checks permission for the target action, creates an opaque single-use intent with actor/site/target/expiry and an idempotency receipt, and commits. The object key is random and contains no customer name, VIN, or other PII. The API then signs the short-lived upload capability. If signing fails, the intent remains unconsumed and expires; the response does not claim an upload was saved.
2. The browser writes bytes directly to the private quarantine bucket using only the scoped grant. The bucket has no public ACL, listing, or browser read access. CORS is limited to the exact VMMS web origins and `PUT`.
3. `finalizeUpload` locks the intent and verifies its actor, site, target, unused state, and expiry. It reads object metadata, enforces the configured size, streams bytes to detect the actual type and SHA-256, and rejects mismatched or unsupported content. It creates immutable evidence metadata in `quarantined` state and appends a scan job in the same PostgreSQL transaction. A provider ETag or browser-supplied hash alone is not accepted as the content hash.
4. A dedicated worker leases scan jobs and scans the quarantine object. Clean content is promoted to a private immutable clean-object key; the worker verifies the promoted object digest before the database transition function can mark the evidence `accepted`. A detection marks it `rejected`; scanner outage, timeout, unknown result, or promotion mismatch leaves it quarantined and schedules bounded retry/alerting. No failure path sets `accepted`.
5. Upload, scan, promotion, cleanup and outbox delivery are at-least-once and idempotent. Unique intent/evidence IDs, object hashes, job IDs, worker leases and a legal state-transition function make retries safe. An expired or abandoned upload is deleted by a reconciler; database deletion is never used as the only cleanup signal for an object.
6. A download request rechecks current staff site/record authority or the current vehicle-owner relationship on every request, requires `accepted`, and writes an attributable access/export event before returning a very short-lived signed GET URL. Use `Content-Disposition: attachment`, a safe server-derived media type, `Cache-Control: private, no-store`, and no redirect to public storage. If immediate revocation of an already issued URL is required, proxy the response through an authorization-checking endpoint instead of issuing a bearer URL.

## Persistence, immutability, and backup

Extend `evidence_records` through a new migration with immutable object identifier/version, safe display filename, verified media metadata, content hash, scan engine/version/result/timestamp, and target links. Preserve the existing organisation/site composite foreign key and FORCE RLS. Add an `evidence_upload_intents` table for actor/site/target, requested metadata, expiry, single-use state, idempotency, and opaque quarantine key. Add append-only scan/access/export events; keep evidence state transitions in narrow security-definer functions. Revoke runtime `UPDATE`/`DELETE` of evidence metadata and events; the API and scanner receive only function-scoped transition rights, not table-owner rights. Scope every SELECT, HEAD, signing, export, and scan operation by derived tenant/site authority.

Use two private buckets/prefixes: quarantine and accepted. Database PITR alone is not a file backup. Configure object versioning or equivalent immutability where supported, an independent backup destination, lifecycle rules reviewed for retention, and a daily reconciliation manifest containing evidence ID, object version, size, and SHA-256. A restore drill must restore both metadata and bytes and verify each restored digest; record orphan and missing-object findings. Provider selection, backup destination, retention/legal hold and restore targets remain operational decisions, so F-007 cannot claim backup inclusion until the configured provider is exercised.

## Verification

- Real PostgreSQL runtime-role tests: same-site success; wrong-site and wrong-organisation denial; forged actor/site ignored; current owner relationship checked on every download; non-accepted and expired intent denied; immutable metadata/event rejection; scan transition function only accepts allowed transitions.
- Store/scanner integration tests: unsupported extension and actual MIME mismatch rejected; zero/over-limit objects rejected; hash mismatch rejected; public/list access denied; short-lived grants expire; scanner clean/infected/unavailable; retry after crash between copy and DB transition; deduplicated finalize, scan and cleanup; content not downloadable before acceptance.
- Export/download tests: access event committed before grant is returned; no owner endpoint exposes prior-owner details; exact filename, safe content disposition and `no-store`; revocation blocks the next download request.
- Configured local S3-compatible store plus malware scanner should be exercised (for example isolated MinIO and ClamAV containers); no private source/customer data enters that environment. Production-equivalent backup and restore must be tested against the selected provider.
- Threat and limits review covers upload flooding, signed-URL leakage, MIME polyglots, decompression/parser attacks, scanner signature staleness, oversized objects, abandoned uploads, presigned URL logs/referrers, bucket policy drift, object deletion races, and backup key recovery.

## Alternatives and tradeoffs

- **Selected candidate shape:** direct-to-private-quarantine upload plus explicit finalize and out-of-band scan. We accept intent/reconciliation complexity and a provider capability gate in exchange for keeping large bytes off the API, making the scanner an isolated worker, and preserving clear quarantine/acceptance transitions.
- **API-streamed upload:** simpler to enforce streaming byte limits and hash content in one path, but makes the API a bandwidth bottleneck and couples request limits/timeouts to object size. It remains the fallback if a selected store cannot enforce the upload grant safely.
- **Public or merely obscure object keys:** rejected. They expose sensitive evidence without current product authorization and are not protected by opaque IDs alone.
- **Synchronous scan on the request path:** rejected. It makes user-facing uploads depend on scanner latency and encourages fail-open timeouts; a durable quarantined state and retriable worker are easier to audit.
- **Store acceptance state in object tags only:** rejected. PostgreSQL is the canonical authority for tenant scope, attachment links, scan decision and audit; object tags are provider metadata and cannot atomically authorize business use.

## Open questions

- Which production private store and independent backup destination will be used, and what are the restore-time and restore-point targets?
- Which malware scanner, signature update process, retry/alert owner and permitted unavailable-scanner behavior will be operated?
- Which file types, per-file/site quotas, retention rules, legal holds and export workflow does management approve?
- Can the selected provider enforce maximum object size and required checksum headers on short-lived upload grants? If not, should the deployment use the API-streamed fallback or another provider?
- Do any record types require immediate invalidation of issued download URLs, making an authenticated proxy mandatory?

## Synthesis decision

Pending comparison with Candidate A and independent review. This document is a design candidate, not an accepted storage-provider decision or operational approval.

## Next implementation step

Prototype the selected adapter against an isolated S3-compatible development store and scanner, then prove finalize, retry, quarantine, acceptance and denial using synthetic PostgreSQL records before exposing any upload route.
