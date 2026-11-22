# Diagnosis consent display verification

**Date:** 18 November 2026  
**Scope:** Diagnosis-only payer response wording in the work-order scope proposal panel.  
**Result:** Passed in the disposable PostgreSQL and real-browser work-plan scenario.

## What changed

An approved payer response to a proposal marked **Diagnosis** is labelled as diagnosis consent for that exact proposal. A declined diagnosis response is labelled separately. Repair proposals keep the general payer-response label. The page states that diagnosis consent alone does not authorize diagnostic execution, repairs, parts, charges, or dispatch; price and technical reviews remain required. No API authorization state, authority grant, dispatch behavior, or work-order transition was changed.

## Checks

- `npm run verify:work-plan-browser` — passed all 68 checks against disposable PostgreSQL data and the real VMMS API/browser. The scenario selected Diagnosis, recorded the payer response, and asserted the diagnosis-consent label and blocked-state explanation. Full results: [browser-work-plan/results.json](browser-work-plan/results.json).
- `npm run typecheck` — passed for API and web workspaces.
- `npm run build` — passed for API and web workspaces; generated image derivatives were already current.
- `npm run docs:check` and `npm run docs:test` — passed after tracker generation.
- `git diff --check` — passed for the edited files.

## Limits

This verifies wording and the existing payer-response evidence path only. It does not implement or authorize diagnostic execution, calculate charges, grant staff authority, satisfy a vehicle-specific procedure, or complete G2. Production grants, approved procedures, and full commercial/technical review remain open.
