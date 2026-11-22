# After-sales reference audit

**Status:** read-only source review; operational validation remains pending.

## Scope and limits

Reviewed `C:\Projects\after-sales` as a reference implementation for pages, forms, data organization, and workflow. This review inspected source and supplied form images only. It did not run the app, access its database, inspect live customer records, or establish management approval. No source files in that project were changed. Handwritten customer, vehicle, and staff values in form images are intentionally not reproduced here.

## Product shape

The project is a Next.js App Router application backed by Supabase. Its navigation covers Dashboard, PDI, Repairs, Maintenance, After-Sale Issues, Vehicles, Clients, Service Requests, and Admin. Desktop uses a side navigation and mobile uses a bottom navigation. PDI, repair, maintenance, and issue logs share list, filtering, detail, and edit patterns. Vehicle detail presents a service history timeline. Forms can look up a vehicle by chassis and offer a create-vehicle path when no match is found. PDI and service request flows support evidence uploads. The project includes filtered Excel export affordances.

These are source-level findings, not claims that each page or export was exercised successfully at runtime.

## PDI form reviewed

The two supplied PDI form pages show model, registration/chassis, location, inspection date, and a structured checklist. The checklist groups cover exterior, interior, EV electrical, and mechanical/safety items. The second page includes body-damage views, comments, and Technical Lead/PDI Officer name, signature, and pass/fail clearance fields. The inspected seed checklist contains 22 items. A build guide elsewhere describes progress as “18 of 24,” so the reference materials disagree on the checklist count; VMMS must derive counts from the current approved form revision rather than hard-code either value.

The React checklist component has per-item checks and notes, section grouping, progress, and a hidden serialized form value. The PDI form also models chassis, inspection, body condition, scans, and clearance. The inspected flow permits Passed with unchecked items if a comment is entered, and a database trigger derives Completed from Passed and marks the vehicle Sold. Treat these as legacy behavior to review, not as safe VMMS policy.

## Data and authority boundaries observed

The reference schema keeps vehicles and PDI/repair/maintenance/issue logs in separate tables, with chassis as a global vehicle key and client name on vehicle/log records. Its database policies describe only Admin and Staff roles, with broad read/add/edit access for active staff and delete access for admins. The PDI form’s typed names and signatures do not provide independent, signed, scoped authority grants. The reviewed repair/maintenance statuses are generic completion labels.

These boundaries conflict with VMMS requirements for organisation/site scoping, separate payer/client, vehicle owner and visit contact, action-time grants, decision snapshots, independent inspection, and the G1–G5 command gates. A reference PDI Passed value cannot satisfy a VMMS gate or authorize release, payment, or vehicle collection.

## Patterns VMMS can adapt

- Chassis/VIN-first lookup with an explicit human review step.
- One canonical vehicle record with an attributable service history timeline.
- Checklists embedded in the relevant form, with per-item notes and revision-derived progress.
- A damage diagram with comments and linked evidence.
- Navigation shaped around staff work areas and adapted to narrow screens.
- Domain-specific filtered exports and reports.

## Patterns VMMS must replace or constrain

- Scope every record and query to the authenticated organisation and site; chassis identity is not a substitute for tenant scope.
- Keep payer/client, vehicle owner, and visit contact distinct.
- Route each new job through Operations review, a qualified lead assignment, supervisor execution and completion, lead release, and advisor collection/payment coordination.
- Enforce signed role grants and independent inspection on the server. Typed names, signatures, generic “Fixed/Done,” or PDI Passed status do not establish authority.
- Keep safety holds, G1–G5, payer terms, warranties, and release policy fail-closed until approved policy and evidence exist.
- Do not copy the reference Sold trigger or allow an incomplete checklist to pass a safety gate through a free-text comment.

## Pending evidence

The owner will provide the current SOP documents and any later workbook/source files. After receipt, document control must inventory revision, approval, effective date, applicable vehicle/work scope, responsible authority, and mapped VMMS validation. Until then, the mapping in [SOP validation mapping](../architecture/sop-validation-mapping.md) is a design aid only; no reference-project checklist is an approved procedure.

## Monitoring note — 18 November 2026

The latest checkout at `C:\Projects\after-sales` contains uncommitted work for a technician workspace, proposed technician updates, assignment/review actions, a Supabase migration, and a service-request call intake guide. This is a source snapshot only: the app and database were not run, the migration was not applied, and the checkout had no clean release evidence at review time.

- The technician plan proposes assigned-job views and staff-reviewed proposals with stale-revision protection. VMMS can use the proposal/review pattern, but must keep its own org/site scope, current assignment, qualification, action grant, audit and idempotency controls.
- The technician workspace now includes a “My Workshop” dashboard, editable assignment controls, technician-proposed updates, and staff approve/return review actions. The additive migration defines assigned-technician row-level policies and an optimistic revision check before staff approval. The dashboard itself still queries up to 100 recent rows without an explicit assignment filter, so correctness depends on the migration's RLS actually being applied. The plan explicitly says the migration was not applied and requires a staging database, role-scoped access tests, stale-proposal tests, and deployment of the matching app revision. Treat this as a useful proposal/review pattern, not verified behavior or a VMMS authority model.
- The service-request call guide emphasizes safety-first questions, authored wording, truthful distinctions between unknown/not asked/customer-reported/confirmed, and separating a preferred visit window from a booked appointment. These are useful UX rules, but any technical safety text still needs the approved site/OEM source.
- The PDI plan suggests extra EV checks, but those are proposals, not vehicle-specific OEM procedures. Do not seed them as approved VMMS inspection steps without exact applicability, source, competence, equipment and acceptance criteria.

CodeGraph was used to inspect the current technician dashboard and action call paths. No customer records, credentials, database contents, or live services were accessed. Recheck this repository and its task guide before each substantial VMMS pilot checkpoint; do not copy its unmerged or unverified code.

### Monitoring update — 18 November 2026

The reference checkout now also has changes through commit `cb9e004` (“Support technician access to vehicle library”) plus a larger uncommitted technician-workspace change set. The uncommitted additions include technician route layouts, role-aware pages, assignment controls, proposed updates, staff review actions, and `supabase/migrations/20261117001900_technician_workspace.sql`.

The migration introduces an explicit `Technician` role and assigned-job row-level policies for PDI, maintenance and after-sale issues. Technician submissions are stored as proposals and staff approval checks a job revision before applying an allowed patch. The dashboard query itself does not filter `assigned_technician`; it relies on that migration’s row-level policy. CodeGraph did not identify tests for the new dashboard or action functions. The migration remains uncommitted and was not applied or runtime-tested in this read-only review.

Useful VMMS design reference: a worker can submit a proposed update against the revision they read, and an authorized reviewer can approve or return it after detecting stale changes. Do not copy this role or authorization boundary as-is. In VMMS, distinguish technician updates from Supervisor completion, team-lead release, independent inspection, Head oversight, site scope, authority grants, audit, evidence requirements and command idempotency. The After-Sales approval RPC currently uses its broad Admin/Staff classification; it is not evidence that the VMMS role chain is equivalent or safe to map directly.

### Monitoring update — technician-workspace source recheck, 18 November 2026

CodeGraph was rerun against the current checkout before inspecting the changed technician paths. The present snapshot confirms the dashboard aggregates recent PDI, maintenance and issue rows, while the technician action module submits bounded update proposals, asks a database RPC to approve or return them, and lets staff assign technician IDs. No test symbols were found in the inspected call paths. The page/action source and migration remain uncommitted; this review did not run the application, execute the migration, or test Supabase row-level policies. In particular, the dashboard query requests recent job rows and depends on database policies for technician visibility; the assignment action checks the selected profile is an active Technician but is not evidence of VMMS-style action grants, site scope, audit snapshots, or command idempotency.

VMMS may reuse the user-facing idea of a worker proposal that a supervisor reviews against a revision. Preserve the stricter VMMS contract: only current assigned workers can append activity against current plan and assignment revisions, and replies never complete work or advance G3/G4. This remains a read-only reference finding, not an approval to copy or deploy the After-Sales implementation.

### Monitoring update — vehicle reference library and current branch, 18 November 2026

The repository now also contains an editable make/model/trim library, vehicle specifications, source links and attributed images, with technician access enabled in the latest commit. Its working tree includes additional uncommitted edits and an unapplied Supabase migration. CodeGraph source review found no tests in the library call paths; hosted access had previously returned 403 in the separate library review. The feature is not verified for deployment.

VMMS already provides a staff vehicle-learning assessment and review flow. The two capabilities have different purposes: keep the VMMS assessment for staff to record sourced observations, hypotheses, unknowns and reviewed learning notes; consider a curated, sourced specification catalogue separately if it improves those exercises. Do not ingest or present specifications as verified without checking source, market, model year and trim. Keep image/media source and access controls explicit. The After-Sales library's Supabase schema, broad staff access and unverified migration are not suitable to copy directly into the VMMS server-owned, site-scoped model.

### Monitoring update — technician workspace recheck, 18 November 2026

The latest read-only review found the technician workspace and migration are still uncommitted and unapplied. CodeGraph traces the dashboard, update form and server actions, but found no tests for the new paths. The database migration adds assigned-technician reads and stores proposals against a job revision; the approval RPC locks both proposal and job, detects stale revisions, and applies approved fields. This is a useful worker-feedback pattern, but it has not been runtime-verified.

The review also confirms boundaries VMMS must keep: After-Sales uses one `Technician` profile role and broad `Admin`/`Staff` approval, while VMMS assigns technicians under a Supervisor and requires distinct Supervisor completion, Team Lead release and Head inspection. Its assignment action is a direct table update after a server role check, not an idempotent command with an authority snapshot. The dashboard's recent-job queries depend on the unapplied RLS migration to filter assigned records. Do not map these permissions into VMMS or claim the After-Sales implementation is deployment-ready. VMMS task activity remains attributable to the current task assignment and does not itself complete work.

#### Migration review follow-up — 18 November 2026

The migration is still uncommitted and unapplied. Direct source review found an additional integrity gap: `technician_job_updates` grants authenticated users `UPDATE`, and the staff policy is `FOR ALL`. An Admin or Staff account can therefore write proposal status/reviewer fields directly instead of going through the stale-revision review RPC. The approval RPC's locking and checks do not protect against that alternate write path. Staff assignment changes also rely on a server action to check that the chosen profile is active and has the Technician role; the table's staff update policy does not enforce that rule itself. No tests were found for the new actions, and this review did not run a database or verify deployed RLS behavior.

VMMS must enforce command-only proposal review, current assignment and authority at the database boundary, and prohibit direct update/delete of immutable activity and review records. Do not copy this migration or treat the proposal/review flow as operationally verified.

### Monitoring update — latest plan and implementation check, 19 November 2026

The After-Sales reference checkout is at `cb9e004` and contains the editable vehicle reference library and technician access changes (the earlier library commit is `a7fb444`). The current worktree still has uncommitted Technician Workspace changes, including its new plan, dashboard, assigned-job routes, proposal/review actions, role-specific layouts/navigation, and migration `20261117001900_technician_workspace.sql`. The plan requires applying the migration to a confirmed staging database, validating assigned-only row-level security and stale-update handling, then deploying app and schema together. It states the migration has not been applied to the intended project. This review did not apply it or execute runtime tests.

The feature adds an actionable technician landing page and a proposal workflow for PDI, maintenance, and issue records. The source tree depends on the migration for assigned-record visibility and still contains the direct-write review gap recorded above. Treat the plan as useful workflow context only; do not call the implementation verified or production-ready until the proposal status fields are writable only through the guarded RPC, assignment constraints are enforced at the database boundary, and staging tests cover role denial, assigned scope, approval, return, and stale conflict behavior.

### Monitoring recheck — 19 November 2026

Rechecked the reference checkout after the review above. It remains on `codex/vehicle-reference-library` at `cb9e004` (18 November); no newer commits or plan documents were present. The same 36-file working-tree change set remains uncommitted. The newest plan remains `docs/plans/technician-workspace.md`; the technician migration is still part of that uncommitted set. No database, app, or staging execution was performed in this recheck.

Priority for VMMS remains the safer equivalent already in progress: server-owned assignments and attributed technician activity under the VMMS order and task model, with reviewer responses explicitly unable to mark completion or advance release gates. Treat After-Sales as a source of workflow ideas only until its database boundary and deployment checks are closed.

#### Monitoring recheck — 19 November 2026, 04:50 UTC

The checkout remains on `codex/vehicle-reference-library` at `cb9e004`, aligned with `origin/codex/vehicle-reference-library`. No newer commit or plan document appeared. The same Technician Workspace plan, uncommitted app changes and unapplied migration remain present. This was a read-only source check; no After-Sales tests, database, deployment or migration were run.

#### Monitoring update — Technician Workspace source review, 19 November 2026

The current checkout still points at `cb9e004`; its worktree contains uncommitted changes to the Technician Workspace plan, dashboard, job update/review actions and migration. The migration still grants `UPDATE` on `technician_job_updates` to all authenticated users and gives Admin/Staff a `FOR ALL` policy. That permits direct edits to proposal status and reviewer fields outside `review_technician_job_update`, despite the RPC's stale-revision lock. It also has no append-only protection for reviewed proposals. Treat this as an open database-boundary defect; don't map the proposal status to VMMS task completion. A safe reference would revoke direct `UPDATE` and make the guarded RPC the only review path, with staging tests proving users cannot bypass it.

The new Technician Workspace is still uncommitted and its plan says the migration has not been applied to the intended project. No test, database, or deployment was run in this recheck. VMMS already has the stronger task-assignment-bound activity, evidence, progress, and separate review records; reuse the After-Sales navigation and queue ideas only, not its role or mutation model.

#### Monitoring recheck — 19 November 2026, 06:09 UTC

No newer After-Sales commit, plan, or source-file modification appeared since the prior 04:50 UTC check. The checkout remains at `cb9e004` on `codex/vehicle-reference-library`; `docs/plans/technician-workspace.md` and the associated technician changes remain uncommitted. The migration still grants authenticated users direct `UPDATE` on `technician_job_updates` and retains the broad Staff review policy, so review status and reviewer fields can bypass the guarded review RPC. It remains unapplied and has no staging/runtime evidence. No tests, database, deployment, or migration were run during this read-only recheck.

#### Monitoring recheck — 19 November 2026, late morning

The After-Sales checkout remains on `codex/vehicle-reference-library` at `cb9e004`, with no newer commit or plan file since the 06:09 UTC check. The same uncommitted Technician Workspace change set is present. Its plan additionally proposes a data-compatible PDI form revision (explicit pass/fail/not-applicable/not-checked outcomes, required reasons, added EV checks) and structured maintenance observations (condition-in, symptoms, diagnostics/DTCs, parts, condition-out, road test and sign-off). These are recommendations for future After-Sales work; the plan says the current migration does not change the PDI checklist, and they are not approved VMMS procedures or implemented After-Sales functionality.

Current source review again confirms the dashboard relies on the unapplied RLS migration for assigned-only visibility, and the migration's direct proposal-update path bypasses its review RPC. The plan itself requires staging role-scope, approval/return, stale-conflict and direct-edit-denial checks before production. No tests, database, staging, or deployment were run in the After-Sales repository. VMMS already has assignment-revision-bound task activity and review records; retain that model and do not import the After-Sales role or checklist assumptions.

#### Monitoring recheck — 19 November 2026, 19:02 UTC

The checkout remains on `codex/vehicle-reference-library` at `cb9e004`. The Technician Workspace plan and migration timestamps remain 18 November; the working tree still contains uncommitted technician dashboard, assignment, proposal-review and role-navigation changes. No newer plan or commit was found during this review. The same uncommitted/unapplied status and direct-update review-path concern remain; this check did not run After-Sales tests or access its database, staging or production services.

#### Monitoring recheck — 19 November 2026, 19:34 UTC

The After-Sales repository remains at `cb9e004` on `codex/vehicle-reference-library`; the technician workspace plan, application paths, and migration remain uncommitted and dated 18 November. No newer plan or commit was found since the 19:02 UTC check. The service-request call-guide plan records an implemented call workspace, saved intake/call history and callback handover, but capacity lookup and booking remain future work; this was not a new change in this recheck.

A closer review of `20261117001900_technician_workspace.sql` confirms the previously noted proposal integrity gap: authenticated users receive direct `UPDATE` on proposal rows, and Admin/Staff use a `FOR ALL` policy, so review status and reviewer fields can bypass the guarded RPC. One additional consistency issue is that the PDI proposal RPC only accepts `remarks`, while its approval RPC also attempts to apply `checklist` and `body_damage`; those branches are unreachable through the supported submission function. The migration remains unapplied according to its plan, and no tests or database execution were run during this recheck.

Use the worker dashboard and proposed-update/review concept as workflow context only. Do not import its role model or bypassable review design into VMMS. VMMS already binds worker activity to the current task assignment and plan revision, preserves reviewer actions separately, and keeps completion/release gates distinct.

#### Monitoring recheck — 19 November 2026, 20:23 UTC

No newer After-Sales commit or plan appeared since 19:34 UTC. The checkout is still at `cb9e004` on `codex/vehicle-reference-library`; `docs/plans/technician-workspace.md`, its dashboard/actions/routes, and `20261117001900_technician_workspace.sql` remain uncommitted. The call-guide plan still describes the existing implemented intake workspace and explicitly leaves capacity lookup and booking as future work.

This recheck confirmed the migration's review bypass remains: authenticated users have direct `UPDATE` on `technician_job_updates`, and the Admin/Staff RLS policy is `FOR ALL`. It also confirmed that the PDI submission RPC accepts only `remarks`, although the review RPC contains branches for `checklist` and `body_damage`; those fields cannot be proposed through the supported submission path. The plan continues to require staging migration and role/scope/conflict verification. I did not run tests, access a database, or deploy the After-Sales project.

For VMMS, retain only the useful assigned-work dashboard and reviewer-queue interaction. Continue using VMMS task assignments, scoped task activity, independent command authorization, and separate completion/release gates; do not copy the After-Sales Technician role or its proposal mutation model. PDI and maintenance checklist ideas remain reference recommendations pending VMMS's own versioned procedures and review rules.
