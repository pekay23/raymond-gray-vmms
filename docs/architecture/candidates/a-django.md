# Candidate A Django modular monolith

## Problem

Build one authoritative operations system for a service centre, with a web release before native packages. The confirmed launch has one site, generally reliable internet, saved drafts, and no real records to migrate from the prototype. The master specification still requires independent G1-G5 gates, per-task progress, named authority, protected evidence, and atomic stock, release, and financial decisions. The existing portal audit does not establish those controls. This proposal uses a Django application with domain-owned commands, PostgreSQL, and a React TypeScript client.

## Usage from the caller

The advisor saves a reception draft, records the customer and vehicle, adds complaints in the customer's wording, and submits intake. The server returns one work order and its actual missing evidence. A created work order does not imply G1 is complete and never implies repair authority.

```python
intake = reception.receive_vehicle(
    context=staff_context,
    command=ReceiveVehicle(
        key=command_key,
        visit_id=visit_id,
        customer_id=customer_id,
        vehicle_id=vehicle_id,
        complaints=(CustomerComplaint(text="Charging stops intermittently"),),
        custody_evidence_id=custody_id,
        triage=triage_result,
    ),
)
```

The advisor adds C02 to the same work order, using the version last displayed. The service assigns the complaint number while locking the work order. The browser does not choose C02 or create another work order.

```python
updated = workshop.add_complaint(
    context=staff_context,
    command=AddComplaint(
        key=command_key, work_order_id=intake.id,
        expected_version=intake.version,
        customer_words="Rattle over uneven roads",
    ),
)
```

A technician reports a task hazard. The server creates a task-scoped hold while unrelated tasks remain actionable. A vehicle-wide safety concern creates a work-order safety hold that also blocks G4.

```python
held = workshop.open_hold(
    context=staff_context,
    command=OpenHold(
        key=command_key, work_order_id=updated.id,
        expected_version=updated.version,
        scope=TaskScope(task_id), kind=HoldKind.SAFETY,
        severity=Severity.HIGH, owner_id=controller_id,
        reason="Reported concern requires technical assessment",
        source_evidence_id=observation_id,
    ),
)
```

## Shape

These are contracts for implementation, not implemented APIs. Public service inputs are typed domain commands. HTTP serializers validate UUIDs, lengths, dates, enumerations, and cross-record ownership before constructing them. Django request objects and ORM instances remain private to the adapter and service.

```python
@dataclass(frozen=True)
class StaffContext:
    actor_id: PersonId
    organisation_id: OrganisationId
    site_id: SiteId

@dataclass(frozen=True)
class TaskScope:
    task_id: TaskId

@dataclass(frozen=True)
class WorkOrderScope:
    pass

HoldScope = TaskScope | WorkOrderScope

@dataclass(frozen=True)
class OpenHold:
    key: CommandKey
    work_order_id: WorkOrderId
    expected_version: int
    scope: HoldScope
    kind: HoldKind
    severity: Severity
    owner_id: PersonId
    reason: str
    source_evidence_id: EvidenceId

def add_complaint(*, context: StaffContext, command: AddComplaint) -> WorkOrderView:
    raise NotImplementedError

def open_hold(*, context: StaffContext, command: OpenHold) -> WorkOrderView:
    raise NotImplementedError

def close_hold(*, context: StaffContext, command: CloseHold) -> WorkOrderView:
    raise NotImplementedError

def release_vehicle(*, context: StaffContext, command: ReleaseVehicle) -> ReleaseReceipt:
    raise NotImplementedError
```

The service hides membership checks, scoped loading, authority evaluation, version checks, transaction boundaries, numbering, mutation, audit, receipt, and outbox persistence. The caller supplies intent and evidence rather than coordinating separate validation and save methods. This follows boundary-discipline and minimizes the public interface.

### Records and ownership

| Module | Canonical records and owned policy |
| --- | --- |
| `identity` | Person, staff identity, organisation, site, membership, session and access capabilities |
| `authority` | Signed grant revisions, assessor evidence, scope, validity, suspension, decision snapshots and independence rules |
| `reception` | Customer, vehicle, ownership history, booking, visit, custody, intake and recovery |
| `workshop` | Work order, complaint, task, diagnostic finding, scope revision, consent, hold, labour, inspection and G1-G4 decisions |
| `inventory` | Part, fitment, requisition, PO, receipt, lot, reservation, issue, return and immutable stock movement |
| `commercial` | Coverage case, cost line, proposed and approved payer, claim, invoice, receivable, payment, write-off and G5 decision |
| `governance` | Controlled document revision, effective instruction, incident, audit, CAPA and acknowledgement |
| `people` | Profile, qualifications, skills, training and supervision evidence; authority owns actual grants |
| `equipment` | Asset, commissioning, calibration, pre-use inspection, quarantine, maintenance and impact assessment |
| `evidence` | Private object metadata, immutable content hash, upload and malware-check status, access and export policy |
| `audit` | Append-only event and sensitive read/export records; no mutable operational truth |
| `delivery` | Command receipt, transactional outbox, worker lease, retry and integration adapters |
| `reporting` | Read projections and versioned metric definitions; no alternate customer, vehicle or ledger stores |

Use a monorepo with `apps/api` and `apps/web`. Django apps own tables and service commands; they do not each become a separately deployed service. Keep a typical path to HTTP view, domain command, and owned models. Avoid repository wrappers that merely forward ORM calls. Generate web transport types from the versioned OpenAPI contract rather than duplicating them manually.

### Data structures and invariants

Use stable UUID identifiers and organisation/site foreign keys on business records. A vehicle is unique by normalised VIN within an organisation. Vehicle history spans sites; a visit and work order belong to one site. One controlling work order per visit has a database uniqueness constraint. Complaint and task numbers are unique within the work order. Customer and vehicle ownership changes append history.

Work orders contain independently recorded gate decisions, not one enum that implies every prior gate is valid. Tasks have their own state and scope revision. Holds are separate records with a typed task or work-order target, severity, owner, reason, source, open time, closure evidence and closure time. SQL checks enforce exactly one permitted target. Current status is a projection of these facts. A parts hold on T01 does not halt T02; an open vehicle safety hold blocks G4 regardless of payer status.

Consent is purpose-scoped. Estimate approvals identify a scope revision, tasks, payers, currency, approved ceiling and signed evidence. A variation creates a new revision and suspends affected work; diagnostic consent cannot authorise replacement. A decision snapshots the exact applicable named grant, effective interval and restrictions. Role labels never create technical or financial authority.

Store money in integer minor units with an explicit currency and currency precision policy. Store quantities and labour measurements as bounded decimals. Do not store floats for money or infer exchange rates. Keep proposed payer, approved immediate payer, recovery claim and reconciled cash as separate records. Store timestamps in UTC and display in the site's configured timezone.

### Concurrency and replay

Every command first authenticates current membership, then enters one PostgreSQL transaction. Acquire the aggregate work-order row lock, validate `expected_version`, evaluate current authority and record evidence, then persist the mutation, incremented version, audit event, command receipt and outbox item together. Inventory and finance commands lock additional owned rows in a documented deterministic order. All commands affecting release, including opening a safety hold, acquire the same work-order lock, so hold versus release cannot pass independently.

Unique command identity is organisation, site, actor and idempotency key. The canonical request hash includes command kind, target and payload. A matching replay returns the original receipt without a second effect; a changed payload returns conflict. Check for a receipt before evaluating stale expected-version failure, while still enforcing the caller's current read access. Savepoint handling resolves simultaneous receipt insertion without committing a partial mutation. A process crash commits all these records or none.

Grant revocation and sign-off must have a declared serialization rule. Lock each grant used for a decision while checking validity. Revocation uses the same lock; whichever commits first determines whether the act was valid. Snapshots preserve past decisions. G4 checks all required task outcomes, independent inspections, tests, residual-risk dispositions and holds in the release transaction. Released critical evidence cannot be silently edited; corrections append a reasoned revision and trigger the required reassessment.

### Identity and evidence

Use same-origin secure HttpOnly session cookies, CSRF protection, expiry, sign-out and individual accounts on shared devices. Add the selected staff identity provider and MFA before production. A site selector is an input to a server-verified membership, never a trusted tenant identifier. Deny unscoped querysets. Add PostgreSQL row-level tenant/site policies as defence in depth with a non-owner runtime database role and `SET LOCAL` inside explicit request and worker transactions. Test jobs, exports and admin paths as well as HTTP endpoints.

Keep domain writes out of generic Django admin CRUD; provide read-only investigation views and controlled configuration commands. Database runtime privileges and append-only triggers protect audit and signed decisions against application update/delete. Database owners can still alter data; restricted operator access, backup records and external audit export address that separate trust boundary.

Evidence uses private S3-compatible storage. Upload intent and object acceptance are separate states because an object upload and SQL commit cannot be one transaction. Finalize by checking object metadata, size, allowed type, checksum and malware result; only accepted evidence can satisfy a gate. Issue short-lived access after record-level authorization. Audit sensitive access and closeout exports. Never cache these URLs or content in the service-worker shell.

### Deployment and devices

Serve the React application and `/api/v1` behind one TLS origin at the proposed `vmms.raymond-gray.org`. Deploy one Django web process, one outbox worker, PostgreSQL and private object storage. Add a broker only when measured job throughput requires it; the outbox is durable without it. Use database backups plus object-version protection, independent restore drills, staging and structured request/command identifiers. Production refuses development secrets and insecure cookie settings.

The browser is the first supported client on Windows, macOS, iOS/iPadOS and Android after actual browser checks. Installability is a separate capability. A PWA provides shell installation and narrowly scoped drafts, not offline release, payment or stock issue. On shared hardware, drafts require account/site binding, explicit persistence choice, expiry and sign-out cleanup; surface quota/storage failures. Default to session-only drafts until the shared-device policy is agreed. Reauthentication and server revalidation are required when a draft becomes a command.

HarmonyOS browser compatibility and native packaging require their own device and SDK investigation. Do not presume an Android package runs on current HarmonyOS. Later Windows/macOS packages or mobile clients consume the same versioned API only if printers, diagnostics, scanning or durable offline work justify native code. No native shell owns a second set of business rules.

## First vertical slice

Implement membership-scoped sign-in, site selection, customer and VIN lookup, reception drafts, work-order creation, complaint addition and work-order/task hold creation and closure. Create a draft work order even if intake evidence is incomplete; record G1 only after custody, condition photographs, odometer, SOC/fuel and triage requirements are satisfied. Include read-only gate requirements and an attributable event timeline. Do not expose a generic state-change endpoint or a release button before the release command exists.

The HTTP boundary has `GET /api/v1/session`, `GET /api/v1/sites`, `GET /api/v1/work-orders`, `GET /api/v1/work-orders/{id}`, `POST /api/v1/intakes`, and command-specific complaint and hold endpoints. Mutations carry an idempotency key; existing aggregate commands carry expected version. Responses distinguish validation, forbidden, not found, stale version and idempotency conflict, with field errors and next permissible actions. Cross-scope object IDs return not found rather than leaking object existence.

## Verification that can reject this design

- Create an intake and C02 through the real API; inspect one visit/work order, two complaint records, one receipt per command and attributable audit rows.
- Race two complaint additions with the same version in PostgreSQL; exactly one succeeds, numbering remains unique, and the other receives a conflict.
- Replay a command after a simulated connection loss; no second effect occurs. Reuse its key with different content and receive conflict.
- Open a task hold and prove another task can progress. Race safety-hold creation against release and prove no released vehicle retains an unresolved pre-release hold.
- Revoke a grant concurrently with sign-off; verify lock ordering and the recorded authority snapshot. A superuser role does not bypass grant or independence rules.
- Attempt cross-site IDs, export paths, worker queries and admin writes using a normal runtime database role; no protected record is exposed or modified.
- Disconnect in the browser, retain only the permitted draft, reconnect, and revalidate. Sign-out and another staff login cannot expose the prior draft.
- Exercise desktop, narrow phone, keyboard and tablet layouts; then restore SQL and evidence into an isolated environment and reconcile IDs and hashes.

SQLite can speed local UI work but cannot satisfy PostgreSQL locking, row-security or restore acceptance. Failed or unavailable checks stay open in the tracker.

## Synthesis decision

Pending comparison with the independent alternative and the cross-judge. This candidate does not select itself.

## Tradeoffs accepted

- Accept two implementation languages in exchange for Django's mature transaction, migration, identity and administrative foundations plus a responsive typed client.
- Accept one deployable business application in exchange for atomic cross-domain decisions and lower operational overhead. Domain boundaries still permit later extraction if measured needs justify it.
- Accept an outbox worker and at-least-once delivery in exchange for durable external effects; every integration adapter needs its own idempotency contract.
- Accept online approval and transaction commands in exchange for authoritative current safety, stock and finance decisions during the first release.

## Alternatives considered

An all-TypeScript API can share transport tooling with React but still needs explicit transactions, grant logic, migrations, privileged administration and worker lifecycle. Shared language alone does not hide those decisions. It remains a viable competing candidate.

A desktop-first embedded database with bidirectional sync exposes conflict policy and stale authority to every core operation before staff can use the first web release. Reliable internet and unprocured devices do not justify that launch burden. Microservices similarly expose cross-service transaction and identity coordination without evidence of an independent scaling need.

## Open questions and risks

Which identity provider, shared-device policy and MFA method will management approve? Who supplies signed privilege schedules, effective SOPs, inspection rules, rates and payer agreements? What region, backup destination, recovery targets and operational owner fit the hosting budget? Which actual device peripherals would require native packages? These are review-register items and remain configuration or rollout dependencies.

## Next implementation step

Build the scoped identity and reception command transaction with real PostgreSQL replay, version-conflict and tenant-isolation checks before implementing the advisor intake screen.
