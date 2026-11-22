# Technician work-entry authorization gate — 20 November 2026

## Result

Verified locally. The API now refuses to create work-history entries that state a diagnostic test, repair action, or completed technical follow-up while VMMS cannot verify the required authorization. The task form starts with a finding and explains the missing prerequisites; test and repair entries, and the completed follow-up result, are disabled.

## Why the gate is needed

The prior work-entry command checked the current task assignment, evidence and idempotency but did not establish G2 scope, an effective vehicle instruction, an exact-scope qualification, or a signed task-execution grant. A saved work note is not itself an authorization. Until those checks exist, accepting an entry that says a test or repair was performed would imply an execution path the system cannot validate.

## Behavior

- A current assigned worker may record an observation (`finding`) or an open/blocked follow-up.
- The API returns `TECHNICAL_AUTHORIZATION_UNAVAILABLE` for test entries, repair-action entries, and a completed technical follow-up. The denial occurs before evidence linking or any event, receipt, outbox, or work-entry write.
- The task form defaults to `Finding` / `Observed`, disables the unavailable options, and names the needed scope, instruction, qualification and signed task authority.
- The server check remains authoritative if a caller bypasses the browser.
- This gate does not implement the missing authorization configuration or sign-off commands. No G3, G4, Head inspection or vehicle-release action is enabled.

## Verification

- `npm exec --workspace @vmms/api -- tsx --test test/foundation.test.ts` — **88 passed, 0 failed**. The PostgreSQL-backed case verifies test, repair and completed-follow-up denials and that the denied commands add no work-entry rows; observation save, replay, correction, evidence and report behavior still pass.
- `npm run verify:my-assigned-tasks-browser` — **PASS**. It verifies the safe default and unavailable selections in the technician form.
- `npm run typecheck --workspaces --if-present` — **passed**.
- `npm run build --workspaces --if-present` — **passed**.
- `node --check scripts/my-assigned-tasks-browser.mjs` — **passed**.

These are local synthetic checks. Production configuration, actual staff qualifications and authority, vehicle-specific procedures, staff UAT and physical-device acceptance remain open.
