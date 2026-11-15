# Candidate B: normalized G3/G4 controls

**Status: candidate for architecture synthesis; not accepted architecture.** This proposal is grounded in `technical-completion-and-release.md`, `staff-authority-and-qualification.md`, and the pending review items REV-006, REV-008, REV-009 and REV-035. It defines data structure and decision flow only. It does not supply workshop policy, values, authority, instructions, inspection criteria or approval.

## Usage from the caller

Governance staff maintain separate revisions for the controlled inputs they own. An authorized approval process approves each revision. A site activation binds exact revision IDs that work together for a defined effective interval and scope. The activation stores references only; each control family keeps its own normalized records and revision history.

At runtime, the browser requests the server's current action view. If required inputs are absent or ambiguous, the server returns pending gates and plain-language blockers. Staff cannot tell the server which checks are required, which grant they hold, or whether a gate passed.

The server-side callers are narrow commands:

```ts
type Id = string & { readonly __brand: "Id" };
type Version = number & { readonly __brand: "Version" };
type ExpectedRevision = {
  workOrderVersion: Version;
  workPlanRevisionId: Id;
  scopeRevisionId: Id;
};
type DecisionReason = string;

type G3Command = ExpectedRevision & {
  reason: DecisionReason;
};
type G4Command = {
  workOrderVersion: Version;
  g3DecisionId: Id;
  reason: DecisionReason;
};

function resolveEffectiveControlSet(
  tx: PoolClient,
  context: ServerDerivedControlContext,
  at: Date,
): Promise<ControlResolution>;

function recordTaskExecution(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: Id,
  taskId: Id,
  input: { workOrderVersion: Version; evidenceIds: readonly Id[]; reason: string },
): Promise<WorkOrderDetail>;

function signG3(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: Id,
  input: G3Command,
): Promise<WorkOrderDetail>;

function recordInspectionResult(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: Id,
  checkId: Id,
  input: { workOrderVersion: Version; outcomeCode: string; evidenceIds: readonly Id[]; reason: string },
): Promise<WorkOrderDetail>;

function recordFaultDisposition(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: Id,
  faultId: Id,
  input: { workOrderVersion: Version; dispositionCode: string; evidenceIds: readonly Id[]; reason: string },
): Promise<WorkOrderDetail>;

function signG4(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: Id,
  input: G4Command,
): Promise<WorkOrderDetail>;
```

The signatures are design sketches, not accepted transport contracts. `Scope` comes from the authenticated session; the API derives actor, vehicle, powertrain, model, current plan, G2 scope, current grants and qualifications from canonical records. The client can identify evidence it intends to attach or a result it recorded, but server-side validation decides whether it meets an effective requirement. Expected versions prevent stale decisions. The server generates all decision timestamps.

## Structural model

Use independently versioned, tenant/site-scoped domain records. Do not store all policy fields in a single JSON document or policy-package row.

### Revision families

| Family | Root and relation records | Purpose |
| --- | --- | --- |
| Task classification | `task_class_revisions`, `task_class_powertrains`, `task_class_models`, `task_class_systems` | Define the approved classification and where it applies. These mappings do not authorize a task. |
| Controlled instructions | `instruction_revisions`, `task_class_instruction_requirements` | Point to a specific controlled source/revision and bind it to applicable task classes. |
| Evidence requirements | `evidence_rule_revisions`, `task_class_evidence_requirements`, `instruction_evidence_requirements` | State which configured evidence categories are needed for an execution, declaration or instruction. |
| Inspection matrix | `inspection_matrix_revisions`, `inspection_check_revisions`, `inspection_matrix_checks`, `inspection_check_evidence_requirements` | Define exact checks, their applicability, and evidence required by the approved matrix. |
| QA independence | `qa_independence_revisions`, `qa_independence_constraints` | Link a configured check/signoff to the participants from whom the verifier must be distinct, as the approved policy specifies. |
| Fault disposition | `fault_disposition_revisions`, `fault_disposition_rules`, `fault_disposition_evidence_requirements` | Define which disposition codes are permitted for a configured fault class and what grant/evidence each requires. |
| Custody | `custody_rule_revisions`, `custody_transition_rules`, `custody_transition_evidence_requirements` | Define allowed custody transitions, triggering decision and any required acknowledgement/evidence. No custody-state vocabulary is preseeded. |

Each family revision has immutable source references, author, approval reference/evidence, status, effective interval, and an explicit revision number. Relation rows carry the same organisation/site scope and foreign keys to the owning revision. Once approved, a revision's content cannot be edited; corrections create a new revision. Controlled instruction revisions also retain their source document ID, document revision, and integrity evidence when available.

### Effective activation manifest

`effective_control_activations` records an approved activation ID, organisation/site, applicability scope, effective interval, approving authority snapshot, and activation state. Typed child relations reference exact revisions:

- `activation_task_class_revisions`
- `activation_instruction_revisions`
- `activation_evidence_rule_revisions`
- `activation_inspection_matrix_revisions`
- `activation_qa_independence_revisions`
- `activation_fault_disposition_revisions`
- `activation_custody_rule_revisions`

These rows provide typed foreign keys and preserve referential integrity. They bind separately governed revisions without duplicating their contents. A revision may be reused across activations only if its own effective period and source authority permit it. Cross-family compatibility is validated when the activation is approved and resolved again at decision time.

Selectors should reference approved catalog identities for vehicle models, systems, classifications, outcomes and custody states. The catalog and exact values must come from supplied, approved policy. Do not seed sample workshop values as operational defaults. Where catalogs or required relation rows are missing, there is no safe match.

### Decision snapshots

G3/G4 decision records are append-only and include the work-order/site scope, decision actor, current grant and qualification snapshots, `completed_at`/`released_at` from the database clock, reason, expected work-order/plan/scope versions, and the exact activation plus family revision IDs used. Store accepted execution/check/fault/custody evidence links by relational foreign key. Preserve historical decision rows when a later scope or control revision supersedes them.

## Resolution and command behavior

`ServerDerivedControlContext` is assembled from locked database rows, not request fields. It includes the work order, active site, vehicle, model, powertrain, planned tasks, current G2 scope and relevant revisions. `resolveEffectiveControlSet` returns either:

```ts
type ControlResolution =
  | { state: "resolved"; activationId: Id; revisions: Readonly<Record<ControlFamily, Id>> }
  | { state: "blocked"; reasons: readonly ControlBlockReason[] };
```

`ControlFamily` and `ControlBlockReason` are protocol concepts, not workshop values. Their stable codes should identify missing input, conflicting effective matches, expired input, unknown classification or incompatible revisions. A message may explain what an authorized administrator must supply, but it must not imply that a user can waive the blocker.

G3 resolves and locks the effective activation and referenced immutable revisions; validates current G2 scope, every required task, execution records, actual configured labour/parts/tests/deviations/evidence, technician declaration, exact task/model/system qualification, execution grant, instruction, and all applicable holds. It then requires the assigned eligible supervisor and writes the signed decision atomically. Until an effective mapping covers every in-scope task, G3 is blocked.

G4 is a separate command. It verifies a current G3, resolves the effective inspection matrix and custody rules, requires every applicable check and its outcome/evidence, enforces configured QA independence, requires approved disposition for outstanding faults, checks holds, and requires the eligible team-lead release grant. It writes the release decision and collection-zone custody transition atomically. G4 does not close G5, record payment/guarantee, authorize customer handover, or claim physical departure.

Every required family must have exactly one applicable effective revision. Missing, ambiguous, expired, revoked, unapproved, incompatible or partially populated configuration fails closed. An empty inspection matrix or empty requirement relation is **not** interpreted as “nothing required.” The command does not accept a client-provided “no checks required” flag.

## Module ownership

| Module | Owns |
| --- | --- |
| Governance | Draft/revise/approve controlled configuration, provenance, effective intervals and activation manifests. It must not mint technical grants merely by publishing a policy revision. |
| Authority | Current named grants, qualification scope, validity, restrictions, revocation and decision-time snapshots. Role labels do not grant technical or release authority. |
| Workshop | Canonical tasks, current plan/scope and execution/declaration records; G3 command orchestration under the work-order aggregate. |
| Safety and quality | Hold behavior, inspection results, independence evaluation, fault disposition and G4 release preconditions. |
| Evidence | Private evidence validation, link authorization, scanning state and immutable evidence metadata. |
| Reception/custody | Canonical custody history and allowed custody mutations; G4's collection-zone movement remains part of the same release transaction. |
| Delivery and audit | Atomic decision events, idempotency receipts and outbox records. |

The owning API should expose commands, not a pass-through controller/service/repository stack. Database migrations should be grouped by independently deployable concern and additive, with one migration writer. Runtime database roles may read activated policy and write decisions through authorized command transactions; they must not edit or approve effective policy revisions.

## Security and transaction boundaries

Use the existing command protocol and same work-order root lock as hold opening/resolution and any release-affecting operation:

1. Authenticate and lock/recheck current membership and site access.
2. Lock the work-order root and reject a stale expected version.
3. Lock/recheck the effective activation and referenced revision state so concurrent withdrawal/activation cannot change the decision's policy view.
4. Lock/recheck the exact named grant, qualification and any required independent-participant relationship.
5. Acquire/check the command ID and replay only after current authorization; reject payload mismatch.
6. Resolve current G2/scope/evidence and all required relational rules; no API-controlled shortcuts.
7. Atomically write the operational records, decision snapshot, event, receipt and outbox row.

If a blocking hold commits before G4, G4 observes it and denies. If G4 commits first, a later ordinary hold command conflicts and must use a separately approved post-release safety/rework path. Policy activation withdrawal and grant revocation must serialize with decisions. A G4 decision must never be inferred from a job title, role, owner contact, payment, showroom guarantee or earlier G3.

## Verification cases

Use disposable PostgreSQL data explicitly labeled synthetic. Synthetic fixtures prove mechanics; they do not become site seed data or approval evidence.

- No activation, missing family, empty required mapping, unsupported model/system/classification, multiple matches, inactive/expired revision, and inconsistent cross-family references all deny G3/G4.
- G3 denies without current G2 scope, complete required execution/declaration evidence, current task-scoped competence and distinct current grant, assigned eligible supervisor, or when a blocking hold exists.
- G4 denies before valid G3; with a missing, failed or stale required check; with missing evidence; when configured QA independence is violated; with an unresolved fault lacking an allowed disposition; with a missing custody rule; or with open blocking holds.
- Revoked/expired grants or qualifications, stale work-order/plan/scope/evidence versions, replay after membership revocation and changed idempotency payload deny or conflict as specified.
- Cross-organisation/site foreign keys and read projections cannot expose another site's configuration or evidence.
- Concurrency tests cover hold-vs-G4, grant revocation-vs-signature, policy withdrawal-vs-decision, duplicate signature, retry after committed response loss, and failed-command atomic rollback.
- Verify that a task-scoped hold prevents its required task from completing while unrelated work can continue; a work-order safety hold blocks aggregate release.
- Verify that G3, G4, invoice/financial disposition, customer handover and physical departure remain distinct records and transitions.

## Why this structure; alternatives

Independent revision streams let governance correct an inspection matrix without rewriting task classifications, or revise an instruction reference without editing evidence requirements. The normalized relations make applicability, requiredness and provenance queryable and constrainable by foreign keys. The activation manifest supplies a reproducible set of exact revisions for a decision without turning their content into one opaque configuration object.

Alternative A is a single versioned G3/G4 policy package with all criteria embedded. It is simpler to load atomically but creates a large coupling surface, duplicates shared instruction/evidence sources, and makes narrow revision history harder to inspect. A free-form JSON policy has fewer migrations but weaker type, relational, tenant-scope and completeness guarantees. Either may be a later synthesis choice; this document is not an accepted architecture decision.

## Default state and approval boundary

Create schemas and validators without inserting effective activation rows or operational configuration. G3/G4 remain unavailable until REV-006 approves named authority and separation rules; REV-008 provides controlled SOPs; REV-009 provides approved model-specific procedures, inspection matrix and equipment acceptance; and REV-035 resolves execution evidence, holds, faults, custody, post-release safety and rework. Do not manufacture classifications, evidence types, thresholds, outcome labels, signer substitutions, custody acknowledgements, authority grants or release terms.

A test activation may exist only in an isolated test database and must be identified as synthetic. Passing its tests proves implementation mechanics, not policy approval, a safe workshop procedure, operational readiness, or permission to release a real vehicle.
