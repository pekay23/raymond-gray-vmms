# Candidate A: completion and release as an append-only decision ledger

**Status:** Candidate design only; not an implementation, policy approval, or operational grant.

## Problem

The current VMMS has a persisted chain through work planning, Supervisor handoff, task allocation, technician progress/evidence and role-scoped reports. It has no G3 Supervisor completion, G4 Team Lead release, or separate Head post-release inspection command. The existing policy-package validator intentionally returns unavailable because there is no approved effective package, and the authority grant helper does not support G3/G4 capabilities. The design must preserve the owner's approved sequence while keeping exact task procedure, model scope, qualifications, grants, evidence, inspection rules and failed-inspection routing fail-closed.

## Usage from each caller's view

The assigned technician records actual work on the task, plus an explicit declaration against the current task assignment and approved scope:

```ts
await execution.recordTaskDeclaration(scope, commandId, {
  workOrderId,
  taskId,
  expectedWorkOrderVersion,
  workPlanRevisionId,
  assignmentRevision,
  scopeDecisionId,
  declaration: "work-record-complete",
  evidenceIds,
  deviation: null,
});
```

The current Supervisor asks VMMS whether all required task declarations and source-backed requirements are ready, then signs the single job-level G3 decision:

```ts
await completion.recordG3(scope, commandId, {
  workOrderId,
  expectedWorkOrderVersion,
  reason: "I reviewed the current assigned task records and evidence.",
});
```

After the configured independent checks and fault dispositions exist, the current Team Lead records G4 and collection-zone movement as one command:

```ts
await release.recordG4(scope, commandId, {
  workOrderId,
  expectedWorkOrderVersion,
  reason: "I reviewed the current release evidence and outstanding fault decisions.",
});
```

Only after G4 may the Head record the separate post-release inspection. An Advisor completion-status contact is available only after this inspection passes. Invoice, payment or showroom guarantee, receipt, physical departure and vehicle handover remain later, separate G5 work.

## Shape

### Domain records

Use append-only, version-bound records beneath the canonical work order:

```ts
type TaskExecutionDeclaration = {
  id: string;
  workOrderId: string;
  taskId: string;
  taskRevisionId: string;
  workPlanRevisionId: string;
  assignmentRevision: number;
  scopeDecisionId: string;
  policyPackageId: string;
  policyRevision: number;
  policyDigest: string;
  actorId: string;
  actorPlacementId: string;
  executionGrantSnapshot: unknown;
  qualificationSnapshot: unknown;
  evidenceIds: string[];
  declaration: "work-record-complete";
  deviation: string | null;
  recordedAt: string;
};

type G3Decision = {
  id: string;
  workOrderId: string;
  workOrderVersion: number;
  workPlanRevisionId: string;
  scopeDecisionId: string;
  policyRevision: number;
  policyDigest: string;
  taskDeclarationIds: string[];
  actorId: string;
  actorPlacementId: string;
  supervisorAssignmentSnapshot: unknown;
  completionGrantSnapshot: unknown;
  qualificationSnapshot: unknown;
  reason: string;
  decidedAt: string;
};

type G4Decision = {
  id: string;
  workOrderId: string;
  workOrderVersion: number;
  g3DecisionId: string;
  policyRevision: number;
  policyDigest: string;
  inspectionResultIds: string[];
  faultDispositionIds: string[];
  actorId: string;
  actorPlacementId: string;
  releaseGrantSnapshot: unknown;
  qualificationSnapshot: unknown;
  reason: string;
  custodyTransitionId: string;
  decidedAt: string;
};

type HeadInspection = {
  id: string;
  workOrderId: string;
  g4DecisionId: string;
  collectionCustodyRevisionId: string;
  policyRevision: number;
  policyDigest: string;
  result: "passed" | "failed" | "incomplete" | "blocked";
  actorId: string;
  actorPlacementId: string;
  inspectionGrantSnapshot: unknown;
  qualificationSnapshot: unknown;
  evidenceIds: string[];
  reason: string;
  decidedAt: string;
};
```

The declared values are records of a decision, not the complete procedure schema. Exact check lists, thresholds, pass rules, evidence requirements and qualifications come only from the effective policy package pinned by vehicle make/model/variant/powertrain/system/task and applicable market. Do not permit a browser to submit its own “ready” task or inspection lists; the server resolves the exact package and writes the IDs actually reviewed into immutable decision snapshots.

`G3` is a job-level Supervisor decision over the exact current required-task set and its latest eligible technician declarations. It is not a task progress update. `G4` is a separate Team Lead decision over the current G3, all policy-required inspections, fault dispositions and safety holds; its transaction also records movement to the collection zone. The Head inspection references that exact G4 and collection-custody revision. It cannot backdate, replace or erase G3/G4.

Readiness is a derived projection, not a second mutable state flag. A plan/scope change, changed task assignment, newer outcome/declaration, superseded policy, unresolved hold, stale evidence or changed work-order version removes readiness until the current records are checked again. Prior signed decisions remain in history and never authorize later scope or a new rework cycle.

### Module and API boundaries

Keep route handlers thin in `apps/api/src/app.ts`; group state and invariants by owning domain:

- `apps/api/src/work-order-execution-declarations.ts`: validate the current assigned worker, scope, task classification, effective procedure, competence and evidence; append an attributable declaration.
- `apps/api/src/work-order-g3.ts`: derive job readiness and record the assigned Supervisor's G3 decision.
- `apps/api/src/work-order-g4.ts`: record the Team Lead's independent required-check/fault decision and collection-zone custody transition.
- `apps/api/src/work-order-head-inspections.ts`: record the distinct Head inspection bound to G4 and collection custody; expose the passed/failed state needed by the Advisor's completion-contact gate.
- `apps/api/src/work-order-readiness.ts`: produce a read-only, site-scoped explanation of each current gate, responsible role, blocked reason and next permissible step. It must use the same source/grant resolvers as commands, not duplicate UI guesses.

Proposed routes:

```text
POST /api/v1/sites/:siteId/work-orders/:workOrderId/tasks/:taskId/execution-declarations
GET  /api/v1/sites/:siteId/work-orders/:workOrderId/completion-readiness
POST /api/v1/sites/:siteId/work-orders/:workOrderId/g3
POST /api/v1/sites/:siteId/work-orders/:workOrderId/inspections
POST /api/v1/sites/:siteId/work-orders/:workOrderId/g4
POST /api/v1/sites/:siteId/work-orders/:workOrderId/head-inspections
```

The read endpoint returns a discriminated `ready | blocked` result. A blocked result names each missing prerequisite in plain language and links to the action that can resolve it. No endpoint returns a ready result from the role label alone.

### Authority and qualifications

Keep each action capability independent, for example `work-order.task.execution-declare`, `work-order.supervisor.complete`, `work-order.qa.inspect`, `work-order.team-lead.release`, and `work-order.head.post-release-inspect`. The server checks an active signed capability grant and the exact active qualification at action time, then snapshots both decisions. A Team Lead assignment qualification does not substitute for release authority or QA qualification. A Supervisor role does not substitute for a G3 grant. The Head role does not substitute for inspection authority.

Grant resolution must serialize against grant revocation and must be added through a migration replacing the current hard-coded `public.lock_work_order_authority_grant(text)` capability allowlist. The API runtime remains unable to mint or edit grants. No real staff grants should be seeded by this change. Production access remains denied until authorized, signed grants and current qualification evidence exist.

### Transaction boundaries

Every mutation uses `runStaffCommand` and the shared `lockWorkOrderRoot` order:

1. Lock and recheck active site membership.
2. Lock the site-scoped work order and affected task/declaration roots.
3. Lock and recheck the named action grant, exact assignment and qualification.
4. Recheck the idempotency receipt; replay only after current membership and authority checks; reject a changed payload with the same command ID.
5. For a new command, reject stale work-order, plan, scope, task-assignment, policy or evidence versions and evaluate holds/readiness.
6. Atomically append decision/evidence/custody rows plus domain event, receipt and outbox event.

All completion/release/hold/resolution commands use the same work-order root lock. This makes a hold-versus-G4 race serialize: hold-first blocks G4; G4-first prevents an ordinary later hold from rewriting the pre-release history. Post-release hazards require a separately approved transition and must not be inserted as though they preceded G4.

Suggested append-only tables:

- `work_order_task_execution_declarations` and declaration-evidence links, unique sequence per task/assignment revision;
- `work_order_g3_decisions` plus child references to the exact required task declarations;
- `work_order_inspection_results` and fault-disposition decisions, each pinned to effective policy/check IDs;
- `work_order_g4_decisions` plus immutable collection-zone custody event reference;
- `work_order_head_inspections` bound to a G4 decision and its resulting custody revision.

Each row uses composite organisation/site/work-order foreign keys and forced RLS. Store private evidence links in typed relation tables, not the event payload. Events contain metadata and references only. Never update a prior decision to make a later review look like the original sign-off.

### Screen flow

Extend the existing work-order readiness panel rather than creating another dashboard or duplicated job record:

```text
Current scope and instructions
  → task execution and technician declarations
  → Supervisor G3
  → required independent inspections and fault dispositions
  → Team Lead G4 and collection-zone movement
  → Head post-release inspection
  → Service Advisor completion-status contact
  → separate G5 financial decision and physical handover
```

Supervisor work-order screens show each required task, latest assigned worker, declaration, evidence, hold and version. The G3 action appears only when the API says the exact current package, grants, qualifications, assignment and evidence are ready. Team Lead screens separate check results, unresolved faults and holds from the G4 signature. The Head queue contains only current G4 releases awaiting inspection and makes independence requirements visible. Advisor screens may record the completion contact only after a passed Head inspection; ordinary diagnostic, estimate and callback contacts remain possible through the existing contact workflow.

On a failed/incomplete Head inspection, preserve the G4 record and collection custody history, block completion-contact and G5 departure actions, and raise a clear escalation. Do not automatically reverse custody or invent a rework sequence; the exact post-release movement/rework route is a policy input under REV-035. Every screen has loading, empty, offline, failure, stale-version and blocked states, and supports phone, foldable, tablet, desktop, keyboard and 200%/400% zoom.

### Tests

Pure readiness tests prove every missing or stale requirement keeps the next command unavailable. PostgreSQL/API tests with synthetic grants and exact synthetic policies must cover:

- positive declaration/G3/G4/Head paths with exact current source, task, assignment, qualification, grants and evidence;
- each missing, expired or revoked grant and qualification independently;
- unassigned/replaced Supervisor, unassigned Team Lead, unauthorized Head, read-only membership, wrong site/tenant, cross-scope evidence, expired/stale source and unsupported model/system/task;
- missing declaration, missing/failed critical inspection, open applicable hold, missing fault disposition, insufficient evidence and G2 scope mismatch;
- stale plan/work-order/scope/evidence/policy versions and changed-body idempotency replay;
- outbox failure rollback and exactly-one command commit under repeated submission;
- separate PostgreSQL-session races for hold vs G4, G3 vs scope/assignment changes, G4 vs grant revocation, and post-release inspection vs Advisor completion contact;
- historical G3/G4 retention across rework attempts, with no inherited authorization for the new scope;
- confirmation that G3, G4, Head inspection, customer contact, payment/guarantee and physical departure remain separate events and authorities.

Browser verification should use the real PostgreSQL API and existing `scripts/work-plan-browser.mjs` role fixture, extended for current synthetic action grants and policy packages. Cover the ordinary work-plan/technician path plus each blocked and ready sign-off state, print/report wording, responsive/accessibility checks and absence of client-contact details from Technician pages. Existing 73-check work-plan browser evidence exercises the current intake-to-task/evidence/report/hold path, not G3/G4/Head inspection; it is not sign-off verification.

## Synthesis decision

This candidate uses one append-only decision ledger under the work-order root, with readiness projected from the exact current child decisions. It avoids a second mutable lifecycle state machine while preserving each actor's distinct decision and evidence. G3 is job-level but references the current task-level declarations; G4 captures the release and collection-zone movement atomically; the Head inspection is a further record that can block the next customer/departure actions but cannot rewrite G4.

## What can ship under the owner-approved interim policy

The owner-approved interim policy settles the organizational sequence, separation between role and authority, stop-work rule, reason/evidence expectations, G3 → G4 → Head inspection → Advisor contact order, and prohibition on departure without verified payment or authorized showroom guarantee. The application can ship the readiness projection, the distinct screen sequence, typed storage contracts, API denial paths, audit/idempotency scaffolding, synthetic policy/grant tests and explanatory blocked states now. Staff can continue current task progress, comments, evidence and requests, which explicitly remain non-sign-off.

Do **not** enable operational G3, G4 or Head inspection merely because the interim policy is approved. Exact model/variant/system/task procedures, safe acceptance criteria, inspection matrix, equipment/instrument requirements, person qualifications, signed named grants, independent-check and substitution rules, fault-disposition policy, post-release failure/rework route and applicable effective SOP publication remain unavailable. `validateEffectivePolicyCandidate()` currently always returns `POLICY_UNAVAILABLE` because no approval/effectivity resolver exists. Tests may install synthetic grants and packages only in isolated databases; production stays blocked until the exact approved records and verification exist.

The separate completion-status customer contact guard may be designed with these commands. Implement it against a passed Head-inspection record and existing canonical customer-contact history; do not claim a message was sent. G5 financial clearance and physical departure remain deferred and unavailable until their separate policy, authority and evidence contracts are implemented.

## Tradeoffs accepted

- We accept several typed immutable records so that each role's decision is auditable and cannot overwrite another role's work.
- We accept deriving readiness from the latest current records instead of maintaining a synchronized `completed` boolean; the projection must be indexed and tested against the exact scope/version path.
- We accept building synthetic test-only configuration before production enablement; it proves command mechanics, not vehicle-specific safety or staff competence.
- We accept leaving failed post-release routing unavailable until owner/technical policy defines it rather than inventing rework movement rules.

## Alternatives considered

- One mutable `workOrder.status = complete/released/inspected` field was rejected: it collapses G3, G4 and Head inspection and loses actor/policy/evidence provenance.
- A generic approval service for every workflow was rejected: it exposes generic options and makes the caller coordinate domain-specific gates, with more opportunity to accidentally treat one approval as another.
- Automatically allowing role codes or the interim policy to grant sign-off was rejected: role profiles and approved workflow order do not create a signed person-specific technical grant or competence record.
- Per-task completion as the only G3 mechanism was rejected: the Owner-directed G3 is Supervisor job completion and must derive from all required current task records without treating one task as the job sign-off.

## Open questions and risks

- Which exact staff placements will receive the signed G3, G4, QA and Head-inspection grants, and who is authorized to approve those grants?
- Which current vehicle-specific procedure, qualification, inspection and evidence revisions apply to each task at the pilot site?
- Who may inspect when the Head participated in the repair, and how should unavailable independent inspection be escalated?
- What physical custody and rework route applies when the Head inspection fails after the car has entered the collection zone?
- What exact authenticated customer-contact category should the Advisor use after Head inspection, given that the current contact record stores channel/outcome/notes but no dedicated completion-update type?

## Next implementation step

Build the shared version-stable readiness projection and G3/G4/Head blocked-state contracts first, then add command handlers against synthetic-only policy/grant fixtures without creating production authority or procedure data.
