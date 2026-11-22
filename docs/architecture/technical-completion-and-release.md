# Technical completion and vehicle release (G3/G4)

**Status:** Engineering contract for implementation. Operational criteria and authority provisioning remain pending under REV-006, REV-008, REV-009 and REV-035. No G3/G4 command may accept completion or release while required policy is absent or unresolved.

## Authority and scope

This contract implements the master requirements for G3 (`master-0037`) and G4 (`master-0038`), segregated privileges (`master-0013`), G5 commercial closure (`master-0039`), the technician and independent inspection flow (`upgrade-0037`), lifecycle and exception transitions (`upgrade-0046`), task-scoped holds (`upgrade-0052`), HV/HSE controls (`upgrade-0038`), diagnostic-versus-repair authorization (`upgrade-0048`), revised-scope suspension (`upgrade-0049`), the separate eligible release signatory (`upgrade-0050`), inspection and release record fields (`master-0136`), and competence scope (`master-0137`). `upgrade-0051` supplies the G5 rule for unresolved technical holds and unapproved financial disposition; it is not the source of the G4 hold rule. Raymond Gray's Operations-to-handover direction is captured by `USER-027`.

The existing G1-G5 projection is deliberately pending. A task titled by reception is only a proposal; a diagnostic finding is not a work instruction; a supervisor handoff note is not a work plan; assignment qualification is not technical privilege; and an imported completion label is not a signed G3 or G4 decision.

## Current implementation boundary

As of 19 November 2026, the API and browser support Operations review, qualified Team Lead assignment, versioned work-plan drafts, Supervisor handoff, technician task assignment/progress, immutable Technician work declarations for Supervisor review, checklist outcomes and review, holds, evidence, scope proposals, payer responses, and exact repair estimates. A declaration snapshots its current work-plan, assignment and task work-entry references. It is the worker's statement only; it does not authorize work, change task state or sign off G3. Scope and payer records remain non-authorizing: the policy resolver still returns `POLICY_UNAVAILABLE`, so no repair or diagnostic execution can be dispatched under them. A server-projected job path now shows the current stage and the later Supervisor completion, Team Lead release, Head inspection and Service Advisor client-update stages. G3/G4/Head inspection actions are not implemented and remain visibly unavailable. The API still returns all G1-G5 gates as pending. Real sign-off remains blocked until applicable effective instructions, evidence rules, named qualifications and action grants are configured and verified.

## Transition model

```mermaid
flowchart LR
  A[Operations review] --> B[Qualified team-lead assignment]
  B --> C[Versioned work plan draft]
  C --> D[Supervisor handoff]
  D --> E[Authorized scope and dispatch]
  E --> F[Technician execution records]
  F --> G[Technician task declarations]
  G --> H[Assigned supervisor signs G3]
  H --> I[Configured independent checks and fault disposition]
  I --> J[Eligible team lead signs G4 and collection-zone move]
  J --> K[Advisor invoice, payment/guarantee and handover (G5)]
```

The work plan and supervisor handoff describe intended work. They do not authorize diagnosis, repair, a cost, or a safety action. Each executable line must be covered by a current G2-approved scope before dispatch. The scope proposal, payer response and exact repair estimate are recorded as non-authorizing revisions, but effective technical policy is unavailable, so dispatch remains blocked. Diagnostic authorization does not authorize parts replacement (`upgrade-0048`); a revised scope, added cost or new risk suspends the affected task until additional approval (`upgrade-0049`). G3 cannot be signed while required policy, evidence and action authority are absent.

### Owner-approved generic decisions for implementation

The owner-approved interim policy, the owner's operating sequence, and the explicit instruction to treat recommendations as approved settle the generic workflow rules for implementation. These decisions do not make an OEM procedure effective, create a staff qualification, or grant sign-off authority:

- G3 belongs to the current assigned Supervisor. Each in-scope task must have an attributable technician declaration and work record, every required checklist outcome must be complete and independently reviewed where configured, required accepted evidence must be present, and no blocking hold or unresolved failure may remain. The decision binds the current work-order, work-plan, G2 scope, task, evidence and instruction revisions.
- G4 is a separate Team Lead decision after G3. The assigned eligible Team Lead checks all configured pre-release inspections and fault dispositions; a successful decision atomically records release-to-service and moves custody to the collection zone. It does not authorize customer handover or departure.
- The Head of Service Centre inspection follows G4 and must pass before the Service Advisor records a completion-status contact. A failed inspection keeps client update blocked and opens a reasoned rework path. It does not erase, rewrite or retroactively invalidate the earlier signed G3/G4 records; rework requires a new scope, execution record and sign-off cycle.
- Evidence is attributable, accepted/scanned, and linked to the exact organisation, site, work order, task and source revision. The applicable effective instruction defines evidence type and measurements; VMMS does not require a universal photo or allow free text to replace prescribed evidence.
- Each action uses a distinct current grant and scoped qualification snapshot. Role titles, reporting lines, checklist review and account-administration access do not grant G3, G4 or Head inspection authority. The VMMS Operator is excluded from technical sign-off.
- Missing effective instructions, G2 scope, required evidence, current qualification/grant, inspection criteria or hold resolution blocks the action. An empty policy/configuration is never interpreted as “no checks required.”

The decision log records this generic policy resolution under REV-035. The listed model-specific, staff-specific and equipment/site inputs below remain unresolved and continue to block a successful operational transition.

### Work plan and handoff

- Store immutable work-plan revisions linked to the work order and existing planned task IDs. A revision records its author, time, rationale, and line-level task reference and handoff context. Editing a plan creates a new revision; it does not rewrite an accepted handoff.
- A revision contains an ordered selection of already proposed `planned` tasks and a planning rationale. It requires the current team-lead assignment, active qualification and distinct `work-order.prepare-work-plan` grant, with the action-time decision snapshot and resulting work-order version. A draft does not authorize work or satisfy G2.
- The assigned team lead prepares the plan and hands a specific revision to a currently eligible supervisor. Keep the handoff bound to the current team-lead assignment, Operations review, plan revision, site and work-order version.
- Reject handoff without the latest plan at the exact current work-order version. A new plan revision or any intervening work-order change requires a new handoff; preserve old unbound legacy rows as historical records rather than treating them as current.
- Plan lines are intentions only. They must not contain generated repair procedures, guessed labour allowances, assumed parts, or inferred G2 approval. Exact fields and stage rules are subject to REV-035.

### G3 technical completion

Before a G3 signature can be recorded, the server must establish that every required in-scope work item has:

1. A named technician whose effective, accepted qualification covers the exact task class, system and vehicle model, plus a distinct current, effective signed task-execution authority grant and an effective controlled instruction revision. Competence is not itself authority to act.
2. Attributable execution records for actual labour and parts, configured tests and outcomes, evidence, and deviations.
3. A technician declaration tied to the exact task, plan revision, scope revision and evidence set.
4. Record the effective task classification and policy revision. For classifications requiring additional HV/HSE controls, include the applicable model-specific instruction reference, permit, suitable test-instrument evidence, stop-work/hazard/incident record, and damaged-battery quarantine/response record as configured by approved policy. An unknown or missing required safety category blocks the affected task; this contract does not supply a procedure, threshold, permit rule or test method.
5. No unresolved blocking hold, missing mandatory evidence, stale scope, or incomplete required task.

The assigned supervisor, and no substitute based only on job title, signs aggregate technical completion after checking the complete job. The server generates `completed_at` from its trusted clock. Each technician/task declaration and execution record snapshots both the technician's task-execution grant and scoped qualification; the G3 decision is append-only and snapshots the supervisor grant, required evidence, explicit decision reason and exact work-order/task/plan/scope versions. Browser timestamps and role labels cannot satisfy this transition.

The specification requires these categories but does not define task classes, approved forms, evidence types, labour/parts semantics, test criteria, deviation dispositions or declaration wording. These remain policy inputs; an unconfigured category must block G3 rather than be silently skipped.

### G4 independent verification and release

G4 is a separate command after G3. The server loads the effective approved inspection matrix for the vehicle and work scope, requires every configured critical inspection and functional verification, checks signed outcomes and required evidence, verifies that the responsible verifier is independent where required, and requires an approved disposition for every outstanding fault. It rejects unresolved safety/quality holds and failed or missing required checks. Where the approved schedule requires an independent verifier, QA eligibility and release-signatory authority are separate decisions; satisfying one does not satisfy the other.

The eligible team lead signs the release. The command atomically records the signed decision and moves custody to the collection zone under the same work-order lock used by hold creation, resolution and other release-affecting changes. It stores the policy revision, check results, fault dispositions, evidence, authority and qualification snapshots, explicit decision reason, server timestamp, previous/current state, event, receipt and outbox item. A retry with the same idempotency key returns the original decision; a changed request or stale aggregate version conflicts. Per `master-0039`, G5 still requires invoice/payer/payment or approved credit/guarantee disposition and no customer handover before G4; G5 must also reject unresolved technical holds and unapproved financial disposition per `upgrade-0051`. G4 does not imply invoice approval, payment, showroom guarantee, client handover or physical departure.

Independent-check selection, signer separation/substitution, risk and fault disposition, hold-resolution evidence, collection-zone custody evidence and the accepted release vocabulary are not specified sufficiently to configure. Until REV-035 and the referenced source/policy reviews resolve them, G4 remains unavailable.

### Hold scope, post-release safety, and rework

- A task-scoped hold blocks the affected task according to its approved scope; unrelated task work may continue (`upgrade-0052`). A hold on a required task prevents aggregate G3 while that task remains incomplete. A work-order safety hold blocks G4 as required by `master-0038`. Exact categories and blocking semantics remain policy inputs under REV-035; an unknown hold classification cannot be treated as clear.
- Hold opening/resolution and G4 serialize on the same locked work-order row. If the hold commits first, G4 observes it and fails closed. If G4 commits first, a later ordinary hold command must be rejected with a version/state conflict. A post-release hazard must use a separately defined, attributable post-release safety or rework transition; it cannot be inserted as though the hold had existed before release or silently coexist with custody in the collection zone.
- Rework must append a new scope/execution cycle. Previous G3/G4 decisions remain immutable historical decisions, but do not approve the new work or establish a new release. Rework must bind to the new authorized scope, current instructions, execution/declaration evidence and required G3/G4 decisions. Exact reopen, custody, authority and version semantics remain pending in REV-035; until configured, rework release is unavailable.

## Persistence and transaction boundaries

The implementation should use append-only, tenant/site-scoped records with composite foreign keys to the work order and linked task. Expected records are:

- work-plan revisions and line items;
- supervisor handoffs bound to a plan revision;
- task execution records, technician declarations and evidence links;
- G3 completion decisions;
- configured G4 inspection/verification results, fault dispositions and release decisions;
- hold-resolution decisions with reason, evidence and action-time authority.

Exact tables and indexes are implementation details of the owning API/migration task, but no record may be updated to erase prior signed evidence. Runtime writes require command-specific operations. For existing work-order transitions, the required lock order is: (1) lock and recheck active site membership; (2) lock the site-scoped work order; (3) lock and recheck the named grant and exact qualification; (4) acquire the shared idempotency key and inspect its receipt; (5) for a new command, reject stale versions and evaluate current scope/evidence; (6) atomically persist domain rows, the reasoned decision snapshot, event, receipt and outbox. A matching receipt is replayed only after current membership and authority checks; a changed payload conflicts. Multi-root commands lock aggregate roots in a stable order before grants. Existing commands now follow the shared membership/target/authority/receipt order. Hold opening/resolution, G3, G4 and any post-release safety/rework transition must use the same work-order root when implemented. `BUILD-CMD-LOCK-ORDER-001` and `CHECK-CMD-LOCK-ORDER-001` cover the current runner; no G3/G4 hold-release race-safety claim is made until their commands exist and are verified.

The existing `lock_work_order_authority_grant` permits only Operations review, lead assignment and supervisor handoff. G3/G4 capability names and lock functions must be added only after a signed site authority schedule exists. Existing EV/ICE/HYB assignment checks do not cover model, system, instruction or task privilege and cannot be reused as G3/G4 approval. Authority decisions, QA eligibility and release-signatory authority remain separately configured and snapshotted under REV-006.

## Required denial and concurrency cases

- no effective policy, instruction, task mapping or current G2 scope;
- unassigned or replaced supervisor, wrong model/system/task scope, expired/revoked qualification, missing named grant, or ineligible team lead;
- missing technician declaration, execution evidence, required test, part/labour record, or unresolved deviation;
- missing, failed, non-independent or stale critical inspection; outstanding fault without an approved disposition;
- task-scoped holds must stop the affected task while permitting unrelated task progress; unresolved work-order safety hold, including a hold racing G4;
- a hold committed before G4 must be observed and block it; a later ordinary hold after release conflicts and is redirected to a configured post-release safety/rework flow;
- rework attempts must preserve old G3/G4 decisions and cannot reuse them as approval for a new scope or release;
- stale work-order, plan, scope or evidence version; changed idempotency payload; replay after membership, grant or qualification revocation;
- duplicate or conflicting G3/G4 signatures, attempted use of Admin role, client payment or showroom guarantee as a bypass;
- any attempt to treat G3, G4, invoice approval, payment, collection-zone movement and vehicle departure as one transition.

## Pending inputs and implementation order

REV-035 records the exact G3/G4 policy questions. REV-006 supplies named sign-off grants and substitutes; REV-008 supplies effective SOPs; REV-009 supplies model-specific procedures, emergency policy, inspection matrix and equipment acceptance. Until owners provide these inputs, build the empty configuration model, append-only evidence model, validation and synthetic denial cases, but keep operational G3/G4 commands disabled. Do not seed production grants or claim G3/G4 readiness from engineering tests.

Implementation order: shared target/grant/receipt lock-order refactor and PostgreSQL race verification (`BUILD-CMD-LOCK-ORDER-001`, `CHECK-CMD-LOCK-ORDER-001`); versioned work-plan/handoff; task execution and declaration evidence; Supervisor G3 decision; configured independent inspection/fault disposition and hold resolution; Team Lead G4 release/collection-zone event; separate G5 invoicing, payment/guarantee, handover and departure. The read-only closeout path is navigation only; it does not close `BUILD-R-M-0037`, `BUILD-R-M-0038`, `BUILD-USER-027`, or their verification tasks and does not authorize a pilot.
