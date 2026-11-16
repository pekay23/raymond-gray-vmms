# Parts foundation candidate A

**Status:** Candidate architecture only; not yet selected or implemented.  
**Scope:** Site-scoped catalogue proposals and recorded goods receipts that remain quarantined.  
**Source requirements:** `master-0078`, `master-0080`, `master-0120` / `BR-11`.

## Caller use

An authorized staff member searches suppliers explicitly associated with the current site, records a manufacturer part proposal and its vehicle-variant evidence, then revises it without overwriting the prior revision. A receiving staff member records what arrived against a supplier reference, snapshots the catalogue revision and the received lot/serial details, and submits the receipt. VMMS returns an attributable receipt whose full quantity is `quarantined`; the receipt cannot be reserved, issued, fitted, billed or treated as accepted stock.

This is evidence capture, not approval. A compatibility document can be malware-accepted and readable while its technical claim remains unreviewed. The API must not turn evidence presence, a role name, a receipt, or a supplier assertion into fitment or inspection authority.

## Candidate module boundary

```text
apps/api/src/parts-catalogue.ts
  savePartsCatalogueDraft(pool, scope, commandId, input)
  listPartsCatalogueDrafts(pool, scope, requestId, query)

apps/api/src/goods-receipts.ts
  recordGoodsReceipt(pool, scope, commandId, input)
  listGoodsReceipts(pool, scope, requestId, query)
```

Fastify exposes named routes under `/api/v1/sites/:siteId/parts/...`; it derives actor, organisation and site from the authenticated session. Both domain modules own strict Zod schemas and projections. They use the existing `runStaffCommand` envelope for mutations and `recordSensitiveRead` for protected reads. They do not expose database row types to the browser.

## Type sketch

```ts
type PartsCapability =
  | 'parts.catalogue-draft.read'
  | 'parts.catalogue-draft.manage'
  | 'parts.goods-receipt.read'
  | 'parts.goods-receipt.record';

type VariantReference = {
  make: string;
  model: string;
  modelYearFrom: number | null;
  modelYearTo: number | null;
  trimOrPowertrain: string | null;
  sourceEvidenceIds: string[];
};

type CatalogueDraftContent = {
  manufacturerPartNumber: string;
  description: string;
  unitCode: string; // selected from a small controlled unit list
  variant: VariantReference;
  supplierReference: string | null;
  compatibilityEvidenceIds: string[];
  revisionNote: string;
};

type PartsCatalogueDraft = {
  draftId: string;
  revisionId: string;
  revision: number;
  previousRevision: number | null;
  content: CatalogueDraftContent;
  fitmentState: 'unapproved';
  createdAt: string;
};

type GoodsReceiptInput = {
  receiptId: string;
  expectedReceiptRevision: number;
  catalogueDraftId: string;
  catalogueRevisionId: string;
  supplierId: string; // must have an explicit active association to this site
  supplierDocumentReference: string;
  receivedAt: string; // event claim, paired with server-recorded time
  items: Array<{
    lineId: string;
    quantity: string; // bounded exact decimal, never binary floating point
    unitCode: string;
    supplierLotReference: string | null;
    serials: string[];
    evidenceIds: string[];
  }>;
  correctionNote: string | null;
};

type GoodsReceipt = {
  receiptId: string;
  revision: number;
  lines: Array<{
    lineId: string;
    catalogueRevisionId: string;
    receivedQuantity: string;
    unitCode: string;
    lotId: string | null;
    quarantinedQuantity: string;
  }>;
  state: 'quarantined';
  fitmentState: 'unapproved';
  createdAt: string;
};
```

The sketch deliberately omits status fields that would imply acceptance. Any future transition from quarantine requires a separately designed command, signed policy, named inspection grant and its own task/evidence.

## Storage and transaction shape

Migration `079_parts_catalogue_receipt_quarantine.sql` is the next available number after `078_oidc_rp_logout_transactions.sql` at this review. Recheck migration ordering before implementation.

Use append-only, organisation/site-scoped tables:

- Supplier association: explicit site-to-canonical-party link with active state and creator/revision metadata. Do not broaden the existing service-customer lookup to find suppliers.
- Catalogue draft and revision: stable draft identity plus immutable content revisions, manufacturer number, exact variant claim, unit, source references, author, capability grant snapshot, command identity and timestamp. No approved-equivalent relation is created.
- Receipt and receipt revision: stable receipt identity plus immutable correction revisions, supplier association, supplier document reference, received-time claim and server time, exact catalogue revision, receipt author/grant, and correction reason.
- Receipt lines and custody identities: exact decimal quantity and unit, supplier lot reference, line-level evidence, and serial identity separate from receipt events so the same physical serial can be traced across later receipt/correction events.
- Domain events, idempotency receipts and outbox entries use the shared command transaction. RLS and runtime grants keep all business rows tenant/site-scoped and immutable to the runtime role.

Use existing command serialization roots for receipt revision, catalogue revision and the actor's capability grants. Grant-registry changes must acquire the same grant lock; otherwise a grant could be revoked between the check and commit. The read path holds current membership and grant checks through projection and read-audit insertion.

## Authorization and audit

Role labels alone do not authorize parts actions. Check the newest active capability grant for the exact actor, organisation and site at action time, reject a revoked/expired/latest-revision-mismatched grant, and snapshot grant ID/revision on every write. Require writable site membership for commands. Reads use named read capabilities and are entered in the sensitive-read audit stream.

Extend both the TypeScript audit-action union and the database validation allowlist in the migration; preserve the existing actions. Read actions should distinguish catalogue-draft lists from receipt lists. Denials cover wrong site, inactive membership, read-only membership, missing/revoked/expired grants, unassociated supplier, mismatched catalogue revision, duplicate serial within a receipt, invalid quantity/unit and stale revision.

## Revision, correction and concurrency rules

- Same command ID and same canonical payload replays the committed response without a second receipt or audit mutation; same ID with changed payload conflicts.
- Catalogue updates require the caller's expected current revision and append a new immutable revision.
- A receipt correction appends a revision with an explicit reason. It cannot erase the original receipt, change a line silently, or create non-quarantined quantity.
- Serialize overlapping receipt edits and serial identity claims under deterministic locks. Two concurrent submissions claiming one organization/site serial cannot create duplicate current custody.
- Commit domain row(s), event, command receipt and outbox atomically; failed authorization, validation or stale-version checks leave none of them behind.
- Keep exact quantity in PostgreSQL numeric columns and strings at the API boundary. Define unit conversion policy before any future aggregation; this candidate does not infer conversions.

## Candidate routes

```text
GET  /api/v1/sites/:siteId/parts/catalogue-drafts?page=&pageSize=
POST /api/v1/sites/:siteId/parts/catalogue-drafts
GET  /api/v1/sites/:siteId/parts/goods-receipts?page=&pageSize=
POST /api/v1/sites/:siteId/parts/goods-receipts
```

No supplier creation or generic party-search endpoint is added. Supplier association management is its own bounded operation and approval contract; until it exists, the new receipt route can accept only previously associated supplier IDs.

## Explicit non-goals

This candidate does not approve fitment or equivalence; accept inspection; release stock; reserve, issue or return stock; calculate valuation/cost of goods; approve purchases; establish supplier terms; create invoice lines; satisfy financial or safety gates; or set operational procurement/technical authority. It does not complete `BUILD-R-M-0078`, `BUILD-R-M-0080` or `BUILD-BR-11`.

The initial implementation tasks should be narrower build/check pairs for (1) append-only catalogue proposals and (2) receipt capture that always remains quarantined. Broad requirement tasks stay open until approved fitment, stock movement and supplier claims are implemented and verified.

## Alternatives considered

1. **One mutable product/stock table:** rejected because it merges a compatibility claim with operational fitment and makes corrections, review provenance and receipt history hard to distinguish.
2. **Fully effective catalogue and stock now:** rejected because the owner has not supplied the approved fitment sources, inspection process, procurement delegation or technical grant schedule. Enabling issueable stock would invent business authority.
3. **Reuse the current customer party lookup:** rejected because that projection intentionally exposes only parties related to workshop activity; broadening it could leak customer/owner identities and incorrectly treat suppliers as service customers.
4. **Separate microservice for inventory:** rejected for this slice. The accepted system design is one command API with domain modules and one canonical PostgreSQL model; a separate service would add distributed transactions before there is an operational stock lifecycle.

## Integration findings and open decisions

- Existing patterns: `runStaffCommand` in `apps/api/src/commands.ts`, immutable Finance proposal revisions in `apps/api/src/finance-configuration.ts`, and audited scoped reads in `apps/api/src/sensitive-read-audit.ts`.
- Existing customer lookup cannot be reused as supplier lookup; explicit supplier/site membership is required.
- Revocation races require grant-registry writers to share the new parts capability lock.
- Malware-accepted evidence is supporting material only and cannot approve compatibility.
- The natural serial key (organisation/site versus organisation-wide) and treatment of repeated receipt references need owner review before storage uniqueness is finalized. Candidate default: serial identity is organization-wide, while receipt events remain site-bound; collisions are denied pending explicit transfer workflow.
- Quantity precision and controlled unit codes need an implementation-level domain review. Avoid quantity conversion until conversion rules are approved.
- No purchase approvals, inspection acceptance roles, supplier policy, or fitment data sources may be invented; record these under the existing review register before enabling those operations.
