# Manual finance candidate B: append-only ledger and immutable documents

**Status:** architecture candidate; not approved Finance policy or an implementation contract. No invoice, receipt, payment, guarantee, email, or G5 action is enabled by this design.

## Caller journey

1. A Service Advisor prepares an invoice preview from approved work and parts for the selected paying client. The preview says **Not issuable** until every required Finance setting and action grant is approved.
2. A separately authorized checker reviews a specific immutable invoice revision. A distinct authorized action issues it only when current work, payer, rates, taxes, currency, numbering, terms, legal identity, recipient and required evidence are valid.
3. Staff verify an external payment from an approved source and allocate only the confirmed amount to an issued invoice. VMMS does not collect payment or integrate a gateway.
4. VMMS creates a numbered receipt for the verified allocated amount. A showroom guarantee is a separate record and never creates a receipt.
5. An authorized sender emails the approved invoice or receipt revision to the verified client address through a configured mail adapter. Retry changes delivery state only; it does not create another financial artifact.
6. G5 evaluates the resulting financial facts together with technical completion, release, inspection and hold state. No finance command sets the work-order gate.

## Core shape

```ts
type Money = { minorUnits: bigint; currency: string };
type InvoiceState = "draft" | "issued" | "voided" | "credited";
type ExternalPaymentState = "verified" | "disputed" | "reversed";

interface FinanceConfigRevision {
  id: string;
  siteId: string;
  revision: number;
  currency: string;
  taxAndRateReferences: string[];
  numberingRuleRef: string;
  termsRef: string;
  legalEntityRef: string;
  templateRef: string;
  senderConfigRef: string;
  effectiveDecisionId: string | null;
}

interface InvoiceRevision {
  invoiceId: string;
  revision: number;
  workOrderId: string;
  payingClientId: string;
  recipientContactId: string;
  financeConfigRevisionId: string | null;
  sourceWorkAndPartRevisionIds: string[];
  lines: Array<{ description: string; quantity: string; unitMinor: bigint; taxRef: string | null }>;
  total: Money | null;
  state: InvoiceState;
  artifactHash: string | null;
  checkerDecisionId: string | null;
  issueDecisionId: string | null;
}

interface VerifiedPaymentEvent {
  paymentId: string;
  payingClientId: string;
  amount: Money;
  methodCategory: string;
  externalReference: string | null;
  evidenceIds: string[];
  verifierDecisionId: string;
  verifiedAt: string;
}

interface PaymentAllocation {
  paymentId: string;
  invoiceId: string;
  amount: Money;
  allocationDecisionId: string;
  reversalOfAllocationId: string | null;
}

interface ReceiptRevision {
  receiptId: string;
  revision: number;
  invoiceId: string;
  paymentAllocationIds: string[];
  amountReceived: Money;
  artifactHash: string;
}

interface ClientDocumentDelivery {
  documentRevisionId: string;
  verifiedContactId: string;
  state: "queued" | "sent" | "failed";
  attempt: number;
  providerMessageId: string | null;
}
```

## Persistence and module boundaries

- `commercial` owns versioned Finance configuration, invoice identity/revisions, external-payment facts, allocations, reversals, guarantees, receipt revisions and balance projections.
- `commercial-documents` (or a cohesive submodule within `commercial`) renders versioned, recipient-specific invoice and receipt artifacts from immutable snapshots. Issued content is never reconstructed from mutable current work-order data.
- `commercial-delivery` owns email intents and delivery attempts. It writes through the existing transactional outbox and calls an adapter only after commit.
- The G5/work-order policy module reads a site-scoped commercial projection. It does not accept a caller-provided “paid” boolean.
- Tables carry organisation/site keys, composite parent keys, forced RLS and least-privilege grants. Runtime callers cannot update or delete issued artifacts or financial events. Corrections append reversal, void, credit or replacement records with reason and decision provenance.

## Commands and transaction rules

```ts
prepareInvoice(scope, { workOrderId, expectedWorkOrderVersion, commandId }): Promise<InvoicePreview>;
checkInvoice(scope, { invoiceId, expectedInvoiceVersion, commandId, decision, reason }): Promise<InvoiceRevision>;
issueInvoice(scope, { invoiceId, expectedInvoiceVersion, commandId }): Promise<InvoiceRevision>;
verifyExternalPayment(scope, { invoiceId, expectedInvoiceVersion, commandId, amount, currency, methodCategory, reference, evidenceIds }): Promise<VerifiedPaymentEvent>;
allocatePayment(scope, { paymentId, invoiceId, expectedVersions, commandId, amount }): Promise<PaymentAllocation>;
reverseAllocation(scope, { allocationId, expectedInvoiceVersion, commandId, reason }): Promise<PaymentAllocation>;
recordGuarantee(scope, { invoiceId, expectedInvoiceVersion, commandId, amount, evidenceIds, expiry }): Promise<GuaranteeRecord>;
createReceipt(scope, { invoiceId, expectedInvoiceVersion, commandId, allocationIds }): Promise<ReceiptRevision>;
sendClientDocument(scope, { documentRevisionId, verifiedContactId, commandId }): Promise<ClientDocumentDelivery>;
```

These signatures are sketches; exact schemas follow approved policy. Inputs omit actor, site, role, grant, effective/settled state, invoice balance, document number, recipient email text, and gate result. The server derives trusted identity and scope. Each mutation uses `runStaffCommand`: recheck active writable membership and action grant under the shared lock order; acquire work-order/document/allocation serialization roots in stable order; validate expected versions, evidence and state; then atomically persist business rows, immutable decision/audit facts, idempotency receipt and outbox entry. Same-key/same-content retries return the original result; changed content conflicts. Issuance and payment allocation use locked number and balance roots so concurrent actions cannot duplicate numbers or over-allocate funds.

## Authorization and G5 boundary

Role labels do not grant financial authority. Proposed action identifiers include `invoice.prepare`, `invoice.check`, `invoice.issue`, `payment.verify`, `payment.allocate`, `payment.reverse`, `guarantee.record`, `receipt.create`, and `finance.document-send`. They must be separately provisioned signed grants with scope and validity. Check current grants at action time and snapshot grant and policy revisions. The checker must be independent of the preparer if approved Finance policy requires it; absent the approved separation rule, issue fails closed.

The receipt precondition is an issued invoice plus current, authorized external-payment verification and allocation. Only allocated verified payment creates a receipt; a partial payment creates a receipt for that amount and leaves a derived balance. Disputed, reversed, unmatched or excess amounts remain distinct. A guarantee neither represents cash nor creates a receipt.

The G5 projection may report the financial condition satisfied only when its approved policy finds the required issued/checked invoice, sufficient reconciled payment or a valid separately approved guarantee, and no unresolved commercial exception. The distinct G3, G4, Head inspection, hold and handover requirements remain independently enforced. Payment cannot override a safety hold or authorize departure.

## Safe work before Finance approval

The following can be implemented with no live financial authority:

- Schema and types that default to no effective Finance configuration and no active grants.
- Non-issuable previews clearly marked as previews, with no valid invoice/receipt number and no claim of amount due.
- Synthetic-only config fixtures for deterministic arithmetic, allocation, concurrency, RLS, replay, rollback and denial tests.
- A disabled configuration/readiness view that explains which approved inputs are missing.
- Versioned accessible PDF/HTML template studies using synthetic values, visibly watermarked “Preview — not a valid invoice/receipt.”
- An outbox adapter contract and synthetic delivery tests; production sender credentials and real messages remain absent.

Do not enable live issue, verification, receipt, guarantee, paid status, client delivery or financial G5 satisfaction until Finance supplies and approves rates/taxes/currency, legal entity and numbering, terms, evidence rules, grants and separation policy, verified client-address rules, templates, retention, and mail sender/provider under `REV-007`, `REV-012` and `REV-054`.

## Rationale and rejected alternatives

This shape keeps each financially meaningful fact append-only and independently attributable. Immutable invoice/receipt snapshots make a sent document reproducible; allocations represent partial and reversed payments without rewriting receipts; delivery retries do not duplicate commercial artifacts. Derived balances prevent multiple status fields from drifting apart, and G5 consumes one explicit projection without collapsing technical and financial authority.

Rejected alternatives:

- **Mutable invoice with `paid = true`:** loses partial allocation and correction history, invites races and lets one status hide disputed or reversed funds.
- **Payment-gateway-first design:** conflicts with the user's manual-payment direction and adds unnecessary payment custody/integration.
- **Treating a showroom guarantee as a payment:** misstates cash received and could issue a false receipt.
- **One generic ledger table for invoices, payments, guarantees and emails:** obscures distinct invariants and makes accidental transitions easier.
- **Recomputing issued documents from live work-order rows:** later edits would change the apparent contents of an already issued artifact.
- **Using a role label or UI visibility to authorize finance actions:** does not enforce authority at mutation time or preserve its historical basis.

## Remaining review

This is Candidate B, not a selected architecture. Compare it with Candidate A's single commercial aggregate/state-machine shape and cross-judge before implementation. Finance must confirm the policies and configuration listed above. The owner's manual, no-gateway flow is accepted; the candidate does not define tax treatment, accounting policy, legal numbering, credit terms, guarantee authority, payment evidence acceptance, retention, or email provider.

Related: [SOP-004 draft](../../operations/sops/SOP-004-invoice-payment-receipt-and-vehicle-handover.md), [work-order lifecycle and G5](../work-order-lifecycle-and-booking.md), [export/report policy](../data-export-and-reporting.md), and [review register](../../decisions/review-register.md).
