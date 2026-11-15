# Role-aware navigation verification — 2026-11-13

## Scope

This evidence covers the first navigation slice for USER-040. It adds a role-aware Today page, a shorter primary navigation, a keyboard-operable More section, selected-site-aware landing routes, and client-side route guards that mirror the intended screens. Server authorization remains authoritative. The approved Raymond Gray visual baseline is unchanged.

## Results

- `npm run typecheck --workspace @vmms/web` — passed.
- `npm test --workspace @vmms/web` — 32 passed, 0 failed.
- `npm run build --workspace @vmms/web --ignore-scripts` — passed. The ignore flag avoids running image-generation lifecycle scripts during this verification.
- `npm run verify:workspace-navigation --workspace @vmms/web` — passed for Head with Operator, Advisor, Technician, Sales-only, Operator-only, and a two-site user switching from Sales to an Advisor site. Synthetic session and empty account-request responses were browser-mocked; no production identity or database was used.
- Head Today layout had no document-width overflow at 320, 390, 673, 768, 1024, and 1440 CSS pixels.
- Head Today automated axe scan found 0 WCAG 2.1 A/AA violations. `More` opened by keyboard Enter, and the current Today link exposed `aria-current=page`.
- Sales-only direct navigation to Work orders returned to the Sales landing. Operator-only direct navigation to Today returned to Staff accounts.

## Remaining acceptance work

This does not verify the full USER-040 requirement. The job-context summary for current owner, next allowed action, due time, required evidence, and exact block reason remains to be implemented and checked. Real API denial responses, all role combinations, form and page loading/failure/offline states, 200% zoom, and assistive-technology testing remain open. Automated axe results do not replace a screen-reader review.
