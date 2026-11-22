# G3/G4 implementation candidate C

**Status:** Candidate design only; not selected, implemented, or permission to release a vehicle.  
**Date:** 19 November 2026  
**Base:** Existing site-scoped work-order aggregate, work plan, task assignments, execution/activity records, checklist outcomes, review records, holds, command receipts, events, and outbox. Do not create a separate closeout aggregate.

## Recommendation

Build three distinct, append-only decisions on the existing work order:

1. The assigned Supervisor records **G3 technical completion** after the server derives that every currently required, approved task is complete with its required evidence and declarations.
2. An eligible Team Lead records **G4 release to service** and the linked **move to collection zone** after G3 and every applicable pre-release check are valid.
3. The Head of Service Centre records a separate **post-release inspection** after G4. It is not G3 or G4 and cannot replace or rewrite either decision.

All three commands use the existing work-order row as the serialization root. They derive current inputs from the latest effective work plan, authorized scope, task assignments, task records and evidence. The browser submits an expected work-order version and command-specific evidence/decision facts; it never supplies a trusted gate result, current assignment, required-check list, policy revision, actor, grant, qualification, or timestamp.

The existing work-order aggregate remains the canonical record. Append-only decision rows are children of the work order and reference the exact source revisions they attest. No parallel “closeout” aggregate, stock state, invoice state, payment state, handover state, or vehicle-departure state is introduced.

## Current implementation evidence

- The [technical completion and release contract](../technical-completion-and-release.md) says G1-G5 remain pending and G3/G4 commands must fail closed. It requires task declarations, effective source instructions, G2 scope, action grants, qualifications, evidence, holds, and atomic receipts/events/outbox.
- The owner-approved [interim operating policy](../../operations/interim-workshop-operating-policy.md) fixes the sequence: assigned Supervisor technical completion; Team Lead release and collection-zone movement; separate Head inspection; then Service Advisor update/handover. It explicitly does not supply model-specific procedures, qualifications, named grants, inspection criteria, or financial authority.
- Current task checklist outcomes are append-only, assignment- and source-bound records. The checklist review command is explicitly a record review, not job completion, G3, G4, or release. A checklist must already be in progress; effective vehicle-specific templates and a successful PostgreSQL review flow are still absent.
- The 18 November role journey covers Operations review, Team Lead assignment and plan, Supervisor handoff, task assignment, technician updates, labour, evidence, and reports. Its verification expressly excludes G3, G4, Head inspection, G5, and collection-zone handover.
- Current API routes cover review, assignment, supervisor handoff, plan revisions, task allocations, task activity, checklist outcomes, and checklist review. There is no G3, G4, or post-release Head inspection command or screen. Existing G1-G5 projections remain pending.

## Decision boundaries

| Decision | Actor and point in sequence | What it records | What it never means |
| --- | --- | --- | --- |
| G3 technical completion | Current assigned Supervisor, after task work and declarations | A decision that all applicable, authorized work in the exact scope is technically complete, supported by the current task, procedure, qualification, grant, evidence, review, and hold state | It does not release the vehicle, move custody, approve new scope, clear an unresolved finding, settle finance, or authorize collection |
| G4 release to service | Eligible Team Lead, after G3 and required pre-release checks | The separate release decision and a same-transaction custody movement into the collection zone | It does not perform the later Head inspection, issue an invoice/receipt, confirm payment/guarantee, hand over the vehicle, or permit departure |
| Post-release inspection | Head of Service Centre after G4, or eligible independent checker if the Head participated in the work | A separately attributable inspection result bound to the G4 decision and its source revisions | It does not replace G3/G4, undo history, move the vehicle out of the collection zone, or authorize Advisor notification when failed/blocked |

G5 remains a separate commercial and handover stage. Under the interim policy, the Service Advisor must not update the customer or proceed with handover until the Head inspection is clear. No current G5 settlement, customer-notification, handover, or departure command is implied by this candidate.

## Minimal command and screen design

### 1. Supervisor G3 command

Suggested route: `POST /api/v1/sites/:siteId/work-orders/:workOrderId/technical-completion`.

The signed decision contains a stable ID, work-order version, exact work-plan revision, exact authorized-scope revision, assigned Supervisor placement, action-time completion grant ID/revision, policy package ID/revision/digest, qualification/evidence snapshots required by configured rules, decision reason, and database timestamp. The API records the decision and common command envelope atomically.

Eligibility is derived under the work-order lock. The required task set must come from the exact current approved scope and effective policy, not the client’s submitted list and not every historical proposed task. For each required task, verify current task assignment and accepted performer qualification/technical grant; effective applicable instruction; declaration tied to current plan/scope/assignment; required execution, test, measurement, parts/labour, deviation and accepted evidence; required independent record review; and no unresolved task/work-order hold or blocking fault. Missing, stale, unknown, inapplicable-without-reason, failed, or unconfigured criteria block G3 with a clear next action.

Only the currently assigned Supervisor with a distinct current G3 grant may sign. A role label, Team Lead handoff, task review, checklist item review, or technician outcome cannot substitute. The Supervisor cannot approve missing technician work by editing the task record during G3; corrections are separately appended by the authorized performer and reviewed as required.

### 2. Team Lead G4 command

Suggested route: `POST /api/v1/sites/:siteId/work-orders/:workOrderId/release-to-service`.

The command requires the current valid G3 decision and exact work-order version. The API derives the inspection matrix and pre-release checks from the effective policy package for the verified vehicle and scope. Every required check needs its own attributable outcome, verifier authority/qualification, independence status, evidence and disposition. Failed or outstanding faults, unresolved safety holds, stale G3/scope/evidence, unknown applicability, or missing policy block G4.

The currently assigned eligible Team Lead needs a separate release grant. If configured policy requires a QA/independent check, that checking eligibility does not provide release authority. G4 writes one immutable release decision and a custody movement to the collection zone in the same work-order transaction. A vehicle is not marked collected, paid, invoiced, or departed.

### 3. Head post-release inspection command

Suggested route: `POST /api/v1/sites/:siteId/work-orders/:workOrderId/post-release-inspections`.

This command is accepted only after a current G4 release and collection-zone movement. It binds to that G4 decision, current work-order version, effective post-release inspection policy/source, exact check results, evidence, actor’s distinct inspection grant and qualification, and independence decision. The Head must not inspect work they performed; if they participated, select an eligible independent checker or keep the vehicle held and escalate, as the approved policy states.

Record clear, failed, blocked, or not-applicable only when the approved source defines that outcome and its evidence/reason. A failed or blocked result remains append-only and does not rewrite G4. It blocks subsequent Advisor/customer-update work. Because the current technical contract explicitly requires a separately defined post-release safety/rework transition and rejects ordinary holds after G4, any adverse result must stop and escalate until that transition is designed and authorized. Do not silently reverse collection-zone custody or create an ordinary pre-release hold.

## Persistence and transaction behavior

Use small append-only child records linked by composite organisation/site/work-order foreign keys:

- `work_order_g3_decisions`: exact plan, scope, policy digest, required-task snapshot, evidence references, supervisor placement, grant/qualification snapshots, reason, previous/current work-order versions, timestamp.
- `work_order_g4_release_decisions`: exact G3 decision, inspection-matrix/source digest, check and fault-disposition references, Team Lead placement, release grant snapshot, reason, previous/current versions, timestamp, collection-zone custody result.
- `work_order_post_release_inspections`: exact G4 decision, effective post-release inspection source, results/evidence, Head or substitute checker placement, inspection grant/qualification snapshots, independence evidence, reason, timestamp.

Do not copy editable task data into a new aggregate. Store references plus a canonical decision-time snapshot sufficient to explain exactly what was checked. All source rows remain authoritative in their owning work-order/task/evidence tables. Audit records contain metadata and bounded decision facts, never private object keys or unnecessary customer data.

Each command follows the existing lock and receipt protocol:

1. Lock and recheck active writable membership.
2. Lock the site-scoped work-order row, which serializes G3/G4, hold changes, scope changes, task changes, assignment changes, and collection-zone movement.
3. In a stable documented order, lock/recheck current action grant, qualification and exact policy revision/effectivity; prevent concurrent revocation or policy withdrawal from racing the decision.
4. Check the actor/site command receipt. A matching command and payload returns its original result after current membership/authority checks; changed payload conflicts.
5. For a new command, reject stale expected work-order, plan, scope, assignment, G3, checklist, evidence, or inspection versions; then derive eligibility from current records.
6. Atomically append the decision, reasoned domain event, idempotency receipt and outbox item, and perform any G4 collection-zone custody mutation. Do not enqueue customer messages as part of these commands.

Corrections create a new reasoned record linked to the superseded result. Previously signed G3/G4 decisions remain visible and immutable. A new scope or rework cycle must receive new execution evidence and new decisions under a separately approved lifecycle; old signatures never authorize the new work.

## Authorization model

Roles identify eligible work queues; they do not grant signatures. Use distinct action grants, checked at decision time and snapshotted:

- `work-order.g3.technical-completion` for the currently assigned Supervisor.
- `work-order.g4.release-to-service` for the eligible assigned Team Lead.
- `work-order.post-release-inspection` for the Head or approved independent substitute.
- Existing task-execution, checklist-review, QA inspection, hold-resolution, and policy grants remain distinct and do not imply these decisions.

The exact grant names, signatory schedules, qualification codes, substitution rules and named recipients are not approved/configured yet. Do not seed any grant based on a title or synthetic fixture. Current task qualification checks do not prove any G3/G4 privilege or model-specific competence.

## What can be implemented now

The owner has approved the workflow ordering, separation of actors/decisions, append-only evidence principles, scope authorization, stop-work, and no invented vehicle procedure. These foundations can proceed while operational signatures remain blocked:

- A read-only stage panel on the existing work-order detail for Supervisor, Team Lead, Head and Advisor, showing the current stage, responsible role, signed decisions, and exact reason a next action is unavailable.
- Typed command boundaries and strict validation, but with operational execution returning a fail-closed `POLICY_UNAVAILABLE`/`AUTHORITY_UNAVAILABLE` result until the configuration is valid.
- Empty append-only tables, tenant/site constraints, RLS, runtime least-privilege grants, event vocabulary, and command receipt wiring, provided the schema does not seed operational rules or grants.
- Deterministic synthetic denial and transaction tests for missing policy/source, missing G2, wrong actor/placement, missing/revoked/expired grant or qualification, stale revisions, incomplete task set, missing evidence, unresolved holds/faults, self-inspection, duplicate signatures and cross-site access.
- Workflow UI states for loading, empty, denied, policy missing, qualification missing, stale/conflict, failed inspection, offline and successful historical decision; no “complete” or “released” success state until the corresponding server command can pass all checks.

The current contract’s configured-policy resolver is not operational: it has no effective database resolver and reports `POLICY_UNAVAILABLE`. Until one exists and exact effective sources have been approved, there must be no successful synthetic “ready to release” path in production or a seeded local environment.

## Inputs that still block a successful decision

The following remain unavailable and must gate every real happy path:

1. **G2 and execution authority:** G2 scope approval and task assignment/privilege are not implemented. No task is authorized for repair merely because it is planned or completed in a historical source.
2. **Effective OEM instructions:** exact make/model/variant/market/current revision procedures, applicable task classes, measurement limits, test methods, tool/calibration needs, and accepted evidence categories must come from controlled sources. Generic interim policy cannot supply these values.
3. **Qualifications and named authority:** accepted, current model/task-specific qualification records and named action-specific grants/substitutes under REV-006 are not configured.
4. **G3 completeness rules:** approved work-item mapping, required labour/parts/tests/deviations, declaration wording, reviewer requirements, fault dispositions and incomplete/failed rules need approved source/policy.
5. **G4 inspection matrix:** pre-release checks, independence rules, QA eligibility, failure disposition, custody evidence and collection-zone definition need approved source and REV-035 resolution.
6. **Post-release inspection effect:** exact inspection steps and authorized response to failure are undefined. The accepted ordering means this is an extra post-G4 check, and its failed-result/rework transition must be explicitly designed before enabling Advisor updates.
7. **G5 boundary:** configured finance policy, verified payment or approved showroom guarantee, recipient privacy, actual handover identity/authority and vehicle-departure command remain separate. G4 and a clear Head inspection cannot bypass these gates.

Until each relevant dependency is approved, store no accepted decision that implies the corresponding work is safe or complete. Preserve records as proposed, pending, unknown, failed, blocked, or evidence-only as appropriate.

## Denial and concurrency cases to verify

- No effective policy, exact applicable instruction, G2 scope or approved source digest.
- Actor has the right role but wrong/currently replaced assignment, missing grant, expired grant, revoked grant, invalid substitute, expired/revoked qualification, or insufficient model/task scope.
- Supervisor self-performed the work being independently verified where policy requires separation; Head participated in work and no independent checker is eligible.
- Task missing, incomplete, stale, not checked, failed, blocked, not applicable without approved reason, missing declaration, missing evidence, unreviewed checklist outcome, unresolved fault or hold.
- G4 before valid G3; wrong Team Lead; missing/failed/non-independent/stale check; outstanding fault; work-order hold committed before G4.
- Head inspection before G4, mismatched G4 version, unauthorized reviewer, or attempt to pass failed/blocked inspection into Advisor/customer update.
- Any attempt to combine G3, G4, Head inspection, invoice, payment/guarantee, collection-zone move, customer handover or vehicle departure.
- Same command ID and payload replay returns the exact decision without duplicate custody/event/outbox; changed payload conflicts; concurrent duplicate signature conflicts; concurrent hold/scope/assignment/policy revocation wins or loses only according to the shared lock order and never produces partial state.
- Membership/grant/qualification revoked after initial submission but before command lock: deny. A replay after revocation is denied without leaking the previous response.
- Organisation/site mismatch, direct SQL under restricted runtime role, rollback injected between decision/event/receipt/outbox, and pagination/read-access scoping for role queues.

PostgreSQL concurrency and RLS tests must use the actual restricted runtime identity. Browser-only or SQLite-only checks do not prove the lock, grant-revocation, hold-race, or transaction claims. Browser tests should cover assigned Supervisor, Team Lead, Head, and Advisor views at phone/foldable/tablet/desktop/zoom widths, including action visibility, keyboard use, explicit blockers, retries, conflict recovery, and no G5 action before Head inspection.

## Open policy boundary

The interim policy authorizes the sequence and separated responsibilities, but the pre-existing engineering contract describes pre-release independent checks before G4, while the newly approved operating policy places the Head's separate inspection after G4. Candidate C reconciles this by keeping G4's configured release checks separate from the later Head inspection. It does **not** decide whether the Head inspection repeats any G4 check, whether a failed Head check changes custody, or how the vehicle returns from the collection zone for rework. Resolve those exact inspection and post-release exception rules under REV-035/REV-052 before a happy path is enabled.

No production grant, procedure, checklist, qualification, team assignment, or approval is created by this candidate. It does not mark `BUILD-R-M-0037`, `BUILD-R-M-0038`, `BUILD-USER-027`, or related verification tasks complete.
