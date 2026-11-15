# VMMS workforce roles and reporting structure

Status: selected design baseline, 9 November 2026. The owner selected a separate VMMS Operator and Head of Service Centre / Operations Admin. This document defines role placement and reporting; it does not grant operational sign-off authority or approve procedure content.

The Operator's account lifecycle boundary is specified separately in [Operator account administration](operator-account-administration.md). The Head's workforce commands cannot create central identity accounts or assign the Operator role.

## Caller view

```ts
const directory = await workforce.readSiteOrganogram(scope, siteId);
const overview = await workforce.readHeadOverview(scope, siteId, filters);
await workforce.assignExistingRole(scope, commandId, {
  staffAccountId,
  roleProfileId,
  expectedVersion,
});
await workshop.assignTeamLead(scope, commandId, {
  workOrderId,
  teamLeadStaffId,
  expectedVersion,
  reason,
});
```

The organogram says who holds which work role at a site and who they report to. The work-order command says who was assigned to a specific job or task. The authenticated organisation, site, and actor always come from the server session; client input cannot select broader access. See the [supervisor work-allocation contract](supervisor-work-allocation.md) for task-level assignment after team-lead handoff.

## Role profiles and combined duties

The Head of Service Centre and Operations Admin are one combined operational role profile. A staff account may hold multiple active role placements at a site or different placements at different sites. Role profiles support navigation, work queues, reporting lines, and permitted staff/work allocation actions. They do not grant repair, technical completion, independent inspection, vehicle release, financial approval, or controlled-document publication authority.

Initial role profiles follow the master specification and the owner's workflow:

| Role profile | Main work area and reporting relationship |
| --- | --- |
| Head of Service Centre / Operations Admin | Site oversight, Operations review, qualified Team Lead assignment, staff role assignment from the effective catalog, work overview, reports, and internal messages. Reports to the service-centre management structure configured for the site. |
| EV Team Lead | EV work planning and supervisor handoff; reports to the Head of Service Centre. |
| ICE Team Lead | ICE work planning and supervisor handoff; reports to the Head of Service Centre. |
| Supervisor | Receives team-lead handoff and coordinates assigned technicians/engineers; reports to the appropriate Team Lead. |
| Technician / Engineer / Trainee | Performs assigned work within current authority, qualification, training, and supervision; reports to the assigned Supervisor. |
| Service Advisor | Booking, intake, client contact, invoice preparation and collection coordination; reporting line is configured per site. |
| Quality Inspector | Independent checks and quality evidence; independence rules remain separate from reporting hierarchy. |
| Parts & Inventory | Parts records and custody workflows; purchasing authority remains separately controlled. |
| Warranty / Customer Support | Coverage cases and client communications; payer decisions remain separately controlled. |
| Finance / Billing | Invoice and external-payment records; financial approvals remain separately controlled. |
| Compliance / Records / HR | Controlled records and procedure-document administration only when approved; publishing an effective SOP requires separate authority. |
| Approved Vehicle Owner | Separate customer audience, not a staff work role. Has no access to the staff procedure library. |

The named role profiles are configurable records. Whether a person may edit role definitions and permission profiles is still pending review in `REV-041`. The Head assigns staff only to existing effective profiles. The Operator manages account lifecycle and approved account/site access only; the Operator does not assign operational role placements. No role profile may imply a signed technical, inspection, release, finance, or procedure-approval grant.

## Reporting and work assignment are different records

Reporting relationships are site-scoped and effective-dated. The initial default chain is Head of Service Centre → Team Lead → Supervisor → Technician/Engineer. Other roles' reporting lines remain configurable. A cycle, cross-site edge, inactive parent, or second current manager is rejected unless a future approved policy explicitly allows a different structure.

Work assignment remains in the work-order lifecycle. The Head assigns an Operations-reviewed job to an eligible EV or ICE Team Lead using the existing versioned team-lead assignment command. Operations assigns hybrid work to a qualified lead for that job. The Team Lead creates the work plan and hands off to a Supervisor. The Supervisor coordinates technicians/engineers against approved tasks. Do not add a second editable lead/supervisor assignment table. Each reassignment is an attributable, versioned workshop event.

Role placement or reporting rank never satisfies an authority grant or qualification check. Existing commands keep checking current signed grants, competence scope, site membership, effective instructions, holds, evidence, and independence at action time. Missing policy remains a visible block with the next allowed action.

## Head of Service Centre workspace

The Head's overview is site-scoped and shows the work, queue, staffing, reports, and exceptions permitted by the Head's current workspace role and separate grants. Work-stage counts link to filtered work-order lists for open holds, Operations review, team-lead assignment and current lead assignments; the API applies the filter within the authenticated site, and queue membership grants no command authority. It supports Operations review, assignment to qualified leads, and assignment of employees to existing role profiles. Sensitive read projections are metadata-audited. The Head cannot create or suspend central identity accounts; those lifecycle duties belong to the separate Operator. The Operator does not receive Operations review, job allocation, technical, inspection, release, financial, or document-publication authority from the account role.

The first internal-message slice follows the [message contract](internal-messages.md): HSC sends to explicit active same-site staff recipients; only sender and recipients can read; a message may link to a same-site work order; content is immutable and recipients can add a one-way read receipt. No attachments or external delivery are enabled. Production sending stays disabled until retention and operational ownership are approved under REV-042.

## Account provisioning boundary

The VMMS Operator creates, updates, and suspends accounts through the shared identity invitation/provisioning contract, and manages account lifecycle only. The Head of Service Centre / Operations Admin is a separate role and can assign a staff member to an existing VMMS role profile when the current role-assignment authority permits it. Neither role can define or edit role permission policy, issue operational sign-off grants, or manage the shared identity provider.

The shared identity repository currently exposes OIDC, not a production account-provisioning API. Do not call Keycloak Admin REST from browser code or a normal VMMS request. The production design needs a narrowly scoped auth-service invitation capability, invoked through a durable, idempotent VMMS outbox workflow. Auth-service administrator credentials remain inside the auth service. Invitation, account linking, delivery, expiry, recovery, and revocation rules remain review items.

## Persistence and command contract

Use a staff placement record scoped to `(organisation, site, staff account, role profile)`. Allow multiple active placements for combined duties. Store reporting relationships against placement IDs so a person holding two roles can have different supervisors for each role. Preserve revisions for role assignment and reporting changes; retain past work-order assignments in workshop history.

```ts
type StaffPlacement = {
  id: string;
  organisationId: string;
  siteId: string;
  staffAccountId: string;
  roleProfileId: string;
  reportsToPlacementId: string | null;
  revision: number;
  state: 'active' | 'ended';
};

interface Workforce {
  readSiteOrganogram(scope: StaffScope, siteId: string): Promise<SiteOrganogram>;
  readHeadOverview(scope: StaffScope, siteId: string, filters: OverviewFilters): Promise<HeadOverview>;
  assignExistingRole(command: AssignRoleCommand): Promise<StaffPlacementResult>;
  changeReportingLine(command: ChangeReportingLineCommand): Promise<ReportingLineResult>;
}
```

Role/reporting commands derive actor and scope from the session, lock active membership and current staff-management authority, lock the affected placement revisions in a stable order, reject stale versions and self-escalation, and atomically persist new state, audit event, idempotency receipt, and outbox event. Use the existing aggregate command contract. Role assignment checks the approved catalog; it cannot mutate capability policy or signed grants. The initial Head and Operator bootstrap must be a controlled owner/admin action; neither can self-provision.

## Implemented API foundation

The API foundation now stores a read-only built-in role catalog, multiple site placements per account, reporting links, and append-only placement revisions in `staff_role_placements` and `staff_role_placement_history`. The Head-only `GET /api/v1/sites/:siteId/staff/organogram` projection is site scoped and records a metadata read event. `POST /api/v1/sites/:siteId/staff/role-placements` assigns or revises an existing assignable role through the shared command, event, receipt, and outbox transaction. `POST /api/v1/sites/:siteId/staff/role-placements/:placementId/end` ends a placement without deleting its history.

The service rejects an inactive or cross-site manager, reporting cycles, stale revisions, inactive staff or site memberships, assigning the Operator profile, self-assignment to the Head role, ending the last active Head role, and ending a role that still has active reports. The catalog is not yet editable: profile and permission-policy changes stay closed under `REV-041`. The shared identity invitation/provisioning flow remains separate under `AUTH-011`.

The current staff-and-roles page provides the Head with the audited site directory, existing-role assignment, reporting manager selection, and role ending. Heads with read-only membership can view the directory and overview; role changes still require write-enabled membership, and the page hides its role-change controls for read-only accounts.

The Head overview at `/sites/:siteId/overview` reports site-scoped active work orders, holds, Operations review and Team Lead assignment stages, and active staff/role placements. It exposes counts only and links to existing pages; it does not create another work-assignment workflow. Overview reads are metadata-audited. `active` currently counts the only persisted work-order status (`intakeDraft`); later lifecycle statuses need an explicit count definition before implementation. The UI passes synthetic browser checks at 11 viewport sizes, direct loading, read-only/offline/denial states, and an automated WCAG 2.1 A/AA scan. This is not a complete Head workspace: drill-down reports, internal messages, task allocation, Operator provisioning, pilot accounts, concurrent snapshot behavior, and staff UAT remain open. See [workforce verification](../verification/checks/workforce-role-placement-2026-11-09.md) and [Head overview verification](../verification/checks/head-overview-2026-11-09.md).

## Synthesis decision

Candidate B, the site-scoped placement model, is the base because each placement can combine one person's roles while retaining a separate reporting line for each role and site. The cross-judge scored it higher for combined roles and site isolation. Graft Candidate A's explicit effective-dated reporting-line revisions and its strict separation between a reporting relationship and a work-order assignment. Do not graft Candidate A's generic `WorkAssignment` table: it would duplicate the existing work-order lead and supervisor state. Keep task-level technician allocation in the owning workshop aggregate.

## Tradeoffs and alternatives

- Keep identity, site membership, role placement, reporting line, work assignment, qualification, and signed authority as separate records. This uses more records but lets each change retain the right scope and history.
- Use site placements rather than one global staff role because staff may hold different work at different sites.
- Keep role inheritance out of scope. Inherited sign-off powers would couple reporting rank to authority and create unexpected privilege escalation.
- Keep the initial feature to assigning current profiles and reporting lines. Editing role capability definitions waits for a separately approved governance authority.
- Keep messages tied to a site or work item. A general messaging product requires separate retention and delivery decisions.

## Open decisions

- `REV-041`: who may edit role permission definitions and publish effective procedure documents, and whether a second approval is required.
- `REV-042`: message categories, retention, attachments, read status, notification delivery, and cross-site rules.
- `REV-006`, `REV-008`, `REV-009`, and `REV-035`: named operational authorities, controlled procedures, inspection policy, and G3/G4 work controls.
- `AUTH-011`: production identity provisioning API, invitation and recovery policy, and initial Operator bootstrap.

## First implementation steps

1. Add system role-profile definitions and site-scoped placements/reporting revisions without adding any real staff identities or operational grants.
2. Add Head role-assignment and overview reads with explicit role-management authorization and sensitive-read audit.
3. Add test-only synthetic placements for the requested roles and verify cross-site, cycle, self-escalation, suspension, and grant-separation denials.
4. Extend work-order task assignment to Supervisor-managed Technicians/Engineers without duplicating lead or supervisor commands.
5. Implement in-app messages only after `REV-042` review.
