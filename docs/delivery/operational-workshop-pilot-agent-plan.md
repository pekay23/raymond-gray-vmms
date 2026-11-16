# Workshop Operations Pilot: Agent Build Plan

**Status:** Owner-prioritized delivery plan, 15 November 2026. This plan changes the order of work, not the full product goal or the authoritative requirements. The master specification, server-side safety rules, accepted architecture and review register remain binding.

## Goal

Build and locally verify the smallest complete, staff-only workflow for the EV Afriq After Sales Service Center, City Galleria. Make the next action clear from service request through repair reporting and the required sign-offs. After the full local release checks pass, deploy the web application, API and required shared-auth changes to their approved production services and verify production health. Keep engineering status, pilot readiness and management approval distinct.

The user wants to prioritize the day-to-day maintenance operation from the Service Advisor and Head of Service Centre through Team Leads, Supervisors and Technicians/Engineers. Work for finance, sales and ideas borrowed from Smart POS should follow later unless a small control is necessary to prevent an unsafe release or unauthorized vehicle departure.

## User-approved operating sequence

1. A staff member records a service request and any requested follow-up. The request keeps the caller, service client/payer, reported owner, visit contact, vehicle, concern and uncertain facts distinct.
2. The Service Advisor confirms missing details and records each call or contact outcome. A confirmed arrival is converted into reception and one controlling work order for the visit.
3. Operations reviews the new work order, then assigns a qualified Team Lead in a separate recorded action.
4. The Team Lead prepares a versioned work plan and hands the planned work to a Supervisor.
5. The Supervisor assigns tasks to their Technicians/Engineers. Each assigned worker acknowledges work, records findings/tests/actions and progress, and raises blockers or requests with comments. These entries are attributed history; they do not themselves approve repair scope or sign technical completion.
6. After required scope, instructions, evidence and authority are configured, the assigned Supervisor records technical completion (G3).
7. After the configured independent checks and fault decisions pass, the eligible Team Lead records technical release (G4) and moves the vehicle to the collection zone.
8. The Head of Service Centre performs and records the separate post-release inspection/sign-off. This is required before the Service Advisor contacts the client about completion. It does not replace, backdate or grant G4 authority.
9. The Service Advisor records the customer update, confirms the next step and, when commercial controls are delivered, records the separately authorized invoice/payment or showroom guarantee and collection/delivery handover. A vehicle must not leave the workshop without recorded payment or an approved showroom guarantee.

The order in steps 6–9 follows the owner's direction recorded in `REV-046`, `USER-027` and `USER-039`. G1–G5 and action grants remain separate. Where policy, a signed grant, effective SOP, applicable model instruction, inspection rule, evidence or payment/guarantee decision is missing, the server must block the action and show the reason and next permissible step.

## First-release scope

| Workstream | Build or verify for the pilot | Defer until the operational workflow is stable |
| --- | --- | --- |
| Staff access | Existing shared OIDC session, site-scoped staff roles, combined role visibility, secure sign-out, shared-device behavior | Public customer accounts, new native apps, account provisioning automation until the auth integration has passed its separate production gate |
| Service requests | Phone/walk-in intake, caller/contact role, concern, known client/vehicle, assigned follow-up, due/overdue queue, append-only contact history and explicit conversion to reception | Sales CRM, marketing and broad customer campaign features |
| Reception and jobs | Canonical work order, service client/owner/contact separation, vehicle facts, concerns, custody/condition, evidence, holds and readable job status | Sales delivery import, showroom sales entry, sales dashboards and historical maintenance import |
| Operations and workforce | Operations review, eligible lead assignment, Team Lead plan and Supervisor handoff, Supervisor task allocation, staff role/reporting links needed by these actions | General HR/payroll and workforce modules unrelated to current assignment, supervision or authorization |
| Work execution | Task acknowledgement, progress, comments, findings, tests, actions, requests, blockers, evidence and labor entries with a single attributable history | Inventory purchasing, POS functions and full parts/commercial accounting; preserve any existing safety check that prevents unfit parts/equipment use |
| Completion and release | G2 scope controls, G3 Supervisor completion, required QA and fault disposition, G4 Team Lead collection-zone release, separate Head inspection before customer contact; keep every unavailable action visibly blocked | No title-only grants, generic EV checklist, fabricated manufacturer procedure or shortcut that combines G3/G4/Head approval |
| Maintenance | Exact-source routine-maintenance checklist instances on actual work orders, outcome reasons, review and a structured report; use 10,000 km/12 months only as an intake reminder | Sales-delivery PDI application, generic service intervals or package assumptions; PDI work stays separate from after-sales orders |
| Reports | Work-order execution history and a purpose-built Daily Service Report with source, certainty, finding/test, action, result, open items, holds, decisions and next step | Finance statements, sales reports and broad custom BI beyond the staff's operational decisions |
| Documents and audit | Staff access to approved/effective instructions; clearly mark current interim SOPs as drafts. Keep operational audit events and required role access | Full controlled-document lifecycle, CAPA, management analytics and broader governance screens unless needed to satisfy an approved pilot control |
| Deployment | One-site web/API production release, approved shared auth, migrations, backup/restore, monitoring, rollback and role-by-role staff acceptance | Windows/macOS native clients, iOS/iPadOS, Android, HarmonyOS and offline synchronization; retain responsive browser/PWA operation |

The old portal and Smart POS remain read-only reference material. Do not port features just because they exist there.

## Build order and agent work packages

Work in order. A later work package can be developed behind a denied/blocked state while its policy input is pending; it cannot be described as operationally available.

### A. Establish one pilot path and reconcile existing work

- Follow `AGENTS.md`, `docs/README.md`, the system design, this plan, linked requirements and exact task acceptance before editing.
- Start with CodeGraph for code discovery and Graphify's local deterministic analysis for bounded impact. Do not submit personal, customer, staff or secret-bearing data to a graph/model service.
- Read the existing request, reception, Operations review, work-plan/handoff, task progress, evidence, report, role navigation and authentication flows before changing them. Preserve working code and tests; do not rebuild them.
- Reconcile the pilot list in this plan against `docs/delivery/tasks.json`. Keep existing task status honest; add individual tasks when uncovered work is found. Do not mark a source requirement complete because one UI route exists.
- Main references: `USER-027`, `USER-038`, `USER-039`, `USER-040`, `USER-043`, `USER-045`; `BUILD-R-M-0035`–`0038`; `BUILD-USER-039-WORK-HISTORY-001`; related `CHECK-*` tasks; `F-004`/`F-005`/`F-006`/`F-008`/`F-009`/`F-011` and evidence tasks.

### B. Make the daily path clear

- Keep the primary path to **Today → Requests → Jobs → Vehicles / service history**. Put team, documents, reports and account administration in role-aware secondary navigation.
- On Today, show only actions the current staff member can perform or needs to follow up: assigned tasks, callbacks, overdue items and clear handoffs. Link each row to the originating request or job. Do not duplicate business records or infer authority in the browser.
- On a job, show one readable summary: current stage, assigned owner, next action, due time, evidence needed and exact block reason. Keep the existing approved visual direction and responsive behavior.
- Add an Advisor-safe service-history view with server-side site and role checks; do not expose unrelated sales-delivery fields or infer verified ownership from historical purchaser claims.
- Provide real loading, empty, failure, stale-version, offline, blocked and saved/recovery states. Keep accessible names, keyboard order, touch targets and independent scroll behavior.
- Prove by real browser tests using the existing role fixtures. Include Head, Service Advisor, Team Lead, Supervisor and Technician/Engineer combinations. Unassigned, read-only and cross-site personas must be denied by the API as well as hidden in navigation.

### C. Finish the operational job record and Daily Service Report

- Keep reported concerns separate from staff findings, tests, actions and decisions.
- Complete the append-only attributed action/finding/test history. Each entry records the authenticated actor, time, work order and optional task/complaint, plain-language action or finding, result/certainty, source/procedure revision and accepted evidence references. Corrections append a reasoned correction; they never rewrite the original.
- Build a version-stable, printable Daily Service Report from saved records. Use a purpose-designed report template, never a screenshot of the application. Show completed and incomplete actions separately; state not reproduced/inconclusive honestly; show open holds, pending decisions, next owner/action and timestamps. A note or report claim must never appear as approved G3/G4, invoiced or paid.
- Test that report content matches the database and current record version, is site-scoped, selectable text, paginated, privacy-filtered, and usable in phone/desktop print sizes.
- Required task family: `BUILD-USER-039-WORK-HISTORY-001` and `CHECK-USER-039-WORK-HISTORY-001`, plus existing report and evidence tasks.

### D. Complete the gated work lifecycle without inventing policy

- Implement the owner-approved sequence as distinct server commands: authorized G2 scope; assigned-worker execution/declaration; Supervisor G3; required independent checks and fault disposition; Team Lead G4 plus collection-zone movement; separate Head inspection before advisor completion contact; then separate commercial departure/handover controls.
- Before coding each command, bind it to a versioned accepted contract. Use the existing command transaction order: active membership/site, work-order lock, current action grant and competence, idempotency receipt, version check, state/evidence policy, then atomic record + audit + receipt + outbox.
- Store immutable decision snapshots. Deny stale, replay-with-changed-body, wrong-site, wrong-assignment, inactive/revoked/expired grants, insufficient competence, missing evidence, current plan mismatch, required failed/missing inspection, unresolved holds, or a release/hold race. UI role labels never substitute for signed action grants.
- G4 must not imply payment, guarantee, customer contact or physical departure. Head inspection is an additional immutable check after G4; if it fails, record the reason and create the configured return-to-work/safety path without erasing the G4 decision. Do not allow the advisor to send a completion update until Head review passes.
- Do not seed production grants. `REV-006`, `REV-008`, `REV-009` and `REV-035` identify required signed authority, effective procedures, model-specific policy/equipment, and inspection/exception inputs. Until those inputs are approved, test with isolated synthetic configurations only and show an explicit production block.
- Relevant implementation/checks: `BUILD-R-M-0036`/`CHECK-R-M-0036`, `BUILD-R-M-0037`/`CHECK-R-M-0037`, `BUILD-R-M-0038`/`CHECK-R-M-0038`, `BUILD-USER-027`/`CHECK-USER-027`, `BUILD-USER-039`/`CHECK-USER-039`, lock-order and policy-package tasks.

### E. Make routine maintenance usable

- Complete `BUILD-USER-043-INSTANCE-001`, outcome/review/report/UI tasks and their checks for routine maintenance on a real work order.
- Read the exact model/variant schedule revision; do not manufacture work from a generic EV package. If the schedule/source is missing, keep the checklist unconfigured and state why.
- Every checklist task supports applicable/unknown, assigned owner, progress, completed, failed, not checked, not completed, blocked or not applicable. Non-complete outcomes require a reason; corrections preserve history. Keep checklist review distinct from Supervisor G3, Team Lead G4 and Head inspection.
- Defer delivery-preparation and sales-triggered PDI tasks from this pilot. Do not mark them not-applicable; leave them for the later sales/PDI phase.

### F. Prepare and prove the release

- Use the shared auth service at `auth.raymond-gray.org`; do not add a second password database or create real invitations from local tests. Verify login, exact callback, logout, CSRF/session, roleless denial, revocation behavior and each site-role route before release. Any local Keycloak/auth hardening needed by VMMS must be reproducible and separately verified in the production auth service; do not push a no-op Keycloak image deploy.
- Use production-safe secrets from the approved provider secret store. Do not print or commit `.env` values. Confirm the exact API, web and auth deployment targets and current deployment commit before changing them.
- Run the full required local API/PostgreSQL, migration-upgrade, browser-role, accessibility/responsive, evidence-storage and security checks; run focused denial and concurrency cases for every new transition. Record actual command results and any unavailable platform honestly.
- Remove local synthetic operational records only in the disposable production-like environment using a reviewed exact allowlist. Production must begin with an explicit clean/approved-data check; do not delete real rows by broad cleanup.
- Verify a restorable database and object-storage backup, staging rollout, deployment/health smoke, rollback/recovery instructions and hostname/TLS before production deployment. The owner has authorized production deployment after successful local implementation and tests; do not deploy until the exact change is reviewable and all safety/data/identity release gates for that change pass.
- After deployment, verify production health, OIDC discovery and the exact VMMS authorization callback; use only approved test identities. Do not send real invitations or notifications without the recipient/sender step being separately ready. Then run a small staff role acceptance and collect issues before calling the site operational.

## Required evidence before calling the workshop pilot ready

- PostgreSQL/API positive and negative cases for each operation, tenant/site boundary, idempotency, stale versions, audit/event writes, rollback and lock races.
- Browser proof for each named role from service request to the correct work queue, job timeline, permitted action, blocked explanation and purpose-built report; no console errors or failed requests.
- Responsive checks at phone, foldable/narrow, tablet and desktop sizes, including 200%/400% zoom, keyboard and automated accessibility review. Record any manual screen-reader checks still outstanding.
- Routine maintenance checks for exact source revision, reasoned incomplete outcomes, supervisor/lead/head review separation and correct report contents.
- Shared-auth checks for approved origin, redirect allowlisting, successful login/logout and unauthorized-site/role denial. Production verification must use the production service; local Keycloak alone is not proof.
- Synthetic-data review, backup/restore evidence, deploy/rollback check, staff acceptance and an explicit list of policy inputs still awaiting owner/safety approval.

Passing code checks is not management approval or permission to bypass a blocked operational authority. Production can be deployed as the reviewed release, while actual sign-off actions remain closed until the required policies and named grants exist.

## Deferred work

- Sales recording, showroom imports, delivery preparation and PDI workflow; historical customer/maintenance backlog import until the owner completes the data inventory and approves mappings.
- Full Finance, invoice/receipt/email, Paystack/accounting adapters, commercial reports and broader stock/purchasing functions. Preserve the invariant that no vehicle leaves without a payment record or approved guarantee; do not turn the future finance deferral into an implicit release bypass.
- Smart POS functions that do not serve the workshop maintenance lifecycle.
- Customer portal expansion, OS-specific Windows/macOS/iOS/iPadOS/Android/HarmonyOS apps, offline synchronization and device procurement.
- Broad analytics, HR, payroll, advanced governance and 30-day optimization after the operational pilot.

## Agent handoff instruction

> Implement the VMMS operational workshop pilot strictly from `docs/delivery/operational-workshop-pilot-agent-plan.md`. First reconcile its task IDs with `docs/delivery/tasks.json`, this repository's `AGENTS.md`, `docs/README.md`, `docs/architecture/system-design.md` and the linked contracts. Inspect current code with CodeGraph before searching or reading owning code. Preserve working behavior. Implement in the listed order, one testable vertical slice at a time. Use one writer for shared tracker/migrations; keep agent file ownership disjoint. Do not invent or enable authority, SOPs, EV/HV procedures, inspection rules, money/tax or payer policy. Keep unresolved actions server-blocked and explain the reason. Update only the tasks and requirements supported by evidence; add tasks for newly found gaps. Run the local PostgreSQL/API/browser/security checks relevant to each slice and the full required release suite. Record evidence and deployment/rollback state. Do not send real invitations, import or delete production records, alter DNS, or deploy an unreviewed/untested change. Stop and surface any design conflict rather than quietly changing the user's approved sequence.
