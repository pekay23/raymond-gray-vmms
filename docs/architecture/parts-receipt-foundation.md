# Parts catalogue proposals and goods-receipt quarantine

**Status:** Selected bounded design; implementation not started. This contract does not authorize procurement, fitment approval, inspection acceptance, or usable stock.  
**Source requirements:** `master-0078`, `master-0080`, `master-0120` / `BR-11`.  
**Design review:** Candidate comparison and read-only cross-judge are recorded under `architecture/candidates/parts-foundation-*`.

## User flow

Parts staff with a current site grant can review a catalogue proposal and its revisions, then record a receipt against one exact proposal revision and an already-associated supplier. Each receipt line preserves the supplier lot or serial claim, quantity and unit, evidence references, source document reference, the reported receipt time, and the server-recorded time. Every captured quantity is shown as **Quarantined — unavailable for work**. A correction is a new attributable record; the original receipt remains visible.

These records preserve what was proposed and what was received. They do not establish that a part fits, has passed inspection, can be reserved or issued, can be charged to an invoice, or satisfies a safety or commercial gate.

## Contract and module ownership

The API derives actor, organisation and site from the authenticated staff session. Strict domain schemas reject client-supplied authority, availability, approved fitment, effective status, or trusted scope. Parts domain modules own database transactions and projections; Fastify only applies authentication, CSRF, routing and response mapping. The browser receives explicit pending/unapproved state and never reads SQL row shapes.

```ts
type CatalogueProposal = {
  proposalId: string;
  revisionId: string;
  revision: number;
  manufacturerPartNumber: string;
  description: string;
  variantClaims: Array<{
    make: string;
    model: string;
    variantReference: string | null;
    sourceReference: string;
    evidenceIds: string[];
  }>;
  state: 'unreviewed-proposal';
  operationallyApproved: false;
  createdAt: string;
};

type QuarantinedReceipt = {
  receiptId: string;
  supplierPartyId: string;
  supplierDocumentReference: string;
  receivedAtClaim: string;
  recordedAt: string;
  lines: Array<{
    receiptLineId: string;
    proposalId: string;
    proposalRevisionId: string;
    quantity: string;
    unitCode: string;
    supplierLotReference: string | null;
    serialReferences: string[];
    evidenceIds: string[];
    state: 'quarantined';
    availableQuantity: '0';
  }>;
};

function listCatalogueProposals(pool: Database, scope: Scope, requestId: string, query: PageQuery): Promise<PartsPage<CatalogueProposal>>;
function saveCatalogueProposalRevision(pool: Database, scope: Scope, commandId: string, input: SaveProposalInput): Promise<CatalogueProposal>;
function listGoodsReceipts(pool: Database, scope: Scope, requestId: string, query: PageQuery): Promise<PartsPage<QuarantinedReceipt>>;
function recordGoodsReceipt(pool: Database, scope: Scope, commandId: string, input: RecordReceiptInput): Promise<QuarantinedReceipt>;
function appendReceiptCorrection(pool: Database, scope: Scope, commandId: string, input: CorrectReceiptInput): Promise<QuarantinedReceipt>;
```

The named signatures are design contracts, not implemented exports. Decimal quantities cross the API as bounded strings and use exact PostgreSQL `numeric` storage. No unit conversion or aggregation is performed until quantity precision and unit policy are approved.

### Domain modules

- `parts-catalogue.ts` owns proposal schemas, append-only revisions, exact-revision reads and `parts.catalogue-proposal.*` capability checks.
- `goods-receipts.ts` owns receipt facts, append-only correction records, exact proposal revision binding, zero-available projections and `parts.goods-receipt.*` capability checks.
- `app.ts` mounts site-scoped routes under `/api/v1/sites/:siteId/parts/`; client lookup cannot set site, actor or grant.
- `sensitive-read-audit.ts` and the corresponding PostgreSQL action constraint record paginated proposal, receipt and supplier-lookup reads. Audit values contain bounded metadata only.
- The workspace Parts screen is visible only under a matching role profile, while each API action remains protected by a separately assigned current named grant.

## Data and transaction rules

1. Reuse canonical parties, but resolve suppliers only through an explicit organisation/site supplier association. Do not expand customer, vehicle-owner or visit-contact lookups. This slice can use existing associations only; supplier onboarding and association management require a separate reviewed operation.
2. Catalogue proposals and their revisions are immutable facts. They record the manufacturer number, stated variant, source references, accepted evidence IDs, author, current grant snapshot, command identity and timestamp. Uploaded evidence is support material; malware acceptance is not technical approval.
3. A receipt line snapshots the exact proposal revision and evidence references. It stores the supplier document reference, receipt-time claim, server-recorded time, exact quantity/unit and supplier lot/serial claims. Supplier identity/details are returned only under an approved field-level supplier access rule.
4. New receipt quantities have a fixed quarantined state and derived available quantity of zero. API schemas, database constraints, row security and runtime grants provide no path in this slice to accept or release a receipt.
5. Corrections append a linked record with a reason. Correction arithmetic and duplicate supplier-reference behavior are unresolved; no mutation, signed delta, reversal/replacement rule, or uniqueness policy may be inferred. Do not implement correction writes until those semantics are approved.
6. Commands follow `runStaffCommand`: lock the writable membership, relevant proposal/receipt revision roots and current actor/site/capability roots in a deterministic order; re-check authority before idempotent replay; then commit domain facts, audit/domain event, command response receipt and outbox atomically. Stale expected revisions conflict.
7. Grant-registry changes acquire the same parts capability lock as parts commands, preventing revocation from racing a write. Reads keep current membership and grant checks through projection and audit insertion.
8. Forced RLS and least-privilege runtime grants enforce organisation/site scope. Migration ownership and API runtime ownership remain separate. Add read actions to both the TypeScript union and the current database allowlist without removing existing values.

Migration `079_parts_catalogue_receipt_quarantine.sql` is the current next number after `078_oidc_rp_logout_transactions.sql`, but it is not reserved; recheck immediately before implementation.

## Initial routes

```text
GET  /api/v1/sites/:siteId/parts/catalogue-proposals?page=&pageSize=
POST /api/v1/sites/:siteId/parts/catalogue-proposals
GET  /api/v1/sites/:siteId/parts/goods-receipts?page=&pageSize=
POST /api/v1/sites/:siteId/parts/goods-receipts
```

Supplier search, if added to the screen, is a separately authorized, scoped and audited read against existing site associations. There is no supplier-create or supplier-association route in this slice.

## Required verification

Disposable PostgreSQL tests must exercise success and denial under the restricted runtime role: current grants and grant revocation, writable membership, cross-site reads/writes, existing supplier association, exact proposal revision, accepted evidence scope, append-only history, receipt provenance, fixed quarantine/zero availability, stale revisions, replay and changed-payload conflict, duplicate claims under concurrency where policy is defined, atomic rollback of event/receipt/outbox, forced RLS and runtime privileges. Real PostgreSQL evidence is required for RLS and concurrency; SQLite or a mocked browser API is insufficient.

Browser checks must cover loading, empty, failure and conflict states; pagination; clear quarantine wording; keyboard use; zoom; and responsive layout. The screen must not present a receipt as accepted or stock as available.

## Explicitly outside this slice

Approved vehicle fitment or equivalent parts; receipt inspection and acceptance; available stock; reservations, backorders, issue, returns or supplier claims; purchase orders and spend limits; costing, invoice lines, payment or commercial/safety gate transitions; supplier onboarding; historic backlog import; and production procurement authority.

The broad requirements `R-M-0078`, `R-M-0080` and `BR-11` remain open after this foundation. Later implementation must add the independently authorized approval, inspection, stock movement and part-to-VIN/task traceability workflows before those requirements can be verified.

## Owner review required

See `REV-048` in the [review register](../decisions/review-register.md). The unresolved inputs are correction arithmetic; duplicate supplier-document references and partial deliveries; serial identity and transfer scope; supplier-detail visibility; evidence purpose/scope; quantity precision and controlled units; and the role/grant that may associate suppliers with a site. The evidence-capture design can proceed without implementing those unresolved actions.

## Synthesis record

Candidate B is the base because it separates immutable receipt facts from future stock projections, makes every captured quantity unavailable, and gives clearer correction and site-scope contracts. Grafted from Candidate A: preserve both receipt-time claim and server-recorded time, supplier lot/serial references, and exact proposal/evidence snapshots. Rejected Candidate A's organization-wide serial uniqueness default; deferred a separate custody-identity entity. The independent cross-judge's comparative scores and rationale are in `architecture/candidates/parts-foundation-cross-judge-2026-11-15.md`.
