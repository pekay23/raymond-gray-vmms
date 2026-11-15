# Manual invoice, payment, receipt and email workflow

**Status:** selected implementation contract; operational Finance policy remains unapproved.\
**Scope:** invoice preparation and issue, manual external payment verification, allocation, receipts, verified client email, and the independent G5 commercial check.\
**Authority:** owner direction USER-044 and SOP-004, constrained by REV-007, REV-012 and REV-054.

## User journey

1. The Service Advisor prepares an internal invoice preview for the paying client from eligible, authorized work and parts. It is visibly marked **Preview — not an invoice** until approved configuration and grants exist.
2. A separately authorized checker reviews a fixed invoice revision. An issuer creates a numbered, immutable invoice artifact only if the payer, work, rates, tax, currency, legal identity, terms, number rule, recipient and required evidence are all valid.
3. Staff confirm a payment from an approved external source and record that confirmation, evidence, amount and currency. VMMS does not collect money or connect to a payment gateway.
4. A separate command allocates verified funds to an issued invoice. Unmatched, excess, partial, disputed and reversed funds remain distinguishable. A receipt is made only for the verified amount allocated.
5. An authorized staff member sends an approved invoice or receipt revision to a verified client contact using the approved mail sender. Retries concern the same artifact and never issue another one.
6. G5 derives its commercial fact from invoice review, valid allocation or separately authorized guarantee. Technical completion, Team Lead release, Head inspection, open holds and handover remain independent checks.

## Domain shape

Keep one cohesive `commercial` domain boundary over distinct site-scoped records. Rendering and delivery may be cohesive submodules, not separate orchestration services.

- **Finance configuration revision:** business identity, currency, rate/tax references, numbering, terms, evidence rules, template and sender references. No production-effective revision is seeded.
- **Invoice identity and revisions:** draft/preview, checked, issued, voided or credited revisions; each snapshots paying-client and recipient identity, eligible work/parts source revisions, amounts, currency and configuration revision. Issued artifacts retain an immutable content hash and are never reconstructed from mutable work-order rows.
- **Payment facts:** verified external confirmation is independent of invoice allocation, so unmatched and excess payments can be represented. Record payer, amount/currency, date, approved method category, external reference, accepted evidence and verifier decision snapshot. Payment state is derived from append-only verification, allocation, dispute and reversal facts.
- **Allocations:** separate immutable positive amounts linking verified payment facts to issued invoices. Lock payment and invoice roots in stable order. Prevent over-allocation and underflow under concurrent updates.
- **Receipts:** immutable numbered artifact created only for verified allocated amounts. A guarantee is a separate scoped record and never creates payment or receipt.
- **Client delivery:** immutable intent/attempt rows reference an exact document revision, verified contact ID, sender configuration revision, actor, result and safe provider receipt. Delivery retry does not mutate or recreate the financial artifact.
- **G5 projection:** derived from current financial facts and approved policy; no `paid` or `commercially-cleared` caller-set boolean.

Money is integral minor units with an explicit currency in persistence. JSON/API contracts encode minor units as bounded decimal strings to avoid `bigint` serialization ambiguity. Arithmetic is performed with exact integer/decimal routines and checked against configured currency precision. No floating-point arithmetic.

## Command surface

These are named operation sketches; exact schemas must follow the accepted finance policy and source records.

```ts
type MinorUnits = string; // bounded, non-negative decimal integer string
type Money = { minorUnits: MinorUnits; currency: string };

prepareInvoicePreview(scope, { workOrderId, expectedWorkOrderVersion, commandId }): Promise<PreviewOnlyInvoice>;
checkInvoiceRevision(scope, { invoiceId, expectedVersion, commandId, decision, reason }): Promise<InvoiceRevision>;
issueInvoice(scope, { invoiceId, expectedVersion, commandId }): Promise<IssuedInvoiceRevision>;
recordExternalPayment(scope, { payingClientId, amount, paidAt, methodCategory, reference, evidenceIds, commandId }): Promise<VerifiedPaymentFact>;
allocatePayment(scope, { paymentId, invoiceId, expectedPaymentVersion, expectedInvoiceVersion, amount, commandId }): Promise<PaymentAllocation>;
recordDisputeOrReversal(scope, { paymentId, expectedVersion, kind, reason, evidenceIds, commandId }): Promise<PaymentCorrection>;
recordShowroomGuarantee(scope, { invoiceId, expectedVersion, coveredAmount, expiry, evidenceIds, commandId }): Promise<GuaranteeRecord>;
createReceipt(scope, { invoiceId, expectedVersion, allocationIds, commandId }): Promise<ReceiptRevision>;
requestFinancialDocumentEmail(scope, { documentRevisionId, verifiedContactId, commandId }): Promise<DeliveryIntent>;
```

Input never accepts actor, organisation, site, role, grant, settled state, document number, current balance, raw recipient address or G5 result. The server derives identity and scope. `recordExternalPayment` does not require an invoice ID, allowing legitimate reconciliation of unmatched payments. Allocation is the distinct operation that requires an issued invoice and matching paying client/currency.

Every mutation uses the shared `runStaffCommand` transaction boundary: current active membership, site-scoped roots, current named grant, expected versions, idempotency replay, atomic rows, immutable decision/audit event, command receipt and outbox. Number allocation serializes on a site/document-kind allocator and uses unique constraints. Email sends only from the durable outbox after commit. No request handler sends mail synchronously.

Proposed action grants are distinct: `invoice.prepare`, `invoice.check`, `invoice.issue`, `payment.verify`, `payment.allocate`, `payment.correct`, `guarantee.record`, `receipt.issue` and `finance.document-send`. These names do not grant access by themselves. Management must approve exact roles, scope, validity, limits and separation of duties before provisioning signed grants. The preparer/checker separation must be enforced when approved policy requires it.

## Privacy and report documents

Invoice/receipt output uses a purpose-built accessible HTML/PDF template with selectable text; it is not a screenshot of the app. Snapshot only the paying client and verified recipient fields needed for the stated document. Owner, visit contact, private staff notes, internal flags and unrelated account data stay out unless an approved field policy explicitly includes them. Preview output carries an unmissable non-issuable watermark and cannot use the production number sequence or email route. Authenticated downloads are `no-store` and do not expose public object URLs.

## Fail-closed configuration

No Finance configuration revision or active financial action grant is present by default. Without an effective approved revision, the app may show a non-issuable preview or readiness explanation only. It must not issue documents, assert an amount is due, record settled payment, create a receipt, satisfy G5 financially, treat a guarantee as cash or send email. Each blocked action names the missing approval/configuration and the next review step.

Live enablement requires, at minimum: legal entity/contact and invoice/receipt requirements; approved currency/rates/taxes and arithmetic policy; number sequence; payer terms and approved payment instructions; evidence standards for external confirmation; grants and independent checks; guarantee authority/validity; recipient/contact verification and privacy/consent rules; retention/correction policy; accessible templates; configured sender/provider, bounce/retry and operational monitoring. These decisions remain in REV-007, REV-012 and REV-054.

Test configuration may exist only inside disposable automated fixtures and must be asserted absent from operational environments. Real outgoing email and live payment evidence are not used in tests.

## Implementation sequence

1. Store the immutable Finance configuration and event/document types with no production-effective seed; enforce tenant/site keys, forced RLS and runtime least privilege.
2. Build site-scoped invoice preview from eligible work/parts with explicit non-issuable state, missing-configuration reasons and a purpose-built printable study.
3. Implement immutable invoice check and issue commands, scoped numbering, corrections/voids and negative authorization tests using disposable approved-like config.
4. Record external payment facts independently; implement allocation, derived balance, disputes/reversals and allocation-race protection.
5. Generate receipts only from verified allocations; keep showroom guarantees separate and prove guarantee cannot create a receipt.
6. Add verified-contact delivery intents, durable outbox worker adapter contract, safe retry and recipient-specific invoice/receipt email tests. Production sending stays disabled.
7. Integrate G5 as a read/command precondition over commercial projections and independent G3/G4/Head/hold gates; do not make any finance command complete or release a work order.
8. Prove RLS, site and role denial, action-grant revocation, rollback, stale version, exact replay, changed-body conflict, numbering/payment allocation races, no receipt before payment, partial/unmatched/excess/disputed/reversed cases, report field allowlists, mail retry and accessibility. UAT, Finance policy approval and production launch are separate.

## Prerequisite: trustworthy invoice source lines

The current work-entry model records narrative findings, tests, actions and follow-ups. It does not record chargeable labour duration, an approved rate basis, or parts actually issued/fitted. There is also no part catalogue, compatibility record or stock-issue ledger in the current implementation. Therefore an invoice preview must not derive a chargeable amount from a completed action note, diagnostic finding, parts request, checklist answer or source report.

Before the preview can produce itemized work/parts lines, implement and verify task labour records and part catalogue, fitment approval, issue/return and traceability paths in `R-M-0066`, `R-M-0028`, `R-M-0078`, `R-M-0081` and `BR-11`. The proposed labor clock records server-timed intervals against the current task assignment; it is not itself billable time or a rate. The preview then consumes only attributable, approved source records and snapshots their IDs/revisions. If a required source, rate, payer or policy is absent, show the missing item and retain a non-issuable preview with no invented total. See `BUILD-USER-044-INVOICE-PREVIEW-001` and its verification task in the tracker.

## Selected architecture

Candidate B's append-only facts and immutable document snapshots were selected over a mutable invoice/payment state machine. The cross-judge review required two refinements: record external payment before allocating it to an invoice (to preserve unmatched/excess funds), and serialize JSON-facing minor units as strings rather than native `bigint`. Candidate A's explicit payer snapshot and guarantee separation are retained. See the [candidate comparison and cross-judge synthesis](candidates/manual-finance-synthesis.md).
