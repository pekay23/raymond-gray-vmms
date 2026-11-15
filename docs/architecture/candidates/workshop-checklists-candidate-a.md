# Candidate A — separate revisioned checklist aggregate

## Caller usage

```ts
const created = await createWorkOrderChecklist(scope, workOrderId, {
  kind: 'PDI' | 'routine-maintenance',
  templateRevisionId,
  scheduleBasis: 'unknown' | { sourceDocumentId, sourceRevision, lastServiceKm?, lastServiceDate? },
  expectedWorkOrderVersion,
});

const saved = await recordChecklistItemOutcome(scope, checklistId, {
  expectedChecklistVersion,
  itemId,
  result: 'completed' | 'failed' | 'not-checked' | 'not-completed' | 'blocked' | 'not-applicable',
  observation?, unit?, reason?, evidenceIds?,
});

const report = await readChecklistReport(scope, checklistId, { audience: 'staff' | 'client' });
```

Template publication and technical/inspection/release decisions are separate commands. Creating a checklist or recording an observation never authorizes work or completes a work order.

## Grounded integration model

- Work orders own the canonical client, owner, contact, vehicle, consent, holds and visit status. Checklist records refer to the work order and never duplicate or mutate those identities.
- The current workflow has separately versioned work-plan revisions, supervisor handoffs, task assignments and append-only task progress. `runStaffCommand` is the transaction boundary for idempotent mutation, audit/event and outbox; workflow operations lock the scoped work-order root and reject stale versions.
- `organisation_id` and `site_id` are mandatory scope keys. Staff placement and the current assignment/grant are checked on every command. Role labels do not imply a sign-off grant.
- Existing report code renders structured records into a purpose-built report. A checklist report must follow that pattern and apply its audience policy; it must never print the application screen.

## Types and module boundary

```ts
type ChecklistKind = 'PDI' | 'routine-maintenance';
type ChecklistResult = 'completed' | 'failed' | 'not-checked' | 'not-completed' | 'blocked' | 'not-applicable';
type ChecklistReviewDecision = 'accept' | 'return';

type EffectiveChecklistTemplateRevision = {
  id: UUID;
  kind: ChecklistKind;
  revision: number;
  applicability: { make: string; model: string; variant: string; powertrain: PowertrainClass };
  sourceDocumentId: UUID;
  sourceRevision: string;
  items: readonly TemplateItemSnapshot[];
};

type WorkOrderChecklist = {
  id: UUID; workOrderId: UUID; templateRevisionId: UUID | null;
  templateSnapshot: readonly TemplateItemSnapshot[];
  kind: ChecklistKind; scheduleBasis: ScheduleBasis | { state: 'unknown' };
  state: 'draft' | 'in-progress' | 'review-pending' | 'returned' | 'accepted';
  version: number;
};

type ChecklistItemOutcome = {
  itemId: UUID; result: ChecklistResult; observation: string | null; unit: string | null;
  reason: string | null; evidenceIds: readonly UUID[]; recordedBy: UUID; recordedAt: Instant;
};

function createWorkOrderChecklist(scope: Scope, workOrderId: UUID, input: CreateChecklist): Promise<ChecklistResult>;
function recordChecklistItemOutcome(scope: Scope, checklistId: UUID, input: RecordOutcome): Promise<ChecklistResult>;
function requestChecklistReview(scope: Scope, checklistId: UUID, input: VersionedReason): Promise<ChecklistResult>;
function decideChecklistReview(scope: Scope, checklistId: UUID, input: ReviewDecision): Promise<ChecklistResult>;
function readChecklistReport(scope: Scope, checklistId: UUID, audience: ReportAudience): Promise<ChecklistReport>;
```

Keep code in `apps/api/src/work-order-checklists.ts` with migrations under `apps/api/migrations/`; UI belongs beside existing work-order workflow panels, with a dedicated structured report route/component. Template authoring, approval and publication live in the controlled-document governance boundary rather than in the checklist editor.

## Persistence and command boundary

Use a dedicated aggregate because template provenance, item snapshots, result history and checklist review have their own version and idempotency lifecycle. Suggested relations:

- `checklist_template_revisions`: immutable revision content, exact model applicability, source document/revision, lifecycle state and separately recorded publication decision.
- `work_order_checklists`: organisation/site/work-order scope, purpose, template revision reference, immutable template snapshot, schedule basis, state and optimistic version.
- `work_order_checklist_item_revisions`: append-only item outcome snapshots, reason, measurement/unit, assignee snapshot, evidence references and correction link.
- `work_order_checklist_decisions`: append-only review decisions with reviewer placement/grant snapshot and rationale. A checklist acceptance decision does not replace the work-order Supervisor completion, Team Lead release or Head inspection.

Each write is one command transaction: validate current site membership, assigned work and action-specific grant; lock the scoped aggregate/work-order root; check expected version and idempotency body; validate an effective applicable source revision; write projection plus immutable history, audit event, idempotency receipt and outbox item atomically. Apply org/site/author or assigned-team RLS to every read/write path. Corrections append a new revision and preserve the previous outcome. Do not store checklist answers only in an event payload or an unscoped JSON blob.

## Fail-closed workflow and unknowns

- In this slice, there are no approved OEM schedules, model-variant item lists, measurement limits or checklist reviewer grants. Therefore no template revision may be active for operational use, and an unknown source stays `unknown`. A draft or observation-only record can be retained for later review but cannot be represented as an effective checklist.
- Block an operational checklist creation when no currently approved exact-model template/source revision matches. Never silently fall back to a generic EV checklist or the 10,000 km/12-month reminder.
- Non-complete outcomes require a plain-language reason. `Not applicable` also requires an applicability reason. A result of `completed` records a worker assertion; it does not itself constitute Supervisor inspection or G3 completion.
- Review, technical completion, release and Head inspection are distinct command types and distinct grants. Every transition also checks open safety holds, required item outcomes, required evidence and current authority snapshots. If policy/grant configuration is absent, deny the transition and show the next permitted action.
- Keep approved consent scope and diagnostic/road-test restrictions with the owning work order; checklist item completion cannot widen consent.

## Report contract

`readChecklistReport` returns a stable structured snapshot with business/site, booking and purpose; paying client, owner and visit contact as distinct relationships; verified vehicle identity; template and source revisions; schedule basis or visible `unknown`; grouped item outcomes; complete/open/failed/blocked/deferred counts; observations, reasons, units and accepted evidence labels; assignments and follow-up; append-only correction and decision history; holds; and separately named Supervisor, Team Lead and Head decisions. Client view is allow-listed and excludes internal-only notes and staff contact data. Rendering paginates and preserves selectable text and source attribution.

## Trade-offs

**Benefits:** clear template provenance; immutable model-specific snapshot unaffected by later template edits; checklist corrections remain auditable; report/read authorization is explicit; checklist review cannot be mistaken for job release; PDI and maintenance can share the engine without sharing their acceptance policy.

**Costs:** a new aggregate, migration and read/report model; cross-root coordination with the work order must be carefully locked/versioned; task status and checklist results can diverge unless operational tasks are linked by durable IDs and a single transition owns each duplicated concept.

## Rejected alternatives

- **Put all checklist rows directly on `work_orders` or reuse `work_order_tasks`:** rejected for this candidate because an effective template revision, detailed applicability basis, item-by-item maintenance evidence and checklist-specific correction/report rules would inflate the existing work-order command contract. It remains a viable alternative only if a competing design demonstrates one canonical outcome per task and no duplicated checklist/task status.
- **Store checklist JSON on the work order:** rejected because it weakens relational scope, idempotency, append-only correction and per-item authorization/report queries.
- **Activate a universal EV/PDI/10,000-km package now:** rejected because neither the source PDF nor current approved material supplies model-specific procedures, exact intervals or acceptance values.

## Limitations pending owner/content decisions

The exact OEM source library and model/variant mappings; who can author, approve and publish effective templates; the technical reviewer and inspection grant matrix; required evidence/measurements; source-document retention; whether existing work tasks are linked or derived; and client report visibility must be resolved before operational activation. This candidate is architecture only and grants no authority.
