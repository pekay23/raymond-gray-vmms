# Service report pagination — Candidate A

## Caller usage

The print page asks for report page 1. The API returns the report header and the first bounded entry page, plus the current work-order version and total entry count. The print page then requests pages 2 through the last page in order, passing the version and count from page 1. It enables the report and Print control only after every page is loaded and the server confirms the same version and total on each request. A conflict shows a clear refresh message and leaves Print unavailable.

## Contract sketch

```ts
type ServiceReportPageRequest = {
  page: number;                // default 1; bounded positive integer
  pageSize: number;            // default 50; bounded 1..50
  expectedWorkOrderVersion?: number; // required for page > 1
  expectedTotalItems?: number;        // required for page > 1
};

type ServiceReportPage = {
  generatedAt: string;
  workOrderVersion: number;
  order: WorkOrderDetail;
  entries: ReportEntry[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};

readWorkOrderServiceReport(
  pool: Database,
  scope: Scope,
  workOrderId: string,
  requestId: string,
  page: number,
  pageSize: number,
  expectedWorkOrderVersion?: number,
  expectedTotalItems?: number,
): Promise<ServiceReportPage>;
```

Page 1 establishes `workOrderVersion` and `totalItems`. Later pages must supply both expected values. A changed version or count returns `409 SERVICE_REPORT_CHANGED`, with no partial report marked ready. A fixed page size of 50, positive page validation, and deterministic `recorded_at, id` ordering bound individual requests and keep page boundaries stable. Reports have no total entry cap.

## Server module boundary

- Keep report composition and page reads in `apps/api/src/work-order-service-report.ts`.
- Keep request parsing and route wiring in the existing service-report route in `apps/api/src/app.ts`.
- Extend the response contract in `apps/web/src/api.ts`.
- Keep the multi-page orchestration and complete-report print gate in `apps/web/src/pages/print-work-order.tsx`.
- Do not create a new report service layer, snapshot table, or mutation path.

Each request uses the authenticated organisation/site scope and existing report read authorization. In its transaction, the API takes the existing shared work-order root lock, verifies the current work-order version, reads the current entry count, and, for later pages, compares it with the expected version/count. It then reads only that page with `ORDER BY entry.recorded_at, entry.id OFFSET ... LIMIT ...`. Every returned page records a sensitive-read audit event whose count is the actual number of returned entries. The header/order version is checked against the locked root row as it is today.

## Consistency rationale

Work entries are append-only, corrections add a new entry, and current work-entry writes lock the same work-order root row. Within one page request, the report's shared root lock prevents a work-entry write from passing its serialization point while that page is assembled. If a new entry commits between pages, the next page observes a different total and fails closed. Work-order commands that change the report header increment its version; a changed version also fails closed. This avoids a persistent report snapshot, expiry policy, and cleanup job while preventing missing/duplicate entries from being printed as a complete report.

The read view is only stable for the report data governed by work-order version and immutable entry count. Joined data that can change without incrementing the work-order version (for example a staff display name) is a limitation: either preserve attribution text on each work entry, prove the joined source is immutable for report purposes, or choose a persisted report snapshot before claiming exact whole-document snapshot consistency.

## Print-page behavior

`PrintWorkOrder` fetches the first page, then loads each remaining page sequentially with the established expected version and total. Sequential requests make conflict handling deterministic and avoid redundant work. During loading, show a progress state such as “Loading report entries (50 of 125)” and keep report content/Print unavailable. Any authorization, network, stale-version, or changed-count error uses the existing error state and retry path; do not print a partially loaded list. On success, concatenate pages in server order and render one selectable-text service report with the existing custom sections and print styles. Retain the page-one `generatedAt` and `order` projection for the full printout.

## Acceptance checks

1. A PostgreSQL report with 105 or more synthetic entries returns the exact ordered set once across multiple pages; corrections remain adjacent only according to their recorded times and keep their source links.
2. Every page is site-scoped and authorized independently; wrong-site, unauthenticated, and read-denied calls return no entry data or read audit for another site.
3. Page size above 50, page below 1, or missing expected version/count on page 2+ is rejected.
4. Append a work entry between page requests: the next request returns `409 SERVICE_REPORT_CHANGED`; the browser does not expose a printable partial report.
5. Change the work-order version between pages: the next request returns `409 SERVICE_REPORT_CHANGED`; the browser does not expose a printable partial report.
6. A stable report loads all pages before enabling Print, includes first and last entries as selectable PDF text, excludes application controls, and paginates without clipping.
7. Audit assertions show one read event per requested page and the sum of `result_count` equals the entries actually returned.

## Alternatives considered

- **Return all entries from one request:** rejected. It removes the current guard but loses bounded transfer, page-level audit clarity, and useful progress feedback for a large report.
- **Persist report snapshots and row IDs:** stronger isolation for mutable joins, but adds snapshot schema, expiry, authorization-on-every-page rules, retention/cleanup work, and a new stateful lifecycle. Defer unless attribution sources cannot be made snapshot-stable within the existing model.
- **Keep the 100-entry refusal:** rejected. It fails the complete report requirement for longer-running vehicles.

## Rationale and disposition

This candidate chooses one existing API report endpoint with bounded page reads and explicit continuation expectations. The print page owns only sequential page orchestration; the API remains the authority for scope, version, count, ordering, and audit. It fits the existing task-progress report pagination pattern and avoids a new subsystem. Before implementation, verify that every work-entry writer locks the work-order root and decide whether actor display names need a write-time snapshot; otherwise do not claim that mutable joined attribution is frozen across page requests.
