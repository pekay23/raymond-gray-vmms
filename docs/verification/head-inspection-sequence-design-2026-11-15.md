# Head inspection sequence design check

**Status:** Contract and task-traceability update only. No runtime inspection, release, customer-update or invoice action was implemented or exercised.

## Confirmed sequence

`USER-039` and `REV-046` require Supervisor technical completion (G3), Team Lead final release and collection-zone movement (G4), Head of Service Centre inspection/sign-off, then the Service Advisor's post-repair customer update. Payment or approved showroom guarantee, collection and paid delivery remain later separate transitions. Intake confirmation and repair-progress communications remain available before Head sign-off; a callback about completed work or collection readiness remains gated. The timing of cleanliness checks and invoice preparation/issue remains pending under REV-057.

The G3/G4 engineering contract now keeps the Head checkpoint distinct from G4 and G5. A Head decision cannot be inferred from role title: the signer must have an active Head placement and configured action-specific authority, or an explicitly approved delegation. It must use the applicable current checklist/policy, required outcomes and accepted evidence, and a signed action-time authority decision. A passing Head decision gates post-repair Advisor customer updates only. Earlier intake confirmation and repair-progress communications remain available. Invoice and cleanliness sequencing is not decided. Failed findings preserve the already recorded G4 decision and require a separately defined post-release safety/rework route.

## Review boundaries

- No inspection criteria, technical steps, evidence matrix, independence rule, authority grant or failure/custody policy was invented.
- No G3/G4/Head inspection endpoint, database record, UI action, invoice, customer message, payment, collection or release was changed.
- The implementation and verification children are tracked under `USER-039` and included in the full-completion gate. They depend on G3/G4 and competence-grant implementation.
- SOPs, signed authority schedule, evidence requirements and failure routing remain pending. Until approved and implemented, the operational path stays unavailable.

## Verification performed

- Cross-checked sequence against `USER-039`, `REV-046`, the accepted service journey and technical completion contract.
- `python scripts/project-status.py --write`: passed; tracker regenerated for 256 requirements, 686 tasks and 350 source blocks.
- `npm run docs:check`: passed.
- `npm run docs:test`: passed, including completion-gate task coverage and reciprocal build/check links.

These checks validate document consistency and traceability only; they do not prove runtime behavior, staff acceptance or operational approval.
