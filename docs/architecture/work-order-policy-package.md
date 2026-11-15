# Work-order policy package

**Status:** Accepted engineering model for a fail-closed configuration registry. It does not approve or publish workshop rules. G2, G3 and G4 remain unavailable until REV-006, REV-008, REV-009 and REV-035 are resolved.

## Caller view

Future G2, execution, G3 and G4 commands will resolve one complete site policy package inside their existing database transaction:

```ts
const policy = await requireEffectiveWorkOrderPolicy(client, {
  organisationId: scope.organisationId,
  siteId: scope.siteId,
  workOrderId,
  expectedWorkOrderVersion,
});
```

The resolver returns a validated immutable snapshot or a `POLICY_UNAVAILABLE` denial. It derives the current vehicle, task, site and transaction time from server-owned records. The browser cannot submit a policy revision, task classification, required check, approval, gate result or trusted timestamp.

Resolving a policy package only tells a future command which approved rules it must enforce. It does not approve a job's repair scope, authorize a technician, sign G3/G4, move a vehicle, close G5 or authorize departure. No current command calls this resolver, and G2/G3/G4 remain pending.

## Package shape

Store one immutable, schema-versioned package revision per organisation and site. The strict package schema owns the source references and applicability rules for:

- task classes, models and vehicle systems;
- effective work instructions and G2 scope references;
- execution records, evidence and technician declarations;
- conditional HSE controls and their approved applicability sources;
- inspection requirements, outcomes, evidence and independence rules;
- fault dispositions and blocking behavior;
- release authority references, blocking-hold rules and collection-zone custody evidence.

Every policy reference carries a unique pin ID plus a source identifier, source revision and SHA-256 digest. Sections refer to the pin ID, so a package cannot ambiguously select one of multiple revisions by document name alone. Applicability must be explicit and bounded; wildcard coverage is not accepted. Cross-references must resolve within the exact package revision. The package schema is versioned independently from its site revision number.

Package content is canonicalized before hashing. The digest binds the schema version, package identity and revision, effective interval, source pins, applicability, and every rule section. A policy approval record must refer to that exact digest. This is an authenticated application approval record, not a claim about legal electronic signatures.

Empty or partial sections never mean “no checks required.” An absent package, unsupported schema, invalid digest, missing section, incomplete coverage, unknown reference, no unique applicable package, or unresolved required source returns `POLICY_UNAVAILABLE`. The validator does not supply actual task classes, safety procedures, thresholds, test methods, evidence categories, inspection results, fault outcomes, signer rules or custody methods.

## Storage and access

The target API owns two append-only record families, now present in migration `043_work_order_policy_ledger.sql`:

- `work_order_policy_package_revisions`: organisation/site, package ID and revision, schema version, strict JSON content, digest, effective interval, creator and database timestamp.
- `work_order_policy_package_decisions`: exact package revision and digest, decision action, actor, authority snapshot, reason, command ID and database timestamp.

Both use composite organisation/site foreign keys and forced row-level security. Revisions and decisions cannot be updated or deleted. The API runtime role has SELECT only. The migration creates empty storage; it does not provide an API, UI, CLI, seed, or other write path. In particular, it does not let staff draft, approve, activate, reject or withdraw policy. No production values or approval events are seeded. Governance write commands require the approved authority and review process from REV-006 before implementation. Source-pin identities and digests are stored as candidate declarations; the database does not prove that the pinned controlled-document bytes exist or match.

The future resolver must read policy only within an existing site-scoped transaction and use PostgreSQL's transaction clock. It must require exactly one approved, effective revision whose digest and references validate for the requested work. If no usable approved decision exists, it must deny. No cache may outlive the current transaction or bypass effectivity checks. The current validator cannot produce an operationally available policy even for a valid synthetic candidate.

## Module ownership and future command order

`apps/api/src/work-order-policy.ts` currently owns only the strict structural schema, canonical digest, unique source-pin checks, package completeness checks and fail-closed candidate validation. The returned parsed snapshot is deeply frozen. This helper does not fetch or verify controlled source content, and it has no database resolver. Workshop commands remain in their domain modules and own G2, execution, G3 and G4 decisions. Future decisions will snapshot the policy package ID, revision and digest alongside their separate action-time authority and qualification snapshots.

Future commands retain the established order: lock/recheck membership; lock the work-order root; resolve and serialize access to the exact policy revision; lock/recheck action-specific grants and qualifications; acquire/check the idempotency receipt; evaluate current scope and evidence; atomically write domain records, decision, audit event, receipt and outbox. Policy approval/withdrawal must use compatible locks before an operational command may rely on effectivity. No race-safety claim is made until those write commands and PostgreSQL concurrency tests exist.

## Why this shape

Two independently designed alternatives were reviewed in `candidates/work-order-policy-package-a.md` and `candidates/work-order-policy-normalized-b.md`. The package revision was selected because the approval and runtime decision need to bind one coherent, exact ruleset; a package ID, revision and digest give a small lookup surface and prevent partial activation across domains. From the normalized proposal, this design keeps explicit component-level source revision and digest pins, so policy content remains traceable to controlled documents.

The normalized activation-manifest design remains a future option if the actual governance process needs independently owned revision lifecycles. It is deferred because its many revision streams and cross-family activation rules add substantial machinery before the source policies and owners exist. Policy fields are not copied into work orders, and arbitrary JSON is not accepted without strict schema and digest validation.

## Verification boundary

Synthetic tests may validate strict parsing, digest integrity, reference consistency, empty/partial denial, effective-time boundaries, ambiguous matches, organisation/site isolation and runtime immutability. Synthetic fixtures must live only in disposable test databases. They do not establish approved procedures, authority, safe repair criteria, G2/G3/G4 readiness, or permission to release a real vehicle.

The structural validator and the empty append-only storage ledger have separate implementation and verification tasks in `docs/delivery/tasks.json`. Operational acceptance remains gated by REV-006, REV-008, REV-009 and REV-035. Even a database-owner inserted synthetic `approved` decision is only a test fixture: the API has no resolver and the candidate validator still returns `POLICY_UNAVAILABLE` for every otherwise-valid package.
