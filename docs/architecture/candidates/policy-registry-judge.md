# Policy registry candidates — cross-judge

## Scope and evidence

This review compares [Candidate A](policy-registry-candidate-a.md), which extends the existing package revision/decision ledger, with [Candidate B](policy-registry-candidate-b.md), which introduces a more general immutable event ledger and multiple policy families.

The authoritative requirement `R-M-0016` calls for versioned SOP references, approved authority, limits, inspections, rate cards and case classes, with inactive/approved/effective/superseded states. It requires named approval, evidence, revision and effective intervals, rejects unauthorised activation and retrospective application, and allows synthetic implementation checks before actual values arrive. The implementation plan directs us to build configuration and validation while leaving safety and financial decisions fail-closed. Current policy package validation is strict and always denies operational use; migration `043` already stores immutable site-scoped revisions and approval/rejection/withdrawal decisions, but the runtime role has SELECT only and there is no write/read API workflow. The authority grants in migrations `019` and `021` are empty by default and runtime cannot issue them.

REV-006, REV-007, REV-008, REV-009, REV-035 and REV-041 leave the actual grants, approvers, SOPs, technical rules, inspection criteria, rates, monetary limits, policy visibility and separation-of-duties decisions unresolved. Neither candidate may fill those gaps with defaults.

## Scores

Scores are 0–5; 5 is strongest for the criterion.

| Criterion | Candidate A | Candidate B | Evidence-based reason |
| --- | ---: | ---: | --- |
| Source fit and scope | 4 | 4 | Both preserve empty policy values and acknowledge the full requirement. A is specific to the existing work-order package; B sketches the broader settings but risks duplicating the controlled-document and future finance registries. |
| Security and authority separation | 4 | 5 | Both avoid role-label grants and a seeded approver. B more clearly calls out the governance bootstrap problem and absent grant issuer. A's proposed capability names are reasonable engineering labels, but they must remain unassigned pending review. |
| Immutable lifecycle and effectivity | 3 | 4 | B names lifecycle events and interval-overlap checks, but it makes approval and activation two separate grants/events without an accepted policy requiring that split. A correctly treats `effective` as a time-derived projection, though it needs exact supersession semantics before writing that projection. |
| Fit with current migration and command boundary | 5 | 2 | A reuses migration `043` and identifies only proven ledger gaps. B's generic event ledger would replace or extend a functioning immutable schema before demonstrating a need, widening migration, replay and query scope. |
| Honesty about owner decisions and operational readiness | 5 | 5 | Both leave real procedures, rates, grants and operational use unavailable. Neither treats design or synthetic evidence as approval. |
| **Total** | **21/25** | **20/25** | **Candidate A is the better implementation base, with selected controls from B.** |

## Findings

### Candidate A

- The decision-history approach matches migration `043`: no mutable status can drift from its immutable revision and decisions. An unapproved candidate can project as inactive/draft; `effective` can be derived from an exact approved digest and its half-open interval using the database clock.
- It needs a narrow, reviewed persistence boundary. Migration `043` intentionally denies all runtime DML; ordinary application inserts must not be added as a broad table grant. A scoped security-definer append operation or equivalent restricted database function must preserve membership, package-root lock, action-specific grant snapshot, command receipt, event/outbox atomicity and immutable triggers. If this boundary cannot be proven, keep write routes absent and mark the implementation slice incomplete.
- Its suggested states do not yet define how a newer package supersedes old applicability. A newer revision must not silently win by creation time. Until a specific supersession event names the exact revision and applicability and serializes against policy use, overlapping candidates must resolve to unavailable.
- The suggestion to require an approver different from the author is prudent but unresolved. Do not enforce or relax it as though REV-006/041 had answered it.
- One site-scoped copy fits the present service-centre rollout and existing schema. Cross-site inheritance or a global company package needs an explicit source/ownership decision before it is modeled.

### Candidate B

- Its exact revision/digest event chain, database decision time, overlap denial and bootstrap warning are valuable review checks.
- Separate `approved` and `activated` states are not a harmless implementation detail. They imply separate grants, actors, evidence and operational ownership. REV-006/041 do not define that additional gate. Prefer approved plus future-dated effectivity as the initial projection; add a separate publication/activation transition only if the owner approves it.
- Its proposal for several typed policy families is directionally compatible with R-M-0016, but work-order instructions, controlled document lifecycle and finance configuration have different sources and owners. Do not create a permissive cross-domain registry or duplicate document bytes/revision records. The current work-order package may pin source documents; rates/tax/payers remain a separate REV-007-dependent model.
- Replacing the decision table with a generic ledger is not justified yet. Existing decisions already bind package revision, digest, actor, authority snapshot, reason, command UUID and site scope. An append-only event table should be added only when a concrete missing event or integrity constraint cannot fit the existing ledger safely.

## Selection and grafts

Select Candidate A as the base. Graft these controls from Candidate B:

1. Treat governance bootstrap as an explicit separate dependency. No role, Head, Operator, qualification, or policy-registry record can mint its own governance grant.
2. Serialize and test concurrent revisions, decisions, grant revocation and applicability overlaps. Any zero/multiple effective match or ambiguous overlap returns `POLICY_UNAVAILABLE`.
3. Bind every decision and future operational snapshot to the exact immutable digest and PostgreSQL transaction time; prior signed work decisions remain unchanged after withdrawal or supersession.
4. Keep the generic event ledger, separate activation event and multiple policy-family expansion out of the first implementation unless a source or owner decision proves they are required.

The immediate implementation can safely deliver a scoped read projection of the empty/fixture candidate ledger and a write command contract that fails closed when its named grant is missing. Synthetic database-owner fixtures may test permitted grant paths in disposable databases only; no production grants or policy content are to be inserted. If the runtime write function would need to create generic command/audit/outbox state outside an atomic boundary, defer the write route and complete the database-boundary design first.

## Required verification before task closure

- Empty production state; no seeded policy values or grants.
- Real PostgreSQL site isolation and runtime direct-DML denial remain intact.
- Missing, expired, revoked, wrong-scope and wrong-capability grant denials; no role-title shortcut.
- Exact digest binding, immutable revisions and decisions, authorized transition ordering, reason and replay behavior.
- Approval before and at effective-time boundaries; no retrospective effectivity; future policy remains unavailable before its start.
- Concurrent revision/decision and grant-revocation outcomes serialize deterministically; overlapping applicability never resolves by “latest wins.”
- Failure rollback leaves no revision/decision, receipt, audit or outbox partial state.
- Every synthetic permitted-path test uses an isolated disposable database and explicitly states it does not establish real governance authority or operational readiness.

This selection chooses an implementation structure only. The outstanding management and technical policy decisions remain open, and G1–G5 cannot use a package until the required sources, approvals, grants and resolver have their own verified tasks.
