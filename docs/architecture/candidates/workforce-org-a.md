# Candidate A: Site roles with explicit reporting lines

## Problem

VMMS currently has global staff identities and site memberships, but no staff role catalog, multiple-role assignment model, or reporting structure. Operations review and team-lead assignment already use distinct signed grants; team-lead assignment also checks qualification and vehicle class. The requested organogram adds a Head of Service Centre who also performs Operations Admin work, Team Leads who plan and hand over jobs, Supervisors who manage Technicians/Engineers, and workers who may hold combined functions. The owner confirmed that the VMMS Operator remains separate and handles account administration; the Head handles site operations and assigns staff to existing role profiles.

## Usage (caller's view)

```ts
const directory = await staffDirectory.forSite({ siteId });
const overview = await operationsOverview.forSite({ siteId, range });
await workAssignments.assign({
  siteId,
  workOrderId,
  taskId,
  assigneeId,
  expectedVersion,
  commandId,
});
await workforce.setRoles({
  siteId,
  staffId,
  roleCodes: ['service-advisor', 'parts-inventory'],
  expectedVersion,
  commandId,
});
```

The directory returns a person's effective site roles and reporting line, not their technical grants. The operations overview returns data already scoped to the caller's approved organisation/site. Assignment is a separate command that checks the caller's work-allocation authority and verifies the assignee's current qualification, job scope, active membership, and applicable workflow rules.

## Shape

```ts
type SiteRoleCode = string & { readonly __brand: 'SiteRoleCode' };

type SiteRole = {
  code: SiteRoleCode;
  label: string;
  description: string;
  state: 'active' | 'retired';
  capabilityProfileRevision: number;
};

type SiteStaffRoles = {
  organisationId: string;
  siteId: string;
  staffId: string;
  revision: number;
  roles: readonly SiteRoleCode[];
  effectiveFrom: string;
  effectiveUntil: string | null;
};

type ReportingLine = {
  organisationId: string;
  siteId: string;
  staffId: string;
  reportsToStaffId: string | null;
  revision: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

type WorkAssignment = {
  organisationId: string;
  siteId: string;
  workOrderId: string;
  taskId: string | null;
  assigneeId: string;
  assignedBy: string;
  assignmentKind: 'team-lead' | 'supervisor' | 'technician' | 'other';
  expectedAggregateVersion: number;
};

interface StaffDirectory {
  forSite(input: { siteId: string }): Promise<readonly StaffProfile[]>;
}

interface OperationsOverview {
  forSite(input: { siteId: string; range: DateRange }): Promise<OperationsProjection>;
}

interface WorkforceCommands {
  setRoles(input: SetSiteRolesCommand): Promise<SiteStaffRoles>;
  setReportingLine(input: SetReportingLineCommand): Promise<ReportingLine>;
}

interface WorkAssignmentCommands {
  assign(input: WorkAssignmentCommand): Promise<WorkAssignmentResult>;
}
```

The schema separates four facts:

1. `staff_users` remains the person/account identity.
2. `memberships` remains the site's active-access boundary.
3. A versioned, site-scoped role assignment answers which work areas and menus the person uses. Multiple active roles are allowed; a person can therefore combine service-advisor and inventory work, for example.
4. Signed, revisioned authority grants and qualifications continue to decide who may review operations, execute regulated work, inspect, release, approve financial actions, or administer controlled policy. Role codes never create those grants.

Reporting lines are explicit site-scoped, effective-dated relationships. A role label alone cannot establish a manager. The requested default chain can be represented as Head of Service Centre → Team Lead → Supervisor → Technician/Engineer. Other roles' reporting lines remain configurable rather than inferred. The Head of Service Centre and Operations Admin share one role profile because the owner explicitly combines those functions.

Job assignment is not the same as reporting. The Head may allocate a job to an eligible Team Lead; the Team Lead may prepare the work plan and hand it to a Supervisor; the Supervisor may assign eligible technicians to tasks. Each assignment has its own actor, recipient, task scope, reason, version, and history. Existing Operations-review, lead-assignment, handoff, execution, inspection, and release grants remain action-time checks.

The shared identity provider continues to own authentication only. VMMS should not call Keycloak Admin REST from a normal route. Account invitation/provisioning needs a narrow server-to-server contract in the shared auth service, invoked durably through a VMMS outbox or equivalent idempotent workflow. The Operator handles account lifecycle and approved account/site access; the Head cannot create or suspend accounts and cannot assign the Operator role.

### Module map

- `Identity` owns `staff_users`, provider-subject mappings, sessions, site membership, role catalog revisions, site role assignments, and reporting-line revisions.
- `Workforce` projects staff directory, role mix, reporting lines, vacancies, and the Head of Service Centre site overview.
- `Workshop` owns versioned work-order and task assignments, using existing signed grants and qualification checks.
- `Governance` owns role-capability policy and controlled procedure publication. The person allowed to change these policies remains to be designated.
- `Delivery and audit` records account, role, reporting, assignment, and internal-message events. External SMS/email/WhatsApp integrations are separate adapters and remain unconfigured.

Use the shared command transaction for role/reporting mutations: lock current site membership and account-administration or governance authority, lock the staff membership aggregate, enforce fixed scope and no self-elevation, write the new revision and attributable event atomically, and reject stale expected versions. Internal messages should link to an organisation/site-scoped work item and preserve sender, recipients, time, and read state; a global free-form chat is outside this candidate's initial work scope.

The caller-facing surface is small: two read projections and two command groups. It hides row-level scoping, role revision resolution, assignment history, identity provisioning, and audit writes. The caller still chooses the site and target staff member; the server checks that both are in the caller's approved scope.

## Synthesis decision

Candidate A proposes a normalized many-to-many site-role model plus explicit reporting-line records. It separates organizational supervision, user access, work assignment, and signed authority. The owner-approved Operator/Head boundary is recorded in `docs/architecture/workforce-organogram.md` and `docs/decisions/review-register.md`; this candidate remains an alternative design proposal.

## Tradeoffs accepted

- We accept multiple records and versioned relationships in exchange for accurately representing combined roles and reporting changes over time.
- We accept an explicit reporting-line write in exchange for not inferring managers from role rank or screen labels.
- We accept a separate work-assignment history in exchange for a clear accountable actor and the ability to audit reassignment without changing a person's role.
- We accept that account provisioning depends on a future shared-auth service contract in exchange for keeping Keycloak credentials out of the VMMS application.

## Alternatives considered

- A single primary role on each staff record exposes combined-role special cases to every route and cannot reliably express a worker serving as both advisor and inventory support.
- A role-inheritance tree hides permission lookup from callers but makes a supervisor inherit all lower-level powers, risking accidental technical/financial grants. It also confuses reporting rank with action authority.
- Embedding every assignment in a person's role record couples staffing to work-order state and obscures who assigned or reassigned an individual task.

## Open questions and risks

- The owner confirmed that the Operator remains separate from the Head. The Operator manages account lifecycle and approved account/site access; the Head assigns staff only to existing role profiles and runs site operations.
- Does “change people's roles” mean assign people from the current role catalog, or edit role definitions and capabilities as well?
- Which approved role may revise role-capability policy and publish effective procedures?
- Should all business and support roles report directly to the Head, or will the owner provide additional reporting lines?
- What internal message types, retention, attachment, notification, and delivery expectations are needed for the first release?
- Which site-level overview fields may the Head see when customers, staff, and finance records have different access rules?

## Next implementation step

Implement the site-scoped role catalog and reporting-line model with no role-derived operational grants, then prove the constraints under the PostgreSQL runtime role.
