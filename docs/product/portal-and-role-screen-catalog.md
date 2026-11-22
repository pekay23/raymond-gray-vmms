# VMMS portal and role screen catalogue

**Status:** Product source of truth, first draft, 15 November 2026. This catalogue distinguishes screens that have a route today from screens that are requested or planned. A role label never grants a protected action by itself; the server must enforce the matching site scope, membership, capability and signed authority.

## Portals

| Portal | Audience | Main screens | Current state |
| --- | --- | --- | --- |
| Public sign-in | Staff and approved vehicle owners | Sign-in audience choice, secure shared sign-in handoff, invitation continuation, failed/not-approved states | Implemented. The workshop photo and full-size transparent logo are visible; the sign-in and workspace layouts adapt across phone, foldable, tablet, desktop and zoomed viewports. |
| Staff workspace | All active work-role holders | Today, requests/callbacks, jobs, intake, assigned task work, vehicle history, team/role directory, overview, messages, controlled documents, vehicle learning, finance setup, purpose-built print reports | Partly implemented. Desktop navigation retracts to an icon rail; compact navigation opens as a menu. Screen visibility follows `workspaceCapabilities`; protected commands still require server checks. |
| VMMS Operator | Designated account administrators | Staff account list and account requests; an account overview of pending invitations, active access and account changes; account audit log | Staff account screen is present. The account overview and audit-log viewer are requested and not yet implemented. Keep this portal separate from Head operations. |
| Head of Service Centre | Operational head | Head overview, jobs and queues, work assignment and review, people and reporting lines, staff messages, site activity, reports | Initial read-only, site-scoped work-order activity view is implemented. Broader audit coverage and filters remain open. |
| Vehicle-owner portal | Approved vehicle owners | Shared vehicle list, service history/reports made available to the owner, sign-out and access/help states | Implemented in part. Owners do not enter staff workspace, documents, learning, account administration or internal audit. |

The central identity service at `auth.raymond-gray.org` owns authentication and enrollment. VMMS owns its business screens and local account/site/role records. Sign-in redirects to the shared identity service; it is not a second VMMS portal.

## Screens and access by role

This inventory covers every role level, from the Head and team leads through supervisors, engineers, technicians and trainees, plus the service, sales, finance, records and administrative roles. Screen names below use plain language for staff. “Available now” describes the current route and role-capability wiring, not final security acceptance. Combined roles receive the union of their permitted screens, with each action still independently authorized. A person must not receive additional sign-off authority merely because they hold a more senior-sounding role.

Keep these accountabilities distinct: the VMMS Operator administers accounts; the Head of Service Centre / Operations Admin oversees workshop operations; Finance / Billing / Accountant handles finance screens only when separately authorized; and HR, records or compliance support sees only its assigned information. “Admin” by itself is not a permission profile.

| Role | Screens available now or in the current route model | Requested/planned screen or access boundary |
| --- | --- | --- |
| **VMMS Operator** | Staff accounts; controlled documents; shared sign-in and sign-out | Add Operator overview and account audit log. Account log is read-only and scoped to account/site access lifecycle. No work-role placement changes, technical actions, vehicle release, finance decisions, policy changes or Head-only operational overview. |
| **Head of Service Centre / Operations Admin** | Today; requests/callbacks; jobs and work orders; vehicle history; service-centre overview and print report; people and roles; staff messages; controlled documents; vehicle learning | Add a read-only site operational audit log. Include scoped work review/assignment, progress, inspection, release and financial-event evidence as approved fields. This role cannot create central identities, assign the VMMS Operator role or open Finance setup from its role alone. |
| **EV Team Lead** | Today; requests/callbacks; jobs and work orders; controlled documents; vehicle learning; work-plan and handover controls on assigned jobs | See only assigned/eligible team work and site-scoped records. No Head overview, workforce administration, Operator account administration, Finance setup or final release unless a separate approved grant is present. |
| **ICE Team Lead** | Same workspace screens as EV Team Lead, with ICE job assignment context | Same scope and sign-off limits as EV Team Lead. |
| **Supervisor** | Today; requests/callbacks; jobs and work orders; controlled documents; vehicle learning; assigned task work and technician oversight through the job workflow | Task completion/sign-off applies only where a separate valid technical grant and evidence permit it. Supervisor does not provide final release to service or open Finance setup from the role alone. |
| **Engineer** | Today; requests/callbacks; jobs and work orders; My assigned tasks; controlled documents; vehicle learning | Job/task access must be assignment scoped and limited to current qualifications and grants. Engineers record assigned work, evidence and progress; no whole-job completion, release or Finance setup access follows from this role alone. |
| **Technician** | Today; requests/callbacks; jobs and work orders; My assigned tasks; controlled documents; vehicle learning | Job/task access must be assignment scoped. Technicians record assigned work, evidence and progress; they cannot sign off a whole job as complete or open Finance setup from this role alone. |
| **Trainee Technician** | Today; requests/callbacks; jobs and work orders; My assigned tasks; controlled documents; vehicle learning | Only supervised, assigned learning and work permitted by current qualifications and grants. The trainee cannot self-approve, inspect their own critical work, complete a job, release a vehicle or open Finance setup. |
| **Service Advisor** | Today; requests/callbacks; jobs and work orders; intake where write access is granted; controlled documents; vehicle learning | A dedicated service-history view is not yet available to this role; the combined sales-delivery/history route is not granted to avoid exposing unrelated sales data. Customer contact, invoice preparation, payment confirmation and collection/delivery screens must follow the defined workflow. |
| **Quality Inspector** | Today; requests/callbacks; jobs and work orders; controlled documents; vehicle learning | Inspection screens and inspection decision require a separate inspection grant; do not infer it from this role label. |
| **Parts and Inventory** | Today; requests/callbacks; jobs and work orders; controlled documents; vehicle learning | Inventory screens, stock movements and cost detail are still to be added and separately authorized. |
| **Warranty and Customer Support** | Today; requests/callbacks; jobs and work orders; controlled documents; vehicle learning | Warranty review and customer-contact screens require approved process and data scope; no warranty outcome is inferred from role name. |
| **Finance and Billing / Accountant** | Today; requests/callbacks; controlled documents; vehicle learning; Finance setup route | The initial role code is `finance-billing`; “Accountant” is a plain-language title, not a separate role profile yet. Finance setup is visible only for this role, and protected finance actions still require a current server-side grant. Finance staff cannot open workshop work-order routes from this role alone. Manual payment is the launch method; payment, receipt, reconciliation and finance audit screens remain planned. |
| **Compliance / Records / HR (one combined profile today)** | Today; requests/callbacks; controlled documents; vehicle learning | This is currently the combined `compliance-records-hr` role profile, not three separately enforceable profiles. It cannot open workshop work-order routes from this role alone. Purpose-limited compliance, records and HR screens are not implemented. Split these profiles only with approved duties and scoped access rules. |
| **Sales Representative** | Vehicle sales/delivery history and PDI-related vehicle records; Today and requests where a staff membership is present | Sales/PDI entry screens are a separate workflow under development. No access to workshop-only procedures or client finance beyond the required handoff data. |
| **PDI Observer** | Vehicle sales/delivery history and PDI-related vehicle records; Today and requests where a staff membership is present | PDI checklist and evidence screens are planned. Observation does not equal technician completion or approval. |
| **Approved vehicle owner** | Owner sign-in; own approved vehicles; owner-visible service history/report; sign-out and access/help states | Only explicitly shared owner-safe records. No internal notes, staff assignments, controlled staff documents, learning submissions or audit logs. |

The catalogue reflects the current navigation capability function in `apps/web/src/workspace-navigation.ts` and the route gates in `apps/web/src/workspace.tsx`. Every non-Operator staff role receives Today, Requests and callbacks, and Documents. Finance setup is limited in navigation to `finance-billing`; the API still requires a separate active finance grant before protected finance data or commands are available. Finance and the combined `compliance-records-hr` profile cannot open workshop work-order routes by themselves. The combined HR/records/compliance profile still needs to be split into approved, purpose-limited profiles before operational launch. The Service Advisor's missing service-history view should be added as a dedicated route rather than opening the sales-delivery route.

## Audit-log screens

The owner explicitly requested audit screens for the VMMS Operator and Head of Service Centre.

| Screen | Reader | Scope | Design and safety rules |
| --- | --- | --- | --- |
| Account audit log | VMMS Operator | Account requests, invitation state, identity linking, staff membership and account access changes within the Operator's authorised organisation/site scope | Read-only, newest-first, filter by time, event, actor and person; show who/when/which target/result and a reason where captured. Do not show secrets, invitation tokens, passwords, full session tokens or unnecessary contact information. Audit access to this screen and exports. |
| Service-centre activity | Head of Service Centre | Current build: events in the Head's active site's work-order aggregate ledger | Read-only, site scoped, newest first, keyset paginated. Shows event type, timestamp, actor, aggregate/version and work-order reference only. Excludes reason text, state snapshots and customer details. Each read is audited. Filters, broader event coverage, retention and export rules remain open. |

Neither screen may update or delete audit events. The API must independently authorize every page, filter, record detail and export. Audit views must use stable pagination and preserve event ordering. Add the feature to the implementation tracker; it is not complete because audit events already exist or are written by other screens.

## Shared screen rules

- The sidebar shows only screens allowed for the signed-in account, with a clear active location and plain labels.
- The Operator rail remains separate from operational navigation; a person who has combined roles sees their permitted screens from each role.
- Narrow, foldable and zoomed layouts use a menu that can be opened by keyboard and touch. Desktop navigation can retract to an icon rail, while account controls and sign-out remain reachable.
- Every screen has loading, empty, error, offline and denied states. Denied states explain the next permissible step.
- Print and export actions create purpose-built documents from selected records, with their own filter summary, data labels and pagination. They do not print a screenshot of the live page.
- Audit entries are append-only. Business permission checks are enforced by the API, never only by navigation visibility.

## Open items

- Continue route-level navigation and action-policy checks for every profile and combined-role fixture; current finance-route changes are client navigation evidence only.
- Add a concise account overview for the Operator that summarizes account requests and access state without exposing workshop activity or bypassing site scoping.
- Add the Operator overview and account audit log. Extend Head activity beyond current work-order aggregate events only after event coverage, field redaction, retention and export rules are agreed.
- Add a dedicated Service Advisor history view that excludes unrelated sales-delivery claims.
- Confirm all final job functions and reporting placements in the approved organogram and SOPs.
- Complete responsive, keyboard, screen-reader, browser-zoom and staff acceptance checks for each role, including combined-role accounts.
