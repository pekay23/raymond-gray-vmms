# Supervisor work allocation

Status: engineering contract based on the owner-approved workforce hierarchy. Allocation records coordinate the work plan; they never grant permission to diagnose, repair, declare work complete, inspect, release a vehicle or approve payment.

## Workflow

1. Operations reviews the current work order and assigns an eligible Team Lead.
2. The Team Lead creates a versioned work plan and hands that exact plan revision to one qualified Supervisor.
3. The receiving Supervisor assigns tasks from the handed-off plan to active Technician, Engineer or Trainee role placements that report directly to that Supervisor at the same site.
4. Each task may have one current assignee. Reassignment appends a new revision and preserves the former allocation. A changed work order, plan or handoff makes an allocation stale; the Supervisor must allocate again against the current handed-off plan.

## Authorization boundary

The server derives the actor, organisation and site from the authenticated staff session. It confirms that the actor is the current handoff recipient, has an active Supervisor role placement, and that every selected task belongs to the currently handed-off plan. Each assignee must have an active site membership and active Technician, Engineer or Trainee placement reporting directly to that Supervisor placement. A role placement is not a technical qualification.

Allocation is a coordination record only. It does not enable task execution. Starting or signing off work must separately check current task/system/model qualification, supervision, effective approved procedure, diagnostic consent and scope, safety holds, equipment readiness, required evidence and signed execution authority. Until those policies and their commands are implemented and approved, the system must leave work-start and technical sign-off unavailable; assigning a task cannot bypass those gates.

## Persistence and command behavior

Use a staff command with the shared work-order serialization root, current membership lock, command UUID, payload fingerprint, stale work-order version check, append-only domain event, idempotency receipt and outbox entry in one transaction. Store each allocation revision against the work order, task, plan revision, direct-report Supervisor placement and target staff placement. Keep history append-only and site-scoped with composite foreign keys and row-level security. A task outside the handed-off plan, duplicate task in one command, inactive or cross-site assignee, indirect report, wrong actor or stale plan is rejected without partial writes.

The work-order projection may display current task allocations and their history. Only the current handoff Supervisor may change them; the Team Lead may revise the work plan and hand over a new revision. Other roles can read only through the existing site-scoped work-order projection. The interface must state that assignment does not authorize starting or signing off the repair.

The current handoff Supervisor may read a paginated activity feed for tasks allocated to active, writable direct reports under the current plan. The Team Lead currently assigned to the work order and Head of Service Centre may read the same feed across the current plan for oversight, subject to the same current-Supervisor and direct-report boundary. The feed includes the worker's acknowledgement, progress, blockers, comments and requests, with the actor and time. It is read-only: a request is not automatically approved or completed. A prior Supervisor, unassigned Team Lead or unrelated role cannot use the feed after the current assignments change. Every read is site-scoped and audited.

The work-plan panel shows assignment controls only when the API authorizes the current Supervisor to assign work. Other readers see the planned tasks and current assignee names without disabled form controls. Team Leads and the Head are told that the current Supervisor manages team assignment; this display rule supplements, but never replaces, API authorization.

## Technician assigned-task queue (read-only first slice)

The staff workspace may provide a paginated **My assigned tasks** view for a user with an active Technician, Engineer or Trainee placement. It returns only task allocations for that authenticated user from the latest assignment revision, on the latest plan tied to the current Operations review and Team Lead, with a still-current Supervisor handoff and active work-order, staff, role-placement and site-membership records. The latest revision is selected before filtering by assignee, so a former assignee cannot see a task after reassignment. Every query is scoped by the authenticated organisation and site.

The projection is limited to the booking reference, vehicle registration and make/model, planned task reference and title, current Supervisor, plan revision, assignment timestamp and assignment revision. It excludes customer and owner contact details. Reads are paginated and recorded using the sensitive work-order queue audit action. A stale or missing review, plan, handoff, assignee placement or membership yields no task. This view is a coordination aid only: it has no start-work, procedure, diagnostic, parts, time, completion or sign-off action. Those remain unavailable until their approved instructions and action-time grants exist.

## Verification

Use disposable PostgreSQL, the non-owner runtime role and synthetic data. Cover successful allocation, direct-report eligibility, wrong/indirect/inactive staff denial, wrong Supervisor, non-plan task, changed plan or handoff, duplicate task, cross-site identifiers, idempotency, stale version, rollback of event/receipt/outbox, RLS isolation and immutable history. Browser checks cover Supervisor visibility, save/retry/conflict states, keyboard use, narrow screens and the explicit authorization boundary. No real staff qualifications or procedures are seeded by these tests.
