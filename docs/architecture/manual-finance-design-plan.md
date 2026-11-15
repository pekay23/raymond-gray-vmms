# Manual finance design and implementation plan

This plan follows the user's manual invoice/payment/receipt direction. It is not Finance approval and does not authorize operational records or outgoing email.

- [x] Ground — read USER-044, R-M-0105, SOP-004, REV-007/012/054, G5 workflow, scoped command/transaction contract and current tracker.
- [x] Sketch — compare a work-order commercial ledger and an append-only fact ledger with immutable documents.
- [x] Cross-judge — evaluate the candidates for authority, false-settlement prevention, race safety, G5, pre-approval work and module simplicity.
- [x] Select and refine — choose the append-only ledger, with independent external-payment facts and minor-unit string transport.
- [x] Implement first primitive — exact minor-unit parsing/arithmetic, JSON string serialization and pure payment-allocation limits are implemented and verified.
- [x] Implement first persistence slice — add a site-scoped, append-only Finance configuration proposal registry and grant-checked read/save API; drafts remain non-effective.
- [x] Verify first persistence slice — disposable PostgreSQL/API coverage passed for access denial, revision history, replay, stale and competing writes, RLS, privilege limits, audit and outbox.
- [x] Build proposal workspace — add the grant-aware Finance setup page, immutable revision browsing, edit-only-current behavior and paginated list; keep all values non-effective.
- [x] Verify proposal workspace — exercise no-grant, read-only, manage, pagination, current/history, stale conflict, credential rejection, accessibility and responsive states.
- [ ] Build trustworthy billable source records — implement server-timed labour sessions and compatible, approved part issue/fitment records before using them as invoice lines (`R-M-0066`, `R-M-0028`, `R-M-0078`, `R-M-0081`, `BR-11`). See the [task labour contract](task-labour-tracking-v1.md).
- [ ] Build and verify non-issuable invoice preview — consume only approved source records, snapshot their references, show missing policy/price reasons and never infer charges from notes (`BUILD-USER-044-INVOICE-PREVIEW-001`).
- [ ] Continue implementation — build the remaining invoice issue/check, external payment, allocation, receipt, email and G5 commands. No effective Finance config is seeded.
- [ ] Verify remaining workflow — use disposable PostgreSQL, synthetic configuration/evidence, API and browser checks for positive, negative, rollback and concurrency cases.
- [ ] Review for Finance — collect the exact rates, tax, legal identity, numbering, terms, grants, evidence, recipient, retention, template and mail decisions.
- [ ] Operational pilot — only after Finance approval, staging, backup/restore, exact document review and explicit deployment authorization.

Read the [selected contract](manual-finance.md), [draft registry contract](finance-configuration-drafts.md), [cross-judge synthesis](candidates/manual-finance-synthesis.md), [SOP-004 draft](../operations/sops/SOP-004-invoice-payment-receipt-and-vehicle-handover.md) and [review register](../decisions/review-register.md#rev-054-manual-invoice-payment-verification-receipt-and-client-email) before implementation.
