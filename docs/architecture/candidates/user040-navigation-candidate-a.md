# Candidate A: Today-first staff navigation

**Status:** Navigation candidate for USER-040; not selected and not an authorization change. Grounded in [USER-040 navigation grounding](user040-navigation-grounding.md) and the [service journey](../service-journey.md). Preserve the current Raymond Gray visual direction.

## Proposal

Give staff one predictable first screen: **Today**. Keep four primary destinations for staff who have those permissions: **Today**, **Requests**, **Jobs**, and **Vehicles**. Keep people, role setup, staff messages, documents, reports and account administration in a clearly separated **More** area, filtered by role. The label **Jobs** remains subject to REV-039; the current route and formal record name remain **Work orders** until that wording decision is resolved.

Today is a set of links and summaries over the existing role-scoped sources. It is not a new all-purpose queue or a second business record. Each card retains the source's access, audit, loading and error behavior. A failed source stays visibly failed; it must not look like a zero count or an empty day.

## Navigation and URL compatibility

| Destination | Current route to keep | Candidate label and use |
| --- | --- | --- |
| Today | New `/sites/:siteId/today` | Role-aware start screen with quick actions and separate source cards. |
| Requests | `/sites/:siteId/requests` | New enquiries, follow-up and callback queue. |
| Jobs | `/sites/:siteId/work-orders` and `/sites/:siteId/work-orders/:orderId` | Workshop queue and the controlling job record for a visit. |
| Vehicles | `/sites/:siteId/sales-deliveries` | Sales deliveries and the vehicle's available delivery/PDI/service history. Keep the existing route while the page grows into the vehicle-history destination. |
| Team | `/sites/:siteId/staff`, `/sites/:siteId/messages` | People and roles; Head-sent staff messages. |
| Reference | `/sites/:siteId/documents` | Effective site documents available to the current workspace role. |
| Staff accounts | `/sites/:siteId/staff/accounts` | VMMS Operator account requests only. |
| Existing reports | `/sites/:siteId/overview`, `/sites/:siteId/work-orders/:orderId/print`, `/sites/:siteId/overview/print` | Head overview and current purpose-built print views. Show these from Today or More according to role; do not rename their routes. |

Add the Today route and change only the default workspace landing and navigation links. Keep every route above, including deep links, print links, request-to-reception links and site-scoped parameters. Keep direct URL authorization in the API; hiding a navigation link is only a usability choice. A user with multiple role placements receives the union of allowed destinations, while each action remains checked by the server.

An Operator-only account is the exception to workshop navigation: its Today page contains account-administration work and a link to Staff accounts, with no Requests, Jobs or Vehicles. Keep its existing default destination `/staff/accounts` or route it through Today with the account queue clearly available. It must never land in operational work or inherit a work function. A mixed Operator/work role sees the work destinations allowed by its work roles and Staff accounts as a separate secondary destination.

## Today content and quick actions

Build each card from an existing, role-authorized page or read projection. Keep cards separate by source so a future merged view cannot imply that records have the same owner, permissions, due rules or workflow state.

- **Requests to follow up:** show the existing callback queue states and link to Requests. A “New request” action links to the current request form only for users who can create requests.
- **Jobs needing attention:** link to the current work-order queue or a specific work order when the existing authorized projection identifies one. Do not invent a universal “next action” field.
- **My assigned tasks:** show the Technician's existing assigned-task list and link to that task/job. A task assignment is coordination; it is not permission to start, diagnose or repair.
- **Team review:** show the Head overview or allowed Operations review path. Head oversight and role assignment do not imply technical, inspection, release or financial authority.
- **Deliveries and vehicles:** show available sales-delivery activity and link to Vehicles. Do not make an imported staging row look like an operational vehicle or delivery.

Quick actions should be few and conditional: **New request**, **Register a visit**, **Open my tasks**, **Record a delivery**, **Review team overview**, or **Manage staff accounts**, only when the existing role and API permit the destination. Today cards are links to those flows, not new mutations or approval shortcuts.

## Example journeys

### Head of Service Centre

Signs in to Today and sees the current Head overview, role-authorized Operations reviews, requests requiring contact, and links to open jobs. Chooses **Review team overview** to reach `/overview`, or a specific review link to `/work-orders/:orderId`. Uses **Requests** to review a concern and **More → Team** for `/staff` and `/messages`. Account provisioning stays separate: the Head is not shown the Operator's Staff accounts controls unless they also hold the Operator placement; neither role grants technical or financial approval.

### Service Advisor

Signs in to Today and sees callback items from the existing request queue plus authorized job links. Chooses **New request** or opens `/requests` to record or follow up on a call. When the client, vehicle and visit are confirmed, uses **Register a visit** to continue through the existing request-to-reception route. For a vehicle that has arrived without a request, uses the existing intake route. Invoice, settlement and delivery actions are not offered as complete until their authorized workflows exist.

### Team Lead

Signs in to Today and opens assigned jobs from `/work-orders`. In the job, reviews Operations assignment, prepares the current work-plan draft and hands it to an eligible Supervisor using the existing job context. Today may show the job as awaiting a saved plan or handoff only if the current job projection provides that state. It must not offer G4 release until policy, grants and the REV-046 sequence are approved and implemented.

### Supervisor

Signs in to Today and opens jobs with an active handoff. Uses the current job page to allocate handed-off plan tasks to direct reports and review their task activity. The candidate shows the same job link and exact current status; it does not present the activity feed as a technical completion or G3 sign-off. If a required procedure or policy is unavailable, show its actual block reason and leave the transition unavailable.

### Technician / Engineer

Signs in to Today and chooses **Open my tasks**, which goes to `/my-tasks`. Opens the assigned task in its job context to acknowledge and record supported progress, blockers or requests. The task page and Today card repeat that assignment does not authorize repair. No start, repair or completion control is implied by the Today summary.

### Sales-only staff

Signs in to Today and sees delivery/vehicle actions and customer requests that the current Sales role is allowed to create or read. Chooses **Record a delivery** to reach `/sales-deliveries`; chooses **New request** to use the current Requests flow if authorized. Does not see workshop Jobs or Team controls unless another active role permits them. A purchaser-at-delivery remains a historical claim, never an inferred current owner or service payer.

### Operator-only account

Signs in to an account-focused Today state. The only operational card is the account-request queue and a **Manage staff accounts** link to `/staff/accounts`; Documents remains available only if the current account-only access permits it. No customer request, vehicle, workshop job, Head overview or team assignment appears. Existing server denials remain authoritative even if a URL is typed directly.

## Job screen information contract

Today should route users into the existing work-order detail screen, where the job remains the controlling record. Candidate A keeps the current owner and activity close to the job title, but distinguishes sourced facts from derived guidance:

- **Current owner:** show the assigned Team Lead, Supervisor, or task assignee returned by the current scoped projection; show “Not assigned” when that is the persisted state. Do not infer a manager from the reporting organogram.
- **Next allowed action:** show only an action currently exposed by a configured, role-checked workflow. If the server has no accepted next-action result, show the known current state and a link to the relevant section; do not guess a next action from the role label.
- **Due:** show a date only when the source record contains one, such as a request callback. Do not invent job due dates or treat missing dates as overdue.
- **Evidence:** show attached evidence and known procedure/evidence requirements. If approved policy is absent, state the actual policy block and keep the related operation unavailable; do not suggest that an empty list means no evidence is required.
- **Block reason:** surface the known gate, missing assignment, missing plan, hold or policy-unavailable response in plain language, with the server-provided action guidance where available. Do not hide a failed read as an empty panel.

The current detail projection has work-order stage, gate, evidence, assignment and hold data plus its workflow sections. It does not have an accepted generic job `nextAction` or due-time policy. The Today design must preserve that limit. G2 repair authorization, G3 supervisor completion, G4 Team Lead release/collection-zone movement, REV-046 inspection order, G5 settlement and physical departure remain deferred until policy and authority are approved and implemented.

## Current behavior and deferred behavior

**Current and reusable:** `/overview`, work-order queue/detail and print, request/callback queue and reception conversion, Technician task queue, sales-delivery/PDI records and vehicle history, Operations review/lead assignment, work-plan draft and Supervisor handoff/allocation/activity, team/role pages, Head messages, staff documents and Operator staff-account requests. Their APIs and page-specific access checks remain the source of truth.

**Not yet supplied by this candidate:** a Today screen; a unified cross-domain queue; job-level due-date policy; generic next-action engine; G2/G3/G4 sign-off; the Head inspection/release ordering; invoicing, payment/guarantee, collection/delivery; an approved report catalog; promotion of historical sales or maintenance staging rows. Do not place dummy metrics, synthetic “next steps,” or buttons for deferred commands on Today.

## Responsive and accessibility requirements

- Keep the independently scrollable navigation and content columns on desktop. Ensure the sign-out action remains visible and keyboard reachable when the viewport narrows.
- At phone, tablet, fold and desktop widths, let the primary navigation wrap or collapse into a labelled control without hiding destinations, clipping names, or changing their order unpredictably. Reflow Today cards to one column on narrow screens; no horizontal scrolling for ordinary content.
- Keep a visible text label with every icon. Use semantic landmarks and headings, `aria-current="page"`, keyboard-operable links, clear focus indicators, sufficient contrast, announced loading/failure/empty states and reduced-motion behavior.
- Do not use color alone for urgency, active state or permission. Counts must have accessible text labels, not be the only description.
- Verify at 320, 390, 768, 1024 and desktop widths; keyboard only, 200% zoom, screen-reader landmarks/forms, session expiry, site switching, and loading/error/empty states for each Today source.

## Rejected alternatives

- **Keep the flat role-coded sidebar and just add Today:** rejected because this adds another item without separating everyday work from team administration and reference documents.
- **Make Today a decorative KPI dashboard:** rejected because it does not lead to work and risks suggesting unsupported totals or completion states.
- **Merge requests, jobs, tasks and deliveries into one client-side queue:** rejected because the sources have distinct scopes, permissions, audit trails and state meanings. It can duplicate a request and its linked job or disclose an inaccessible item.
- **Route every staff account to Jobs:** rejected because Sales-only and Operator-only accounts have no safe operational job path, and the Operator must remain separate from workshop authority.
- **Generate a universal next-action engine from role names:** rejected because role labels do not grant authority, the job API has no accepted generic next-action/due policy, and unresolved safety/commercial sequences must remain fail-closed.
- **Rename or remove existing route paths:** rejected because it would break saved links, print views, callback-to-reception links and external deep links without adding user value.

## Design score

Scoring follows the six USER-040 rubric items. Each item is 0 (fails), 1 (partial) or 2 (meets). This is a candidate score, not verification evidence.

| Rubric item | Score | Reason |
| --- | ---: | --- |
| Four-part mental model without hiding daily work | 2 | Today, Requests, Jobs and Vehicles form the short primary path; role quick actions reduce steps. |
| No duplicate records or invented cross-domain authority | 2 | Today links to separately authorized source pages and does not create a second queue record. |
| All role combinations, Sales-only, Operator-only and site switching | 2 | Examples cover role unions, restricted single-role accounts, existing routes and site-aware scope. |
| Owner/next/due/block visible without inventing policy | 1 | Known state and blockers can be surfaced now, but generic job due and next-action policies are not implemented. |
| Brand, responsive layout, keyboard, zoom and screen readers | 2 | Uses the approved visual direction and states measurable responsive/accessibility checks. |
| Incremental change with route compatibility and evidence | 2 | Adds one landing route while preserving current page and deep-link paths. |
| **Total** | **11 / 12** | Strong navigation fit; Today content and the generic job information contract still need implementation evidence. |

## Rationale and limits

Candidate A makes the main places to work predictable while reusing the pages and access boundaries already in place. Its biggest limitation is that Today cannot yet promise one complete “what should I do next?” answer: some data and authorization policy are absent. Keep unknowns explicit, implement Today as linked source cards first, and add deeper guidance only after the workflow provides an approved, server-derived next action. Do not rename formal records, introduce a new visual direction, or enable deferred sign-off/commercial actions as part of this navigation change.
