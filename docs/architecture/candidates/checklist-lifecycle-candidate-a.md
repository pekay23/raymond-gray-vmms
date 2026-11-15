# Candidate A: one checklist engine with explicit lifecycle parents

Status: design candidate, 14 November 2026. No operational authority, migration or application change is approved by this document.

## Usage (caller's view)

Sales records a delivery preparation against the canonical vehicle before a delivery date exists. A qualified, assigned technical worker starts a PDI within that preparation. Routine maintenance starts within its actual workshop work order. Both callers receive the same checklist editing and reporting contract, with the parent clearly named.

```typescript
// Sales records preparation facts. This does not start technical work.
const preparation = await deliveryPreparations.open(actor, {
  commandId: newCommandId(),
  vehicle: selectedCanonicalVehicle,
  source: salesSourceClaim,
});

// An assigned technical worker starts the exact, delivery-applicable PDI.
const pdi = await checklists.start(actor, {
  commandId: newCommandId(),
  parent: { kind: 'delivery-preparation', id: preparation.id,
    expectedVersion: preparation.version },
  templateRevision: selectedDeliveryPdiTemplate,
  basis: { kind: 'delivery-inspection' },
});

// The maintenance screen uses its existing work order, without copying a visit.
const maintenance = await checklists.start(actor, {
  commandId: newCommandId(),
  parent: { kind: 'work-order', id: order.id, expectedVersion: order.version },
  templateRevision: selectedWorkshopMaintenanceTemplate,
  basis: { kind: 'unknown' },
});

// A correction appends an outcome revision; it cannot release either parent.
const saved = await checklists.recordOutcome(actor, {
  commandId: newCommandId(),
  target: maintenance.editTarget,
  item: selectedItem.id,
  expectedAssignmentRevision: selectedItem.assignmentRevision,
  supersedes: selectedItem.latestOutcomeId,
  outcome: { result: 'not-completed', reason: recordedReason,
    comment: recordedComment, evidence: [] },
});
```

`actor` is authenticated server context, not a browser-supplied actor or grant. HTTP handlers parse untrusted bodies and IDs before these calls. Selection values above are validated domain values; the API repeats current eligibility checks at execution. No caller sequences separate authorize, create, snapshot and save operations.

## Problem

`USER-043` requires pre-delivery inspection and routine maintenance; `USER-037` also places Sales facts in the vehicle's delivery history. The present schema requires every checklist to have a work order. A PDI before the first service visit therefore has no truthful parent. `sales_deliveries.delivered_on` describes a completed-delivery fact and must not be made nullable or filled with a planned date to solve this. Candidate A introduces delivery preparation as a genuine lifecycle parent and shares only the checklist definition, item history, submission and checklist-review machinery. Parent-specific authority and safety stay explicit.

Grounding phase is complete for this candidate; sketch phase is complete here. Agreement and implementation await the parent architect's comparison. Scrap this candidate if delivery-specific policy cannot be expressed without optional-field bags or a growing collection of parent-type checks across the item engine.

## Shape

### Core types and commands

These are design signatures, not a second hand-maintained transport schema. Implementation derives the validated domain types from the owning boundary schemas. `Id<K>`, `Version`, `Reason`, `Instant` and `SourceClaim` are parsed, branded values; unrelated IDs cannot be interchanged.

```typescript
type Parent =
  | { kind: 'delivery-preparation'; id: Id<'delivery-preparation'>;
      expectedVersion: Version }
  | { kind: 'work-order'; id: Id<'work-order'>; expectedVersion: Version };

type ScheduleBasis =
  | { kind: 'delivery-inspection' }
  | { kind: 'unknown' }
  | { kind: 'customer-request'; source: SourceClaim }
  | { kind: 'verified-history'; historyRevision: Id<'verified-history'> };

type ChecklistState =
  'draft' | 'in-progress' | 'submitted' | 'returned' | 'approved' | 'closed';

type EditTarget = {
  parent: Parent;
  checklist: Id<'checklist'>;
  expectedChecklistVersion: Version;
};

type Outcome = {
  comment: string | null;
  evidence: readonly Id<'parent-evidence-link'>[];
  measurement?: PrescribedMeasurement;
} & (
  | { result: 'completed' }
  | { result: 'failed' | 'not-checked' | 'not-completed' | 'blocked';
      reason: Reason }
  | { result: 'not-applicable'; reason: Reason }
);

type ChecklistView = {
  id: Id<'checklist'>;
  editTarget: EditTarget;
  kind: 'pdi' | 'routine-maintenance';
  state: ChecklistState;
  templateRevision: Id<'checklist-template'>;
  vehicleSnapshot: VerifiedVehicleSnapshot;
  basis: ScheduleBasis;
  items: readonly ChecklistItemView[];
  permittedActions: readonly ChecklistAction[];
  blockers: readonly ActionBlocker[];
};

// Each body is intentionally not implemented in this design candidate.
interface DeliveryPreparations {
  open(actor: StaffContext, input: OpenPreparation): Promise<PreparationView>;
  recordFacts(actor: StaffContext, input: CorrectPreparationFacts): Promise<PreparationView>;
  linkDeliveryFact(actor: StaffContext, input: LinkRecordedDelivery): Promise<PreparationView>;
}

interface Checklists {
  read(actor: StaffContext, parent: ParentReference): Promise<ChecklistPage>;
  start(actor: StaffContext, input: StartChecklist): Promise<ChecklistView>;
  assign(actor: StaffContext, input: AssignChecklistWork): Promise<ChecklistView>;
  recordOutcome(actor: StaffContext, input: RecordOutcome): Promise<ChecklistView>;
  submit(actor: StaffContext, input: SubmitChecklist): Promise<ChecklistView>;
  review(actor: StaffContext, input: ReviewChecklist): Promise<ChecklistView>;
  report(actor: StaffContext, input: VersionedStaffReport): Promise<StaffReport>;
}
```

Every mutation input contains a command ID; every existing-parent input contains its expected parent version. Existing-checklist inputs contain `EditTarget`. Assignment updates carry expected assignment revision; outcome corrections also name the previous outcome ID and correction reason. The engine verifies prescribed measurement presence, unit, evidence and outcome constraints from the immutable item definition. A successful result never supplies a technical acceptance threshold by default.

`review` accepts a named checklist disposition, reason and expected submitted revision. `approved` retains the existing storage vocabulary but means only "Checklist review accepted" in projections. Submission freezes a revision; return creates a new editable round, preserves the submitted revision and invalidates its acceptance. `closed` means the checklist record's editing lifecycle ended. Neither state describes delivery permission or G3/G4/G5. Exact submission and closing criteria require the technical owner's policy.

### Relational ownership

Use a single `checklist_instances` table, not a generic `target_id` with an unchecked type. All referenced tuples below have matching unique constraints. `O` and `S` mean `organisation_id` and `site_id`; the SQL uses their full names.

| Table | Keys and foreign keys |
| --- | --- |
| `delivery_preparations` | PK `id`; unique `(O,S,id)` and `(O,S,id,vehicle_id)`; `(O,S) -> sites(organisation_id,id)`; `(O,vehicle_id) -> vehicles(organisation_id,id)`; version, source-attributed facts and immutable creation identity. No required delivery date. |
| `checklist_instances` | PK `id`; unique `(O,S,id)` and `(O,S,id,parent_kind)`; nullable `work_order_id` and `delivery_preparation_id`; `(O,S,work_order_id,vehicle_id) -> work_orders(O,S,id,vehicle_id)`; `(O,S,delivery_preparation_id,vehicle_id) -> delivery_preparations(O,S,id,vehicle_id)`; `(O,S,template_revision_id,parent_kind) -> checklist_template_contexts(O,S,template_revision_id,parent_kind)`. |
| `checklist_template_contexts` | PK `(O,S,template_revision_id,parent_kind)`; `(O,S,template_revision_id) -> workshop_checklist_template_revisions(O,S,id)`; immutable context applicability and context-specific publication decisions. Keep the existing template table initially; its name confers no delivery applicability. |
| `checklist_items` | Unique `(O,S,id)` and `(O,S,checklist_id,id)`; `(O,S,checklist_id) -> checklist_instances(O,S,id)`; unique item code and ordinal within checklist; immutable definition snapshot. |
| `checklist_item_revisions` | Unique `(O,S,checklist_id,item_id,revision)` and `(O,S,checklist_id,item_id,id)`; `(O,S,checklist_id,item_id) -> checklist_items(O,S,checklist_id,id)`; `supersedes_id` self-FK using the same checklist/item tuple; `(O,S,actor_placement_id) -> staff_role_placements(O,S,id)`; append-only actor, assignment revision, measurement and reason history. |
| `checklist_assignments`, `checklist_review_decisions` | Scoped FK to checklist; scoped FK to placement/grant as applicable; append-only decisions retain signed grant revision and submitted checklist revision, not only mutable IDs. Assignment snapshots include assigned item scope. |
| `delivery_preparation_delivery_links` | Unique `(O,S,preparation_id)` and `(O,S,delivery_id)`; `(O,S,preparation_id,vehicle_id) -> delivery_preparations(O,S,id,vehicle_id)` and `(O,S,delivery_id,vehicle_id) -> sales_deliveries(O,S,id,vehicle_id)`; append-only actor/reason/source. The link records correspondence, not delivery authorisation. |

Add the composite unique keys on `work_orders` and `sales_deliveries` before referencing them. `vehicle_id` is immutable within a checklist and a preparation after creation. Corrections to canonical vehicle facts cannot rewrite historical snapshots.

The instance constraint is explicit:

```sql
CHECK (
  (parent_kind = 'work-order'
    AND work_order_id IS NOT NULL AND delivery_preparation_id IS NULL)
  OR
  (parent_kind = 'delivery-preparation'
    AND delivery_preparation_id IS NOT NULL AND work_order_id IS NULL
    AND kind = 'pdi' AND schedule_basis = 'delivery-inspection')
)
```

`parent_kind`, `vehicle_id`, parent IDs, template ID and item snapshots are immutable after creation. Context eligibility also checks the template's kind matches the instance kind; enforce with a scoped composite template FK including `kind`, with its referenced unique key. An instance cannot be moved from preparation to workshop. A later service visit creates its own checklist and can link the historical PDI as context.

Delivery preparation is initially an administrative open record with attributed corrections and an optional recorded-delivery link. Cancellation, reopen, resale and actual delivery approval need explicit owner decisions. Do not create an automatic "ready to deliver" or "delivered" transition from checklist acceptance.

### Evidence and holds

Reuse private evidence records and scanning, but add an explicit `delivery-preparation` upload purpose with a scoped FK to `delivery_preparations`; do not pretend its files belong to a work order. Create `delivery_preparation_evidence_links` with unique `(O,S,preparation_id,evidence_id)`, FK to the scoped preparation and FK `(O,S,evidence_id)` to `evidence_records`. Attachment verifies original purpose/target, accepted object key, current clean scan and matching digest under locks. Existing work-order evidence links remain canonical for workshop evidence.

Use two outcome-evidence link tables. Workshop links have `(O,S,checklist_id,work_order_id)` FK to a corresponding unique instance tuple, `(O,S,work_order_id,evidence_id)` FK to `work_order_evidence_links`, and the exact outcome revision FK. Delivery links use the equivalent preparation tuple and `delivery_preparation_evidence_links`. This makes cross-parent attachment impossible by FK rather than a late report filter. Evidence availability is rechecked for approval/download. Historical revision links retain their identity even if a later scan blocks use.

Existing `holds` are work-order children. Add delivery preparation hold records with `(O,S,preparation_id)` FK and append-only resolution decisions. Their commands lock the preparation row, matching every delivery checklist mutation. Do not reuse existing `holds` with a fabricated work order. The delivery policy must also identify any vehicle-wide or other-root safety restrictions and coordinate their writes with the same vehicle lock. Missing restriction coverage or resolution authority blocks technical checklist activation. Factual Sales capture and protective hold capture can remain available; they authorise no physical action.

### Modules and interface depth

| Module | Responsibility |
| --- | --- |
| `apps/api/src/checklists.ts`, proposed | Complete named checklist operations and scoped reads/reports; parent context resolution, template eligibility, item history, assignment/review decisions and persistence stay together. Private exhaustive parent switch chooses the real root and policy. |
| `apps/api/src/delivery-preparations.ts`, proposed | Canonical vehicle selection/creation for preparation, attributed Sales facts, preparation holds, delivery correspondence. Owns delivery-specific readiness and authority requirements when approved; never exports a generic policy bypass. |
| `apps/api/src/commands.ts`, existing | Transaction/receipt/event/outbox runner. Retain `runStaffCommand`; no second transaction framework. |
| `apps/api/src/work-order-policy.ts`, existing | Existing workshop action policy and fail-closed resolution. Read through current code; never bypass `POLICY_UNAVAILABLE` by calling a checklist operation. |
| `apps/api/src/app.ts`, existing | HTTP authentication/CSRF and payload parsing, then one named operation. Existing work-order checklist read route migrates to the shared engine in the same change. |
| Web checklist component and two parent screens | Shared item editor and report rendering, explicit parent heading and actions from server projection; Sales history screen retains its separate factual-note flow. |

This is a deep module per `minimize-reader-load` and `boundary-discipline`. The caller supplies intent and observed versions. The engine hides FK layout, immutable snapshots, current provenance, locking, grants, assignment, replay and report consistency. A generic plugin registry or `ParentAdapter` interface would expose more lifecycle knowledge than two supported parents need. Use an exhaustive switch privately; keep delivery-specific policy in its owning module rather than scattering `if delivery` across item handling.

### Transaction, locking and retry flow

1. Authenticate site/session and parse the command. `runStaffCommand` begins `scoped`, sets transaction-local context and locks active membership. Only writable members can mutate.
2. Resolve the scoped, immutable parent from the checklist ID for edits, and require it equals the requested parent. Acquire the actual parent row lock: existing `lockWorkOrderRoot` for workshop; `SELECT ... FROM delivery_preparations WHERE O/S/id ... FOR UPDATE` for delivery. All parent hold, assignment and lifecycle commands use that lock. Never lock the checklist first then discover the parent.
3. Within the parent lock, lock the canonical vehicle row for a stable current identity, then checklist row, template/context root, source/evidence rows in ID order and applicable authority rows in ID order. Publication/supersession, source invalidation, scan state changes and grant revocation must take compatible conflicting locks; use a template-root protocol for append-only publication decisions so a concurrent new decision cannot appear as an unlocked phantom. This protocol must be integrated and race-tested before writes activate. No claim is made that the current SELECT-only availability query already provides it.
4. Check current role, assignment and action-specific grants in the runner's authorization phase. Capability names are configuration proposals, not newly issued grants. Acquire the runner's actor/site/command-ID lock and check the fingerprint and receipt. Same body returns the original response after current authority checks; changed body conflicts. Version checks stay after receipt lookup, as in the existing runner.
5. For a new command, validate both parent/checklist expected versions and assignment revision; then exact vehicle/context applicability, currently effective source publication, qualification, consent/scope, safety restrictions and scan-current evidence. Workshop uses existing work-order policy. Delivery uses a separately approved preparation policy; absent policy fails closed. Read-time eligibility is advisory and cannot substitute for this step.
6. Append item/assignment/review history; update current checklist and parent versions; snapshot decision basis. Parent version advances for every child mutation because the parent lock protects decision context. Return one parent aggregate mutation to `runStaffCommand`, with checklist ID and revision in metadata. Parent event version stays unique; the new checklist version appears in the committed projection. No second nested runner or separate commit.
7. Domain rows, metadata-only audit event, receipt, outbox and schema-validated response commit together. A rollback leaves none. External delivery is a later worker action; this slice sends no actual notifications. General events contain IDs, versions and dispositions, not comments, source content or evidence bytes.

Preparation creation has no parent row yet. Take the organisation/vehicle advisory root used by current vehicle operations before inserting a new preparation. For a new VIN, use the existing organisation/VIN root and unique VIN enforcement. Preparation creation must also establish legitimate site visibility without inventing a visit or delivery; update the vehicle lookup's allowed relation to include a scoped preparation. Do not impose one lifetime preparation per vehicle. Retry identity is the command ID; any rule for competing active preparations is an owner decision.

Shared canonical preparation/checklist state needs serialization because safety and assignment decisions cross the same record. Per-actor drafts remain separate and merge only after an explicit version check. Accept work-order lock contention rather than creating independent safety snapshots. No multi-parent command is required; if one is later proposed, it needs a single ordered root-lock protocol, not nested operations.

### Reads, reports and indices

Reads recheck active membership, scoped parent access and approved role policy. Sharing tables must not grant Sales access to workshop notes. Forced RLS must choose role access by actual parent context for instances and descendants, alongside API checks. New tables start with no runtime write privilege; only reviewed command privileges are added with corresponding policies. A role label alone never satisfies technical grants.

Index instances on `(O,S,work_order_id,created_at DESC,id DESC)` and separately on `(O,S,delivery_preparation_id,created_at DESC,id DESC)` with matching partial predicates. Index preparation queue on `(O,S,created_at DESC,id DESC)` and vehicle history on `(O,S,vehicle_id,created_at DESC,id DESC)`. Item ordering and latest-revision indices remain checklist/item-local. No scan over all instances or application-maintained parent cache is required.

Reports select a fixed checklist/submission revision, load its immutable item/outcome/decision history in one consistent transaction, audit the sensitive read and render the purpose-built paginated staff document. Delivery reports say "Delivery preparation PDI" and workshop reports name their actual visit. Include source/context revision, unknown schedule basis, outcomes/reasons, next steps, holds and individually named review decisions. No review stamp implies release. Client disclosure and reports remain blocked until their allowlist is approved; current authority/hold status is labelled separately from the historical revision being printed.

### Migration and preservation

Use an additive follow-up migration, never rewrite applied migration 068. Rename the three work-order checklist tables to the shared names while preserving IDs, item snapshots and outcome history. Existing parents remain `work-order`; no PDI kind is inferred to be delivery preparation. Replace child work-order-column FKs with the checklist-local tuples only after validating every old row, then drop redundant child parent columns. Preserve immutable data while rebuilding constraints/triggers inside the migration transaction. Migrate every current API/query/test caller in the same change rather than keeping dual write paths.

Give existing immutable templates workshop-only context; do not activate them for delivery. Delivery context requires a new approved applicability decision with its own sources and authority; a new template revision is required where procedure or item rules differ. Existing publication grants named `work-order.checklist-template.publish` cannot publish delivery applicability. Preserve all `sales_deliveries` and `pdi_observations` as they are. Historical notes may be linked as labelled source references but never converted into item outcomes or review decisions. Linking an already delivered vehicle does not imply a PDI existed beforehand.

## Synthesis decision

Pending architect comparison with Candidate B. Candidate A recommends one shared item/outcome engine because reasoned outcomes, immutable corrections and versioned reporting have the same meaning in both contexts. It rejects sharing lifecycle permission: preparation and workshop remain different relational parents and use distinct action policy. No claim that Candidate A won is made here.

## Tradeoffs accepted

- We accept nullable parent FK columns with a strict exclusive-parent constraint in exchange for one checklist history model and enforceable scoped relations.
- We accept a migration of the existing SELECT-only checklist foundations in exchange for avoiding duplicate operational engines before commands exist.
- We accept explicit delivery evidence, hold and policy work in exchange for representing actual pre-delivery work without a fake service visit.
- We accept parent version conflicts between workers in exchange for safety and assignment decisions using one current parent context.

## Alternatives considered

- Separate delivery PDI and workshop aggregates hide each lifecycle well and require fewer parent-type branches. They lose shared item-history and report behavior unless the reusable part is extracted anyway. Prefer that shape if the technical owner establishes materially different outcome semantics or review rounds. Candidate A keeps lifecycle policy distinct while avoiding duplicated outcome persistence.
- Make every PDI a work order. This gives a short public interface only by exposing the false premise that Sales must fabricate an after-sales visit. It cannot represent the user's chronology truthfully and is rejected.
- Put PDI inside `sales_deliveries`. This hides delivery association, but forces a completed-delivery date before inspection and couples checklist edits to append-only Sales history. A nullable/fictional delivery date would erase the distinction the current schema preserves.
- Unchecked `(parent_type,parent_id)` handles shorten SQL declarations but transfer tenant, site and parent existence checks into every caller. Explicit nullable FKs hide that integrity work in the database and are preferable.

## Open questions and risks

- Which named technical owner approves delivery-PDI procedures, source applicability, required measurements and evidence under REV-053/REV-008?
- Which preparation actions, assignments, reviews and independent inspections require which signed grants, and what is the approved delivery safety/consent policy before any technical item is operational?
- Which vehicle-wide restrictions must block preparation work, and which canonical owner/locking protocol governs restrictions shared with a simultaneous workshop job?
- Does preparation need cancellation, a planned handover date, multiple concurrent preparations, resale or corrective-delivery links? These facts must not be inferred from the initial-delivery history.
- May Sales view a restricted PDI summary while technical staff record outcomes, and which exact roles may read either context and any eventual client report?
- When sources or grants change during an open checklist, must work restart on a new revision, return for review or retain a formally approved continuation? Until decided, technical progression fails closed and historical records stay readable with a withdrawal warning.

## Next implementation step

After synthesis, build the parent constraints/context applicability migration and PostgreSQL negative/race tests first, keeping command writes closed until the accepted policy and action contracts are implemented.

## Evidence and checks still required

Current source was read through CodeGraph without a stale-index warning: `runStaffCommand`/`lockWorkOrderRoot` in `apps/api/src/commands.ts`, `recordSalesDelivery`/`addPdiObservation` in `apps/api/src/sales-deliveries.ts`, `readWorkOrderChecklists` in `apps/api/src/work-order-checklists.ts`, and accepted-evidence checks in `apps/api/src/work-order-evidence.ts`. Migrations 057, 067 and 068, USER-037/043, the associated instance/outcome/review tasks, system design, delivery plan and the shared grounding informed this candidate. This is source-based design evidence, not runtime proof.

Required implementation proof includes cross-tenant/site/parent FK and RLS denial; preserved historical IDs and notes; missing delivery context/source/grant/policy denial; exact same-key replay and changed-body conflict; parent/checklist/assignment stale versions; one-commit competing outcomes; hold-versus-review, source-withdrawal-versus-start, grant-revocation-versus-review and scan-change races on PostgreSQL using the runtime role; rollback without partial event/receipt/outbox; report revision consistency/privacy; and browser Sales preparation/PDI plus routine-maintenance journeys with conflict/offline/accessibility/responsive states. No test or staff UAT result is asserted by this document.

The design was screened for architect red flags: no public save stages, no caller-controlled adapters, no duplicate editable parent truth, no pass-through controller/service/repository chain, and no transport objects in the command interface.
