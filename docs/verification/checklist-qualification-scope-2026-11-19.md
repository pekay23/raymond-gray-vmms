# Exact qualification scope for maintenance checklist outcomes

## Result

Verified that source-backed routine-maintenance checklist items must identify a system and task class, and that an assigned technician can record an outcome only when the current accepted qualification exactly matches the vehicle powertrain, normalized vehicle model, system, and task class. The qualification row is locked during the command and its scope is retained with the outcome snapshot. Wrong or missing scope, inactive/unaccepted qualifications, and unresolved restrictions fail closed.

The normalized model key is `make::model::variant`, with whitespace collapsed and case folded. Classification values are exact source-approved codes carried by the checklist item; runtime does not infer classification from its display label.

This authorizes checklist observation recording only. It does not authorize repairs, checklist activation, G3 technical completion, G4 release, Head inspection, or vehicle movement. The broader R-M-0137 competence and sign-off requirement remains in progress.

## Verification

- API integration case `Supervisor task allocations` passed against disposable PostgreSQL. It denied qualification rows with the wrong model, system, task class, powertrain, or unresolved restriction, then accepted the exact-scope case and read back the qualification snapshot.
- `npm test` — API: 164 passed, 0 failed, 1 optional external S3/ClamAV test skipped; web: 43 passed, 0 failed.
- `npm run verify:my-assigned-tasks-browser` — passed 17 browser scenarios, including the technician checklist flow and five tested widths (320, 390, 768, 1024, 1440). The synthetic response fixture was updated to include the current activity schema fields. Today review queues are stubbed locally; the run produced no proxy errors or page errors.
- `npm run typecheck` — API and web passed.
- `npm run build` — API TypeScript and Vite production builds passed; image and logo derivatives were current.
- `codegraph sync` — up to date. `codegraph affected` identified 11 related API/web test files; the full suites above cover them.
- `git diff --check` — passed (subject to final documentation edits below).

## Remaining limits

No production migration or deployment was performed. No operational qualification rows were seeded. The exact model/system/task classification for actual repair procedures, effective OEM instructions, named grants, training evidence, restriction evaluation, G3/G4 commands, Head inspection criteria, staff UAT, and production runtime/identity gates remain outstanding. This scoped test does not establish production readiness.
