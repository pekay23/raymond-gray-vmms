# Checklist record review synthesis

## Decision

Add an append-only, item-level review decision for the latest technician checklist outcome revision. The decision records whether the entry is sufficiently supported as a record or needs correction. It never changes the checklist outcome, checklist state, task state, or work-order state.

## Selected design

- Bind one review decision to the exact organisation, site, work order, checklist, item, and outcome revision.
- Require the current work plan, current task assignment, active reviewer placement, and the action-specific `work-order.checklist.item-review` grant at command time.
- Permit only the current handoff Supervisor reviewing a current direct report, the currently assigned Team Lead, or the active Head of Service Centre. Reviewer and outcome recorder must differ.
- Require a reason for both dispositions. A corrected outcome creates a new pending review; the old decision remains unchanged.
- Use the normal staff command envelope for the work-order lock, event, idempotency receipt, and outbox entry.
- Keep this action separate from successful technical completion, Supervisor G3, Team Lead G4, Head inspection, and release/G5.

## Why not batch approval

A batch decision could hide which exact outcome revision was reviewed and would make assignment changes harder to explain. The source design does not define a single hierarchy-wide batch authority. Item-level decisions preserve traceability without inventing that authority.

## Guards and limits

The queue shows a version-bound snapshot of the current checklist item and outcome. A `record-confirmed` decision confirms the record only; a failed or blocked result remains failed or blocked. `returned-for-correction` requires a reason and leaves the existing record untouched. No checklist is activated and no effective vehicle template is seeded. Missing model-specific sources, qualifications, grants, unresolved safety holds, and customer/staff acceptance remain explicit release gates.

## Verification boundary

Database and API tests can prove tenancy, reviewer eligibility, current assignment, immutability, idempotency, stale-revision conflicts, and separation from work completion. Browser checks can prove the queue and decision controls are understandable and responsive. Those checks do not prove an OEM schedule, workshop SOP, individual grant, or real-world UAT is approved.
