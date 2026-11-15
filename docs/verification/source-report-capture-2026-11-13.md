# Source report capture verification

Date: 2026-11-13

Result: **Capture, correction, source-file linkage and printable output passed a disposable PostgreSQL/browser journey; wider authority and concurrency acceptance remains open.**

All database scenarios used a disposable local PostgreSQL database and synthetic records. The supplied the source-report customer report was not imported or inserted into canonical records.

## Passed

- Focused API regression rerun on 2026-11-14 passed against disposable PostgreSQL. It verified the Service Advisor's successful recording path, a cross-organisation write denial with no version or report-row change, and two concurrent corrections to the same source revision yielding exactly one commit and one `STALE_VERSION` conflict.
- The same rerun raced source-report entry against the real Operations-review API command on a fresh work order. Exactly one transition committed, the other returned a conflict, the work-order version advanced once, and the database contained only the winning transition.
- A test-only outbox trigger forced a source-report command to fail after its business writes. PostgreSQL row counts remained unchanged for the work order, complaints, report revisions/items, events, receipts and outbox; retry with the same command ID then succeeded after removing the trigger.

- The API migration applies under the runtime role and retains the full sensitive-read action allowlist, including the task-evidence action from migration 061.
- Full API suite: **122 passed, 0 failed, 1 optional local S3/ClamAV fixture skipped**.
- Focused source-report API coverage checks Head of Service Centre recording, technician/read-only/account-only Operator denials, CSRF, idempotent retry, correction history, concern linkage, stale work-order versions, post-Operations-review denial, no partial rows on that denial, unchanged G1-G5 gates, and separation from assigned-task work entries.
- Web unit suite: **33 passed**.
- API and web TypeScript checks and production builds passed in the previous implementation verification; the web typecheck also passed after this turn's source-file, label and version fixes.
- The real browser flow passed on a disposable synthetic PostgreSQL database in Chromium 157. It attached accepted evidence, recorded two source items with a concern relationship, corrected the report, retained its file link, and verified both revisions plus attribution and selectable text in the purpose-built service report.
- The same browser run passed 200% and 400% zoom, layout/text clipping, focus/reachability, toast dismissal, work-order accessibility and print checks. A clipped transcribed detail at 400% was fixed with additional right padding and wrapping; the final run passed.
- Shared responsive baseline also passed phone, fold, tablet, desktop, retina and zoom viewports.
- Documentation traceability for this slice passed before the latest scope additions: 252 requirements, 655 tasks and 350 source blocks. The current source of truth now records 256 requirements and 666 tasks; its counts are regenerated and current.
- `git diff --check` passed; Git reported only repository-wide LF/CRLF normalization warnings.
- CodeGraph synced and identified affected test files: `apps/api/test/evidence.test.ts`, `apps/api/test/foundation.test.ts`, `apps/api/test/support/evidence-browser-runtime.ts`, and the four listed web test files.

## Still needed

- Staff UAT and physical/documentary VIN confirmation before the supplied report can be entered.

## Scope boundary

The report transcription stores what the source says and who entered it. It does not add technician work entries, create technical sign-off, or change safety, release, payment or collection state. No production database, external deployment or DNS was changed. Synthetic browser artifacts are in `docs/verification/browser-source-report/results.json`; the supplied the source-report customer report remains outside canonical data because the VIN still needs physical/documentary confirmation.
