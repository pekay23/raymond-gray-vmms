# Finance configuration drafts

**Status:** Implemented API and append-only storage; approval, effective configuration and Finance operations are not implemented.\
**Requirement:** `USER-044`\
**Parent workflow:** [Manual invoice, payment, receipt and email](manual-finance.md)\
**Design sequence:** [Manual Finance plan](manual-finance-design-plan.md)

## Purpose and authority boundary

This registry captures proposed site-specific Finance setup for later review. Saving a proposal does not approve it or make it operational. The response is always `state: draft-only` and `operationallyEffective: false`. It cannot issue invoices or receipts, set a due amount, verify a payment, satisfy G5, or send an email.

The user-selected manual payment process and the master specification define the business intent. A proposal or source document is input to that process, not Finance approval. No tax rate, payment authority, monetary limit, payer term, invoice numbering rule, sender credential, or legal claim is inferred or enabled by this registry.

## Scope and access

- Organization and site are taken from the authenticated staff session, never from the request body.
- `finance.configuration-draft.manage` allows an authorized staff member to save a proposal. `finance.configuration-draft.read` allows a separately authorized staff member to list proposals. A current manage grant also allows reads.
- The API checks the newest active grant at action time and serializes each operation with grant changes. Revoked or expired grants do not fall back to an older revision.
- No Finance configuration grants are seeded. Role names alone do not grant access.
- Reads are paginated, site-scoped and recorded in the sensitive-read audit stream. Forced row-level security also hides records when session scope is absent or mismatched.

## Stored proposal

Each immutable revision contains:

- Proposed legal-entity name, registration reference, address and contact reference.
- Proposed currency code and references to rate, tax, invoice/receipt numbering, payment terms, payment verification and evidence policies.
- References to showroom guarantee authority, invoice/receipt templates, sender setup, verified client email, corrections and retention policies.
- Source references, a revision note, author and exact grant ID/revision, command ID, timestamp and prior revision number.

These are proposed values and references, not effective policy. The API rejects common inline credential patterns, bearer tokens and credential-bearing URLs. That check cannot detect arbitrary secret text, so reference fields must contain opaque identifiers only. Production sender credentials belong in deployment secrets managed outside this record.

## Revision command

`GET /api/v1/sites/:siteId/finance/configuration-drafts` returns a paginated list to a currently authorized reader. `POST` to the same path saves a revision using `draftId`, `expectedRevision`, a reason and the proposed content. New records start at revision 1; later saves must match the current revision. A stale submission returns a conflict and does not append a revision.

The command uses the shared staff-command transaction: membership and grant checks, a site/draft advisory lock, immutable revision insert, domain event, idempotency receipt and outbox item commit together. Competing edits against the same revision are serialized; one succeeds and the other receives a stale-version response. Revision rows reject update and delete, and the runtime role has only SELECT and INSERT on that table.

## Storage and verification

Migration `073_finance_configuration_drafts.sql` creates the forced-RLS revision table and grant-change lock. `finance-configuration.ts` owns the command/read contracts. The API integration check uses disposable PostgreSQL and synthetic grants to exercise denied access, revision history, exact replay, stale edits, concurrent edits, pagination, grant rotation, RLS, runtime privileges and atomic event/receipt/outbox records.

Evidence: [Finance configuration draft verification](../verification/finance-configuration-drafts-2026-11-14.md).

## Work still required

This first slice does not provide a browser form, Finance approval or publication, effective configuration versions, invoice previews or issuance, external payment verification and allocation, receipts, client email or G5 integration. Those commands remain closed until their approved policies, templates, named grants, recipient rules and operational checks exist. Continue with the [manual Finance plan](manual-finance-design-plan.md); do not use this registry as a substitute for review or sign-off.
