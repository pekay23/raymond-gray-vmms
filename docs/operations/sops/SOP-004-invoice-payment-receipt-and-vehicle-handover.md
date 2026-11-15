# SOP-004 — Invoice, manual payment record, receipt and vehicle handover

**Status:** DRAFT — Finance/management approval required\
**Revision:** 0.1 (working draft)\
**Effective date:** None\
**Process owner / approver:** Pending Finance/management appointment\
**Applies to:** Service Advisor, authorized Finance staff, Team Lead and Head of Service Centre\
**Related controls:** G3–G5; `REV-007`, `REV-012`, `REV-032`, `REV-046`

> Launch design uses no payment gateway. A staff member verifies an external payment or authorized showroom guarantee and records evidence in VMMS. This draft does not set prices, taxes, credit terms, financial limits, guarantee authority or retention rules. Until those controls are approved and configured, financial actions remain unavailable.

## 1. Invoice preparation and review

1. The Service Advisor prepares an itemized invoice from recorded, approved work, parts and current finance-approved rates. Do not invoice source-report claims, unapproved work, unsupported time, unverified parts, or a proposal as completed work.
2. Address the invoice to the explicitly selected paying client. Keep the vehicle owner and visit contact separate. Confirm recipient, currency, applicable tax/rate, payment terms, and authorized payer/guarantee before issue. If any value or account is missing, leave the invoice in draft and request Finance review.
3. Show business identity and contact, invoice number, issue date, job/booking reference, vehicle identification appropriate for the recipient, itemized approved descriptions/quantities/rates, approved tax and currency, total, approved payment instructions/terms, due date if approved, and revision/status. Keep private staff notes, credential information and internal risk flags out of the client copy.
4. The preparer checks calculations and scope against the job record. A second authorized checker independently verifies recipient, line items, rates/taxes, arithmetic, payment instructions and version before the invoice is issued. Record both actors, decision time and invoice revision. Do not rely on a screenshot of an application page; generate a purpose-built PDF or accessible email document.
5. Send the issued invoice to an explicitly verified client email address only through an approved email route and only after applicable contact/privacy approval. Record the recipient, document revision, sending actor, time and delivery outcome. A queued or failed email is not a delivered invoice; retain a safe retry path that cannot create a duplicate invoice.

## 2. Manual payment verification and receipt

1. An authorized staff member verifies payment from the approved source of truth (for example, the company/showroom finance confirmation or bank record); a client screenshot alone is not proof of settled funds unless Finance explicitly accepts that evidence.
2. Record amount and currency, payer, payment date, payment method/category, transaction/reference identifier, the invoice(s) allocated, evidence link/source, verifier identity and time. Keep the raw account credentials, full card/bank secrets and unrelated account data out of VMMS.
3. Compare amount and allocation to the issued invoice. Record partial, excess, reversed, disputed or unmatched amounts distinctly; never mark them fully paid by assumption. Reconciliation is a separate authorized action with reasoned correction history.
4. After an authorized payment verification is recorded, VMMS generates a numbered receipt tied to the paid amount and invoice allocation. The receipt states the amount received, currency, payer, date, method/reference as permitted, remaining balance if any, issuing business, work-order/invoice references and receipt revision. A receipt does not assert that an unpaid balance was settled.
5. Send the receipt to the verified paying client through the approved email route, recording destination, document revision, sender/time and delivery outcome. If email bounces, surface a retry/error state without changing the verified payment.
6. If an authorized showroom guarantee is used instead of reconciled payment, record the named guarantor/organization, authority evidence, covered amount, applicable invoice, validity/expiry and reconciliation owner. A guarantee is not a payment or receipt. Do not release the vehicle on a draft or unapproved guarantee.

## 3. Departure and custody gate

Before collection or delivery, verify separately that all required technical completion, Team Lead release, collection-zone placement, Head inspection, quality/safety holds, invoice check, reconciled payment or valid authorized guarantee, recipient identity/authority, vehicle condition, keys/documents/items and handover record are complete. No single payment, invoice, receipt or role label substitutes for another gate. Keep the vehicle on site when any required gate is open. Record a delivery fee and delivery authorization only when separately approved.

## 4. Corrections, voids and audit

Do not overwrite an issued invoice, receipt or payment event. Use a reasoned adjustment, credit/void or reversal command with appropriate independent approval and links to prior versions. Preserve the amount and disposition history, document delivery history and reason. Access to financial evidence is limited by approved role grants and every read/write is audited. Report output uses only the recipient-specific relevant fields.

## 5. Approval and configuration required

Finance/management must appoint preparer, checker, verifier, adjustment, guarantee and handover authorities; supply legal invoice/receipt identity and numbering rules, approved rates/taxes/currency/payment instructions/terms and evidence standards; define privacy, consent, retention, email sender/provider, bounce/retry and client email verification; and approve accessible document templates. Until these items are approved, VMMS may prepare a non-issuable preview only and must not create a valid invoice/receipt, mark a payment settled or send a financial document.
