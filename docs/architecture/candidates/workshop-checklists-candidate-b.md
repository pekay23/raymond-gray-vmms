# Workshop checklists — candidate B

## Candidate shape

Make a PDI or routine-maintenance checklist an owned child of a canonical work order. The work order is already the visit record tying the paying client, reported owner, vehicle, intake, consent, team-lead assignment, supervisor handoff, task work and reports together. Checklist items remain a separate checklist domain under that owner; they do not become repair tasks or vehicle-master facts.

This is a design candidate, not an accepted or active policy. It does not make any checklist effective. The currently available PDI/maintenance form is a draft. Exact OEM schedules, source revisions, model applicability, expected measurements, review criteria, authority grants and approved procedure text remain unknown and must be supplied and approved before a template can be published.

## Caller usage

```ts
const draft = await createWorkOrderChecklist(pool, scope, commandId, workOrderId, {
  kind: 'routine-maintenance',
  expectedWorkOrderVersion: workOrder.version,
  templateRevisionId: selectedEffectiveTemplateRevisionId,
  vehicleSnapshot: verifiedVehicleForThisVisit,
  scheduleBasis: confirmedOrUnknownScheduleBasis,
});

await recordChecklistItemOutcome(pool, scope, commandId, workOrderId, draft.id, {
  expectedChecklistVersion: draft.version,
  itemId,
  result: 'not-checked',
  reason: 'Reason required for every non-complete outcome.',
  measurement: null,
  evidenceIds: [],
});

const report = await readChecklistReport(pool, scope, workOrderId, checklistId, audience);
```

Creation is offered only when an exact, effective, model-applicable PDI or maintenance template revision exists. If it does not exist, VMMS shows why checklist activation is unavailable and the user follows the separately authorized intake/work-order process. A 10,000 km or 12-month reminder may suggest a maintenance review; it never supplies the service package.

## Type sketch

```ts
type ChecklistKind = 'pdi' | 'routine-maintenance';
type ChecklistState = 'draft' | 'in-progress' | 'submitted' | 'returned' | 'approved' | 'closed';
type ChecklistItemResult = 'completed' | 'failed' | 'not-checked' | 'not-completed' | 'blocked' | 'not-applicable';
type ReviewDecision = 'accept' | 'return-with-reason';

type ChecklistTemplateRevision = {
  id: UUID;
  templateId: UUID;
  revision: number;
  kind: ChecklistKind;
  exactVehicleApplicability: ModelVariantPowertrainScope;
  approvedSourceRevisionIds: UUID[];
  items: readonly ChecklistTemplateItem[];
  state: 'draft' | 'effective' | 'superseded' | 'withdrawn';
  effectiveFrom: Instant | null;
  effectiveTo: Instant | null;
  publishedDecisionId: UUID | null;
};

type WorkOrderChecklist = {
  id: UUID;
  workOrderId: UUID;
  templateRevisionId: UUID;
  templateRevisionDigest: string;
  kind: ChecklistKind;
  exactVehicleSnapshot: VerifiedVisitVehicleSnapshot;
  scheduleBasis: ScheduleBasis | { kind: 'unknown'; reason: string };
  state: ChecklistState;
  version: number;
};

type ChecklistItemOutcome = {
  itemId: UUID;
  result: ChecklistItemResult;
  reason: string | null; // required unless result is completed
  observation: string | null;
  measurement: { value: string; unit: string; sourceRequirementId: UUID } | null;
  applicabilityReason: string | null;
  assigneePlacementId: UUID | null;
  evidenceIds: UUID[];
  recordedBy: UUID;
  recordedAt: Instant;
};

type ChecklistDecision = {
  grantId: UUID;
  decision: ReviewDecision;
  reason: string | null;
  actorId: UUID;
  actorRoleSnapshot: string;
  authoritySnapshot: AuthorityDecisionSnapshot;
  decidedAt: Instant;
};
```

`ChecklistTemplateItem` contains only owner-approved source text, applicability, expected observation/measurement rules and required evidence/review declarations. It contains no default technical value from code. If a source or effectiveness cannot be verified, the item and checklist remain non-effective and report the missing source as unknown.

## Module boundaries and signatures

```ts
publishChecklistTemplateRevision(pool, scope, commandId, templateId, input): Promise<TemplateRevisionResult>
createWorkOrderChecklist(pool, scope, commandId, workOrderId, input): Promise<ChecklistResult>
recordChecklistItemOutcome(pool, scope, commandId, workOrderId, checklistId, input): Promise<ChecklistItemResult>
assignChecklistItem(pool, scope, commandId, workOrderId, checklistId, input): Promise<ChecklistAssignmentResult>
submitWorkOrderChecklist(pool, scope, commandId, workOrderId, checklistId, input): Promise<ChecklistResult>
decideWorkOrderChecklist(pool, scope, commandId, workOrderId, checklistId, input): Promise<ChecklistDecisionResult>
readWorkOrderChecklist(pool, scope, workOrderId, checklistId, requestId): Promise<ChecklistView>
readChecklistReport(pool, scope, workOrderId, checklistId, audience): Promise<ChecklistReportModel>
```

- `controlled-checklist-templates.ts` owns template revisioning and publication validation. Publication is a governed document decision and must reference the exact approved source and applicability set.
- `work-order-checklists.ts` owns child instance transitions, item outcomes, assignments and review decisions. It calls the established work-order root lock and staff-command transaction contract.
- `work-order-checklist-reads.ts` owns paginated, site-scoped reads and sensitive-read audit; it exposes an explicit client or staff audience projection.
- `work-order-checklist-report.ts` maps structured records into a purpose-built report document, not an application screenshot.
- Web routes compose those services; the browser never determines grants or final checklist eligibility.

## Transaction, access and history

Each mutation locks the work-order root, checks site and current writable membership, checks the expected work-order/checklist/item versions, loads current exact template applicability, and verifies a separately configured grant for that action. Assignment also validates the current role placement and site. A role name alone never confers checklist work, review, release, inspection or publication authority.

In one `runStaffCommand` transaction, persist the projection or immutable revision, decision snapshot, audit event, outbox event and idempotency receipt. Retry with the same command id and body returns the saved result; changed-body replay and stale versions conflict. Corrections append an attributable revision that retains prior outcome, evidence, actor and time. General event logs carry identifiers and metadata only, not private comments, evidence bytes or restricted customer details.

Tables are organization/site-scoped and forced-RLS. Child rows use composite foreign keys to their work order and checklist; read predicates additionally constrain the user's site and active placement. Evidence IDs must resolve to accepted, scan-current evidence already linked to the same work order. The report loader revalidates scope and audience field policy rather than trusting a UI filter.

## State and safety gates

- Creation requires an effective source-backed template whose model, variant, powertrain and vehicle identity match the visit. Unknown baseline data is stored as unknown, not inferred.
- Each non-complete result requires a reason. `not-applicable` requires a template-defined allow rule and a recorded reason; it cannot hide mandatory inspection work.
- `completed` requires an assignee, any source-declared observation/measurement and accepted evidence, plus the configured required review.
- Submit and review commands verify all required items, current consent, holds and current grants. A return requires a reason. A reviewer cannot self-authorize higher sign-off by choosing a review role label.
- Checklist approval cannot by itself set Supervisor G3 technical completion, Team Lead G4 release or Head inspection. Those remain separate existing workflow commands and authority snapshots.
- Any absent source, expired template, open hold, missing required outcome/evidence, stale assignment or absent grant blocks the transition and identifies the next permissible action.

## Report contract

The report service renders a checklist-specific document with its own title, template/source revision, vehicle and party relationship, schedule basis, work-order reference, outcome summary, grouped completed/open items, reasons, measurements and units, evidence labels, assignees, holds, next actions, correction history and distinct decisions. It paginates long task lists, includes generated time and version, and separates the staff view from the client projection. It never prints application navigation or unrelated work-order details as a page capture.

## Candidate advantages and risks

**Advantages:** the checklist remains attached to the canonical visit; current consent, vehicle, assignment, hold and evidence checks can be evaluated under one work-order lock; visit reporting can produce a coherent client/staff record without cross-aggregate joins for core identity.

**Risks:** the work-order aggregate lock can become a contention point for many parallel checklist updates; it can blur visit state with detailed technical execution if checklists are implemented by reusing generic complaint/task rows; report reads may become large. These are controlled by distinct checklist tables and paginated item-history/report reads, while keeping transition decisions serialized under the existing root lock.

## Alternatives considered and rejection rationale

- A separate checklist aggregate would reduce contention and isolate technical history, but would need explicit cross-aggregate coordination for holds, assignment, report identity and visit closure. That may be appropriate if real concurrency evidence later shows the work-order lock is a bottleneck.
- Reusing work-order tasks as checklist rows is rejected: tasks represent assigned repair or diagnostic work, while an inspection item may be a required check, an observation, a not-applicable outcome or an incomplete finding. Reuse would risk granting work semantics or sign-off meaning to a checklist entry.
- Storing only a report snapshot is rejected because it would lose item-level assignment, correction history, auditability and current-gate checks.

## Unresolved owner inputs

- Exact OEM maintenance schedules and PDI criteria by make/model/variant/powertrain, source revision and applicability/effectivity.
- Technical reviewer/publisher grants, who may create templates, who approves outcomes, and whether review must be independent.
- Required evidence/measurement and retention policy per item; client-report redaction policy.
- Which checklist actions count toward existing G2/G3/G4/G5 gates after the policy is approved.
- Any actual checklist templates from the service centre. Until provided and approved, no generic EV/HV procedure is activated.
