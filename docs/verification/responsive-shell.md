# Responsive shell verification

Date: 2026-11-08  
Status: partial evidence for F-008; not a completion record.

## Scope

Inspected the public sign-in page and authenticated work-order workspace at `http://127.0.0.1:5173/` in installed Microsoft Edge. The repeatable suites are `npm run verify:responsive` (public sign-in) and `node scripts/browser-smoke.mjs` (local OIDC login and authenticated workflow; keep local VMMS, Keycloak and PostgreSQL running). The authenticated harness refuses non-loopback app, identity-provider, or database URLs before test credentials are entered or records are written.

The public suite checks 15 viewport/orientation combinations—280×653, 320×568, 390×844, 540×720, 568×320, 720×540, 768×1024, 820×1180, 844×390, 1024×768, 1180×820, 1440×1000, 1920×1080, 2560×1080, and 2560×1440—and 200%/400% native browser zoom. The authenticated suite checks 12 work-order viewports: compact/small/standard phones, folded and unfolded device ratios, landscape phone, portrait and landscape tablets, desktop, wide desktop and ultrawide desktop.

## Results

- All 15 viewport checks and both zoom checks passed. No horizontal document overflow, out-of-bounds logo/main/controls, or uncaught page errors were reported.
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
