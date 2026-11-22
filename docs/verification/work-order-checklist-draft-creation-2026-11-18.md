# Routine-maintenance checklist draft creation — 18 November 2026

## Verified behavior

The work-order page can prepare a non-authorizing routine-maintenance checklist draft only from an effective, source-backed template for the exact verified make/model/variant/powertrain. The command checks writable site membership, an action-specific preparation grant, current work-order version and active after-sales placement while holding the work-order root lock. It stores the exact vehicle and template/item snapshots, schedule basis, creator placement and authority snapshots. A unique database index prevents duplicate instances for the same work order and template revision.

The draft does not start inspection, diagnosis or repair. It does not clear or satisfy consent, holds, G1–G5, qualification, evidence or release requirements. No template is seeded or implied. Checklist outcomes and activation remain separate work.

Creation, item snapshots, aggregate root, event, idempotency receipt and outbox are committed through the existing staff-command transaction. Retry with the same command key/body returns the saved response; changed-body replay conflicts. A second command for the same template revision is rejected.

## Checks

- `npm run typecheck` — passed for API and web.
- Focused disposable PostgreSQL integration: `node --import tsx --test --test-concurrency=1 --test-name-pattern="intake persists one visit|checklist availability is exact-vehicle" test/foundation.test.ts` from `apps/api` — 2 passed. Covers no-template state, staff-only access, exact vehicle/source lookup, missing preparation grant denial, successful synthetic source-backed draft creation, actor/vehicle/template/item snapshots, replay, changed payload and duplicate refusal.
- `npm test --workspace @vmms/web` — 37 passed.
- `npm run docs:generate` — task/requirement graph validation passed.
- `npm run build` — passed for API and web; responsive workshop asset generators verified all 26 image outputs and 10 logo derivatives unchanged.

The final full API suite on disposable local PostgreSQL reported 145 passed, 0 failed, 1 optional local S3/ClamAV integration case skipped. This includes the final checklist draft integration and all existing API/PostgreSQL tests.
- `npm run verify:work-plan-browser` — passed in Chromium 157.0.4341.60; 60/60 recorded checks verified, 0 errors. The wider workshop run covers Operations review/assignment, team-lead and technician workflow, reports, keyboard and accessibility states, and responsive widths/zoom. It does not exercise the new checklist-draft control.

## Not verified

No browser interaction with the checklist-draft control, checklist-specific keyboard/screen-reader check, checklist outcome command, template authoring/publication flow, effective model-specific checklist, activation, or checklist report was verified here. The wider browser workflow did exercise G2 guidance, but does not prove G1/G2 behavior for checklist execution. Production migration and deployment were not verified. Do not mark the full checklist workflow or USER-043 complete from this draft-creation slice.
