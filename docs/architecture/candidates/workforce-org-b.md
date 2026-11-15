# Candidate B: position-based workforce organization

## Problem

VMMS has staff accounts and site memberships but no staff role catalog, reporting structure, role-aware navigation, or account-administration commands. The existing work-order model already assigns a lead and supervisor through separate, versioned commands and checks signed grants and qualifications at action time. The new direction adds a service-centre organogram: the Head of Service Centre (HSC) also performs Operations Admin duties, monitors work and reports, messages staff, assigns work to leads, and supervisors allocate work to technicians/engineers. People may combine functions. The owner confirmed that the VMMS Operator remains a separate account-administration role; the Head assigns people to existing role profiles and cannot administer central accounts.

## Usage (caller's view)

```ts
const org = await workforce.readSiteOrganogram(scope, siteId);
const result = await workforce.assignWork(scope, commandId, {
  expectedVersion,
  workOrderId,
  targetStaffAssignmentId,
  taskId,
  reason,
});
const home = await workforce.readHeadOfServiceCentreOverview(scope, siteId, filters);
```

The HSC page reads the active service-centre organogram, queue, and reports from one site-scoped projection. It can assign an Operations-reviewed job to a qualified team-lead assignment using the existing lead-assignment command. A team lead prepares the work plan and hands the job to a supervisor. A supervisor allocates eligible work to assigned technician/engineer placements. Each handoff appears in attributable job history.

The person editor assigns existing role profiles to a staff account at a site and links one placement to its reporting manager placement. A person's multiple active placements allow combined duties. The account-administration actions are exposed only if the pending HSC/Operator decision permits them. The Operator boundary otherwise remains account administration only.

## Shape

Model the organogram as **staff placements** rather than treating a role label as an identity or a permission:

```ts
type StaffAccountId = string & { readonly __brand: 'StaffAccountId' };
type SiteId = string & { readonly __brand: 'SiteId' };
type StaffPlacementId = string & { readonly __brand: 'StaffPlacementId' };
type RoleProfileId = string & { readonly __brand: 'RoleProfileId' };

type RoleProfile = {
  id: RoleProfileId;
  code: string;
  title: string;
  workAreas: readonly WorkArea[]; // navigation and work queue choices only
  configurableByGovernance: true;
  catalogRevision: number;
  effective: boolean;
};

type StaffPlacement = {
  id: StaffPlacementId;
  staffAccountId: StaffAccountId;
  organisationId: string;
  siteId: SiteId;
  roleProfileId: RoleProfileId;
  state: 'active' | 'suspended' | 'ended';
  reportsToPlacementId: StaffPlacementId | null;
  revision: number;
};

type WorkforceScope = {
  actorId: StaffAccountId;
  organisationId: string;
  siteId: SiteId;
  placementId: StaffPlacementId;
};

type WorkAssignment = {
  id: string;
  siteId: SiteId;
  workOrderId: string;
  targetPlacementId: StaffPlacementId;
  assignedByPlacementId: StaffPlacementId;
  taskId: string | null;
  expectedVersion: number;
  state: 'assigned' | 'accepted' | 'reassigned' | 'completed';
};
```

One staff account may have multiple active placements at the same or different sites. A reporting line references placements, so the graph remains unambiguous if the same person is, for example, a workshop supervisor on one site and a quality inspector on another. Enforce no cycles, no cross-organisation/site edge, no inactive placement as a parent, and one effective reporting parent per placement revision. Role profile edits create a new catalog revision; they do not rewrite past assignments or signed decisions.

Keep `RoleProfile.workAreas` strictly presentational and workflow-routing metadata. Commands that approve Operations review, repair scope, technical completion, independent inspection, release, finance, or document publication continue to require their existing specific grants and qualification checks. A reporting edge, HSC title, combined placement, or assignment to a job is never evidence of technical competence or approval authority. This preserves the [staff-authority contract](../staff-authority-and-qualification.md).

### Module and API sketch

```ts
interface Workforce {
  readSiteOrganogram(scope: Scope, siteId: SiteId): Promise<SiteOrganogram>;
  listRoleProfiles(scope: Scope, siteId: SiteId): Promise<readonly RoleProfile[]>;
  assignPlacement(command: StaffCommand<RoleAssignmentResult>): Promise<RoleAssignmentResult>;
  changeReportingLine(command: StaffCommand<ReportingLineResult>): Promise<ReportingLineResult>;
  assignWork(command: StaffCommand<WorkAssignmentResult>): Promise<WorkAssignmentResult>;
  readHeadOfServiceCentreOverview(scope: Scope, siteId: SiteId, filters: OverviewFilters): Promise<Overview>;
}
```

The `workforce` module owns role profile revisions, staff placements, reporting edges, work-allocation commands, account administration within the approved boundary, and the HSC summary projection. It does not own credentials or provider subjects: those remain with the shared identity service. It does not own signed authority or competence: those remain with the existing authority and qualification model. Work-order lead/supervisor decisions remain in the workshop aggregate and should not be duplicated by a second editable assignment table.

Each mutation uses `runStaffCommand`: lock current site membership, lock the affected placement/revision roots in stable order, recheck the separately approved workforce-management grant, verify current placement/reporting eligibility, then check command receipt/version, and atomically write the change, audit event, receipt, and outbox item. Read projections are derived from the authenticated organisation/site and record sensitive-read metadata where required. HSC overview never grants cross-site access by title.

The mobile/desktop UI reads the placement projection to show the org chart, reports, assigned work, messages and relevant work areas. Use responsive cards/tree navigation rather than relying on a wide, fixed org-chart canvas. Messages should be attached to a site or work-order context with a clear recipient list, read policy and audit behavior; external SMS/WhatsApp delivery remains a separate reviewed adapter.

### Provisioning boundary

The shared authentication repository currently offers OIDC, not a VMMS account-provisioning API. It prohibits putting product roles in Keycloak and its local fixture scripts are not production provisioning. The eventual flow is a VMMS-pending account/membership/placement command plus a durable outbox request to a narrowly scoped server-to-server invitation capability in `raymond-gray-auth`. The auth service alone keeps Keycloak administrator credentials. Invitation expiry, account recovery/linking, delivery and revocation remain open review items. The role boundary is settled: the Operator manages accounts and approved account/site access; the Head manages site operations and assigns only existing role profiles. Do not make a normal VMMS request directly call Keycloak Admin REST.

## Synthesis decision

This is candidate B, an alternative design proposal only. It has not been selected or implemented. It models the organogram as placements in a reporting graph instead of assigning a single primary role to each person. Candidate A and an independent cross-judge will determine whether that additional explicit structure is justified.

## Tradeoffs accepted

- We accept a placement/reporting graph and revision history in exchange for representing combined duties and site-specific reporting without overloading the global staff account.
- We accept that the HSC dashboard is a bounded, server-derived projection in exchange for preventing titles from becoming cross-site permissions.
- We accept a separate shared-auth provisioning contract and eventual outbox worker in exchange for keeping provider credentials and Keycloak administration out of normal VMMS requests.
- We accept that a custom role profile controls navigation and work assignment only; explicit sign-off remains a separately granted decision.

## Alternatives considered

- **Single primary role per account:** smaller schema and simpler navigation, but it cannot express a staff member who combines duties without role duplication; its global user role also obscures site-specific assignment.
- **Inherited role permissions through a tree:** convenient for dashboard inheritance, but a manager's reporting relationship could accidentally grant sign-off authority to every descendant. It exposes inheritance exceptions and privilege escalation to every caller.
- **Free-form permissions on each role:** flexible but turns role editing into direct privilege issuance. It conflicts with the approved boundary that the Operator cannot change policies and must remain separate from technical/financial grants.

## Open questions and risks

- The owner confirmed that HSC and Operator remain separate. HSC cannot create/suspend central accounts; the Operator does not receive HSC operational duties.
- Does "change roles" mean assigning people to existing effective profiles, or editing the role catalog and its functions? The recommended boundary is assign existing profiles while a separately approved governance process edits the catalog.
- Which account/site grant authorizes role placement, reports, messages, work assignment and role-catalog revision, and how is the initial HSC placement bootstrapped without self-elevation?
- Which roles report directly to HSC, and does each person have exactly one manager placement per site?
- Which message formats and retention rules are needed? Are messages site-level, job-level, or both?
- Can a task have multiple technicians, and what evidence/qualification controls are required before a supervisor assigns it?

## Next implementation step

After choosing the role/account boundary, add the placement and reporting model to the site-scoped PostgreSQL schema and verify cycle, cross-site, inactive-parent, self-escalation and signed-grant isolation cases using the non-owner runtime role.
