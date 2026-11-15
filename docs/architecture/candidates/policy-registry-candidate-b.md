# Candidate B: append-only policy event ledger

## Purpose and limits

This candidate addresses `BUILD-R-M-0016` and `R-M-0016` without defining workshop procedures, finance values, authorities, or staff permissions. The source requires configurable SOP revisions, approved authorities, limits, inspections, rate cards and case classes (`master-0016`, `upgrade-0029`). It also requires named approval, evidence, revision and effective intervals, while the SOP library and authority schedule remain absent.

The candidate does **not** enable G1 through G5, policy publication, role editing, or operational use. `REV-006`, `REV-008`, `REV-009`, `REV-035` and `REV-041` remain gates. Until the owner supplies policy and approves governance permissions, runtime access stays read-only and every candidate resolves to `POLICY_UNAVAILABLE`.

## Candidate

Keep each policy payload as an immutable, typed revision. Record every lifecycle change as a separate immutable event. Treat a revision's visible state as a projection of its revision row and ordered events; never update a status column in place.

### Revision record

The current `work_order_policy_package_revisions` row in migration `043_work_order_policy_ledger.sql` is a useful first typed family: it stores exact package content, revision, schema version, digest and proposed interval. Extend the configuration model through distinct, schema-validated families instead of placing unrelated material into one permissive JSON document:

- work-order policy package;
- controlled SOP/document references;
- approval-grant policy references;
- inspection and case-class configuration;
- commercial settings such as rate-card, payer, tax or monetary-limit references, subject to `REV-007` and Finance review.

Each family uses an explicit schema version. A stored revision records organisation/site, stable family ID, revision number, canonical payload, digest, provenance/source pins, creator and database creation time. Source bytes and signatures are not implied by a filename or hash; the approved evidence process must establish that the exact source exists and is accepted.

### Lifecycle event

Use an append-only event table keyed to the exact revision and digest. Event actions are a closed transition vocabulary, initially:

| Event | Meaning |
| --- | --- |
| `submitted` | A complete immutable draft is presented for review. |
| `approved` | A named authorized approver approves the exact revision and digest for the recorded purpose. |
| `rejected` | A named reviewer rejects that revision with a reason. |
| `activated` | An authorized activation records when the approved revision may govern future decisions. |
| `withdrawn` | An authorized withdrawal prevents later use; it does not erase prior decisions. |
| `superseded` | A later revision replaces this revision for the same exact applicability after its own effective event. |

An event stores organisation/site, family and revision identity, the previous event identity, action, actor, reason, database timestamp, command UUID, exact package digest, and an immutable snapshot of the action-specific signed grant/qualification evidence. Do not accept a client-supplied actor, authority, decision time, prior state or effective status.

`inactive` means a revision has no submission event. `approved` means the exact digest has a valid approval event but has not become effective. `effective` is a read projection: an approved and activated revision whose interval includes the database transaction time and which is neither withdrawn nor superseded. `superseded` is a terminal historical projection, not a rewrite of the revision. A report or command that used a revision retains its exact revision and digest, so a later event cannot rewrite the past.

## State and time rules

- Accept only the documented transition graph. For example, reject, withdraw, activate and supersede cannot be emitted for an absent or mismatched revision; an approval cannot refer to another digest; a second competing terminal event conflicts.
- Draft correction creates the next immutable revision and preserves the previous draft. Never edit or delete policy content after its digest has been recorded.
- Approval and activation are different decisions. Each requires its own named grant, actor, evidence and reason. A general staff role, VMMS Operator, Head role, technical qualification or account-administration permission cannot substitute.
- Use PostgreSQL `transaction_timestamp()` as the decision clock. Reject activation where the requested effective start predates the activation event. Future effective intervals may be approved, but must not become usable before their effective start.
- On activation, serialize by organisation/site/family and validate the full interval and exact applicability against all already approved or effective revisions. Reject ambiguous overlapping revisions; never choose the latest revision as a silent tie-breaker.
- An operation snapshots the exact policy revision, digest, effective interval, authorization decision and server time in its own atomic command. Future operations resolve only current effective configuration. Existing snapshots remain bound to their original decision even after a replacement or withdrawal.
- A policy must not become effective retroactively. If an effective start is already in the past by activation time, require a new revision with an acceptable future/current start and repeat approval; do not repair timestamps or historical work decisions.

## Authorization and bootstrap

The current authority registry (`staff_authority_grants`, migration `019`) is empty by design and has no general governance grant issuer. REV-006 and REV-041 do not identify the named policy authors, approvers, publishers or required separation of duties. Therefore:

1. Define grant *capability names* in the model only after governance owners review the action boundaries; never create a person or role-to-grant mapping in a seed.
2. Keep policy-write routes and UI absent or explicitly unavailable until a signed external/management authority schedule names who may issue those grants.
3. Never let the policy registry approve the authority schedule that grants permission to approve the policy registry. Bootstrap of governance authority is a separately evidenced management action.
4. At command time, lock membership, the scoped registry root, and the named authority record before checking the idempotency receipt or applying the transition. Recheck active membership, grant, qualification, evidence, expected revision and digest on replay.
5. If the grant or schedule is missing, expired, revoked, conflicted, or outside its scope, return a plain denial and make no event, receipt, notification or partial revision.

This empty state is an intentional control. It satisfies no claim that an operational policy has been approved or that a staff member can perform a safety or financial action.

## Database and API shape

Reuse the current append-only `work_order_policy_package_revisions` and `work_order_policy_package_decisions` only for the existing work-order package family. Candidate B would replace or extend the decision table with the generic typed event ledger once migration status is confirmed; do not write both competing ledgers for the same decision. Add composite organisation/site foreign keys, uniqueness for `(org, site, family, revision)`, `(org, site, command actor, command UUID)`, and `(revision, digest)` references. Enable and force RLS; deny update/delete at both table and runtime role. The API runtime receives no policy write privileges until governance grants and command paths are approved.

Expose future named operations such as create draft, submit, approve, activate, reject and withdraw only after those grant rules are approved. Read endpoints return one scoped revision plus its derived state and complete decision history; they never accept a requested state or decide effective status in the browser. A future policy resolver receives the work-order/task identifiers from the locked canonical model, resolves exactly one applicable effective revision in the same transaction, and denies on no match, multiple matches, invalid digest, unresolved source, unsupported schema or missing section.

Do not add an activation worker or scheduled policy process in this candidate. If management later requests unattended scheduled activation, define its execution identity, clock behavior, failure recovery and audit contract as a new reviewed capability.

## Validation and test matrix

Use synthetic-only fixtures in disposable PostgreSQL. Verify:

- complete revisions for each implemented schema family; invalid/unknown fields, source pins, digests, revisions and intervals fail closed;
- transitions are append-only and only legal from the derived prior state;
- two approvers/activators racing the same revision cannot both create conflicting decisions;
- concurrent revisions with overlapping applicability cannot both activate for an overlapping interval;
- missing, wrong-site, revoked, expired, out-of-scope and wrong-capability grants deny; no operator/admin shortcut exists;
- retries replay the original result only after current membership and grant checks; altered payload, stale revision and event-order conflicts fail;
- rejected or withdrawn packages are unavailable; current policy resolves to exactly one matching revision or denies;
- before/equal/after interval boundaries use PostgreSQL transaction time; backdated activation is rejected; future approved policy is unavailable before its start;
- an existing action snapshot continues to reference its original digest after a newer revision, withdrawal or supersession;
- all failed paths leave no partial event, receipt, audit or outbox row.

The existing `validateEffectivePolicyCandidate` helper is not a resolver and currently denies every otherwise valid candidate because no authenticated approval/effectivity ledger exists. Keep this behavior until end-to-end lifecycle evidence and owner approvals exist.

## Trade-offs

**Advantages:** lifecycle history is naturally auditable; corrections never erase draft or approval history; approval and activation are distinct; the effective-state projection can be reconstructed; work-order commands can pin a precise digest; and empty authority remains safe by default.

**Costs:** every read of the current state must correctly replay or project ordered events; legal transitions, lock order, duplicate decisions, interval overlap and authorization snapshots need careful tests. A read projection or materialized current-state cache would introduce another state that must be derived atomically and repaired safely. Keep the initial implementation on direct indexed event queries under a per-site/family lock until measured performance justifies a cache.

This candidate is an alternative lifecycle model, not owner approval to create policy values or governance permissions. The other candidate and judge should select the simplest model that can satisfy R-M-0016 while keeping the current write path unavailable.
