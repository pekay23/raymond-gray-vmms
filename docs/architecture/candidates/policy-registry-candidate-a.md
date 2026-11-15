# Policy registry candidate A — extend the existing immutable ledger

## Goal and hard boundary

This candidate addresses `BUILD-R-M-0016` and `R-M-0016`: give Raymond Gray a versioned place to stage and decide standards and approval-policy packages. It does not supply a single SOP, technical rule, rate, tax, inspection requirement, approval limit, role grant, or named approver. The registry starts empty. G2/G3/G4/G5 continue to return unavailable until the owner supplies the source policies and signed authority schedule and the corresponding operational resolver is implemented and verified.

The source requires configurable SOP revisions, approved authority, limits, required inspections, rate cards and case classes (`master-0016`, `upgrade-0029`). The implementation plan explicitly says to build configuration, validation and review tools before policy input arrives and keep affected approvals closed. REV-006, REV-008, REV-009, REV-035 and REV-041 remain owner or technical-management inputs.

## Current foundation

Use the existing structures rather than start a parallel registry:

- `apps/api/src/work-order-policy.ts` defines a strict, versioned package, bounded applicability, six required sections, source pins and a canonical SHA-256 digest. Its candidate validator always returns `POLICY_UNAVAILABLE` because no authenticated resolver exists.
- Migration `043_work_order_policy_ledger.sql` stores immutable site-scoped package revisions and append-only decisions. Each decision binds the exact package revision and digest to an actor, authority snapshot, reason and command receipt. Forced RLS scopes both tables; `vmms_runtime` can read but cannot write.
- Migrations `019`, `021`, and `025` establish the existing named-grant structure and its action-time, transaction-serialized lookup pattern. Runtime staff cannot mint or edit grants.
- `docs/architecture/controlled-document-library.md` and its governance design own the source documents. A policy source pin must ultimately resolve to the exact accepted document revision; a submitted ID/digest string alone is not proof that the document exists or is approved.

The existing database record is already a suitable immutable candidate revision. Treat the absence of a decision as a draft/inactive candidate. Do not add a mutable `status` column that can disagree with the append-only decision history.

## Candidate lifecycle

1. **Draft/inactive:** an authorized editor creates a new immutable package revision. This adds an append-only creation event or revision row, not an approved decision. Fixes create the next package revision; they never edit an existing row.
2. **Submitted for review:** optional workflow projection only. If management needs this explicit step, represent it as an appended event. Do not overload `approved` or allow the client to set a status field.
3. **Approved:** a separate authorized decision references the exact package revision and digest, a non-empty reason, current named authority snapshot and immutable command receipt. Approval does not itself allow a past effective date.
4. **Effective:** a read projection of the latest valid approved decision while the package's half-open interval contains the database transaction timestamp. No separate activation command or mutable effective flag is needed. A future-dated approval stays approved but is not effective yet.
5. **Superseded/withdrawn/rejected:** append an authorized decision with reason and server time. A supersession/withdrawal applies from that decision time forward only; it cannot revise prior G2/G3/G4 snapshots or erase historic approval. Rejection or withdrawal leaves the revision in history and inactive for future work.

Suggested projection values are `draft`, `submitted`, `rejected`, `approved`, `effective`, `expired`, `withdrawn`, and `superseded`. Persist only source facts and immutable decisions; derive displayed state from those rows and PostgreSQL time. Do not imply that the projection alone makes a package operational: policy completeness, source pins, applicability uniqueness and authority must also validate.

## Commands and authority

Use command-specific API operations and the current `runStaffCommand` atomic boundary. Proposed distinct capability names are `policy-package.edit`, `policy-package.approve`, `policy-package.withdraw`, and `policy-package.supersede`. The names identify actions only; no role is assigned one by default, no grant is seeded, and no role title including Head or Operator satisfies the check.

- Revision creation must verify active writable membership, a current edit grant, package schema, site scope, next revision number, source references and digest. Serialize on a site/package key so two authors cannot create the same revision number.
- Approval/rejection must recheck membership and the exact current approval grant while holding the site/package lock. The decision must match the immutable revision digest and a current command receipt. Refuse if the package has changed (it cannot), been withdrawn, already has a terminal decision, or has an invalid/future interval.
- Enforce `effective_from >= transaction_timestamp()` at approval time. If the proposed date is already in the past, require a newly versioned candidate with a future/current date; never backdate a policy to make old work appear compliant.
- Supersede/withdraw must be an explicit decision with a reason. It affects future resolver calls only; existing work-order decision snapshots remain unchanged.
- Recommend a different approver from the creator for approval, but keep this a pending owner decision under REV-006/REV-041. If later accepted, enforce it on the server while holding the same lock.
- The signatory/grant issuer process is not defined. Do not add a runtime grant-writing endpoint as a shortcut. The current controlled governance/provisioning path remains the only possible future grant source.

Every new command atomically writes its immutable record, audit/domain event, receipt and outbox item. Retry with the same key returns the original result after rechecking membership and grant; changed content conflicts. A failed event/outbox write rolls the policy change back. A transaction that races grant revocation or competing policy decisions must either serialize before the revocation using the valid snapshot or observe the revocation and deny.

## Database and concurrency

Retain migration `043` as the canonical revision/decision ledger. Add a follow-up migration only for gaps proven by implementation, for example:

- append-only draft/submission events and explicitly supported decision actions;
- uniqueness or a transaction advisory root for package revision allocation;
- constraints for no approval before the stored effective-from instant;
- a composite relation to the exact controlled-document revision if the document library has a stable compatible key;
- additional query indexes required by the final status/read projection.

Do not add mutable pointers such as `active=true`, `current_status`, or `effective_revision_id` unless they are transactionally maintained by one database function and provably equivalent to the append-only ledger. Prefer deriving status from decisions. Future operational resolution must fail if zero or multiple effective packages match; overlapping applicability must never be silently resolved by creation order.

Use tenant/site composite foreign keys and forced RLS. Keep runtime table DML denied; if a later runtime command must append records, expose a narrow security-definer operation with a fixed `search_path`, explicit membership/site checks, authority decision and locked package root. Do not grant broad INSERT/UPDATE/DELETE on the ledger. The exact operation boundary needs a security review.

## Read interface

Keep configuration editing outside the daily job workflow. A future staff-only policy area can show each package's name/ID, revision, plain state, effective dates, source references, decision actor and why a user cannot take the next step. It must distinguish “candidate record accepted” from “approved and effective for this work.” Clients and people outside the active workspace have no access.

Do not display monetary rate/limit details to all staff until REV-007 and REV-041 settle audience and confidentiality. Do not expose edit/approve controls to the Head, Operator, or other roles merely because those screens already exist. If no grant is configured, show the policy list only to a separately authorized viewer or keep the workspace unavailable with a clear owner-facing deployment message.

## Verification plan

Use synthetic candidates in disposable PostgreSQL only. Preserve existing package validator and ledger tests, then add real API tests for:

- empty initial registry and absence of seeds;
- scoped reads, cross-site denial and `vmms_runtime` direct DML denial;
- draft creation with valid strict content/digest and rejection of invalid, duplicate, wildcard, dangling, cross-site or wrong-source references;
- missing, expired, revoked, wrong-scope and non-writable edit/approval grants;
- no role-label shortcut, including Operator and Head;
- approval bound to the exact revision/digest and immutable decision snapshot;
- future approval visible as approved but not effective until database time; past/backdated approval denied;
- rejected/withdrawn/superseded histories retained, with prior work-order snapshots unchanged;
- duplicate revision creation, competing approval/rejection, command retry, changed-payload replay and lost response;
- grant-revocation and policy-decision races under PostgreSQL locks;
- atomic rollback when event, receipt or outbox insertion fails;
- one or zero effective matches and overlapping matches both failing closed in any later resolver.

Do not claim this verifies governance readiness, document content, rates, G2/G3/G4 controls, or real approval. Browser tests should verify accessible status and blocked-reason wording only after the owner approves who can view policy details.

## Unresolved decisions and assumptions

- REV-006: named approvers, governance grants, substitutes, separation-of-duties and whether two people must approve.
- REV-008/009: actual controlled SOP corpus, revision authority, document IDs/digests, model-specific procedures and inspection sources.
- REV-035: task/HSE applicability, approval package coverage, inspection/fault/hold/rework rules.
- REV-041: who may author policy, who may approve/publish it, who can view rates and limits, and whether approval needs independent review.
- REV-007: financial values, currencies, payers and monetary disclosure policy.
- State vocabulary: whether “submitted” is a real workflow event or whether authored drafts proceed directly to review.
- Supersession semantics: whether a newer package supersedes only an explicitly named package revision or any overlapping applicability. Until the overlap rule is approved, ambiguity must block resolution.

This candidate chooses append-only state reconstruction and reuse of migration 043. It is a proposal for the implementation path, not an authorization to activate policies or begin restricted work.
