# Candidate B. Delivery preparation and workshop checklists

## Usage (caller's view)

Sales opens a preparation for the canonical vehicle before handover. They can register a new VIN or select a vehicle already visible at their site. The preparation exists even when the site has no effective PDI form. The actual delivery date belongs to the separate Sales delivery record.

```ts
// Sales intake. No client visit, work order or delivery date is required.
const preparation = await preparations.open(staff, intakeAttempt, selectedVehicle)
// On actual handover, Sales records the sourced facts against that preparation.
await deliveries.recordForPreparation(staff, deliveryAttempt, preparation.id, {
  expectedPreparationVersion: refreshedPreparation.version, facts: handoverFacts
})
```

An assigned technical staff member opens the preparation's PDI view. Its available templates and next actions depend on the exact vehicle, source and current authority. A blocked view gives the reason. A start request can still be rejected if eligibility changed after the read.

```ts
const pdi = await deliveryPdi.read(staff, preparation.id, page)
const started = await deliveryPdi.start(staff, startAttempt, preparation.id, {
  expectedPreparationVersion: pdi.version, selection: selectedDeliveryTemplate
})
await deliveryPdi.recordOutcome(staff, outcomeAttempt, preparation.id, {
  expectedPreparationVersion: started.version, ...assignedItemEdit
})
```

For a service visit the technician works from the actual order. Routine maintenance uses its verified history or an explicitly unknown baseline. A workshop PDI is available only if a procedure is approved for that context.

```ts
const panel = await workshopChecklists.read(staff, order.id, page)
await workshopChecklists.start(staff, startAttempt, order.id, {
  expectedWorkOrderVersion: panel.workOrderVersion,
  selection: selectedMaintenanceTemplate, basis: maintenanceIntake
})
```

## Problem

Migration 057 records a completed delivery and its source observations. Migration 068 requires a work order on every checklist. A new vehicle awaiting handover may have neither. Current Sales existing-vehicle selection checks for a same-site visit or delivery. The current workshop read resolves exact make, model, variant and powertrain, verifies all current sources and checks the publisher's `work-order.checklist-template.publish` grant. None of those records establishes delivery-PDI applicability. Existing workshop and Sales history, including successive observation corrections, must remain readable. [Current Sales design](../sales-delivery-and-pdi-design-plan.md) · [Current workshop design](../work-order-checklists.md) · [Grounding](checklist-lifecycle-grounding-2026-11-14.md)

## Shape

### Types and ownership

```ts
type Application = "delivery-pdi" | "workshop-pdi" | "workshop-maintenance"
type Selection<A extends Application> = { context: A, revisionId: RevisionId }
type VehicleIntake = SiteVisibleVehicleSelection | NewVehicleFacts
type Preparation = { id: PreparationId, vehicleId: VehicleId, version: Version }
type DeliveryPdiState = "in-progress" | "submitted" | "returned" | "reviewed"
type DeliveryPdi = { id: DeliveryPdiId, preparationId: PreparationId,
  state: DeliveryPdiState, template: Selection<"delivery-pdi">, vehicle: VehicleSnapshot }
type WorkshopStart =
  | { expectedWorkOrderVersion: Version, selection: Selection<"workshop-pdi">, basis: InspectionBasis }
  | { expectedWorkOrderVersion: Version, selection: Selection<"workshop-maintenance">, basis: MaintenanceBasis }
type ItemResult =
  | { result: "completed", comments?: Comments }
  | { result: "failed" | "not-checked" | "not-completed" | "blocked", reason: Reason, comments?: Comments }
  | { result: "not-applicable", applicabilityReason: Reason, comments?: Comments }
type AssignedItemEdit = { itemId: ItemId, expectedAssignmentRevision: Version,
  expectedItemRevision: RevisionOrZero, result: ItemResult, evidenceIds: EvidenceId[],
  measurement?: MeasurementWithUnit }
```

A preparation holds its vehicle reference, administrative provenance and version. Its technical PDI runs have individual immutable definitions and decisions. Start opens one run. Return reopens the submitted run for attributed corrections. Review records the decision on the exact submitted revision. Only an approved policy may permit acceptance or a repeat attempt. The technical status and the existence of a handover fact are independent read fields. Migration 068 continues to own checklist lifecycle, snapshots, versions and item history for real workshop orders.

### Public operations and module map

The signatures below use domain types. The HTTP boundary derives authenticated staff/site context, parses strict bodies and maps conflicts, denials and blocked reasons. An attempt is the caller's stable command ID.

| Module | Operations and responsibility |
| --- | --- |
| Proposed `delivery-preparations.ts` | `open(staff, attempt, vehicle: VehicleIntake) → Preparation`, `read(staff, id) → PreparationSummary`. Claim or select the canonical VIN, require positive site visibility, and own preparation versions. |
| Existing `sales-deliveries.ts` | Add `recordForPreparation(staff, attempt, id, {expectedPreparationVersion, facts}) → DeliverySummary`. Use the delivery writer inside one command transaction. Preserve the existing direct Sales recording and PDI Observer correction endpoints. |
| Proposed `delivery-pdi.ts` | `read(staff, prep, page) → PdiPanel`, `start(staff, attempt, prep, {expectedPreparationVersion, selection}) → PdiPanel`, `recordOutcome(staff, attempt, prep, {expectedPreparationVersion, …AssignedItemEdit}) → PdiPanel`. Distinct assign, take-charge, handoff, submit and review operations each take the current preparation and relevant assignment/submission revisions. |
| Existing `work-order-checklists.ts` | `read(staff, order, page) → WorkshopPanel`, `start(staff, attempt, order, input: WorkshopStart) → WorkshopPanel`. Corresponding outcome, delegation and review commands require the order, checklist and relevant item/assignment revisions. Keep the existing read route and response contract during rollout. |
| Proposed `checklist-applicability.ts` | `eligible(client, scopedVehicle, context, at) → EligibleRevisions` and `bindCurrent(client, scopedVehicle, selected, at) → PinnedDefinition`. One owner verifies exact model, context, effective revision, source chain, latest clean scan/digest and current publication authority. Reads list eligible revisions. Commands lock and re-evaluate eligibility in their transaction. |

Callers identify a parent, choose a form and provide the observed versions. They never coordinate template snapshots, evidence checks, assignment history, grant decisions or audit writes. The two operational modules can share pure outcome validation over a pinned definition. A common operational state machine would make granting, hold resolution and order consent conditional on the caller's lifecycle.

### Relational contract

Below, `S` expands to both `organisation_id, site_id` in the listed order. Every listed referenced tuple needs a primary or unique key in that exact column order. Child keys are non-null, use restrictive deletes, and receive forced site-scoped RLS and purpose-specific privileges. Staff actor IDs reference `staff_users(id)`; scoped actor placement and grant IDs reference their own scoped keys. Check the placement/grant belongs to the recorded actor and snapshot its revision.

| Child | Required parent and uniqueness |
| --- | --- |
| `delivery_preparations(S,id,vehicle_id,...)` | FK `S → sites(organisation_id,id)`; FK `(organisation_id,vehicle_id) → vehicles(organisation_id,id)`, the vehicle's actual organisation-level key. Unique `(S,id)` and `(S,vehicle_id,id)`. For the currently supported initial delivery, unique `(S,vehicle_id)` gives one preparation. Additional sale cycles require an owner decision. |
| `preparation_deliveries(S,vehicle_id,preparation_id,delivery_id)` | FKs `(S,vehicle_id,preparation_id) → delivery_preparations(S,vehicle_id,id)` and `(S,vehicle_id,delivery_id) → sales_deliveries(S,vehicle_id,id)`; add the latter unique target. Unique `(S,preparation_id)` and `(S,delivery_id)`. An absent link means no documented association. No inferred backfill. |
| `checklist_revision_applications(S,template_revision_id,kind,context)` | FK `(S,template_revision_id,kind) → workshop_checklist_template_revisions(S,id,kind)` with added target key. Unique `(S,template_revision_id,context)`. Check the only kind/context pairs are PDI with delivery/workshop PDI, or routine maintenance with workshop maintenance. Bind applications while drafting; freeze before review. Store append-only context approval/withdrawal decisions with FK to this exact tuple, source references and action-scoped publisher grants. No implicit delivery context for an existing workshop revision. |
| `delivery_pdi_runs(S,preparation_id,id,template_revision_id,context,...)` | FK `(S,preparation_id) → delivery_preparations(S,id)`; FK `(S,template_revision_id,context) → checklist_revision_applications(S,template_revision_id,context)` and check `context='delivery-pdi'`. Unique `(S,preparation_id,id)`. Partial unique `(S,preparation_id)` for open states prevents overlapping runs. Preserve finished runs. |
| Delivery item snapshots, outcome revisions, assignments and review decisions | Items reference `delivery_pdi_runs(S,preparation_id,id)` using `(S,preparation_id,run_id)`. Unique item key `(S,preparation_id,run_id,id)` and unique code and ordinal per run. Outcomes and item assignment revisions reference that full item key; each has unique `(S,preparation_id,run_id,item_id,revision)`. Outcomes reference the exact assignment revision by that tuple plus its revision value. Reviews reference the exact submitted revision by FK `(S,preparation_id,run_id,submission_revision) → delivery_pdi_submissions(S,preparation_id,run_id,revision)`. Store the submitted item-revision set immutably. |
| Workshop rows | Keep migration 068's existing scoped order/checklist/item chain. Add checked workshop context by kind and bind new instances to the application FK above. Preserve historical instances without asserting an approval they never received. Append the matching scoped assignment/submission/review references for new workshop actions. |

Procedure evidence remains bound to the controlled document. Operational item evidence needs a distinct relation to its own parent. For delivery, require a real delivery-PDI upload purpose with a scoped preparation attachment and accepted, current scan. Use `delivery_pdi_evidence(S,preparation_id,evidence_id)` with FKs to `delivery_preparations(S,id)` and `evidence_records(S,id)`, unique `(S,evidence_id)` and `(S,preparation_id,evidence_id)`. Only the server's upload/acceptance path can create it after verifying the intent's purpose and exact preparation. An outcome-evidence link references both this latter tuple and the full scoped item-outcome revision key. Missing target support blocks prescribed-evidence work. Workshop evidence continues to require the same work order. Index scoped preparation by vehicle, run by preparation and creation order, and outcomes by item and descending revision.

### Transaction, replay and reads

1. `open` uses `runStaffCommand`. For new VINs take the existing organisation/VIN advisory lock and atomically insert the canonical vehicle plus the preparation. Duplicate VIN returns the existing selection/conflict flow without leaking another site's vehicle. For a known vehicle take the existing organisation/vehicle key, require same-site visibility (including a preparation), and lock the scoped preparation when present. Database keys prevent duplicate initial preparations. An already-recorded delivery takes the historical fact path; opening a past technical inspection requires independently documented chronology and owner policy.
2. Use one lock order for every writer involved. Lock active membership first. Delivery commands sharing vehicle/delivery state take the same organisation/vehicle advisory key as the current Sales command, then the scoped preparation row `FOR UPDATE`. Resolve a preparation's immutable vehicle ID under site scope before taking those locks and re-read under lock. Extend the direct delivery path to recognize preparations and share this serialization on an existing vehicle. Both delivery-entry paths create the explicit link under the same locks when the operator has selected the preparation. Keep unassociated historical entries intact. Workshop mutations use the existing scoped work-order row lock first and the checklist row second. Each lifecycle re-reads the canonical vehicle under a conflicting row lock before taking an identity snapshot. On later identity/applicability changes block further technical decisions pending reconciliation.
3. Check active actor/placement, site write permission and current action grant before receipt replay. Follow the current receipt key `(S,actor_id,command_id)` and operation/target/canonical payload fingerprint. A matching authorized replay returns the saved bounded response; changing the body or target conflicts. Check expected versions for new executions after receipt lookup. Keep action-time status checks separate from actor permission so a successful command can be replayed after its own state transition. A revoked or reassigned actor loses protected access.
4. Under the root, check current assignment, consent where applicable, holds, eligibility, signed authority and exact expected revisions. To serialize concurrent withdrawal/supersession, approval and scan changes, use the same revision-family/context lock with publication writers, then lock the current policy/grant/source/evidence rows in a fixed order shared with their writers. Evidence rescans that append attempts must also take the evidence root. If these cross-writer guarantees are unavailable, keep technical writes disabled. Never trust the panel result as proof at write time. Pin the template, application decision, item definitions, exact vehicle facts and approved procedure revision IDs at start.
5. Append a reasoned item revision or decision, retain the actor, assignment and authority snapshots and bump the owning root version. Workshop commands increment both work-order and checklist versions. Keep progress updates and handoffs as attributed history. A correction appends an explicit prior-revision reference and reason. Concurrent edits serialize at their parent; a stale client reloads and reconciles its own edit. Commit the mutation, metadata-only audit event, idempotency receipt and outbox row together. A rollback leaves no partial items, delivery link or receipt. Offline views explain that changes require a live authority check.
6. Sales sees source-attributed sale, actual delivery and observation history under its current permissions. Add preparation visibility to the scoped lookup, vehicle selection and subsequent delivery entry; restrict detailed technical outcomes to the approved reader policy. An authorized technical user reads preparation runs by parent or existing workshop instances by order with audited, paginated reads. Report on a pinned submitted revision, including open/failed/blocked work, reasons, evidence labels, next steps, holds and individually attributed decisions. Unanswered is distinct from an explicitly recorded “not checked.” Use purpose-specific staff and approved client projections with pagination and selectable text. Unknown procedure, schedule, authority and approval appear explicitly; page loading, empty, offline, failed and conflict states retain the parent and a permissible next action.

### Safety and authority

Sales records facts. A PDI Observer appends sourced observations and reasoned corrections within the existing role boundary. Neither role acquires a technical grant. In either lifecycle require the approved task-specific qualifications and grants, assignment, procedure, prescribed measurements/units, evidence and action-specific review policy. Verify a proposed recipient before take-charge or handoff. Store reviewers' own decisions separately; enforce required independence from the performer. Missing or unknown applicable authority and safety controls block governed actions. Allow an authorized person to report a blocked item through a safe factual path even when performing the work is prohibited.

Workshop commands resolve live consent and holds under the order root. Existing G1–G5 decisions and the separate Head inspection remain with their owning commands. Delivery PDI needs a preparation/vehicle-specific source of current safety holds, technical access and authority; a missing workshop order cannot stand in for any of them. Until that source and authority exist, expose the preparation and unavailable reasons only. Reported handover remains a dated historical fact. Any future permission to physically deliver, move, diagnose, repair, energize or release requires its own applicable control. Findings, submission, checklist review and a historical delivery entry carry no such authorization. The 10,000 km or 12-month whichever-first condition prompts a maintenance review; actual work at that and other milestones comes only from an effective exact-model schedule.

## Synthesis decision

Candidate B proposes separate operational parents and separate instance histories. Retain only exact-model template provenance and shared result validation across them. The cross-judge owns the final selection.

## Tradeoffs accepted

- Two sets of operational tables and purpose-specific reports cost more migration work. Each lifecycle can enforce its own assignment, evidence targets, controls and review without nullable dispatch keys.
- Writes to a preparation serialize even when staff edit different items. The site gets a reproducible submitted item set and a single review version. Staff retain independent draft input on conflict.
- Reuse of approved content requires a second explicit applicability decision when a revision crosses lifecycle boundaries. Existing workshop publication remains evidence only for the context it actually covers.

## Alternatives considered

- A shared instance with exclusive scoped parent FKs can centralize item storage and reporting. Its command kernel must dispatch parent locks, grant semantics, controls and evidence targets for every transition. It becomes attractive if both lifecycles gain the same approved decision and evidence rules.
- A universal vehicle inspection with later optional links makes the vehicle-history query short. It discards the order or preparation as the source of assignment and consent, forcing each caller to reconstruct which permissions and holds apply.

## Open questions and risks

- Who owns delivery preparation, technical assignment, hold entry and resolution, reinspection, review independence and any separate handover authorization? How should historical reporting after delivery be distinguished from physical pre-delivery work?
- Under REV-053 and REV-008, which exact OEM procedures, revisions, evidence targets, measurements, applicability rules, milestones and document-control grants apply in each context? Which failures permit submission for review and which block acceptance?
- Which vehicle intake proofs permit first-site association of a VIN already registered elsewhere? Do repeat sales, transfer, cancellation or replacement preparations require a new sale cycle?
- Which Sales or After-Sales staff can see technical summaries and evidence labels, and which client fields and retention rules are approved? How will an owner authorize historical reconciliation where preparation links are absent?

## Next implementation step

Prove preparation creation plus actual delivery under two PostgreSQL sessions with same-VIN retries, wrong-site selection, mismatched vehicle links, protected historical rows and injected rollback before adding any operational PDI write privilege.
