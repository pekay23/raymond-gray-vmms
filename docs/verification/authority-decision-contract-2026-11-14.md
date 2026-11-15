# Authority decision contract review

Date: 14 November 2026

## Result

The source contract and current implementation were compared against `master-0132`, `master-0050`, `master-0142`, `master-0144`, `master-0145`, and `upgrade-0060`. The database/API foundation already checks named current grants at action time and snapshots grant/qualification evidence for Operations review and work-plan/assignment transitions.

Focused PostgreSQL checks passed:

- `team lead assignment requires scoped Operations grant and active class qualification; replay is idempotent`
- `authority decision locks block concurrent registry revocation without granting runtime update rights`
- `command runner locks target roots before grants and rechecks grants before replay`

Command: `npm exec --workspace @vmms/api -- tsx --test --test-name-pattern="team lead assignment requires|authority decision locks block concurrent|command runner locks target roots" test/foundation.test.ts` — 3 passed, 0 failed.

## Remaining gaps

This evidence proves only the exercised Operations/assignment slices. It does not meet full `R-M-0132` acceptance:

- No typed approval threshold, unit/currency, comparison rule or policy revision is present on the general grant record.
- `basis_reference` is free text and is not a verifiably signed document/evidence artifact.
- Model, system and task scope on qualification is separate from action authority; not all command families evaluate these dimensions.
- Authority snapshots are not yet a general canonical record linked to estimate, task, finance and QA decisions.
- Signed authority schedules, SOP approval, G2/G3/G4 criteria and financial limits are not configured; no operational privilege is created by this work.

See [the authority decision contract](../architecture/authority-decision-contract.md). The requirement and build/check tasks are now marked in progress to reflect partial implementation; they must remain open until the missing typed evidence and action-family verification are complete. `REV-006`, `REV-008` and `REV-035` remain owner/management gates.
