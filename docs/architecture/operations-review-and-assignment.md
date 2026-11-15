# Operations review and team-lead assignment

**Status:** Engineering contract selected for implementation. The production mapping of the Operations administrator role to the signed `work-order.operations-review` capability remains pending under REV-034. No staff grant is seeded or implied by a role label.

## Purpose and boundary

Each new work order follows two distinct Operations transitions: an authorized Operations reviewer records that the work order was reviewed, then a separately authorized actor assigns a currently qualified team lead. Review is a workflow record for routing. It does not accept vehicle custody, classify a vehicle as safe, approve diagnosis or repair, satisfy G1/G2, sign technical completion, or release the vehicle under G3/G4.

The review has no checklist, approval verdict, or mandatory fields beyond the reviewed work-order revision. Those criteria were not supplied. Optional notes are descriptive and cannot function as a safety or technical decision.

```mermaid
sequenceDiagram
  participant Advisor
  participant Ops as Operations reviewer
  participant Lead as Operations assigner
  participant API
  participant DB as PostgreSQL
  Advisor->>API: Create reception draft
  API->>DB: Commit work order with G1-G5 pending
  Ops->>API: Record review (work-order.operations-review)
  API->>DB: Lock version and grant; append review + event + receipt + outbox
  Lead->>API: Assign qualified lead (work-order.assign-lead)
  API->>DB: Require current review; lock qualification; append assignment + event + receipt + outbox
```

## Command contract

Add `recordOperationsReview(pool, scope, commandId, workOrderId, body)` in `apps/api/src/workshop.ts`, with `POST /api/v1/sites/:siteId/work-orders/:id/operations-review`. The strict request carries `expectedVersion` and optional bounded `notes`. Actor, organisation and site come only from the authenticated scope. The response returns the review ID, reviewer display name, review time, work-order revision reviewed, and new aggregate version.

The reviewer requires the distinct `work-order.operations-review` signed grant, checked and row-locked at action time. Team-lead assignment continues to require `work-order.assign-lead` plus the selected lead's active powertrain qualification. An Admin role label alone does not mint either grant. Both commands use the shared `runStaffCommand` protocol; review and assignment have independent idempotency keys, events, receipts and outbox records. The shared runner now locks the scoped work-order root before checking those grants and qualifications. `BUILD-CMD-LOCK-ORDER-001` and `CHECK-CMD-LOCK-ORDER-001` track implementation and race evidence; G3/G4 transitions and their hold/release races remain later work.

## Persistence and sequence rules

Add an append-only `work_order_operations_reviews` table scoped by organisation/site/work order. It records `reviewed_by`, `reviewed_at`, optional notes, the post-review work-order version, and a minimal signed-grant decision snapshot. A unique constraint prevents two distinct review records for the same work-order version; a later version can be reviewed as a new row. Runtime can select/insert but cannot update/delete. RLS and composite foreign keys enforce site boundaries.

The review command locks the work order before the authority row, compares `expectedVersion`, increments the aggregate version, and records the version resulting from that transition. It then uses the common transaction to persist the review row, domain event, command receipt and outbox item atomically. Replay rechecks current membership and review grant before returning the original response.

Assignment locks the same work-order row and requires the latest Operations review to be for the current aggregate version before inserting a lead assignment. It stores a foreign key to that exact review. Assignment still rechecks the lead's qualification under the existing lock and stores its grant/qualification snapshot. A mutation between review and assignment makes the review stale; Operations must review the new version before assignment. Supervisor handoff requires the latest assignment to reference the latest review, to be bound to the assigned lead and to pass the current handoff grant/qualification checks. Historical assignments with no review link remain unknown; they are not backfilled as reviewed.

## Read model and interface

The work-order detail projection exposes the latest review and whether it is current for assignment. The Operations review card shows reviewer, time and optional notes. The team-lead card remains separate and distinguishes review-required, review-out-of-date, assignment-required, assigned, authority-blocked, and no-qualified-lead states. It offers a review form only when the caller has the review capability; it offers assignment only when the review is current and the caller has the assignment capability. Each action reports validation, stale-version, offline, loading and retry states.

Keep both cards within the approved visual baseline. This change adds no new artistic direction. Responsive layout tests must ensure the sequence remains understandable on narrow screens and at text zoom.

## Decisions and limits

The skill arena compared two designs. Candidate B was selected for its explicit Operations-review authority boundary and separate transitions. Candidate A's concrete grant-row locking and action-time decision snapshot were grafted into the selected design. Candidate A's reuse of `work-order.assign-lead` for review was rejected because it silently equates two authorities. Candidate B's one-time review row was extended to one review per reviewed version so stale information can be reviewed again without editing history. The independent judge also required the supervisor handoff to remain bound to the current review and assignment.

The available arena runner configuration and reference prompt/template files were absent in this environment; two isolated design agents and a separate read-only cross-judge were used instead. Their scratch designs are under the current user's local Temp directory and are not source-of-truth artifacts. This document is the synthesized contract.

No review authority grants, review rubric, Operational readiness, technical sign-off or G1 acceptance are configured by this design. The owner must confirm which named site administrators receive the review capability, its basis, validity and revocation process before operational use. Until then, the review command fails closed.

## Implementation checklist

- [x] Add review table, RLS, append-only grants, review-version constraint and general locked-capability helper.
- [x] Add the review command/route and bind assignment and supervisor handoff to the review sequence.
- [x] Add the detail projection and separate responsive review/assignment cards.
- [x] Verify grant denial/revocation, stale/replay/conflict, review-before-assignment, site isolation, qualification, and handoff linkage with PostgreSQL/API evidence.
- [x] Exercise the authorized Operations review and team-lead assignment forms through the real browser/API path in a disposable database.
- [x] Update requirements/tasks and verification evidence; keep REV-034 and production authority configuration open.

### Current implementation evidence (updated 9 November 2026)

Migration 025, the operations-review endpoint, the append-only command and authority snapshot, assignment/review binding, supervisor-handoff linkage, the detail projection, and separate UI cards are implemented. The API integration suite passes review grant denial and revocation locking, stale versions, changed-payload replay conflict, review idempotency, cross-site denial, assignment links, qualifications and fresh-review requirements during replacement assignments. The local browser smoke confirms the blocked review/assignment UI, sidebar visibility, confirmation toast and core staff workflow. A separate disposable PostgreSQL and Chromium run exercises the authorized Operations review and qualified lead assignment forms, then the assigned lead's saved work plan and plan-bound supervisor handoff; it also forces a stale-version conflict and verifies the entered rationale is kept and succeeds after refresh. See [work-plan browser UI verification](../verification/checks/work-plan-browser-ui-2026-11-09.md). It uses test-mode password sessions and synthetic identities, not Keycloak/OIDC, production grants, UAT or physical devices. REV-034 remains pending; no production review grants are configured. This does not implement G3, G4 or complete USER-027.
