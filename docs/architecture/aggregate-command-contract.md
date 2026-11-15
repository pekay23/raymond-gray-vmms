# Aggregate command, event and outbox contract

Status: engineering design selected 8 November 2026; implementation and PostgreSQL proof are pending. This contract advances F-002, F-003 and F-006. It does not approve vehicle-owner operating policy or enable owner routes.

## Caller example

The domain module owns its authorization and business rules. The command boundary owns scoped transaction handling, idempotency, and the atomic persistence envelope.

```ts
await runStaffCommand({
  scope: authenticatedStaffScope,
  commandId,
  operation: "owner-access.relationship-approved",
  targetAggregateId: relationshipId,
  expectedVersion,
  payload,
  authorize: (tx) => requireOwnerAccessApproval(tx, relationshipId),
  apply: (tx) => approveVehicleOwnerRelationship(tx, relationshipId, payload),
});
```

This is a design sketch, not an exported API yet. `authenticatedStaffScope` is derived from the server-held session and active site membership. The request cannot set actor, organisation, site, approval grant, or resulting version. `requireOwnerAccessApproval` must check a dedicated named grant; `memberships.can_write` is not approval authority.

## Database shape

Use one registry for auditable aggregate roots, one append-only event ledger, the existing staff-scoped command receipts, and one outbox.

```sql
CREATE TABLE aggregate_roots (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id)
);

CREATE TABLE domain_events (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  actor_id uuid NOT NULL REFERENCES staff_users(id),
  event_type text NOT NULL,
  reason text NOT NULL,
  previous_state jsonb NOT NULL,
  new_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_id, aggregate_version),
  UNIQUE (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id, aggregate_id)
    REFERENCES aggregate_roots (organisation_id, site_id, id)
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  event_id uuid NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organisation_id, site_id, event_id)
    REFERENCES domain_events (organisation_id, site_id, id)
);
```

The production migration must also enable and force row-level security for aggregate roots, events and outbox; scope policies to transaction-local organisation and site context; grant only required runtime permissions; and deny runtime update/delete on event history. The domain root remains authoritative for its version. The root registry only links stable aggregate identity, type and scope. Owner relationship revisions remain domain-owned immutable state; they must not be confused with vehicle title.

`work_orders` and later audited roots have composite foreign keys to the registry using their organisation, site and ID. A root is inserted in the same transaction as its domain row. Events reference the root with a composite FK, and an outbox row references its event. This retains database-enforced tenant/site integrity without a nullable work-order target or unvalidated polymorphic ID.

`command_receipts` already has organisation, site, staff actor, command UUID, payload fingerprint, and JSON response. Keep that identity and parse each replay response with the owning command's response schema. Owner-initiated commands are out of this staff-command contract; a later principal/receipt contract must support owner actors without weakening staff actor references.

## Shared API boundary sketch

```ts
type StaffCommand<T> = {
  scope: Scope;
  commandId: string;
  operation: string;
  targetAggregateId: string;
  expectedVersion?: number;
  payload: unknown;
  responseSchema: ZodType<T>;
  lockSerializationRoots: (tx: PoolClient) => Promise<void>;
  authorize: (tx: PoolClient, membership: {canWrite: boolean}) => Promise<void>;
  apply: (tx: PoolClient) => Promise<{
    aggregateId: string;
    aggregateType: string;
    version: number;
    previous: unknown;
    next: unknown;
    reason: string;
  }>;
  project: (tx: PoolClient, mutation: CommandMutation) => Promise<T>;
};

function runStaffCommand<T>(input: StaffCommand<T>): Promise<T>;
```

The scope and actor are resolved before this boundary. Inside one transaction it must:

1. Set transaction-local tenant, site and actor context.
2. Lock and recheck active membership.
3. Lock the command's serialization roots in canonical order. Existing work-order hold, completion, release and post-release safety transitions use the same work-order lock; new-aggregate commands lock the applicable allocator or uniqueness root.
4. Invoke the command-specific authorization callback and lock/check current grants and qualifications. Revocation uses compatible locks.
5. Lock the idempotency key and load its receipt only after current membership and authority checks. Matching fingerprint returns the schema-validated stored response; changed content returns a conflict. Replay occurs before stale-version validation.
6. For a new command, validate the target type, compare the expected version when required, then call the domain mutation.
7. Persist the aggregate version change in its owning domain row, append one reasoned event, build the response projection after the event is visible in the transaction, insert its receipt and outbox row, and commit atomically.

Validation, authorization, stale-version and transaction failures leave no business, event, receipt or outbox writes. Same-version concurrent commands yield one accepted mutation. A repeated command ID with identical content has one accepted effect. Current membership and authorization are checked before any stored response is returned. `runStaffCommand` now requires each caller to acquire its scoped serialization roots after membership and before grants/qualifications; receipt lookup remains after current authority and before command `apply`, where stale-version checks stay. Existing work-order commands share the scoped work-order row lock. The new PostgreSQL tests cover target-before-grant, grant revocation, replay authorization and ledger atomicity. No G3/G4 command exists yet, so hold-versus-release proof remains with the later G4 implementation and `CHECK-R-M-0038`.

## Design selection

Two shapes were compared. Candidate A used an aggregate registry with a centralized event ledger and outbox. Candidate B used typed per-domain audit/outbox tables with a small shared staff command boundary. The cross-review selected A because future VMMS domains need a common event and delivery path, the registry retains ordinary composite foreign keys, and this greenfield system has no production records to migrate. The registry adds one write and composite FK for each audited root; keep it limited to identity, type and scope so it does not introduce a second version source.

Graft from Candidate B: authorization precedes replay; write authorization is domain-specific; the owner approval capability is separate from site write access; transport responses are validated by the owning domain. Rejected shortcuts: making `work_order_id` nullable without an aggregate reference weakens target integrity, while a free-form `aggregate_type/aggregate_id` pair cannot be enforced by an ordinary FK. Domain-specific authorization, events and projections remain inside their domain modules; only transaction and delivery mechanics are shared.

## Verification gate

Before marking the foundation complete, run the migration against an empty PostgreSQL database and prove:

- root, event and outbox RLS isolate two organisations and multiple sites under the non-owner runtime role;
- composite foreign keys reject a root, event, or outbox row with a mismatched organisation/site or missing aggregate/event;
- duplicate event versions and duplicate outbox event IDs are rejected;
- command replay returns one stored response, changed-payload replay conflicts, and stale concurrent versions produce one commit;
- forced event, receipt, and outbox failures roll back the domain mutation and all command records;
- runtime SQL cannot update or delete event history;
- all existing reception and work-order commands retain their current behavior.

## Review and rollout boundary

This schema shape is an engineering decision, not product or privacy approval. CUST-002 must stay gated until its owner access contract and named approver policy are resolved. The migration must preserve any existing local development work orders and audit history; production rollout is separately blocked pending the hosting and backup review.
