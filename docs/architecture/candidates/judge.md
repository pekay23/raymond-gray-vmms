# Architecture cross-judgment

Reviewed both candidates end to end against the comparison rubric and the source clauses listed below. This is a design review by an available Codex reviewer, not evidence of implementation or an external model evaluation.

## Decision

Select candidate B, the TypeScript command application, as the implementation base, with the mandatory additions below. Its narrow command path, explicit draft-only launch boundary, and single application language suit the confirmed web-first, one-site launch. The margin is small. Django remains a credible alternative and has the stronger description of authority serialization and evidence acceptance.

Scores award points out of each criterion's weight. They measure the written proposal, not working software.

| Criterion | Weight | A | B | Evidence and deduction |
| --- | ---: | ---: | ---: | --- |
| Transaction and safety integrity | 30 | 27 | 26 | A `Concurrency and replay` specifies grant/revocation locking and receipt-before-version handling. B `Storage and transaction invariants` gives vehicle-level release coordination and post-release incident handling, but omits the grant lock protocol. Neither proves finance/stock invariants. |
| Web-first delivery and maintainability | 25 | 22 | 23 | A `Records and ownership` uses mature Django facilities but two application languages. B `Shape` and `Initial vertical slice` offer direct command ownership and precise draft limits; session/admin facilities require extra implementation. |
| Data protection and operations | 20 | 18 | 17 | A `Identity and evidence` specifies transaction-local RLS context and evidence acceptance. B `Deployment and identity` separates schema credentials and demands restore evidence, but leaves policy setup and upload finalization less concrete. Neither supplies a tested policy matrix. |
| Device and offline evolution | 15 | 13 | 13 | A `Deployment and devices` defaults to session-only drafts. B `Devices and saved drafts` gives explicit reconnection and account-switch behavior. Both defer native/HarmonyOS claims until testing; neither has physical-device evidence. |
| Cost and agent efficiency | 10 | 7 | 9 | B `Module ownership` and `Shape` keep one language and generated wire contracts. A gains framework administration but adds Python/TypeScript contract and tooling upkeep. Both keep one transactional backend and avoid an initial broker. |
| Total | 100 | 87 | 88 | Conditional design selection only. |

## Required additions from A

1. Adopt A `Concurrency and replay` grant-row locking and a documented lock order used by both approval and revocation. Keep historical authority snapshots. Add a real concurrent revoke/sign-off test before any approval command ships.
2. Adopt A `Concurrency and replay` receipt lookup before stale-version rejection. Preserve B's operation-scoped receipt identity and verify simultaneous identical requests, changed payloads, and rollback through database tests.
3. Adopt A `Identity and evidence` transaction-local scope installation for requests and workers, a non-owner runtime role, and accepted-object checks for checksum, type, size and malware state. Gate evidence cannot refer to a merely uploaded object.
4. Adopt A `Deployment and devices` explicit draft-persistence choice, expiry and storage-failure handling. Until shared-device policy is approved, use server-owned saved drafts or session-only browser drafts. Persistent browser storage needs an explicit policy.
5. Adopt A `Data structures and invariants` bounded decimal quantities and currency precision policy. B's integer minor-unit storage still needs safe arithmetic and serialization beyond JavaScript's safe integer range.

## Preserve from B

- `Storage and transaction invariants` composite scoped foreign keys and vehicle-first coordination. Vehicle-level holds must survive work-order closure and affect later visits until correctly resolved.
- `Initial vertical slice` creates planned task records but exposes no generic state PATCH, release command or hold-resolution shortcut. Protective reporting remains separate from billing approval.
- `Domain contracts` makes inconclusive diagnosis representable and keeps server domain types private. Generated client types contain wire contracts only.
- `Deployment and identity` separates runtime and migration privileges and requires measured restore and forward recovery.

## Risks to resolve in the accepted design

- Both `Problem` sections describe no legacy records to migrate. The prototype has no real records, but an external historical maintenance backlog exists. Add a later staged import with source IDs, provenance, deduplication review, reconciliation and unknown approval states. Historical imports must never fabricate current G1-G5 acceptance.
- B `Domain contracts` has only pending/accepted gate evidence. Add explicit historical unknown and superseded/invalidated decision semantics before import or scope variation. Current readiness must be computed from current evidence; an old accepted decision cannot remain sufficient after its scope changes.
- Both proposals promise RLS without supplying policies. Define organisation-owned vehicle/customer visibility separately from site-owned visits. Test absent scope, wrong scope, pooled connection reuse, workers, exports, joins and runtime-role writes. Scope settings must be transaction-local and fail closed. RLS is not proof against a compromised application with arbitrary SQL access.
- A `Shape` excludes persistent vehicle/asset holds from its union. B includes vehicle holds but leaves asset quarantine to later modules. The accepted design needs explicit vehicle and equipment restrictions, including their effects on new work orders and historical calibration impact.
- B `Usage from the caller` omits hold owner and source although `Initial vertical slice` requires them. Complete the contract or specify defensible server-derived values. Never fabricate source evidence or authority.
- A `First vertical slice` includes hold closure without specifying resolver authority and closure evidence. Defer closure until a command can enforce both. A generic capability to report a hazard must not imply permission to resolve it.
- B `Module ownership` lists incidents under both safety and governance. Assign one canonical incident owner and let the other module reference it. Keep G5 decision coordination and commercial evidence ownership equally explicit.
- Neither proposal spells out stock balance enforcement, double-entry or reconciled ledger constraints, payer allocation totals, or reversal rules sufficiently to implement finance. Specify these with examples and transaction tests before those modules, without inventing rates or limits.
- Neither framework makes the business invariants automatic. Django admin must not bypass commands. Fastify/Kysely needs explicit session, CSRF, migration and privileged administration controls. Pin supported dependencies only after checking actual compatibility; local availability alone is insufficient.
- Both avoid forwarding repository layers. Preserve that restraint. Shared command plumbing is justified only for repeated transaction mechanics, never a generic status setter or universal policy engine that obscures gate-specific evidence.

## Source checks and acceptance boundary

The decision preserves `master-0035` through `master-0044` on independent gates, scoped holds and versioned approval; `master-0111` through `master-0125` on consent, grants, inspection, payer separation and protective action; and `master-0141` through `master-0145` on named authority and historical snapshots.

The intake slice can demonstrate draft persistence, C02 on one work order, planned tasks, scoped holds, receipts and history. It cannot claim G1 acceptance without VIN/owner, custody, condition photographs, mileage/SOC and safety triage from `master-0035`. Neither a polished intake screen nor a successful build completes M02 or the full AT-02 scenario. C02's independently diagnosable behavior needs its own evidence.

Before crediting the first slice, run real PostgreSQL API tests for duplicate replay, different-payload conflicts, concurrent same-version updates, atomic rollback, scoped foreign keys, cross-site reads/writes and audit immutability under the runtime role. Browser tests must cover failed saves, reconnect, stale versions, keyboard operation and account switching. Record each command's persisted effects and denied effects.

Before later release/finance acceptance, prove `master-0200` through `master-0217`, including expired/revoked grants, diagnostic-only consent rejection, independent inspection, hold/release races, payer/recovery separation and measured restore. SQLite, mocks and screenshots do not establish PostgreSQL locking or RLS behavior. No tests were executed for this document review, and no implementation requirement is marked complete by this decision.
