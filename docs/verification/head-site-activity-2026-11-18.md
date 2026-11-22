# Head site activity verification — 2026-11-18

## Delivered

- Added a Head-only, read-only service-centre activity page and navigation link.
- Added a site-scoped API projection over the aggregate event ledger. It shows timestamp, event type, actor, aggregate/version, and work-order reference; it does not return event reasons or prior/new state snapshots.
- Added descending keyset pagination, a supporting site/time index, and the sensitive-read action in the database allowlist. Every successful page read writes a sensitive-read audit event.
- Kept the Operator account audit separate and the broader portal/audit task open.

## Verification

- Focused isolated PostgreSQL API scenario: `node --import tsx --test --test-concurrency=1 --test-name-pattern "Head site activity" apps/api/test/foundation.test.ts` — 1 passed. It creates its own synthetic work order/event, proves the payload excludes private reason/state sentinels, verifies next-page progress, invalid cursor rejection, Head role denial, cross-site denial, and successful-read auditing.
- Full API suite: `npm run test --workspace @vmms/api` — 151 passed, 0 failed, 1 optional S3/ClamAV test skipped.
- Browser journey: `npm run verify:head-overview-browser` — passed. The activity screen was checked at 280, 390, 768, and 1440 px, with WCAG 2.1 A/AA axe checks. It verifies keyset pages append while retaining newer events, and loading, empty, failure/retry, offline, and non-Head direct-route states. The same journey also checks the Head overview and its print report across 11 viewport sizes.
- Web unit tests: 37 passed. Root API/web typechecks passed. Production web/API build passed.
- Documentation validation: `npm run docs:check` and `npm run docs:test` passed (258 requirements, 720 tasks, 350 source blocks).
- Browser API responses are synthetic. This is not staff UAT, managed PostgreSQL concurrency proof, a production retention decision, or evidence for complete audit coverage. Operator account audit and production event coverage remain open.

## Open follow-up

Extend the Head feed to other approved operational event sources only after event coverage, field redaction, retention, filters, and export rules are reviewed. Keep the larger Operator/Head audit task open until both viewers and those controls have evidence.
