# Candidate A: Versioned work-order policy package

**Status:** Candidate for architecture synthesis; not accepted architecture. This document proposes a configuration and decision boundary for future G2/G3/G4 work. It does not approve a procedure, inspection, competence, signatory, disposition, custody method, or operational transition.

**Policy inputs remain pending:** REV-006 (named authority and limits), REV-008 (controlled SOP library), REV-009 (model-specific safety procedures and inspection/equipment policy), and REV-035 (execution, QA, fault, hold, release, custody and rework policy). Until those reviews supply approved inputs, the registry remains empty and G2/G3/G4 remain unavailable.

## Caller usage

Future G2, technician execution, G3, and G4 commands call the policy resolver inside the same PostgreSQL transaction as their business decision. The resolver returns an immutable, validated snapshot for the exact work-order scope, or denies the operation. A package configures the rules a command must check; it does not constitute the work order's G2 approval, authorize dispatch or repair, sign G3/G4, approve G5, or authorize collection or departure.

```ts
type PolicyUse = {
  organisationId: string;
  siteId: string;
  workOrderId: string;
  expectedWorkOrderVersion: number;
  vehicle: {
    powertrainClass: string;
    modelCode: string;
    systems: readonly string[];
  };
  taskIds: readonly string[];
};

type EffectivePolicySnapshot = {
  packageId: string;
  revision: number;
  contentDigest: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  applicableTaskRules: readonly TaskPolicyRule[];
  applicableHseRules: readonly ConditionalHseRule[];
  applicableInspections: readonly InspectionRule[];
  faultDispositionCatalogs: readonly FaultDispositionCatalogRef[];
  releaseRules: ReleasePolicy;
  approvalDecisionIds: readonly string[];
};

async function requireEffectiveWorkOrderPolicy(
  client: PoolClient,
  use: PolicyUse,
): Promise<EffectivePolicySnapshot>;

// Called by future G2 authorization, execution, G3 and G4 command owners.
// Missing or ambiguous policy throws ApiError(409, "POLICY_UNAVAILABLE", ...).
```

The caller supplies only server-derived organisation/site/work-order scope, the persisted vehicle and task identities, and expected version. The resolver reads `transaction_timestamp()` on the same database transaction. It must not accept client-supplied actor, effective policy revision, decision result, gate state, model, task classification, inspection outcome, time, or authority snapshot as trusted inputs. The server resolves those from current persisted records and policy.

Each decision stores the returned package ID, revision, digest and approval decision IDs. It also records its own action-time authority/qualification snapshots, inputs, evidence references, reason, work-order/task/scope revisions and server timestamp. Replaying a command returns its original receipt only after current membership and authority checks, as required by the shared command contract.

## Typed package content

The package is a single, versioned policy artifact for one organisation and site. Its strict schema version is independent from its monotonically increasing revision. It covers the entire configured workflow from task applicability through G4 collection-zone placement; G5 invoicing/payment/guarantee, customer handover and physical departure stay separate.

```ts
type WorkOrderPolicyPackageV1 = {
  schemaVersion: 1;
  organisationId: string;
  siteId: string;
  packageId: string;
  revision: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  controlledSources: readonly ControlledSourceRef[];
  coverage: readonly PolicyCoverage[];
  taskRules: readonly TaskPolicyRule[];
  conditionalHseRules: readonly ConditionalHseRule[];
  inspectionRules: readonly InspectionRule[];
  faultDispositionCatalogs: readonly FaultDispositionCatalogRef[];
  releaseRules: ReleasePolicy;
};

type ControlledSourceRef = {
  sourceId: string;
  revision: string;
  digest: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

type PolicyCoverage = {
  powertrainClassRef: string;
  vehicleModelRefs: readonly string[];
  systemRefs: readonly string[];
  taskClassRefs: readonly string[];
};

type TaskPolicyRule = {
  ruleId: string;
  classificationRef: string;
  appliesTo: PolicyCoverage;
  instructionRefs: readonly ControlledSourceRef[];
  requiredG2ScopeRefs: readonly string[];
  executionRecordRequirements: readonly {
    requirementRef: string;
    evidenceTypeRef: string;
    sourceRef: ControlledSourceRef;
  }[];
  declarationTemplateRef: ControlledSourceRef;
};

type ConditionalHseRule = {
  ruleId: string;
  applicabilityRef: ControlledSourceRef;
  appliesTo: PolicyCoverage;
  requiredEvidenceRefs: readonly {
    categoryRef: string;
    evidenceTypeRef: string;
    sourceRef: ControlledSourceRef;
  }[];
};

type InspectionRule = {
  checkRef: string;
  appliesTo: PolicyCoverage;
  criticalityRef: string;
  requiredEvidenceRefs: readonly string[];
  outcomeCatalogRef: ControlledSourceRef;
  independenceRuleRef: ControlledSourceRef;
};

type FaultDispositionCatalogRef = {
  appliesTo: PolicyCoverage;
  dispositionCatalogRef: ControlledSourceRef;
  blockingSemanticsRef: ControlledSourceRef;
};

type ReleasePolicy = {
  requiredPriorDecisionRefs: readonly string[];
  holdBlockingRulesRef: ControlledSourceRef;
  releaseAuthorityRef: ControlledSourceRef;
  collectionZoneCustodyRequirements: readonly {
    requirementRef: string;
    evidenceTypeRef: string;
    sourceRef: ControlledSourceRef;
  }[];
  departureIsSeparate: true;
  g5IsSeparate: true;
};
```

These are type shapes, not approved data dictionaries. `*Ref` values must resolve to a controlled, approved source or taxonomy. This candidate intentionally does not enumerate vehicle models, task classes, systems, tests, evidence types, HSE triggers, permits, instruments, check outcomes, criticality codes, independence roles, fault dispositions, blocking outcomes, custody evidence, or thresholds. REV owners must supply and approve those values and definitions.

The package schema rejects unknown fields, unrecognized references, duplicate rule keys, empty applicability, empty coverage, unbounded wildcards, missing source digests, invalid intervals, and incomplete rule sets for declared coverage. Empty arrays never mean “no checks required.” If a policy cannot declare complete coverage for the requested work, resolution fails closed.

## Approval and digest model

The server canonicalizes the validated, versioned package content and stores a SHA-256 content digest. A policy approval is an append-only authenticated decision over that exact digest. The decision records:

- The actor, organisation, site, trusted transaction time, reason and command ID.
- The exact digest, package ID and revision being approved.
- A current action-specific authority decision snapshot, including the grant revision and any required governance evidence.
- The signature-recording mechanism and version, so later verification can reproduce the approval record.

This is an application approval record. It does not claim to satisfy a legal electronic-signature requirement; that requirement and any additional signer rules remain for the records owner and REV-006 authority schedule. No role title or administrator flag creates approval authority. The capability name, signer count, substitutions, limits and provisioning workflow are not fixed by this candidate.

Any content change creates a new revision and digest, requiring fresh approval. Approval, effectivity, supersession, withdrawal and revocation are separate append-only decisions. Signed content and prior decisions are never edited or deleted. A package is eligible only when an authorized approval exists for its exact digest, all required decisions and sources are effective, the package interval includes transaction time, and no later withdrawal or supersession applies.

Resolution requires exactly one eligible package for the requested site and complete task/model/system coverage. Zero matches, multiple matches, a gap in coverage, an expired/future package, missing approval, a digest mismatch, unresolved source revision, or unknown rule produces `POLICY_UNAVAILABLE`. The resolver must not select the “closest” or latest package to make a request succeed.

## PostgreSQL persistence sketch

Names are proposed and may change during synthesis. All records are organisation/site scoped, use composite foreign keys for related rows, and are protected by RLS with forced RLS. The API runtime role receives only the insert/read rights needed by command-specific functions; it receives no update/delete rights on revisions, rule rows, approvals or decision history.

```sql
CREATE TABLE work_order_policy_package_revisions (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  package_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  canonical_content jsonb NOT NULL,
  content_digest bytea NOT NULL CHECK (octet_length(content_digest) = 32),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organisation_id, site_id, package_id, revision),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites(organisation_id, id)
);

CREATE TABLE work_order_policy_package_decisions (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  package_id uuid NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'withdraw', 'supersede')),
  content_digest bytea NOT NULL CHECK (octet_length(content_digest) = 32),
  actor_id uuid NOT NULL,
  authority_snapshot jsonb NOT NULL,
  reason text NOT NULL,
  command_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id, site_id, actor_id, command_id),
  FOREIGN KEY (organisation_id, site_id, package_id, revision)
    REFERENCES work_order_policy_package_revisions
      (organisation_id, site_id, package_id, revision)
);
```

Rule children should be normalized into append-only, revision-keyed tables (task rules, HSE conditions, inspections, fault catalog links and release/custody requirements) with non-empty scoped references and composite foreign keys. The canonical content and digest permit independent integrity verification; child rows make exact lookup, scope checks and database constraints explicit. At write time, the server verifies that both forms represent the same strict schema-valid package before inserting. If canonical JSON and normalized rows differ, reject the revision.

The `action` examples above describe lifecycle events, not an approval vocabulary or signer policy. Whether `approve` alone makes a revision effective, and which additional review decisions it requires, must be defined by the pending governance schedule. An empty decision table or absent approved authority must always produce unavailable policy.

## Module ownership and API boundaries

- `apps/api/src/work-order-policy.ts` owns the strict content schema, canonicalization, source-reference verification, coverage matching, approval/effectivity resolution and read-only immutable policy snapshot.
- A command-specific policy administration module may later own proposal and approval operations, but only after the governance capability, signer rules and review workflow are approved. It must derive actor/site from the authenticated server session and may not accept trusted authority snapshots from the browser.
- A future `apps/api/migrations/030_work_order_policy_packages.sql` (number subject to migration state at implementation time) owns tables, scoped constraints, RLS and least-privilege grants. Do not edit previously deployed migrations.
- `apps/api/src/workshop.ts` remains the owner of G2, execution, G3 and G4 domain commands. Those commands call the resolver and snapshot its exact revision/digest; policy definitions do not live as ad-hoc conditions in `workshop.ts`.
- The web app may later offer policy proposal/review screens for authorized named approvers. Until then, no production policy can be created through a generic admin form or development seed.

## Security, transaction and lock boundaries

Future work-order commands preserve the accepted command order:

1. Authenticate, derive organisation/site and lock/recheck active membership.
2. Lock the scoped work-order root (and any other business roots in stable sorted order).
3. Lock and resolve the policy package root/revision; verify the exact content digest, approval, effectivity and complete applicability.
4. Lock and recheck action-specific grants, qualifications and independent-signer rules.
5. Acquire/check the idempotency receipt after current membership and authority checks.
6. For a new command, reject stale work-order/scope/evidence versions and evaluate every policy requirement against persisted records.
7. Atomically persist the business decision, policy/authority snapshots, audit event, receipt and outbox item.

Package approval/withdrawal must use a lock compatible with policy reads. A package change racing G2/G3/G4 must have one serial result: if withdrawal commits first, the command denies; if the command holds the still-effective revision first, it records that exact digest and its decision cannot later be rewritten. Multi-root operations use one canonical lock ordering, coordinated with `BUILD-CMD-LOCK-ORDER-001`; add PostgreSQL race tests before claiming this property.

Package lookup must not leak policy or record existence across organisation/site boundaries. Policy IDs, task IDs, model references, instruction refs and evidence refs are never standalone authorization. Do not trust browser timestamps, gate claims, staff titles, prior approval displays, cached policy, or old signatures after withdrawal/revocation.

## Verification cases

All fixtures use synthetic identities and policy in a disposable database. Tests do not seed actual authority, instructions, safety values or inspection outcomes.

1. **Empty default:** no package and empty rule/inspection arrays deny G2/G3/G4; all gates remain pending. Empty configuration is not a pass.
2. **Strict shape:** unknown fields, missing source digest, empty coverage, wildcard scopes, duplicate applicability, invalid interval, dangling references and partial coverage are rejected.
3. **Exact approval:** approval for a different digest/revision, unauthorized actor, missing grant snapshot, invalid signature-record version or altered content denies.
4. **Effectivity:** future, expired, withdrawn, superseded and not-yet-approved revisions deny. A new content revision requires a new approval; prior signed evidence remains unchanged.
5. **Applicability:** unknown task/model/system/powertrain, missing conditional HSE classification, absent exact instruction revision or more/less than one matching package denies.
6. **Inspection/release readiness:** missing inspection outcome catalog, independence rule, fault disposition policy, hold rule, G4 authority reference, or collection-zone custody requirements denies. No built-in “not applicable” outcome is inferred.
7. **Tenant/site:** cross-organisation/site proposal, approval, lookup, task reference or policy reuse denies under the runtime role and RLS.
8. **Immutability:** runtime UPDATE/DELETE on revisions, rule children and decision events fails; command failures roll back revision rows, approvals, receipts, events and outbox items atomically.
9. **Replay/staleness:** identical approval command returns its validated receipt; changed payload conflicts; stale policy/work-order/evidence revision denies without partial writes.
10. **Race safety:** PostgreSQL concurrency tests coordinate approval/withdrawal with a work-order command under production lock ordering. Withdrawal-first denies; command-first records the approved digest and cannot be retroactively altered.
11. **No operational bypass:** package approval cannot create G2 scope, technician privilege, G3 completion, independent QA result, G4 release, G5 financial approval, collection-zone custody or departure by itself.

## Rationale and alternatives

### Candidate A: one signed package revision

A single immutable revision makes it possible to review a coherent set of interdependent requirements, bind decisions to one digest, and prove which task, HSE, inspection, fault and release policy was consulted. It prevents partial rollouts from accidentally treating missing rules as optional. It also gives commands one policy snapshot to retain in the audit history.

### Alternative B: independent versioned registries

Separate instruction, task-classification, HSE, inspection, fault, custody and authority registries are more modular and can be updated independently. They also introduce more version combinations and partial activation states. If selected, they need an explicit signed composition manifest that pins every registry revision and digest; otherwise a G3/G4 command could combine incompatible policies.

### Alternative C: policy JSON embedded in each work order

This simplifies local reads but duplicates policy, complicates revocation and cross-job reporting, and risks trusting the browser or stale work-order copies. It is not recommended unless the copy is a server-generated immutable snapshot referencing an approved package digest.

### Trade-off

Candidate A favors review integrity and a clear fail-closed decision over independent policy publishing. Policy resolution must be efficient and transaction-safe; current package/revision lookup should be indexed and the verified snapshot cached only within a request transaction. No cache may override effectivity or revocation checks.

## Explicit exclusions

This candidate does not define workshop procedures, thresholds, task classifications, vehicle-model mappings, required test methods or values, permit rules, evidence vocabularies, inspection checks, independence roles, fault outcomes, hold classifications, custody proof, policy signer identity/count/substitutions, legal signature meaning, finance rules, or production seed data. The owner, technical/safety lead, service-centre management, finance owner and privacy/records owner must provide the applicable decisions through REV-006, REV-008, REV-009 and REV-035 before operational policy is populated or any G2/G3/G4 command can be enabled.
