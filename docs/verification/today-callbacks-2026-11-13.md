# Today callbacks panel — 13 November 2026

## Result

The role-aware Today page now shows a small read-only panel for overdue callbacks and callbacks due today. It reads those two existing request filters with the current site session, shows up to four items per group, and opens the existing request detail with its queue filter preserved. Callback edits remain in Requests.

The panel shows the next action, concern, reported vehicle and due time. It does not show caller names or phone numbers. The same service-request endpoint applies the current actor/site/record visibility and logs the read; the widget adds no role grant or API route.

## Verification

- `npm run typecheck --workspace @vmms/web` — passed.
- `npm run test --workspace @vmms/web` — 32 passed, 0 failed.
- `npm run build --workspace @vmms/web` — passed.
- `node scripts/workspace-navigation-browser.mjs` — passed for Head, Advisor, Technician, Sales-only, Operator-only and multi-site landing scenarios. Its mocked API fixture checks populated callbacks, an empty state, a denied-read failure with retry, absence of caller contact details, preserved queue filter, responsive widths, and the Head Today WCAG 2.1 A/AA scan.
- `npm run test --workspace @vmms/api` — 121 passed, 0 failed, 1 optional local S3/ClamAV integration skipped. Existing tests cover request queue filters, actor/site scoping and request authorization.

## Limits

The empty and denied-read/retry states remain browser-mocked. Manual assistive-technology checks, staff UAT and production identity remain open. The panel is not a cross-domain inbox and does not infer urgency beyond the server's existing overdue and due-today filters.

## Real API and PostgreSQL browser recheck

`node --import tsx scripts/service-requests-real-browser.mjs --run` passed against a disposable PostgreSQL database and local API, using an overdue callback time computed in the seeded site's time zone. The browser verified that Today loaded the callback, omitted the caller name and phone, and opened the matching request with its `overdue` filter preserved. The same journey then passed contact-attempt response-loss recovery, close/reopen history, and the remaining service-request checks. It completed four viewport widths, the WCAG 2.1 A/AA automated scan, and browser-error assertions. No production records were read or changed.
