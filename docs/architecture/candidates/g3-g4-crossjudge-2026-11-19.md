# G3/G4 design cross-judge — 19 November 2026

## Rubric and scores

Scores are 1–5, where 5 best satisfies the criterion.

| Criterion | A: decision ledger | B: closeout dossier | C: work-order child decisions |
| --- | ---: | ---: | ---: |
| Distinct Supervisor G3, Team Lead G4, post-G4 Head inspection, then Advisor completion contact | 5 | 5 | 5 |
| Action-time assignment, grant, qualification and effective vehicle instruction gates | 5 | 5 | 5 |
| Immutable attributable evidence, shared transaction, idempotency, stale-state and hold safety | 5 | 5 | 5 |
| Fit with current work-order architecture and verifiable implementation surface | 4 | 3 | 5 |
| Honest separation of buildable daily workflow from policy-blocked sign-off | 5 | 4 | 5 |

## Selection

**Candidate C is the base.** It keeps the work order as the single serialization root, makes each decision an append-only child record, and follows the owner's exact sequence: Supervisor G3, Team Lead G4 with collection-zone movement, separate Head inspection, then the Service Advisor's completion-status contact. It adds no parallel closeout aggregate or generic approval service. That shape fits current `runStaffCommand`, work-order locking, event, receipt and outbox patterns and makes the safety boundaries straightforward to test.

## Grafts and rejections

- Graft A's read-only readiness projection: show each role the current responsible person, exact missing input and next permitted action. Keep readiness derived from current records and use the same validators as the commands.
- Graft B's stable review manifest: when a signer reviews a set of task/evidence/policy records, persist normalized references and a canonical digest with that decision. The digest supplements foreign keys, version checks and action-time authorization; it does not replace them.
- Reject B's single generalized dossier-and-decision API as the primary domain surface. Its common stage type makes the three actors' transitions look interchangeable and expands the signing flow before the underlying policy and grants exist.
- Reject A's broad split into execution, G3, G4, Head-inspection and readiness modules as the initial file structure. Keep one clear work-order transition boundary first; extract modules only where implementation proves the rules have distinct ownership.

## Risks and boundaries

The interim policy approves the sequence, not the technical criteria for a successful sign-off. Exact vehicle/model/system/task procedures, applicable inspection rules, action-specific signed grants, current qualifications, independence and fault-disposition rules remain missing. The current policy resolver also returns `POLICY_UNAVAILABLE`. Therefore, now we can build the stage/readiness panel, blocked states, strict command contracts, synthetic-only denial and transaction tests, and the distinct completion-contact guard. We cannot enable a real G3/G4/Head happy path or represent the vehicle as operationally signed off.

Post-G4 Head inspection failure needs an approved custody/rework transition. Keep the G4 record and collection-zone history immutable; do not reverse custody or create a pre-release hold retroactively. Payment/guarantee, receipt, customer handover and physical departure remain separate G5 controls.

Local acceptance should prove the permitted and denied actor paths, current assignment/grant/qualification/source checks, stale versions, changed-body replay, outbox rollback and both hold/G4 commit orderings against PostgreSQL. Browser work should use the existing role fixture and confirm Technician progress cannot sign off, only the assigned Supervisor sees G3, only the eligible Team Lead sees G4, the Head inspection follows G4, and completion contact stays unavailable until the Head passes. Synthetic success proves command mechanics only; it does not establish real authority or procedure approval.
