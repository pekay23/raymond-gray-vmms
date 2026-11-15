# Local browser smoke — 14 November 2026

## Result

`npm run verify:browser-smoke` completed **64 of 64 checks successfully** at `2026-11-14T21:14:22Z` in Microsoft Edge 157.0.4341.46. The browser recorded zero uncaught page errors and four passing automated WCAG 2.1 A/AA scans. The machine-readable results and screenshots are in [`browser/results.json`](browser/results.json) and [`browser`](browser/).

The run used the loopback VMMS web/API services, local Keycloak and PostgreSQL, and synthetic development identities and records. It exercised staff and vehicle-owner sign-in, owner-session expiry while a staff session remains active, staff sign-out and shared-tab cleanup, a second identity with QA-only membership and no work role, and denial of that identity's attempt to read a DEV work order. The QA identity receives a clear site-specific message instead of a blank workspace when it has no assigned work role.

It also covered vehicle-visit intake, offline blocking, saved-draft recovery and isolation, repeat-visit identity checks, VIN scanning fallbacks, work-order history, pagination, task-scoped updates and holds, evidence-upload recovery, keyboard focus, reduced motion, responsive navigation, 16 viewport profiles, and 200%/400% reflow checks.

## Corrections made during the run

- Updated outdated smoke assertions to use the current `Register a vehicle visit` and `Register visit for Operations review` actions.
- Kept the same EV classification when testing the next client-wide booking sequence.
- Made the phone navigation assertion ignore links inside a collapsed `More` disclosure while requiring the disclosure to remain visible.
- Added a clear no-work-role state that identifies the affected service centre and provides sign-out.
- Matched sign-out assertions to the dedicated signed-out page, including the safe message shown when central sign-out is unavailable.

## Limits

This is local synthetic evidence, not staff acceptance or production proof. The browser smoke simulates the RP logout response; the central provider logout callback is not exercised by this run. Google federation, production `auth.raymond-gray.org`, production VMMS client registration, physical passkeys/devices, manual assistive-technology checks and real staff UAT remain open under REV-056 and the linked identity tasks. The shared auth repository was inspected only through its local architecture and OIDC contract; no production endpoint, database, secret or provider configuration was accessed.
