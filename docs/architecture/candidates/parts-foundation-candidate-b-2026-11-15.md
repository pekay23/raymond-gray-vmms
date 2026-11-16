# Parts foundation candidate B: append-only receipt ledger

**Status:** Alternative architecture sketch; not selected or implemented.  
**Scope:** A bounded catalogue-proposal and goods-receipt foundation. It does not complete `R-M-0078`, `R-M-0080`, or `BR-11`.

## Caller first

An authorized staff member opens Parts for the active site. They can review a paginated list of catalogue proposals and their revisions, record a supplier receipt against an exact proposal revision, and see each received quantity clearly marked **Quarantined — unavailable for work**. A correction adds a linked record with a reason; the original receipt remains visible. A receipt or an accepted upload does not approve compatibility, inspection, purchase, cost, or use.

The API derives organisation, site, actor, writable membership and current named authority from the session. The caller supplies a command ID and typed business facts. It cannot set a trusted actor, site, approval, effective fitment, stock availability, or financial state.

## Shape

Candidate B separates immutable business facts from any future stock-availability projection. Catalogue proposals and receipt events are append-only records. This keeps historical provenance legible and makes the “quarantined only” invariant easier to enforce than a mutable stock counter.

### Public contracts

```ts
type CatalogueProposal = {
  proposalId: string;
  revisionId: string;
  revision: number;
  manufacturerPartNumber: string;
  description: string;
  candidateFitments: Array<{
    make: string;
    model: string;
    variantReference: string | null;
    powertrain: 'EV' | 'HYB' | 'ICE' | 'unknown';
    sourceReference: string;
    evidenceIds: string[];
  }>;
  state: 'unreviewed-proposal';
  operationallyApproved: false;
  createdAt: string;
};

type ReceiptLineInput = {
  proposalId: string;
  proposalRevisionId: string;
  quantity: string; // exact decimal text, bounded at the request boundary
  unit: string;
  supplierLotReference: string | null;
  serialReferences: string[];
  evidenceIds: string[];
};

type QuarantinedReceipt = {
  receiptId: string;
  supplierPartyId: string;
  supplierName: string;
  receivedAt: string;
  lines: Array<ReceiptLineInput & {
    receiptLineId: string;
    state: 'quarantined';
    availableQuantity: '0';
  }>;
  correctionOf: string | null;
};

type PartsPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  canManage: boolean;
};

function listCatalogueProposals(
  pool: Database, scope: Scope, requestId: string, query: PageQuery,
): Promise<PartsPage<CatalogueProposal>>;

function saveCatalogueProposalRevision(
  pool: Database, scope: Scope, commandId: string, input: SaveProposalInput,
): Promise<CatalogueProposal>;

function listGoodsReceipts(
  pool: Database, scope: Scope, requestId: string, query: ReceiptQuery,
): Promise<PartsPage<QuarantinedReceipt>>;

function recordGoodsReceipt(
  pool: Database, scope: Scope, commandId: string, input: RecordReceiptInput,
): Promise<QuarantinedReceipt>;

function correctGoodsReceipt(
  pool: Database, scope: Scope, commandId: string, input: CorrectReceiptInput,
): Promise<QuarantinedReceipt>;
```

All request and response schemas are strict, bounded, and owned by the domain module. Decimal quantities remain decimal strings end to end; binary floating-point arithmetic is not used. Inputs must name the exact current catalogue revision used at receipt time. Existing receipt lines cannot be edited in place.

## Data and transaction boundaries

### Canonical supplier association

Continue using canonical parties, but require an explicit `supplier_site_associations` relation keyed by organisation, site and supplier party. Do not expand the customer/owner/visit-contact lookup to make suppliers visible. Supplier lookup is a new scoped, audited query over the association relation. Its list and association-management authorities are separate; this slice may only use already-established associations and must not create vendor onboarding or purchasing approval.

The catalogue proposal references a canonical manufacturer/part identity and records candidate vehicle variants with source references. Its state is always unreviewed and non-effective. A future governed review workflow can consume this proposal but must be a separate command with its own named authority and evidence rules.

### Append-only receipts

Store a receipt header (supplier, source document reference, received time, actor and receipt command) and immutable receipt lines. Each line snapshots the proposal ID and revision ID, exact quantity and unit, supplier lot reference, serialized item references where present, and accepted evidence IDs. Accepted evidence establishes only that the referenced bytes passed the existing evidence pipeline; it does not prove compatibility or an inspection result.

Every newly recorded line has the fixed state `quarantined` and computed `availableQuantity = 0`. No request field may select or change these values. The schema and runtime role must not expose a route or SQL permission that marks a receipt accepted or stock available. Quantity corrections append a separate reasoned correction record linked to the original line and receipt; a read projection shows both facts and derives the corrected quarantined amount without erasing source history.

### Atomic writes and access

Each write uses `runStaffCommand` so membership locking, serialization roots, current authority, idempotency checks, domain event, response receipt and outbox insertion share a PostgreSQL transaction. The receipt root and all referenced catalogue roots are locked in sorted order. Replayed identical command IDs return the recorded response after current membership and authority checks; a changed payload conflicts. Expected revisions are checked under the same lock.

Named capabilities are proposed as `parts.catalogue-proposal.read`, `parts.catalogue-proposal.manage`, `parts.goods-receipt.read`, and `parts.goods-receipt.record`. Role names do not grant them. Each command checks the newest valid grant at action time and snapshots its ID and revision. Grant mutation and parts commands must use the same per-actor/site/capability serialization lock so revocation cannot race a write. No parts grants are seeded by this design.

Reads require active site membership, remain scoped by organisation and site, and record bounded metadata in the sensitive-read audit stream before returning the prepared page. They never include evidence storage keys or unrelated customer details. Add new action names to both the TypeScript action union and the current PostgreSQL allowlist; preserve existing values. Apply forced RLS and least-privilege runtime grants as defence in depth. The migration role and runtime role remain distinct.

## Module map

| Area | Candidate responsibility |
| --- | --- |
| `apps/api/migrations/079_parts_catalogue_receipt_quarantine.sql` | Supplier/site association reference, immutable proposal revisions, receipt headers/lines/corrections, FK/quantity/state constraints, forced RLS, indexes, runtime privileges and grant-revocation lock integration |
| `apps/api/src/parts-catalogue.ts` | Proposal schemas, revision commands and audited paginated reads |
| `apps/api/src/goods-receipts.ts` | Receipt schemas, recording/correction commands and quarantined projections |
| `apps/api/src/app.ts` | Authenticated site-scoped routes and CSRF/idempotency boundary |
| `apps/api/src/sensitive-read-audit.ts` and the read-audit migration | Typed action names and matching database allowlist |
| `apps/web/src/api.ts`, `apps/web/src/pages/parts.tsx`, `apps/web/src/workspace.tsx` | Strict client schemas, receipt/proposal screens and authorized navigation |
| `apps/api/test/parts-receipts.test.ts` | Disposable PostgreSQL authorization, RLS, immutability, idempotency, race and rollback checks |
| `scripts/parts-receipts-browser.mjs` | Browser receiving flow, accessible states, denial and responsive checks |

Migration `079` is the current next number after `078_oidc_rp_logout_transactions.sql`. Recheck the migration directory immediately before reserving or creating it; this sketch does not reserve that number.

## Acceptance boundary

The slice should prove scoped supplier resolution, compatible reference integrity (without approving fitment), exact proposal-revision binding, accepted-evidence reference validation, receipt provenance, quarantine invariance, immutable corrections, current-grant enforcement, read audit, RLS, atomic outbox/receipt behavior, stale-version denial, idempotent replay and concurrent-write behavior using the real PostgreSQL runtime role. Browser verification should cover empty/loading/failure/conflict states, pagination, keyboard use, zoom and responsive layout.

## Explicitly outside this slice

- Approved fitment, approved equivalents, inspection acceptance or any claim that the part fits a vehicle.
- Available stock, stock allocation, reservations, backorders, task issue, return-to-stock or supplier claims.
- Procurement, purchase orders, delegated spend, prices, costing or invoiceable part lines.
- Any commercial or safety gate transition, work authorization, repair completion, release, payment or collection.
- Supplier onboarding unless a separately authorized, audited workflow is designed.
- Import of the later maintenance backlog or external supplier catalogues.

These exclusions keep a useful evidence-capture foundation available without implying permission or policy that the owner has not approved.

## Alternatives and rationale

1. **One mutable inventory quantity per part:** rejected because it loses the relationship between supplier delivery, lot/serial identity and each correction, and can make unreviewed stock appear usable.
2. **A general inventory event bus before domain tables:** rejected because it would add generic infrastructure before there is a second proven stock workflow and would obscure the simple receipt contract.
3. **One microservice per catalogue, supplier and receipt:** rejected because the accepted VMMS architecture has one canonical PostgreSQL command API and these records must commit together with audit and idempotency facts.
4. **Candidate B selected as this alternative:** separate immutable proposal/receipt facts with derived quarantined projection. It prefers traceability and fail-closed behavior over modeling future available inventory prematurely.

## Unresolved decisions

- Which named role or grant may associate a supplier with a site and who may view supplier contact details.
- Accepted manufacturer part-number conventions, description limits, unit vocabulary and quantity precision.
- The required receiving document and evidence sources, retention and correction reasons.
- Whether serial identity is unique by manufacturer, part, supplier, organisation or site; avoid uniqueness rules until the owner supplies this policy.
- Which fitment sources and technical reviewers can later support approval; an uploaded document alone is not an approval.
- Whether receipts may combine multiple catalogue proposals and how supplier packing references are represented.

Until those values are approved, inputs must remain explicitly proposed or captured facts and the app must not infer stock eligibility, fitment, purchase delegation or financial treatment.
