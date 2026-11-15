# USER-040 navigation redesign: grounding and review log

Status: design and implementation in progress. This change reorganizes the approved baseline navigation and does not introduce a new artistic direction.

## Aim and acceptance

Reduce the number of places staff must look to understand their daily work. The approved mental model is **Today, Requests, Jobs and Vehicles/history**. Team, documents/SOPs, reports and account administration remain in role-aware secondary navigation. A job must make its current owner, next allowed action, due time, evidence needed and exact block reason easy to find. Task updates and handoffs stay in job context. Keep the current Raymond Gray visual direction and validate responsive/accessibility behavior.

`Jobs` is the recommended staff label but still awaits global wording approval under REV-039; do not apply a global rename until that review is resolved. This design can reorganize destinations without changing current formal record names.

## Current system traced

- `apps/web/src/workspace.tsx` owns site selection, route entry and the shared desktop/mobile shell. `StaffWorkspace` currently sends most work roles directly to `/work-orders`; sales-only goes to `/sales-deliveries`; account-only Operator goes to `/staff/accounts`.
- `Workspace` constructs a flat list from role codes: Head overview, Work orders, Requests and callbacks, My assigned tasks, Sales and deliveries, Documents, New intake, People and roles, Staff messages, and Staff accounts. This mixes daily work with administration and reference links.
- React Router routes are site-scoped under `/sites/:siteId`. Queue/detail pages fetch their own API data. The browser's role checks control visibility only; Fastify session/site/grant checks remain the security boundary.
- Available daily work sources include the service request queue, work-order queue, personalized Technician task queue, Sales/delivery records and Head overview. These are separate domain projections with separate access rules and audit behavior; do not create a cross-domain client-side object that impersonates a unified server queue.
- Work-order detail keeps related service requests, operations review/lead assignment, team plan/handoff, Supervisor task allocation and task activity in the work-order context. The detail projection has gate, evidence, assignment and hold data, but no accepted generic `nextAction` or due-time policy. A screen may explain known blockers and link to the next configured section; it must not invent a transition.
- Sales-only staff, Operators, combined-role staff and multi-site staff need explicit routes and a stable site-switch path. An Operator-only account must stay in account administration; a Head remains distinct from Operator account duties.
- Service Request and Work Order are different records. A request can be linked to a job, but the job remains the controlling workshop record and cannot be shown as two actionable jobs.

## Constraints

1. Preserve all route-level server authorization and tenant/site scoping; hiding a link does not authorize access.
2. Keep the approved visual direction and logo/image baseline. Navigation hierarchy, label clarity and information density may change within that direction.
3. Do not encode unresolved state ordering under REV-046 or unsupported safety/commercial actions.
4. Keep independently scrollable sidebar and content columns; retain the compact navigation and sign-out behavior already verified.
5. Keep work, administration, reference and customer-owner access separate by audience and role.
6. A Today landing screen is not complete if it is only decorative. Every card must lead to an existing, role-authorized action or clearly report that no action is available.

## Design review rubric

Score each alternative 0–2 (0 fails, 1 partial, 2 meets):

1. Gives staff the four-part mental model without making daily tasks harder to find.
2. Avoids duplicate job/request records and does not invent cross-domain authorization.
3. Handles all role combinations, sales-only, Operator-only and site switching without dead ends.
4. Makes owner/next step/due/block information visible while respecting unknown policy and unapproved SOPs.
5. Preserves current brand direction and supports 320px through desktop, keyboard, zoom and screen readers.
6. Can be introduced incrementally with route compatibility and evidence per slice.

## Phase checklist

- [x] Ground current route, role and queue boundaries.
- [x] Sketch at least two structurally distinct navigation designs.
- [x] Cross-judge candidates against the rubric.
- [x] Select a design and record the rationale.
- [x] Graft useful ideas; record rejected alternatives.
- [ ] Implement the smallest user-visible slice and update the task graph.
- [ ] Verify role paths, routes, responsive layout, keyboard and accessibility.
- [ ] Reconcile requirement, task and review-register statuses against evidence.
