# Manual finance architecture synthesis

**Selected:** Candidate B, append-only financial facts with immutable invoice and receipt artifacts.\
**Owner scope:** manual external payment verification; no gateway; checked invoice; receipt after verified payment; approved client email.\
**Decision date:** 14 November 2026.

## Evaluation

The cross-judge scored both candidates against accountability, prevention of false financial facts, concurrency/idempotency/correction, G5 separation, safe pre-approval work, and module simplicity:

| Criterion | Candidate A | Candidate B | Finding |
| --- | ---: | ---: | --- |
| Source of truth and accountability | 4/5 | 4/5 | Both preserve attribution and snapshots. |
| Prevent false issue, settlement, receipt and email | 5/5 | 5/5 | Both keep approved configuration and grants fail-closed. |
| Concurrency, idempotency and correction | 4/5 | 4/5 | Both use shared command protocol; payment facts must be independent of invoice allocation. |
| G5 separation | 5/5 | 5/5 | Both keep technical, safety, inspection and financial facts separate. |
| Safe work before Finance approval | 5/5 | 5/5 | Both allow previews and synthetic-only tests while live actions remain disabled. |
| Small, understandable module surface | 4/5 | 4/5 | Keep rendering/delivery cohesive under one commercial domain. |

Scores were equal. Candidate B is selected because it more explicitly preserves each financial fact as append-only and derives balances/status from verified events and allocations, reducing mutable status drift. It also describes immutable document snapshots and payment-allocation boundaries more directly. Candidate A's work-order root framing is retained as the operational relationship, but invoices/payments keep independent IDs and locks.

## Required grafts and corrections

- Record a payment confirmation independently of any invoice; then allocate it separately. Otherwise unmatched or excess payments cannot be represented honestly.
- Store payment changes as append-only verification, allocation, dispute and reversal facts; derive the current projection rather than mutating one payment status.
- Encode JSON/API money as bounded minor-unit decimal strings; do not serialize native JavaScript `bigint` in JSON/outbox/receipts.
- Retain Candidate A's explicit payer snapshot and separate showroom guarantee that cannot create payment or receipt.
- Keep PDF/HTML rendering and client delivery as cohesive commercial submodules, not independent orchestration services.

## Rejected shapes

- Mutable `invoice.paid = true` cannot represent partial, disputed, excess or reversed payments without losing history and is race-prone.
- A single generic ledger row for invoices, payments, guarantees and email hides unlike invariants.
- Recomputing an issued artifact from live work-order state changes what an already sent document appears to say.
- Synchronous email and payment-gateway-first approaches conflict with the user's explicit manual-payment process and durable retry needs.
- Role names, UI visibility, provisional rates or guessed legal numbering do not authorize Finance actions.

This synthesis selects an implementation architecture only. It does not approve rates, tax, currency, terms, legal identity, numbering, evidence, grants, guarantee authority, recipient privacy, retention, email configuration or staff acceptance. Those remain in REV-007, REV-012 and REV-054.
