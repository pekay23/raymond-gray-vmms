# Service-request type handoff verification — 20 November 2026

## Verified behavior

- API input accepts repair/maintenance, routine maintenance, PSAI and Service Centre PDI, and rejects an unsupported category.
- Staff request drafts preserve the selected category; an older saved draft without that field loads as repair/maintenance.
- PDI requests can store a reported vehicle source and PSAI requests can store a shipping reference; saved drafts preserve these values too.
- A database-backed Service Centre PDI request can be received into one work order, and the work-order response retains `service-centre-pdi` and `partner-garage`. Its safety gates remain pending.
- The work-order page and standard print service report display the requested service category and applicable reported context.
- The browser flow displayed a partner-garage PDI request in Advisor detail and queue, then completed callback privacy, contact history/retry and correction, close/reopen, responsive-width and accessibility checks.

## Checks

- `npm exec --workspace @vmms/api -- tsx --test --test-name-pattern='request reception' test/foundation.test.ts` — passed, 2 tests.
- `npm exec --workspace @vmms/web -- tsx --test src/drafts.test.ts` — passed, 10 tests.
- API and web TypeScript checks — passed.
- `npm run docs:check` and `npm run docs:test` — passed.
- `git diff --check` on changed implementation and documentation files — passed.

## Incomplete verification

The browser check does not exercise customer/third-party submission or a browser-driven request-to-work-order conversion. Conversion of service type and partner-garage source is covered by the focused API/PostgreSQL reception tests.

## Scope limits

Customer/third-party submission, requester verification, privacy-safe vehicle matching, dedicated inspection checklists/report templates and commercial fee handling remain unfinished and are tracked separately. Persisting reported context does not verify ownership, vehicle identity or shipment acceptance, or authorize inspection, diagnosis, repair, release or billing.
