# Controlled-document lifecycle design plan

**Goal:** produce a reviewable, fail-closed architecture for authoring, reviewing, approving, publishing, superseding and acknowledging controlled documents. This is design work only; no procedure content, approval authority, role grants, operational document, or production record will be created.

## Phases

- [x] Ground — read the accepted project docs and requirements/tasks; trace the controlled-document API, schema, evidence boundary and staff library with CodeGraph and two read-only architecture passes.
- [x] Sketch — compare two structurally distinct lifecycle designs against the current controls and pending governance decisions.
- [x] Agree — judge candidates against the rubric, choose a coherent design and record rejected approaches and open owner decisions.
- [x] Implement — update the architecture, review register and tracker with a design-only result. Runtime lifecycle code is deferred while owner-supplied documents, approver/independent-review authority, distribution and acknowledgement policies, and grants remain unapproved.
- [ ] Scrap — revisit the sketch if new SOP/register inputs or approved grants contradict its assumptions.

## Candidate rubric

1. Preserves draft/review/approved/effective/superseded distinctions and never treats unknown history as approval.
2. Makes author, reviewer, approver, publisher and acknowledgement authority explicit without granting any role by assumption.
3. Keeps site scope, accepted evidence, audit history, concurrency and effective-revision uniqueness server-enforced.
4. Defines recoverable, idempotent transitions with clear denial and conflict behavior.
5. Fits the existing evidence, signed-grant and command/transaction boundaries without exposing generic metadata writes.

## Hard limits

- The user will supply SOPs and the document register; do not derive technical procedures from the legacy `after-sales` reference.
- No synthetic SOP may be made effective or presented as an approved operational procedure.
- The VMMS Operator and Head of Service Centre boundaries stay as accepted; neither receives document governance grants by inference.
- Any unresolved policy or authority choice stays in `docs/decisions/review-register.md`.

## Grounded system model

The browser page at `apps/web/src/pages/documents.tsx` calls the site-scoped catalog and download APIs. `apps/api/src/app.ts` authenticates the staff request and derives scope; `apps/api/src/controlled-documents.ts` requires an active site role, selects only the current effective revision with all-site-staff distribution and accepted clean procedure evidence, and records read/download audit events. The generic evidence route enforces the same effective-revision rule. Migration `041_controlled_document_library.sql` stores site-scoped documents and revision states (`draft`, `review`, `approved`, `effective`, `superseded`), requires evidence for approved/effective revisions, and enforces at most one open effective revision per document. The web runtime has no metadata write grant.

The shared `runStaffCommand` boundary can provide membership rechecks, command-specific authorization, serialization, idempotent receipts, and atomic mutation/event/outbox persistence. Migration `019` provides signed, scoped authority grants; role names, `memberships.can_write`, VMMS Operator account duties, and Head of Service Centre operations duties are not document approval authority. No author/review/approve/publish/supersede/acknowledge commands exist. Owner-provided SOPs/register, approval and independent-review authority, review interval, distribution, acknowledgement policy, and grants remain open under `O-001` and `REV-041`.

The two candidates and synthesis are in `candidates/controlled-document-lifecycle-a.md`, `candidates/controlled-document-lifecycle-b.md`, and `candidates/controlled-document-lifecycle-synthesis.md`. The selected contract is `controlled-document-governance-lifecycle.md`. The design review is recorded at `../verification/checks/controlled-document-lifecycle-design-2026-11-12.md`.
