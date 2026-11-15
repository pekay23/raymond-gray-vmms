# Candidate A: Work-order commercial ledger

**Status:** architecture candidate only; not an implementation or finance approval.\
**Scope:** manual invoice, payment verification, receipt, client email and G5 commercial clearance.\
**Source direction:** owner-requested manual payment; no payment gateway. See USER-044, REV-007, REV-012 and REV-054.

## Caller flow

1. A Service Advisor prepares a non-issuable invoice preview from approved, recorded work and parts. The preview identifies the paying client separately from the vehicle owner and visit contact.
2. A separately authorized checker validates the payer, approved work, quantities, rates, tax, currency, arithmetic and recipient against the current finance configuration.
3. An authorized issuer creates an immutable numbered invoice revision and may request delivery to the verified client email.
4. An authorized verifier records payment confirmed outside VMMS, with its source evidence and reference. VMMS does not collect or process money.
5. An authorized allocator applies verified amounts to issued invoices. A receipt is generated only for the amount that is verified and allocated.
6. A separately configured mail worker sends the exact approved invoice or receipt revision and records each delivery outcome. Retry cannot create another financial artifact.
7. G5 derives commercial clearance from reconciled balance or a separately authorized, valid showroom guarantee. It remains independent from technical completion, Team Lead release, Head inspection, safety holds and handover checks.

## Shape

Use one site-scoped commercial ledger rooted in the canonical work order and paying-client party. Preserve owner, paying client, visit contact and any guarantor as distinct parties.

```ts
type FinanceConfigurationRevision = {
  id: UUID;
  siteId: UUID;
  revision: number;
  legalIdentity: ApprovedBusinessIdentity;
  currency: ApprovedCurrency;
  ratesAndTaxes: ApprovedRateAndTaxSnapshot;
  numberingRule: ApprovedNumberingRule;
  paymentInstructions: ApprovedPaymentInstructions;
  terms: ApprovedTerms;
  authorities: ApprovedFinanceAuthorities;
  recipientPolicy: ApprovedRecipientPolicy;
  emailSenderRevision: ApprovedEmailSenderRevision;
  effectiveFrom: Instant;
  effectiveTo: Instant | null;
};

type InvoiceDraft = {
  workOrderId: UUID;
  payingClientId: UUID;
  sourceWorkAndPartsRevisions: SourceRevision[];
  configurationRevisionId: UUID | null;
  lines: InvoiceLine[];
  totals: Money | null;
  preparedBy: StaffId;
  state: "preview-only" | "awaiting-check";
};

type IssuedInvoiceRevision = {
  invoiceId: UUID;
  revision: number;
  invoiceNumber: string;
  payerSnapshot: PartySnapshot;
  sourceRevisions: SourceRevision[];
  configurationRevisionId: UUID;
  checkedBy: StaffId;
  issuedBy: StaffId;
  issuedAt: Instant;
  immutableArtifactHash: SHA256;
};

type ExternalPayment = {
  id: UUID;
  payerId: UUID;
  amount: Money;
  paidAt: Instant;
  method: ApprovedPaymentMethod;
  externalReference: string;
  evidenceId: UUID;
  state: "verified" | "partially-allocated" | "unmatched" | "disputed" | "reversed";
  verifierGrantSnapshot: GrantSnapshot;
};

type PaymentAllocation = {
  paymentId: UUID;
  invoiceId: UUID;
  invoiceRevision: number;
  amount: Money;
};

type ReceiptRevision = {
  receiptNumber: string;
  invoiceId: UUID;
  paymentId: UUID;
  allocationId: UUID;
  amountReceived: Money;
  remainingBalance: Money;
  payerSnapshot: PartySnapshot;
  issuedAt: Instant;
  immutableArtifactHash: SHA256;
};

type DocumentDeliveryAttempt = {
  artifactId: UUID;
  artifactRevision: number;
  verifiedRecipient: string;
  senderConfigurationRevisionId: UUID;
  commandId: UUID;
  requestedBy: StaffId;
  attemptedAt: Instant;
  result: "queued" | "sent" | "bounced" | "failed";
};
```

The domain owns named commands: `prepareInvoicePreview`, `requestInvoiceCheck`, `issueInvoice`, `recordExternalPayment`, `allocatePayment`, `generateReceipt`, `recordPaymentReversal`, and `requestFinancialDocumentDelivery`. Do not expose arbitrary status or balance updates. All mutating commands use `runStaffCommand`, expected aggregate versions, current action-specific grants, idempotency, and canonical work-order/client locks. They atomically persist business changes, immutable decision snapshots, audit events, command receipts and outbox items.

The email worker sends only the selected immutable artifact revision. It uses a stable delivery command ID, records retries and outcomes, and cannot issue a replacement invoice or receipt. Store only the approved recipient and minimum delivery metadata in logs; do not place private account details or financial evidence bytes in audit/outbox payloads.

## Fail-closed configuration

No production finance configuration or grant is seeded. Until an approved, effective configuration and appropriate current grants exist, the service may show a clearly watermarked *Preview — not an invoice*, but must not issue an invoice or receipt, mark any amount settled, treat a guarantee as payment, or send a financial document. Missing or expired rates, taxes, currency, legal identity, number sequence, terms, evidence policy, independent-check policy, client-recipient verification or mail sender makes the relevant action unavailable with a plain explanation.

Test configuration is confined to disposable automated fixtures. Tests must not write operational records or silently configure local, staging or production databases.

G5 commercial clearance is a derived projection, never a writable boolean. A valid showroom guarantee is a separate authorization/evidence aggregate and does not create a payment or receipt. A paid balance cannot bypass safety holds, technical completion, release, inspection, recipient checks or handover requirements.

## Persistence and verification direction

Add forward-only PostgreSQL migrations for configuration revisions, invoice drafts and immutable issued revisions, external payments, allocations, receipts, guarantees, delivery attempts and metadata-only finance audit. Use organisation/site-qualified keys and foreign keys, forced RLS, restricted runtime grants, uniqueness for issued numbers, append-only issued/payment/receipt history, and transactional locks around invoice allocation and G5 reads. Never infer historic payment, ownership, approval or completion from a source report.

Disposable PostgreSQL and browser checks should cover missing/revoked grants, missing configuration, wrong payer/site, stale versions, exact idempotent replay and changed-body conflict, independent invoice checking, arithmetic and currency consistency, over/partial/unmatched/disputed/reversed payment, allocation races, no receipt before verification, no receipt for guarantee, immutable correction/reversal, G5 separation, audit/outbox rollback, safe email retries, recipient-specific fields, accessible printable templates and no-store downloads. Production email and provider integrations stay disabled in test fixtures.

## Rationale

This shape keeps the canonical work order as the operational root while giving invoices, payments, allocations and receipts their own financial identities and immutable history. It directly supports manual verification, explicit client/payer separation, partial payment and a reliable audit trail. Centralizing command locking and outbox behavior in the existing command boundary avoids a parallel transaction framework. A derived G5 projection can combine commercial facts without letting finance actions imply technical or safety approval.

## Rejected alternatives

- **One mutable invoice/payment status on the work order:** rejected because it cannot represent partial allocations, reversals, immutable issued documents or separate guarantee authority without overwriting history.
- **A generic receivable balance with no invoice/payment artifacts:** rejected because it cannot prove which issued document or externally verified funds caused the balance change, or safely produce receipts.
- **Treat every client screenshot or showroom guarantee as payment:** rejected because neither proves settled external funds by default, and guarantees require separate authority, scope and expiry.
- **Fire-and-forget email inside the request:** rejected because delivery failure and retries could become inconsistent with issued documents or create duplicates.
- **Enable documents using provisional rates, numbering, grants or guessed policy:** rejected because this would invent Finance authorization and could create legally misleading artifacts. Finance and management inputs remain launch gates under REV-007/012/054.

## Known limits

The shape is not cross-judged or selected yet. It does not decide invoice law, numbering, tax, rates, account terms, grant assignments, evidence acceptance, guarantee rules, email provider, consent, retention or operational ownership. It also does not implement an invoice, receipt, payment, client mail or vehicle-departure action. Those remain closed until Finance/management supplies and approves the required inputs.
