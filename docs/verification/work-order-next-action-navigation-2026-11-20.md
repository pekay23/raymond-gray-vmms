# Work-order next-action navigation — 20 November 2026

## Result

**PASS for the local synthetic workflow.** The current-step card now has a direct link to the matching work-order section. Selecting it updates the page hash, moves the target heading into view, and focuses that heading so keyboard users can continue from the current step.

The mapping covers Operations review, Team-lead assignment, the Team Lead work plan, Supervisor handover, and task assignment/progress. The jump scrolls the independently scrolling workspace around its sticky header, then focuses the target heading. It respects the browser's reduced-motion setting.

This is navigation only. It does not enable a blocked action or change any API permission, safety gate, work-order state, or sign-off authority.

## Verification

- `npm run verify:work-plan-browser`: **86 checks passed, 0 failed**, against disposable PostgreSQL data on 20 November. All five links reached and focused the exact matching section; the 200% and 400% zoom checks passed, including the independently scrolling workspace. The run also exercised the Operations-to-technician journey, scope proposal/payer response boundary, evidence, reports, responsive layouts, and accessible feedback. The disposable database and role were cleaned up.
- `npm run test --workspace @vmms/api`: **168 passed, 0 failed, 1 optional scanner integration skipped**.
- `npm run test --workspace @vmms/web`: **46 tests passed, 0 failed**.
- API and web typechecks: passed.
- `npm run build`: passed; 26 workshop image outputs and 10 logo derivatives were unchanged.

Raw browser output and screenshots: [browser-work-plan](browser-work-plan/).

## Limits

The run used synthetic staff and job records on a disposable local database. It is not staff UAT or production verification. Manual screen-reader checks and physical-device checks remain open. Supervisor technical sign-off, Team Lead release, Head inspection, and customer handover remain separately gated by their effective procedures, action grants, qualifications, and evidence criteria.
