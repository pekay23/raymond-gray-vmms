# Work-order maintenance checklists

**Status:** Architecture selected for implementation; no checklist template is effective.

## Purpose

Provide a revisioned routine-maintenance checklist for a real after-sales vehicle visit. The work order remains the canonical source for client, owner, contact, vehicle, site, consent, holds, assignment and visit state. Checklist records are child records with their own item history; they are not work-order repair tasks and do not create vehicle-master facts. Pre-delivery inspection belongs to the separate delivery-preparation lifecycle in [checklist lifecycle](checklist-lifecycle.md); a new delivery PDI must not be forced under a work order. Workshop PDI is not part of the approved first scope.

The supplied draft form is a layout and process reference only. No OEM schedule, model-specific test value, acceptance limit, procedure, permission grant or reviewer authority is inferred. The owner's 10,000 km / 12-month condition is only an intake/review reminder, not a technical interval or package. A checklist can be operational only when an effective template revision exactly matches the vehicle and its work-order context and has approved source provenance.

## Selected design

Use [Candidate B](candidates/workshop-checklists-candidate-b.md), with the [cross-judge refinements](candidates/workshop-checklists-cross-judge.md). Keep checklist tables distinct beneath the canonical work order and serialize checklist mutations with the current work-order root lock. This lets each mutation check current consent, holds, vehicle identity and assignment together without making inspection items behave like repair tasks.

Preserve Candidate A's explicit expected checklist version, immutable item snapshots, and the rule that item completion never completes a work order. Keep effective templates separate from the operational checklist; any future authoring draft remains non-effective and cannot produce a report that implies approved work.

## Data contract

- `ChecklistKind`: `pdi` or `routine-maintenance`.
- `ChecklistState`: draft, in progress, submitted, returned, approved or closed. State transitions require an action-specific grant and current version.
- `ChecklistItemResult`: completed, failed, not checked, not completed, blocked or not applicable. Non-complete outcomes require a plain-language reason; not-applicable also requires an applicability reason.
- Each template revision is immutable and contains exact vehicle applicability, effective dates, approved source revision references, item text, applicability, prescribed evidence/measurement rules and review declarations. No code defaults may supply technical values.
- Each checklist instance binds one exact template revision and a verified visit-vehicle snapshot. Unknown mileage/service baseline remains visibly unknown.
- Item changes append outcome revisions with actor, placement, assignment, time, evidence references, measurement/unit when prescribed, and superseded revision. Corrections do not rewrite prior values.
- Review decisions retain the actor's placement and grant snapshot. Checklist review does not replace Supervisor G3 completion, Team Lead G4 release, Head inspection or G5 departure authority.

Database foundations now exist in `apps/api/migrations/067_workshop_checklist_templates.sql` and `068_work_order_checklist_instances.sql`: exact-variant template revisions, source links and separate decisions; work-order child instances, immutable checklist-item definition snapshots and append-only outcome revisions. A staff-only read path now lists existing records and finds exact-vehicle templates only when current source evidence and the publication grant still validate. Runtime access remains SELECT-only. No template-authoring or checklist-create/update command exists, so the tables are not yet an operational workflow.

## Command and access boundary

Mutations use `runStaffCommand`, lock the scoped work-order root, verify writable membership, assignment and the action-specific grant, validate current work-order/checklist versions, and verify exact effective template applicability. The projection, immutable history, decision snapshot, metadata-only event, idempotency receipt and outbox entry commit atomically. Stale versions and changed-body retries conflict. Evidence IDs must point to accepted, scan-current evidence already attached to the same work order.

Every row is keyed by organisation and site with composite parent foreign keys and forced RLS. Reads and reports re-check site scope and active placements. Client reports use an allow-listed projection in the report service, not a UI-side filter. Staff comments, restricted notes, evidence bytes and sensitive customer details do not enter the general event log.

## Fail-closed operation

Until model-specific templates and grant configuration exist, the application must explain why an operational checklist cannot be started. It must not silently offer a universal EV/PDI/maintenance package. Missing or expired source, unknown applicability, open holds, missing required evidence, incomplete required items or absent grants block approval and any downstream work-order gate. Recording an observation never widens consent or authorizes diagnosis, repair, vehicle movement or HV work.

## Report contract

Reports are purpose-built documents with their own title, booking/site, distinct client/owner/contact identities, verified vehicle, schedule basis, template and source revisions, grouped checklist items, completed/open/failed/blocked/deferred counts, reasons, measurements/units, accepted evidence labels, assignees, next steps, holds, correction history and separately named decisions. Paginate stable versioned data and keep text selectable. Do not print or capture the application page.

## Implementation sequence

1. Add schema and command contract for effective template revisions and checklist child records; keep no operational template seeded.
2. Add fail-closed effective-template lookup and authorized routine-maintenance checklist creation under a real work order. Exact lookup and unavailable-state display are implemented; checklist creation remains open.
3. Add append-only item outcome recording, correction history, evidence binding and assignment checks.
4. Add separately granted submission/review commands; keep them distinct from existing completion, release and Head inspection actions.
5. Add scoped list/detail reads and a purpose-built staff report; add the client projection only after its disclosure policy is approved.
6. Add responsive role-aware screens with explicit unavailable, draft, conflict, missing-source and held states.
7. Verify PostgreSQL RLS and transaction rollback, replay/stale assignment, missing source/authority, correction preservation, report pagination/privacy, keyboard/accessibility and device layouts. Update requirement and implementation statuses only against evidence.

## Open owner and technical inputs

See [REV-053](../decisions/review-register.md#rev-053-pdi-and-recurring-maintenance-checklist-content) for exact OEM schedules, variant applicability, measurement/evidence rules, reviewer grants, independent review needs, failure routing, retention and reports. See [REV-008](../decisions/review-register.md) for approved SOPs and document-control authority. Until those sources and grants are configured, no checklist is effective and no technical or sign-off action may be enabled.

## Design review record

Two distinct shapes were compared: a separate checklist aggregate (Candidate A) and a work-order child with separate checklist tables (Candidate B). The cross-judge scored B 30/30 and A 27/30. B was selected for the shared work-order lock and direct visit context. A's expected checklist version and explicit non-authorizing item outcomes were retained. A's nullable untemplated operational record was rejected; revisit cross-root separation only if measured work-order lock contention justifies it. No application behavior was granted by this design decision.
