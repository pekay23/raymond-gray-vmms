# Candidate B TypeScript command application

## Usage from the caller

An advisor signs in, selects an authorised site, and saves a reception draft. The draft contains the customer's actual complaints. Saving does not accept G1, grant diagnostic consent, or authorise repair. The browser calls three operations rather than coordinating database writes.

```ts
const intake = await vmms.createIntakeDraft({
  commandId: crypto.randomUUID(),
  vehicle: { vin, registration, make, model, powertrain },
  customerId,
  complaints: ["Intermittent charging interruption"],
});
const updated = await vmms.addComplaint({
  commandId: crypto.randomUUID(),
  workOrderId: intake.id,
  expectedVersion: intake.version,
  wording: "Vibration under braking",
});
await vmms.openHold({
  commandId: crypto.randomUUID(),
  workOrderId: updated.id,
  expectedVersion: updated.version,
  scope: { kind: "workOrder" },
  category: "safety",
  severity: "stop",
  reason: "Battery enclosure impact reported; assessment required",
});
```

Neither the caller nor its request body supplies an actor, organisation, approving privilege, or a gate result. The server derives identity and scope from the authenticated session and site membership. A returned work-order projection contains its new version, complaint references, open holds, gate evidence status, and permitted next actions.

## Problem and constraints

Build a new VMMS for one service centre with expansion to additional sites. The user confirmed reliable internet, web-first use with saved drafts, and no real legacy records to migrate. Functional requirements remain authoritative even though the user superseded the in-place upgrade constraint. Legacy import is future capability, not launch migration work.

The inspected portal has separate booking and estate-task models, direct status mutations, and optional unawaited secondary writes. This candidate replaces those assumptions with a canonical work-order record and transactional commands. Its initial slice covers reception drafts, complaint/task records, scoped holds, and history. Full G1 acceptance and G2-G5 remain blocked until their actual evidence and controls exist.

## Shape

Use a React TypeScript client built with Vite, a long-running Fastify TypeScript server, and PostgreSQL. Keep one backend deployment and one database. Do not place business commands inside frontend framework server actions. This preserves the same explicit HTTP API for browser clients, later device adapters, tests, and integrations.

Choose Node 24 LTS initially because it is already installed locally and has ecosystem maturity; pin a supported patch in the build and recheck dependency compatibility. Node's official [release table](https://nodejs.org/en/about/previous-releases) lists both 24 and 26 as LTS on the review date. Check the chosen Fastify major against its [support policy](https://fastify.dev/docs/latest/Reference/LTS/) before locking packages. Do not infer support from successful installation.

The server uses explicit SQL through Kysely and versioned SQL migrations. PostgreSQL owns constraints, references, append-only event protection, exact money storage, and transaction isolation. Fastify owns HTTP parsing, response schemas, sessions, CSRF, and limits. Domain modules own decisions. Module commands open the transaction themselves so a caller cannot forget audit or idempotency.

### Domain contracts

The following is a design sketch, not an implemented SDK. Boundary parsers construct opaque IDs and validated wording; consumers cannot substitute a vehicle ID for a work-order ID. Transport schemas stay private to the HTTP adapter, per boundary discipline and type-system discipline.

```ts
type WorkOrderId = string & { readonly __brand: "WorkOrderId" };
type TaskId = string & { readonly __brand: "TaskId" };
type CommandId = string & { readonly __brand: "CommandId" };
type EvidenceId = string & { readonly __brand: "EvidenceId" };
type Version = number & { readonly __brand: "Version" };
type HoldScope =
  | { kind: "vehicle" }
  | { kind: "workOrder" }
  | { kind: "task"; taskId: TaskId };
type GateEvidence =
  | { kind: "pending"; missing: readonly RequirementCode[] }
  | { kind: "accepted"; decisionId: DecisionId; at: Instant };
type DiagnosticOutcome =
  | { kind: "confirmed"; evidence: readonly EvidenceId[] }
  | { kind: "inconclusive"; observations: string; restrictions: string };
type CommandResult =
  | { kind: "committed"; workOrder: WorkOrderView; replayed: boolean }
  | { kind: "blocked"; reasons: readonly BlockReason[] }
  | { kind: "conflict"; currentVersion: Version };

function createIntakeDraft(
  actor: AuthenticatedSiteActor, command: CreateIntakeDraft,
): Promise<CommandResult> { throw new Error("not implemented"); }
function addComplaint(
  actor: AuthenticatedSiteActor, command: AddComplaint,
): Promise<CommandResult> { throw new Error("not implemented"); }
function openHold(
  actor: AuthenticatedSiteActor, command: OpenHold,
): Promise<CommandResult> { throw new Error("not implemented"); }
```

The public command surface hides membership checking, scoped record loading, locking, policy evaluation, audit creation, idempotency, and commit. It exposes the business decision, expected version, and evidence. Call chains remain HTTP route to command module to database transaction. Avoid controller/service/repository layers that merely forward the same arguments.

### Module ownership

| Module | Owns | Boundary |
| --- | --- | --- |
| `identity` | Accounts, sessions, membership, OIDC adapter, device sessions | Produces authenticated actors; cannot create technical grants |
| `authority` | Named grants, validity, restrictions, revocation, decision snapshots | Evaluates a person/action/site/model/work class at action time |
| `reception` | Customer, vehicle, ownership, bookings, visit and custody | One canonical vehicle per organisation VIN; preserves ownership history |
| `work-orders` | Complaints, tasks, scope revisions, diagnostics, G1-G5 decisions | Coordinates each work-order command transaction |
| `safety` | Scoped holds, permits, incidents, battery quarantine | Opening a protective hold differs from authorising work or resolving it |
| `quality` | Inspection criteria, independent checks, tests and technical release evidence | Inspector cannot satisfy a required independent check for own work |
| `materials` | Catalogue, fitment, procurement, lots, custody, reservations, movements | Issues create immutable stock movements and task costs atomically |
| `commercial` | Coverage, proposed/approved payer, costs, invoices, receipts, recovery | Recovery claims remain distinct from reconciled cash |
| `people-assets` | Competence evidence, training, equipment and calibration | Readiness facts never become signed authority automatically |
| `governance` | Controlled revisions, audits, CAPA, incidents and acknowledgement | Only effective approved revisions are operational instructions |
| `evidence` | Private object metadata, hashes, quarantine and scoped downloads | An uploaded object is usable only after processing succeeds |
| `reporting` | Defined metrics and read projections | No independent editable operational truth |

Place these under `apps/server/src/modules`. `apps/web` owns pages and local drafts. `packages/api-client` is generated from OpenAPI and owns wire types only. Domain types are server-private. `packages/ui` holds actual reused accessible controls, not speculative abstractions. Shared tooling owns linting, checks, and contract generation.

### Storage and transaction invariants

Every business row has organisation/site ownership where applicable and a stable UUID. Vehicle and customer identity is organisation-scoped; visits and work orders are site-scoped. Composite scoped foreign keys prevent linking another organisation's task, evidence, or vehicle. Queries use explicit scope and PostgreSQL row security with a non-owner application role. [Row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) is a second boundary, not a substitute for application checks; owners and privileged roles require separate testing.

Use UUID identifiers independently from readable site/year references. Allocate references from a locked counter or database sequence, never a maximum-row read. A visit has a unique controlling work order. Complaint/task ordinals are unique within that work order. Money uses integer minor units plus currency, or explicitly scaled decimals where required; never JavaScript floating-point arithmetic for financial totals.

Each mutating command atomically writes its domain changes, append-only audit event, command receipt, and durable outbox rows. The receipt key includes organisation, site, actor, operation, and command ID. A canonical payload hash distinguishes replay from key reuse. Recheck current session/site access before returning a replay. The receipt preserves the original result and authority snapshot rather than rerunning an approval with today's grants.

Serialise commands affecting a vehicle's release eligibility in a consistent lock order: vehicle, work order, tasks, then materials/commercial rows as needed. Require `expectedVersion` and advance the aggregate version for every release-relevant mutation, including holds and scope changes. A release command rechecks holds, grants, tests, inspection independence, and approved scope inside the transaction. A concurrently opened safety hold must either precede release and block it or follow release as a recorded recall/incident workflow. It must never silently disappear.

PostgreSQL [row locks](https://www.postgresql.org/docs/current/explicit-locking.html) provide the coordination mechanism; tests must prove the chosen transaction paths use it. Immutable audit tables deny update/delete to the application role. Corrections append events. Separately controlled audit exports are needed for stronger protection against database administrators; a hash field alone does not establish tamper resistance.

## Initial vertical slice

| API | Preconditions and committed result |
| --- | --- |
| `GET /api/v1/session` | Authenticated session returns permitted sites and UI capabilities; no implicit technical authority |
| `GET /api/v1/work-orders` | Membership-scoped list, bounded pagination, filters, no cross-site aggregate counts |
| `POST /api/v1/intake-drafts` | `Idempotency-Key`; validates VIN and references, creates visit/WO/C01 as a draft with one audit event |
| `GET /api/v1/work-orders/:id` | Scoped detail, complaint/task states, holds, version and gate evidence; unauthorised IDs reveal no record |
| `POST /api/v1/work-orders/:id/complaints` | Expected version plus idempotency; appends C02/C03 without another WO |
| `POST /api/v1/work-orders/:id/tasks` | Expected version plus idempotency; creates a planned task linked to complaints, never dispatches or approves work |
| `POST /api/v1/work-orders/:id/holds` | Valid scoped target, category, severity, owner, source and reason; authorised protective reporting does not require billing approval |
| `GET /api/v1/work-orders/:id/history` | Scoped, paginated attributable history; significant sensitive access is audited |

Return `401` for expired login, `403` for missing capability/site membership, `404` for invisible object IDs, `409` for stale version or different-payload key reuse, and field-level `422` validation errors. Business blocks return stable codes and safe next actions. Never return raw SQL, object-store paths, or authority evidence beyond the caller's access.

The first slice has no generic status PATCH, release endpoint, hold-resolution shortcut, financial posting, or production seed that grants authority. G1 acceptance follows only after custody evidence, measurements, photos/condition and triage requirements are implemented and validated. A reception screen alone cannot complete M02 or AT-02.

## Deployment and identity

Serve the SPA and `/api` through one HTTPS origin at proposed `vmms.raymond-gray.org`. One container image runs the API; a second process from the same image consumes the PostgreSQL outbox using leased rows and retry bounds. PostgreSQL plus private S3-compatible object storage are durable dependencies. Add a separate broker only when demonstrated workload requires it. Email and other external effects use command-specific idempotency and adapters.

Use individual staff identities and server-held sessions in Secure HttpOnly SameSite cookies with CSRF and origin checks. Production identity should federate to the approved staff OIDC provider with MFA; the provider remains a review item. Development accounts must be explicitly isolated and never substitute for production identity or named authority. Shared computers require per-person sessions, sign-out, inactivity lock and draft separation.

Deploy staging separately with synthetic data. Application credentials cannot alter schema or audit history. Migration credentials are separately controlled. Backups include PostgreSQL, evidence objects, configuration and secrets recovery procedures. Release acceptance includes a measured restore and forward-recovery exercise, not merely a backup job.

## Devices and saved drafts

The first product is a responsive browser application for workstation, tablet and phone. An installable PWA can follow manifest/service-worker verification. Cache the application shell deliberately; exclude authenticated responses, evidence, and financial exports from shared caches. Local drafts use IndexedDB records partitioned by account/site with timestamps and an explicit retention policy. Persist only the agreed draft fields and explain shared-device visibility.

Drafts are unsubmitted proposals, not offline work orders or approvals. On reconnection, show what is pending, reauthenticate, revalidate version and authority, and submit a named command after staff review. Do not replay arbitrary HTTP mutations or promise background completion on all operating systems. Session changes lock or clear the previous person's drafts according to the approved device policy.

Use the browser/PWA on Windows, macOS, Linux, Android, iOS and iPadOS subject to real-device tests. Packaging with Tauri or Capacitor is a later decision driven by scanner, printing, storage, distribution or device-management needs. HarmonyOS requires its own browser tests and, if a native package is needed, an ArkTS/ArkWeb assessment. Android support does not establish HarmonyOS compatibility. Full offline synchronisation remains a separately scoped future project with revocation and conflict rules.

## Tradeoffs accepted

- Accept explicit SQL migration and access-policy work in exchange for visible transaction and tenant guarantees.
- Accept a dedicated API process in exchange for stable command contracts across clients and frontend releases.
- Accept more identity/admin tooling than Django supplies in exchange for one application language and schema-derived client contracts.
- Accept an online server for authoritative work in exchange for coherent safety, stock and commercial decisions at launch.
- Accept a normal modular monolith in exchange for one transaction boundary; no event-sourced rebuild or microservice choreography is needed.

## Alternatives considered

Next.js alone would combine page delivery and command implementation, but its server-action interface is less suitable as the enduring device/integration contract. A REST API still needs explicit domain commands, so a dedicated server keeps that ownership direct. NestJS adds useful conventions for a larger team, but controller/service/repository forwarding and decorator-heavy policy can increase the number of places a reviewer must inspect. Fastify modules can expose one command without that hierarchy.

Local-first SQLite on every device exposes identity revocation, release conflicts and financial reconciliation to the initial caller experience. That cost is unjustified with reliable internet. A managed backend with client-written tables hides infrastructure but exposes transactional safety policy across database rules and client calls; retain all authoritative commands on the server.

## Validation and next step

Build a real PostgreSQL integration fixture before command implementation. Prove duplicate intake replay creates one visit/WO/C01/event; changed-payload replay conflicts; C02 stays on the same WO; stale versions do not write; task holds leave unrelated task drafts editable; cross-site IDs and exports reveal nothing; audit mutation is denied; and rollback leaves no orphan event, receipt or outbox item.

Then test G1 evidence completeness, grant expiry/revocation, diagnostic-only consent rejection, inspection independence, release/hold races, payer reconciliation and restore as those commands arrive. Browser tests cover keyboard entry, readable conflict messages, mobile layout, draft recovery, account switching and network failure. PostgreSQL concurrency evidence cannot be replaced by SQLite or mocked repositories.

Open reviews are the identity provider, approved SOP library, signed authority matrix, financial policy, hosting/data residency, shared-device draft policy, pilot staff and actual procurement devices. No missing answer permits a guessed approval.

The next implementation step is the PostgreSQL schema, transaction and policy fixture plus the reception-draft commands and their API tests. Synthesis selection belongs to the parent review; this candidate does not declare itself accepted.
