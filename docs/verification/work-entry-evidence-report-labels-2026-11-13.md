# Work-entry evidence labels in service reports

Date: 13 November 2026

## Change

The service-report API now returns accepted evidence attached to each work-history entry as a file name and media type. It only includes evidence that remains accepted and linked to the same organisation, site, work order, and entry. The report print view shows the file name rather than internal UUIDs. Storage object keys are not part of the report response.

## Verification

- API/PostgreSQL coverage confirms the file name and media type appear on both the original work entry and its correction.
- The same check confirms the storage object key is absent from the report JSON.
- `npm run verify:work-plan-browser` passed 50 checks in a fresh disposable PostgreSQL/browser run. It uploaded and scanned a synthetic PDF before Operations review, attached it to a work entry after handoff, verified its name and media type in report JSON, then confirmed its file name is selectable text in the complete 101-entry printed report. The JSON had no `objectKey` field. The run also passed the report's WCAG 2.1 A/AA scan, 320/390/768/1440 px layout checks and the rest of the work-plan browser suite.
- API suite: 121 passed, 0 failed, 1 optional S3/ClamAV integration skipped.
- Web suite: 33 passed, 0 failed.
- Workspace TypeScript checks passed.

## Limits

Generic work-order uploads after Supervisor handoff invalidate the current assignment by design, so this browser scenario attaches its evidence before Operations review and handoff. Uploading new evidence during assigned work requires the separate task-scoped workflow tracked in `BUILD-USER-039-TASK-EVIDENCE-001`; it must not weaken the current work-order scope invalidation rule. Staff review, task-scoped upload and UAT remain open.
