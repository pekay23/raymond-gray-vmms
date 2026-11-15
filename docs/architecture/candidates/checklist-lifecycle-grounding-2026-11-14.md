# Checklist lifecycle design grounding — 2026-11-14

## Purpose

Recheck the checklist parent model before adding a start command. `USER-043` explicitly asks for pre-delivery inspection and routine-maintenance forms. The user also described Sales recording vehicle sales and completed PDI, followed by the after-sales service journey. The current design places every checklist under a workshop work order; this may not represent PDI before the first customer visit.

## Current evidence

- `USER-037` says Sales records delivery and PDI facts against the canonical vehicle. It requires source-attributed PDI notes and says they do not establish technical completion or safety approval.
- `USER-043` says to create technical-role forms/checklists for pre-delivery inspection and routine maintenance, with outcomes, reasons, comments, review and reports.
- Migration `057_sales_delivery_pdi_observations.sql` requires a `delivered_on` date on `sales_deliveries` and attaches `pdi_observations` to a delivery. `addPdiObservation` in `apps/api/src/sales-deliveries.ts` appends source notes; it is not a checklist completion command.
- `docs/architecture/sales-delivery-and-pdi-design-plan.md` explicitly prevents observations from being called complete, safe, passed or approved until instructions and form rules are approved.
- Migration `068_work_order_checklist_instances.sql` requires each checklist instance to reference a work order. It supports workshop PDI and routine maintenance but cannot represent a PDI before an after-sales work order exists.
- Current work-order commands use `runStaffCommand`, site membership and work-order serialization, action-time grants and atomic state/event/receipt/outbox persistence. Current work-order policy resolution returns `POLICY_UNAVAILABLE`; G1-G5 and technical action authority stay fail-closed.
- The exact-model template read path verifies the current effective decision, current source evidence and the publication-grant snapshot. No template authoring, checklist-start or outcome command exists.

## Required invariants

1. A sales pre-delivery inspection must not fabricate an after-sales visit or work order.
2. A workshop maintenance visit remains attached to its real work order and current vehicle snapshot.
3. Delivery and workshop checklists use exact vehicle applicability and current source provenance; shared design must not imply identical applicability.
4. Existing PDI observations remain historical/source notes and are never promoted to completed checklist items.
5. Checklist creation or submission alone cannot authorize diagnosis, repair, vehicle movement, delivery, G3/G4/G5, or a safety/quality release.
6. Every parent relationship must have tenant/site-aware database integrity; do not rely on an unchecked polymorphic target ID.
7. Existing delivered-vehicle records stay intact. A new pre-delivery lifecycle must not reinterpret the completed-delivery table or its required delivery date.

## Candidate shapes to compare

- **A — shared checklist instance with explicit lifecycle parents:** add a genuine delivery-preparation record and allow a checklist to bind to either that record or a work order, enforced by separate composite foreign keys and a discriminator/check constraint. Use one immutable template and outcome engine with explicit applicability context.
- **B — distinct delivery PDI and workshop checklist instances:** add a delivery-preparation/PDI aggregate with its own states and decisions; keep work-order checklist instances for workshop PDI and maintenance. Reuse governed template/source definitions only where context-specific applicability is explicit.

## Review rubric

- Correctly represents both sales-time PDI and work-order maintenance without fake records.
- Preserves explicit relational integrity, tenant/site scope, and current work-order serialization.
- Keeps human role labels separate from action-specific grants and never implies a technical or delivery sign-off.
- Reuses data/behavior only where meanings and lifecycle rules are genuinely shared.
- Preserves existing sales-delivery and PDI observation history without guessing completion.
- Makes missing technical owner, source, schedule, and authority choices clear and fail-closed.

## Status

Grounding only. Candidate comparison and cross-judge are pending; this file does not replace `USER-043`, approve a PDI lifecycle, or authorize technical procedures.
