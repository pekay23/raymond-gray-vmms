# Today role-specific work queues verification — 17 November 2026

## Scope

Verified the Today page work previews for technicians and a combined Head of Service Centre, EV Team Lead, Supervisor and Technician role set. The previews call the existing site-scoped work-order queue and assigned-task APIs; this change adds no business command or sign-off path.

## Results

- `npm run typecheck --workspace @vmms/web` passed.
- `npm test --workspace @vmms/web` passed: 37 tests (current run).
- `npm run build --workspace @vmms/web` passed after restoring the exact locked Rolldown Windows binding in local `node_modules`. No dependency manifest or lockfile changed.
- `npm run verify:my-assigned-tasks-browser` passed again on 17 November. The browser check used synthetic API responses, verified technician and combined-role Today previews, confirmed the Operations queue link retains its filter, exercised empty and retryable API-failure states for all four combined-role work-order previews, checked 320/390/768/1024/1440 CSS-pixel widths, and reported zero Axe violations on the combined-role Today page. Existing assigned-task pagination, search, empty/failure, keyboard and responsive checks also passed.
- `codegraph sync` completed; `codegraph affected` reported the web navigation unit test as the directly affected test. That suite passed.
- `git diff --check` passed after documentation and tracker edits.

Detailed local browser output: `docs/verification/browser/my-assigned-tasks.json` (generated and ignored by repository policy).

## Limits

The browser API responses were synthetic. Tenant and site enforcement, grant checks and sensitive-read audit remain the responsibility of the existing API paths and their separate API/database verification. This check does not establish production identity, device-specific behavior, staff acceptance, or offline task changes. Offline Today shows a cached preview only when the query cache has one; users must reconnect before acting.


