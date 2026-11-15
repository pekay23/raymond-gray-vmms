# USER-040 navigation candidate B: role workbench with contextual records

Status: design candidate for review. This document proposes a navigation hierarchy only. It does not change routes, permissions, record ownership, workflow policy, or the approved Raymond Gray visual direction.

## Design in one sentence

Open each site at a role-aware **Today workbench**, keep **Requests**, **Jobs**, and **Vehicles** as distinct record destinations, and reveal team, reference, reporting, and account tools in a role-filtered **More** area.

This is structurally different from a flat four-link bar: Today is the default work surface, while the other three destinations are context-first record spaces. It is also different from a universal dashboard because each role sees only work already available through its existing authorized projections.

## Proposed shell

```text
┌ Raymond Gray ── Site switcher ─────────────── account / sign out ┐
│ Today | Requests | Jobs | Vehicles | More                         │
├───────────────────────────────────────────────────────────────────┤
│ Today: role-specific workbench                                    │
│   compact next-work groups → open the relevant request or job      │
│   explicit empty / blocked / unknown states                       │
└───────────────────────────────────────────────────────────────────┘
```

- **Today** is the staff landing route. It is a set of concise links and summaries assembled from existing role-authorized pages or projections; it does not own or copy records.
- **Requests** opens the existing service request and callback queue. A request can link to a job but remains a different record.
- **Work orders** opens the existing work-order queue and timeline. “Jobs” remains the recommended shorter staff label pending `REV-039`; the formal record remains a work order.
- **Vehicles** opens sales/delivery and PDI history where the existing role allows it. Service history remains subject to the existing site and role boundary. Do not imply that a purchaser is a verified current owner or payer.
- **More** is a progressive disclosure menu/page. It lists only authorized destinations: Team, Documents, Reports, Messages, Account administration, and other existing specialist areas. Items stay on their current routes.

The site switcher remains available in the shell. A user with multiple roles sees the union of authorized navigation destinations, while Today sections are labeled with their role context. The user is not silently switched into a more privileged persona.

Derive the shell links and landing destination from the selected site's actual available role capabilities. Do not use the first site's roles to decide a different site's route, and do not show workshop job/intake actions solely because a user has any non-Operator role. Sales request actions are shown only when the current service-request permission allows them; server checks remain authoritative.

## Role journeys

| Role | Today workbench | Context destinations and secondary tools | Current behavior preserved |
|---|---|---|---|
| **Head of Service Centre** | Overview and existing site-level work visibility; links to work that needs review only when the source projection identifies it. | Requests, Jobs, Vehicles; More contains People and roles, Staff messages, Documents, and any existing reports. | Head overview remains at `/sites/:siteId/overview`; staff roles and messages stay Head-only. Being Head does not grant Operator account duties or signed technical, inspection, release, or financial grants. |
| **Service Advisor** | Requests needing contact or a callback when the request projection provides that state; links into a specific request. Existing job work remains available through Jobs. | Requests, Jobs, Vehicles; More includes Documents if available. Intake remains reachable from its existing route and current write rule. | Existing Requests and Work Orders stay distinct. Customer update, invoice review, payment, collection, and delivery actions described in the service journey remain deferred until their approved workflow and grants exist. |
| **EV/ICE Team Lead** | Assigned or reviewable jobs only where existing job data makes the assignment/status explicit. | Jobs and Requests; More may include Documents and Team/plan actions already available to the role. | Operations review, qualified lead assignment, planning, and handoff remain in job context. No generic next-action engine or due-time policy is implied. |
| **Supervisor** | Current handed-off work and direct-report activity only where existing assignment data says so. | Jobs; Requests only if the current role permits it; More contains Documents and authorized Team tools. | Task allocation and activity remain attached to the relevant job. Technical completion sign-off is still deferred; assignment or progress is not approval to perform work or sign off. |
| **Technician / Engineer / Trainee** | Their current assigned-task list and recorded updates, using the existing assigned-task projection. | Jobs for the owning job timeline; More includes approved documents. | `/my-tasks` remains the task destination. A task update is progress only and does not authorize work, repair, completion, or release. |
| **Sales-only** | Delivery/PDI items only if the current sales projection provides them; otherwise a plain link to Sales and deliveries with an accurate empty state. | Vehicles is the natural context destination; More contains only authorized sales references. No Requests or Jobs links are shown unless independently authorized by an additional role. | Sales-only users continue to land on `/sales-deliveries`. Delivery/PDI history routes remain role-authorized; the workbench does not create service access. |
| **Operator-only** | A small account-administration landing panel, not workshop Today. It may summarize account requests already visible on the account page. | More contains Staff accounts and any permitted Documents route. No Requests, Jobs, Vehicles, Team, or service overview links. | Account-only redirects to `/staff/accounts`; Operator remains separate from Head and cannot acquire service-work access through navigation. |

For a person with multiple active placements, render each currently authorized area once. Avoid duplicating a job because the same person is both Head and Team Lead. The section heading may name the role lens; the record itself keeps one canonical identity.

## Current behavior and proposed behavior

| Area | Exists now | Candidate B proposes | Deferred / not claimed |
|---|---|---|---|
| Shell and routes | Site-scoped routes exist for overview, work orders, requests, assigned tasks, intake, staff, accounts, messages, documents, sales/deliveries, and print/detail pages. | Reorder destinations and add a workbench presentation while preserving route paths and route-level guards. | No route is considered available to a role merely because a navigation link is hidden or shown. API authorization remains authoritative. |
| Starting destination | Workshop roles generally open Work Orders; sales-only opens Sales and deliveries; account-only Operator opens Staff accounts. | Start work roles at Today. Keep Operator-only account landing and Sales-only sales context unless the role also has workshop placement. | A Today workbench is new UI. No claim that a unified Today API already exists. |
| Requests | Service request and callback queue has its own records, filters, actions, history, and permissions. | Show small, clearly linked request groups in Today only if the existing queue data can supply them without new policy. Requests remains the full queue. | Do not convert requests into jobs or display a second actionable copy. New aggregate endpoint or callback prioritization policy needs separate design. |
| Jobs | Work order queue and detail support operations review, assignment, planning, handoff, activity, holds, evidence, and current gate data. | Link to the existing work-order queue/detail; keep task updates and handoffs in the job. | Do not invent ordering under `REV-046`, a generic `nextAction`, due dates, approval state, completion, release, or payment state. |
| Vehicles | Sales/delivery and PDI observation entry/history exists for authorized roles. | Use Vehicles as the context-first entry point for one vehicle history, with provenance visible and links to records the user can read. | Cross-role service history exposure, backlog imports, broad vehicle search, and purchaser-to-owner/payer inference remain subject to their existing requirements and review decisions. |
| Team / reference / admin | Workforce, documents, messages, and account pages exist behind current role rules. | Move these to More without changing access; active pages keep their existing URLs. | No new reporting or management capability is implied by adding a navigation category. |
| Next-action summary | Some requests store `nextAction` and callback due time; work-order detail has gates, evidence, assignment and hold data. | Present only explicit stored action, owner, due time, or gate reason where that page already exposes it. | Generic prioritization, derived work ownership, inferred deadlines, and inferred permission remain unbuilt. |

### Known and unknown next-action rules

Today may say **“Call back today”** only when an authorized request projection contains a due time that falls today in the site timezone. It may say **“Overdue callback”** only when the stored callback due time is in the past. It may show a named owner only when an assignment is stored and visible to that user.

For job work, display a next step only when the existing server projection provides a permitted action or an explicit blocker. Until a generic action contract exists, a known gate may be presented as its actual gate label and missing evidence; it must not be turned into an executable button. If no action is stored, say **“No next action recorded.”** If a required status is absent or unclear, say **“Status not recorded”** or **“Ask the assigned lead”** only where the visible assignment identifies that lead. Do not manufacture urgency, responsibility, completion, safety approval, release, or a due date.

An empty Today group is a truthful empty state, not evidence that no work exists in other role-authorized systems. Provide a clear link to the relevant full queue, and label loading, access denied, offline, and failure states separately.

## Access and record boundaries

1. Keep every query scoped to authenticated organisation and selected site. Site switching clears site-specific cached data as it does today.
2. Navigation is discovery only. Keep Fastify route guards, grants, and server-side authorization unchanged; a direct URL remains subject to those checks.
3. Role titles do not substitute for signed technical, inspection, release, governance, or financial grants. Head overview visibility does not authorize every job transition.
4. Do not combine Operator and Head duties. Operator-only receives account administration; Head-only receives Head overview, staff-role review, and staff messages under the existing controls.
5. Keep service client/payer, owner, visit contact, purchaser-at-delivery, and staff identities separate. Vehicle matching does not merge those identities.
6. A request linked to a job stays a request linked to one canonical job. Today cards deep-link to source records and do not create denormalized actionable clones.
7. Preserve customer-owner access as a separate audience and shell. This candidate concerns staff navigation only.

## Responsive and accessible behavior

- Keep the current approved Raymond Gray palette, logo, typography, and workshop-image baseline. This is a hierarchy change, not a new art direction.
- On desktop, keep navigation independently scrollable from the page. The workbench may use independently scrolling sections only where the current approved layout supports it; do not create a nested-scroll trap.
- On narrow screens, keep the four primary destinations reachable without relying on hover or a desktop-only sidebar. Place More and account/site controls in a labelled, keyboard-operable disclosure or compact navigation row. Keep sign-out visible and reachable when the screen narrows.
- At 320 CSS px, allow labels and card content to wrap; avoid clipped controls and horizontal overflow. Do not collapse labels to icon-only navigation without accessible names and visible focus.
- Preserve skip-to-content, landmark labels, logical heading order, focus visibility, keyboard operation, zoom/reflow, and screen-reader announcements for loading, empty, error, and changed result states.
- Use concise labels and avoid internal workflow jargon. Keep status color supplementary to text and icons; do not rely on color alone.

## Incremental introduction

1. Add a Today route as a shallow, role-aware composition that initially links to existing pages. Preserve every current deep link and queue.
2. Set work-role landing behavior to Today; retain the special Sales-only and Operator-only landings until their Today views can show a truthful role-specific workbench.
3. Reorganize existing sidebar links into Today / Requests / Jobs / Vehicles and More; preserve direct URLs and existing route guards.
4. Build Today sections from existing projections one role at a time. First use the Technician assigned-task source and existing requests/job sources; do not add a combined API until its data contract and audit/access semantics are designed.
5. Add a candidate-specific role and route matrix, then verify multi-role/site switching, no-access direct URLs, 320px through desktop, keyboard access, zoom, and screen-reader output before broad rollout.

Each slice requires evidence before it is marked complete. A polished shell or passing build alone does not prove that role workflows, server access, or the full service journey are complete.

## Rejected alternatives

- **One expanded sidebar containing every link:** rejected because it keeps the current mixed hierarchy, consumes narrow-screen space, and makes daily destinations compete equally with infrequent administration.
- **One mega-dashboard replacing Requests, Jobs, and Vehicles:** rejected because it duplicates domain records, obscures their distinct lifecycles, and risks inventing cross-domain access and status ordering.
- **A role-specific portal with separate navigation per title:** rejected because users with combined roles would need to switch workspaces, hide useful shared context, and risk treating a title as authority.
- **A universal “My work” task list for every role:** rejected because Head, Advisor, Sales, and Operator work is not necessarily a task assignment, and the current system has no generic task/next-action contract for them.
- **Make “More” a permanent unlabeled icon strip:** rejected because it weakens discoverability and keyboard/screen-reader clarity. More must have a visible, concise label and disclose its contents.

## Candidate B rubric score

Scores use the grounding document's rubric: 0 fails, 1 partial, 2 meets.

| Criterion | Score | Rationale |
|---|---:|---|
| Four-part mental model without making daily work harder to find | 2 | Today is the landing workbench; Requests, Jobs, and Vehicles remain direct primary destinations. |
| No duplicate records or invented cross-domain authorization | 2 | Today links to domain records and only consumes role-authorized projections; requests and jobs remain separate. |
| All role combinations, Sales-only, Operator-only, and site switching without dead ends | 2 | Role-aware sections and special-purpose landings preserve distinct account/sales paths, subject to implementation of Today. |
| Owner, next step, due, evidence, and block visibility without inventing policy | 1 | The rules are explicit and safe, but generic job next-action evidence is not currently available; Today would initially be incomplete. |
| Brand baseline, 320px through desktop, keyboard, zoom, screen readers | 2 | Uses approved shell direction and specifies responsive and accessible behavior; it still needs implementation verification. |
| Incremental delivery with route compatibility and evidence | 2 | The route-first phased plan preserves URLs and lets Today start as a composition of current views. |
| **Total** | **11 / 12** | Strong structure; next-action visibility remains partial until the underlying projection contract is approved and built. |

## Decision still needed

Compare Candidate B with Candidate A using the same six-point rubric. Select a candidate (or graft ideas from both), then record the decision and implementation slice in the review register before changing application navigation.
