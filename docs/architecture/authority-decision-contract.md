# Authority and approval decision record

**Status:** Partial implementation documented; full `R-M-0132` acceptance remains open. This contract does not create or approve a staff grant, technical procedure, financial limit, substitute or sign-off authority.

## Source requirement

The master specification's `master-0132` requires an approval/authority record to retain a grant ID, action class, actor, scope, threshold, revision and signed evidence, linked to a person and the estimate, task, finance or QA event it governs. `master-0050`, `master-0142` and `master-0144` additionally require named, scoped, time-bounded authority and an action-time decision snapshot. `master-0145` prohibits guessed or unapproved limits.

## What the current foundation proves

`staff_authority_grants` and `staff_qualifications` are separate, empty-by-default registries. The runtime role can read grants through scoped policy and narrowly defined lock functions, but cannot create, edit or delete them. Operations review and work-plan/assignment actions record snapshots containing the grant, any applicable qualification, and a server timestamp. Existing tests exercise snapshot persistence, action-time grant locking, concurrent revocation and runtime write denial.

This is a useful foundation, not full `R-M-0132` coverage:

- The current grant row identifies a capability and site, named recipient, revision, validity, grantor and a free-text `basis_reference`.
- Model, system and task-class scope is held on qualification records. That scope must not be confused with action authority, and the current assignment decisions only evaluate vehicle-class qualification.
- There is no typed approval-threshold record or unit/currency rule. No threshold may be inferred from a role or free-text reference.
- `basis_reference` is not a verified signed artifact: the registry does not bind a signature, immutable document revision, digest or accepted evidence record.
- The saved snapshots cover selected operations/assignment actions only. No general approval decision record connects a person and signed authority to every estimate, task, finance and QA decision.

## Required decision record

Each action that depends on a grant must retain an immutable action-time snapshot with:

1. Named actor, organisation and site, authenticated membership revision, action class and target record/version.
2. Grant ID and revision, recipient, grantor, effective interval, current status, scope and the source document/evidence revision that grants the action.
3. Exact scope evaluated by the command (for example vehicle, system, task class, estimate line, work order or finance category). Unevaluated dimensions remain unknown and cannot be treated as broad access.
4. An approved threshold snapshot where the action has a limit. Threshold amount, unit, currency, comparison rule and policy revision must come from approved configuration; non-threshold actions must state that the threshold is not applicable rather than inventing one.
5. Immutable signed evidence identity and revision, verified through the approved evidence/document mechanism. A URL, filename, free-text basis or unsigned note is not proof of a signature.
6. Server decision time, result, reason, applicable qualification/supervision, and links to the resulting estimate/task/finance/QA decision. Later revocation changes future decisions and never rewrites past snapshots.

Use command-specific typed records and valid parent foreign keys. Do not introduce an unchecked generic `(target_type, target_id)` relationship. Persist each business decision, authority snapshot, event, idempotency receipt and outbox item atomically under the owning aggregate lock. Role names and account-administration powers never substitute for a signed grant.

## Implementation sequence

1. Keep current grant and qualification registries empty by default; preserve their no-runtime-mint boundary.
2. Define approved scope and threshold types by action family. Keep unknown, not applicable and approved values distinct.
3. Define how signed grant evidence is stored, verified, revised, withdrawn and retained; bind it to a controlled document/evidence revision.
4. Extend grant issuance and qualification assessment only after the owner-approved authority schedule and governance path exist.
5. Migrate each action family to typed immutable snapshots, with the grant locked and rechecked at action time.
6. Verify permitted and denied actions, expired/revoked grants, scope/threshold boundaries, signed-evidence failures, concurrency, replay, rollback and historical snapshot retention against PostgreSQL using the restricted runtime role.

## Open inputs and gate

`REV-006` owns named technical, QA, release, governance and financial authorities, scopes, substitutes and limits. `REV-008` owns approved controlled documents and publication authority. `REV-035` owns the technical task/inspection evidence that G3/G4 decisions must evaluate. Until the effective signed schedule and evidence policy exist, related actions remain unavailable. This design does not make a grant effective and does not authorize work.

## Current evidence

The current partial implementation is in `apps/api/migrations/019_staff_authority_qualifications.sql`, migrations 024-027, `apps/api/src/workshop.ts`, and `apps/api/test/foundation.test.ts`. Evidence includes the PostgreSQL checks named “authority decision locks block concurrent registry revocation without granting runtime update rights,” operations review snapshot persistence, lead-assignment snapshot persistence and non-owner registry write denial. See `R-M-0132` and `BUILD-R-M-0132` in the canonical tracker for the remaining acceptance work.
