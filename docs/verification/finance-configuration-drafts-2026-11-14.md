# Finance configuration draft verification

**Date:** 14 November 2026\
**Scope:** Draft-only Finance configuration registry API, migration and transaction boundary.\
**Environment:** Disposable PostgreSQL database created by the API integration-test harness; synthetic staff and authority grants only.

## Checks

| Check | Result |
| --- | --- |
| API integration test for current grants, denied access, immutable revisions and draft-only response | Passed |
| API TypeScript typecheck | Passed |
| Evidence/API regression suite after the audited-read migration change | Passed: 9, 1 optional S3/ClamAV fixture skipped |
| Exact command replay, stale revision rejection and unknown-field rejection | Passed |
| Rejection of common inline credentials and bearer/credential-bearing references | Passed |
| Two concurrent edits against the same expected revision yield one commit and one stale-version conflict | Passed |
| Paginated reads and grant rotation from manage to read-only | Passed |
| Forced RLS without transaction scope and runtime SELECT/INSERT-only privileges | Passed |
| Atomic domain event, command receipt and outbox evidence for committed revisions | Passed |

Focused command:

```powershell
node --import tsx --test --test-name-pattern='Finance configuration drafts' apps/api/test/foundation.test.ts
```

Result: 1 targeted test passed, 0 failed. Migration 073 was applied by the disposable test setup. The first run exposed an unnecessary `FOR UPDATE` on `aggregate_roots`; the runtime role intentionally lacks UPDATE there. Removing that lock is safe because the command already holds the stable per-draft advisory lock. The post-fix run, including the competing-write and credential-pattern cases, passed.

Typecheck command: `npm run typecheck --workspace @vmms/api` — passed.

Related regression command: `node --import tsx --test apps/api/test/evidence.test.ts` — 9 passed, 0 failed, 1 optional local S3/ClamAV test skipped.

## Migration-chain recheck — 14 November 2026

The full API suite later exposed a regression in migration 074: its rebuilt `sensitive_read_events_action_check` allowlist omitted `finance-configuration-draft-read-prepared`, which migration 073 had added. Finance draft writes still passed; the first audited list read failed the database check and returned a generic API 500. Added migration 075 to restore the full action list, including the Finance draft read action. The targeted Finance draft integration test was rerun against the disposable migrated PostgreSQL database and passed (1 passed, 0 failed). The local development database also applied migration 075 successfully.

The source migrations remain append-only; migration 074 was not rewritten. A full API and web suite rerun is still required before treating this regression as cleared across the repository.

## Limits

This is not evidence of Finance approval, production readiness, invoice or receipt correctness, email delivery, G5 clearance, or real PostgreSQL deployment concurrency under production load. No Finance grants or effective configuration are seeded. UI, independent Finance review, managed secrets, operational UAT and the remaining manual Finance workflow are still open.
