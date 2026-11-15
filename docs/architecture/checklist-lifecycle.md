# Pre-delivery PDI and workshop maintenance

**Status:** Selected engineering direction after two candidates and a cross-judge. Source-attributed preparation notes and explicit actual-delivery links are implemented. Owner, technical and document-control approvals remain pending; no operational PDI checklist template is active.

**Requirements:** `USER-037` and `USER-043`\
**Design record:** [grounding](candidates/checklist-lifecycle-grounding-2026-11-14.md), [Candidate A](candidates/checklist-lifecycle-candidate-a.md), [Candidate B](candidates/checklist-lifecycle-candidate-b.md), and [cross-judge](candidates/checklist-lifecycle-cross-judge-2026-11-14.md).

## Product model

The system must represent two different events without creating false records:

1. **Pre-delivery inspection:** A sales-delivery preparation exists before a vehicle is handed to its purchaser. A technical PDI checklist belongs to that preparation. It is not an after-sales customer visit or work order.
2. **Workshop maintenance:** A customer's maintenance visit belongs to its real work order. Its checklist uses the exact vehicle-specific schedule; unknown service history stays unknown.

The 10,000 km or 12-month whichever-first threshold is the owner's intake/review reminder. It does not define the technical service interval or a universal task package. Exact work comes from an effective schedule for the vehicle's make, model, variant and powertrain.

The current `sales_deliveries` row records a dated delivery fact. Current `pdi_observations` are attributed source notes attached to that delivery. Neither is a pre-delivery preparation or a completed checklist. Preserve these records and corrections as they are; never convert them into checklist outcomes, inspection approval, current ownership, service payer or authority.

The existing work-order checklist design is retained for routine maintenance. Delivery PDI receives a separate preparation parent and lifecycle. A workshop PDI is not part of the accepted first scope unless the owner later requests it. See [work-order checklist implementation](work-order-checklists.md) for the existing read/storage slice; its PDI template kind is not approval to run a workshop PDI.

## Selected architecture

Use a **delivery preparation aggregate** and keep actual delivery history separate. A preparation binds one canonical vehicle and holds only attributed preparation facts. It can exist without a delivery date, client visit or work order. A later actual delivery record may be explicitly linked to it without changing the meaning of the historical `delivered_on` fact.

Keep delivery-PDI runs and workshop-maintenance checklist instances as separate operational records with explicit scoped foreign keys to their real parent. Do not use an unchecked `(parent_type, parent_id)`, a nullable/fictitious work order, or a completed-delivery row to represent a planned handover. The separate parents preserve each lifecycle's version, assignment, evidence, hold, access and report rules.

Reuse the exact-model template/source library only through an explicit **context-specific applicability decision**. A revision approved for workshop maintenance is not approved for delivery PDI. Where task meanings are truly the same, pure outcome validation may be shared; storage, assignment and review states remain owned by their lifecycle until technical policy proves they have the same meaning.

The cross-judge selected Candidate B and grafted two requirements from Candidate A:

- Block technical checklist actions when vehicle-wide or other-root safety restrictions cannot be checked and serialized with every relevant writer. A preparation-only lock does not protect a simultaneous workshop action.
- Bind each outcome's evidence at the database level to the exact scoped outcome revision and the same preparation or work order. Recheck the upload purpose, target, accepted state, current clean scan and digest at the action that uses it.

## Implemented preparation record

Sales Representatives can create a site-scoped preparation against a canonical vehicle before an actual delivery date exists. For a newly recorded stock vehicle, the preparation command creates the canonical vehicle and preparation together under the organisation-wide VIN lock. The record contains source-attributed notes, actor and time only; it creates no visit, work order, checklist result, sign-off or vehicle-release gate. Multiple preparation records per vehicle are permitted. Preparation-only VIN lookup is limited to the Head of Service Centre, Sales Representative and PDI Observer roles.

After a dated sales delivery exists, a Sales Representative can explicitly select it and link it through a versioned command. The server verifies that the delivery belongs to the same vehicle and site, rechecks the preparation version under the shared vehicle lock, and commits the link, event, receipt and outbox atomically. Existing delivery and PDI observation rows remain unchanged. See [delivery preparation verification](../verification/delivery-preparation-2026-11-14.md).

The page explains that technical PDI is unavailable because no approved vehicle-specific procedure is configured. Source-based preparation notes do not establish that a PDI was performed, authorize technical work, or approve release. Correction, cancellation, repeat/reinspection and broader visibility rules remain open under REV-055 and REV-049.

## Authority and lifecycle boundaries

- Sales may record preparation and actual delivery facts within its existing permissions. Sales or a PDI Observer role does not gain technical authority from the preparation record.
- A technical user may see a blocked or learning state, but a vehicle-specific operational checklist requires a current exact-context source, active action grants, qualification, assignment, applicable safety controls, required consent and evidence rules.
- A submitted or reviewed checklist is not a delivery release, repair completion, Supervisor G3, Team Lead G4, Head inspection or G5 departure decision.
- Do not make actual delivery contingent on PDI completion until management approves the delivery gate, responsible roles, evidence and separate handover authority.
- The existing work-order policy resolver remains fail-closed. A read-time eligible-template result is not authorization to start work; the command must lock and recheck all prerequisites.
- No technical checklist command may proceed while source, authority, safety restrictions or required consent are unknown.

## Record integrity and transactions

Every child reference is organisation/site scoped and enforced by composite foreign keys with forced RLS. Link a preparation and an actual delivery only through an explicit, versioned command; do not infer a link during historical imports. Preserve IDs and all PDI observations. No historical completion or approval is backfilled.

Mutations use the existing `runStaffCommand` envelope for one atomic change, event, idempotency receipt and outbox row. They recheck site membership, current grant, selected parent version, vehicle identity, context applicability, source revisions, scan state, assignment and relevant holds under compatible locks. Same-key replay is idempotent; a changed payload or stale version conflicts. No writer is enabled until the shared lock order with Sales, source/evidence scans, grant revocation and safety restrictions is proven on PostgreSQL using the runtime role.

## Reports and screens

Provide separate screens for delivery preparation/PDI and workshop maintenance, each naming its real parent and the next permitted action. Show loading, empty, offline, blocked, unavailable-source, conflict and failure states. Do not show an active form where no effective context-specific template exists.

Generate purpose-built reports from one immutable checklist revision. Delivery-PDI reports identify the preparation and any linked actual delivery. Maintenance reports identify the work order. Both show completed/open/failed/blocked items, reasons, applicable source revisions, evidence labels, measurements only when source-prescribed, holds and separate decision history. A report never implies a gate or release. Client output stays closed until its field allowlist and access rules are approved.

## Implementation sequence

1. Add the owner decisions under REV-055, alongside source and authority prerequisites in REV-053, REV-008 and REV-049.
2. [x] Add source-attributed delivery-preparation records and explicit, versioned Sales delivery links without changing existing delivered-vehicle or PDI-observation meanings. Preserve same-site visibility and organization-unique VIN protections. Correction/cancellation and repeat rules remain open under REV-055.
3. Add explicit template applicability by lifecycle context. Keep all templates non-effective until approved exact sources and action-specific authority exist.
4. Add separate delivery-PDI and work-order-maintenance instance commands. Verify parent integrity, source/scan/grant revocation races, current assignment, hold scope, replay, stale versions and atomic rollback.
5. Add reasoned item outcomes, assignments and review decisions for each lifecycle; keep review distinct from delivery, G3/G4, Head inspection and G5.
6. Add the two role-aware screens and purpose-built reports, then verify browser, accessibility, phone/tablet/fold/desktop layouts and staff UAT.

## Decisions still pending

- **REV-055:** Who creates and updates a delivery preparation? Does delivery wait for a PDI decision, and if so who performs, reviews and separately authorizes handover? What are the cancellation, retry, repeat-sale and historical-link rules?
- **REV-053 and REV-008:** Which exact OEM schedules and procedures apply to each context? Who owns technical content, grants authority, reviews outcomes and approves the controlled revisions?
- **REV-049:** Which Sales and after-sales roles may read preparation details, technical outcomes, evidence labels and any later client report?
- **Vehicle and safety controls:** What evidence establishes first-site visibility for an organization-wide VIN, and which vehicle-wide restrictions must be checked across preparation and work-order activity?

Until these decisions are resolved, only the source-attributed preparation facts and explicit actual-delivery association described above are available. Technical PDI, maintenance execution, acceptance and any PDI-dependent physical handover remain unavailable wherever their source, grant or safety policy is missing.
