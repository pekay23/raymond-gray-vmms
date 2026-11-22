# Work-order checklist scope verification — 17 November 2026

## Change

The work-order checklist read path now exposes routine-maintenance instances and exact-vehicle approved routine-maintenance templates only. Its response schema rejects PDI records and templates. The work-order panel now explains routine-maintenance scope and the 10,000 km / 12-month reminder without suggesting that it determines the work package.

Pre-delivery inspection remains a separate delivery-preparation workflow. This change does not implement that workflow or create any approved checklist, procedure, maintenance interval or authority grant.

## Results

- Web type-check passed.
- Web unit tests passed: 37 tests, including the work-order checklist response contract.
- API type-check passed.
- Focused API checklist-schema test passed: 1 test.
- Web production build passed.
- API TypeScript build passed.
- CodeGraph sync completed; affected tests included the new API contract test and web API test. Both passed in the runs above.
- `docs:check`, `docs:test` and `git diff --check` passed after the tracker update. Git emitted line-ending warnings for other pre-existing dirty documentation and browser-verifier files, with no whitespace errors.

## Limits

The API query predicates were reviewed in source, but no PostgreSQL integration test ran in this verification because the repository integration suite reads configured database URLs and creates a temporary database. No managed database or paid resource was used for this change.

No exact vehicle template is currently approved, so staff still cannot start an operational maintenance checklist. Template authoring, instance creation, complete outcome integration, separate review, purpose-built reports, delivery-preparation PDI, device checks and staff acceptance remain open.

