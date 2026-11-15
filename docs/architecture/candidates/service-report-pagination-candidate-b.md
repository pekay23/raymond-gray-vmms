# Service report pagination — Candidate B

**Status:** Design alternative only; not selected or implemented.

## Caller flow

1. The authorized report page creates a report snapshot with an idempotency key.
2. The API locks the current work-order root, reads one consistent work-order projection and its complete attributed entry set, and writes a short-lived snapshot in one transaction.
3. The response gives an opaque snapshot ID, the frozen report header, generated time, work-order version, total entry count, expiry time, and page one.
4. The browser loads later pages by snapshot ID. It renders and enables Print only after every page has loaded and passed schema validation. A failed or expired page leaves Print disabled and offers a new snapshot.
5. The purpose-built print view uses the frozen projection and ordered entry pages, preserving selectable text and print pagination.

## Contract sketch

```ts
type CreateServiceReportSnapshot = {
  snapshotId: string;
  generatedAt: string;
  expiresAt: string;
  workOrderVersion: number;
  totalItems: number;
  totalPages: number;
  page: 1;
  pageSize: number;
  order: WorkOrderDetail;
  entries: ServiceReportEntry[];
};

type ReadServiceReportSnapshotPage = {
  snapshotId: string;
  generatedAt: string;
  expiresAt: string;
  workOrderVersion: number;
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
  order: WorkOrderDetail;
  entries: ServiceReportEntry[];
};

createWorkOrderServiceReportSnapshot(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  pageSize: number,
  requestId: string,
): Promise<CreateServiceReportSnapshot>;

readWorkOrderServiceReportSnapshotPage(
  pool: Database,
  scope: Scope,
  snapshotId: string,
  page: number,
  requestId: string,
): Promise<ReadServiceReportSnapshotPage>;
```

Use `POST /api/v1/sites/:siteId/work-orders/:workOrderId/service-report-snapshots` for creation and `GET /api/v1/sites/:siteId/work-orders/:workOrderId/service-report-snapshots/:snapshotId?page=N` for page reads. Keep page size fixed server-side (for example, 50) so the snapshot’s page count cannot be changed by the caller. The snapshot ID is a locator, never a bearer credential.

## Persistence and consistency

Use two short-lived tables:

- `service_report_snapshots`: UUID, organisation/site/work-order scope, creator, idempotency key, work-order version, generated/expiry times, frozen `order` JSON projection, total entry count, and page size.
- `service_report_snapshot_entries`: snapshot scope, stable ordinal, entry ID, and frozen `ServiceReportEntry` JSON projection. A composite foreign key ties rows to the same scoped snapshot; deleting the parent cascades.

Creation runs in one transaction. It checks current active membership and the same service-report read authorization as today, takes `FOR SHARE` on the scoped work-order root, reads and validates the work-order projection and ordered entry set, inserts the snapshot and its entry rows, and appends one prepared-read audit event with the snapshotted entry count. Since work-entry writes lock the root first and entries are append-only, the lock prevents a write from interleaving with snapshot preparation. Any work-order mutation or work-entry append after commit belongs to a later report and cannot change the snapshot.

Page reads recheck active membership and the report read authorization, then require a matching organisation, site, work order, creator, non-expired snapshot, and valid page. They return only the requested immutable projection in ordinal order and audit the actual page row count. A cross-actor or cross-site snapshot lookup returns not found. Expired records return a clear `REPORT_SNAPSHOT_EXPIRED` response and cannot be printed. Page reads do not update the work order or create domain events/outbox items.

The current report has no supported entry-count ceiling. Snapshot creation must still be bounded by statement timeout and request size; if a configured operational cap is later needed, it must be an explicit reviewed business/technical limit with a truthful error, never silent truncation.

## UI and failure behavior

- Start snapshot creation only from an authorized report link; do not persist the snapshot ID in a long-lived URL or local storage.
- Show a progress state while creating the snapshot and while each page is fetched. Keep Print disabled until the expected page count and item count have been verified.
- On a missing page, invalid response, network failure, authorization loss, or expiry, do not render a partial report as complete. Explain that the report needs to be prepared again.
- Use the frozen `generatedAt` and work-order version throughout the print document. Keep the report’s existing owner/payer/source-state distinctions and non-approval language.
- A refresh creates a new snapshot rather than mixing current work-order facts with an earlier set of entries.

## Verification rubric

- Create a synthetic report with at least 105 entries; fetch every page; prove each expected ID appears exactly once and in deterministic order, including correction links and evidence IDs.
- Insert a concurrent new entry and mutate the work order after snapshot creation; verify later pages and PDF remain exactly equal to the created snapshot.
- Lose the create response and retry with the same idempotency key; receive the same snapshot rather than a second snapshot.
- Deny wrong-site, wrong-actor, revoked-membership, invalid-page, and expired-snapshot reads without returning report content; verify all page reads produce scoped audit records.
- Confirm snapshot rows expire and are deleted by an owned cleanup mechanism; prove the cleanup cannot delete active snapshots or canonical work history.
- Generate the final report PDF from multiple pages; check all entries as selectable text, page breaks, accessible pre-print content, no workspace controls, and no partial print after a failed page.

## Rationale and trade-offs

This design freezes the complete report once, so pages cannot drift even if work-order data, staff display names, or evidence relationships change after page one. It moves consistency logic out of the browser and avoids repeatedly loading the same work-order header for every page. It also supports reliable retries for report preparation.

The costs are material: it duplicates sensitive report data in JSONB, adds tables/migration and runtime database permissions, needs idempotent snapshot creation, requires a cleanup worker or bounded lazy-retention service, and introduces expiry, ownership, and denial paths that need security review. The current API already produces the full report in one read; snapshots reduce response and UI payload size but do not remove initial server memory/CPU or database write cost. Keep this alternative only if immutable report reproducibility across later changes is a stated requirement. For the immediate target of displaying all current append-only work entries, a stateless paged API with version/count checks is simpler and leaves no temporary copy to secure or delete.

## Relevant existing implementation

- [Service work history and report contract](../service-work-history-and-reports.md)
- [Current service-report API](../../../apps/api/src/work-order-service-report.ts)
- [Current purpose-built print view](../../../apps/web/src/pages/print-work-order.tsx)
