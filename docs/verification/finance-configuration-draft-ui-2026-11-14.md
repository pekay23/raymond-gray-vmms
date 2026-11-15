# Finance configuration proposal UI verification — 2026-11-14

## Scope

Verified the staff-only Finance setup page for authoring and inspecting immutable configuration proposals. All data and authority grants were synthetic and confined to disposable local test databases. The page does not approve or activate Finance policy and does not issue invoices, record payments, create receipts, send email or clear G5.

## Results

- `node --import tsx --test --test-name-pattern="Finance configuration drafts" apps/api/test/foundation.test.ts` — passed on disposable PostgreSQL. Covers grant and site scope, immutable proposal revisions, current versus prior revisions, stale and competing writes, replay, RLS, credential-like value rejection, audit and outbox behavior.
- `node --import tsx scripts/finance-configuration-browser.mjs --run` — passed against disposable PostgreSQL and synthetic manager, read-only and no-grant accounts. Verified denial without a grant, proposal creation, saved preview, immutable revision history, read-only controls, stale-write rejection, pagination across 28 proposals, keyboard submission and server response scope.
- The browser run also passed automated WCAG 2.1 A/AA checks with zero violations and responsive layout checks at 280, 320, 390, 540, 768, 820, 1024 and 1440 pixels without horizontal overflow.
- `npm run typecheck --workspace @vmms/api` — passed.
- `npm run typecheck --workspace @vmms/web` — passed.
- `npm test --workspace @vmms/web` — 35 passed.
- `npm run build --workspace @vmms/web` — passed; the Finance setup page is emitted as a separate lazy-loaded bundle.
- `npm run docs:check` — passed after updating the task totals and full-completion gate for the new Finance UI tasks.

## Limits

The browser and database checks use synthetic identities and configuration only. They do not establish Finance policy approval, production grants, approved currency/tax/rates/terms, legal invoice or receipt numbering, payment evidence policy, mail-provider configuration, client email verification, or operational readiness. Invoice/payment/receipt/email/G5 work remains open under `USER-044` and `REV-012`.
