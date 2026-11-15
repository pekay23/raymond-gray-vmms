# Responsive shell verification

Date: 2026-11-08\
Status: partial evidence for F-008; not a completion record.

## Scope

Inspected the public sign-in page and authenticated work-order workspace at `http://127.0.0.1:5173/` in installed Microsoft Edge. The repeatable suites are `npm run verify:responsive` (public sign-in) and `node scripts/browser-smoke.mjs` (local OIDC login and authenticated workflow; keep local VMMS, Keycloak and PostgreSQL running). The authenticated harness refuses non-loopback app, identity-provider, or database URLs before test credentials are entered or records are written.

The public suite checks 15 viewport/orientation combinations—280×653, 320×568, 390×844, 540×720, 568×320, 720×540, 768×1024, 820×1180, 844×390, 1024×768, 1180×820, 1440×1000, 1920×1080, 2560×1080, and 2560×1440—and native 200%/400% browser zoom for both staff and owner sign-in. The authenticated suite checks 16 work-order-related viewports: compact/small/standard phones, folded and unfolded device ratios, landscape phone, portrait and landscape tablets, widths around the sidebar breakpoint, desktop, wide desktop and ultrawide desktop. A separate native zoom run now verifies a real staff VMMS session before testing the queue, work-order detail, intake and open diagnostic form at 200%/400%. The current empty owner shell still uses a mocked session.

## Results

- All 15 viewport checks and four public-entry zoom checks passed. The 51-check browser smoke reported no uncaught page errors. It verified accessible names, semantic text bounds, no horizontal document overflow, in-bounds controls, and staff 200%/400% zoom on queue, work-order detail, intake and diagnostic form. The empty owner shell zoom remains mocked and is not owner-dashboard evidence.
- The suite verified image `object-fit: contain`, selected responsive AVIF/WebP variants present in the generated manifest, and checked that the logo retained its source aspect ratio without clipping.
- The sign-in action remained visible and measured 44 CSS pixels high, with no clipped button text.
- At 320×568, the document remained vertically scrollable; it did not require horizontal scrolling.
- Keyboard Tab reached the primary sign-in action. Its focused state exposed a visible 2.7-pixel outline with a 2.7-pixel offset.
- The real authenticated work-order screen fit all 12 viewport simulations without horizontal overflow or interactive controls leaving the viewport. A rendered 390×844 work-order capture was visually inspected; cards and record sections retain their shape and stack in document order.
- Visible work-order action buttons measured at least 44 CSS pixels high in the 390×844 phone layout.
- Keyboard navigation moved between workspace actions and retained a visible focus indicator. The reduced-motion media preference was observed; the tested workspace had no active animations.
- The browser workflow also verified real local sign-in, intake, refresh persistence, offline submission blocking, planned tasks, task-scoped holds, sign-out and no uncaught page errors. Its synthetic records stay in the local development database.
- The browser viewport override was reset after inspection. Edge screenshot outputs and machine-readable results are under `apps/web/test-results/responsive/` (ignored test artifacts).

## Limits

The authenticated layout check covers the work-order screen, not every staff route or future customer portal. It does not verify the remote identity-provider page, every keyboard path, physical foldable devices, all touch-target dimensions, or native Windows/macOS/iOS/Android/HarmonyOS layouts. Fold sizes are viewport simulations, not hinge/device tests. F-008 remains in progress until remaining routes and target devices are exercised and recorded.
