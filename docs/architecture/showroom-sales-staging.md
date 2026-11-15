# Showroom sales source staging

**Status:** local source-staging foundation implemented. Field interpretation and operational promotion remain pending owner review.

## Boundary

The monthly sales report is not a workshop job ledger. Its rows are kept in the separate PostgreSQL schema `vmms_import_staging`, with no organisation or site assignment while the source's service-centre scope is unknown. The staging tables are not part of the canonical `parties`, `vehicles`, `visits`, `work_orders`, finance, or vehicle-owner access models.

The batch retains the workbook SHA-256, sheet, title period, mapping version, row count, and a fixed unreviewed state. Each row retains its workbook row reference, raw delivery date, model, chassis number, registration, and customer-at-sale name claim. Review flags and a per-row hash support reconciliation and idempotent replay. The sales-representative column is not extracted.

## Access and changes

The schema has no VMMS runtime grants, no application route, and no row-level security policies. Both tables enable and force row-level security, so application roles cannot read or write them. Local staging uses the separate migration/import credential and rejects non-loopback hosts, production mode, and any database other than the local `vmms` development database. The imported source rows are immutable; corrected sources use a new batch.

This is an administrator-only source capture area, not a user-facing customer list. Do not expose it through general-purpose database browsing or exports. Production imports require a separate reviewed deployment path, explicit organisation/site assignment, role-limited review access, and approval of the exact batch hash.

## Promotion rules

- A customer named at sale is not automatically a current vehicle owner, service client, payer, or owner-portal user.
- A delivery date does not create a workshop visit, completed job, invoice, or payment.
- A model string does not establish make or EV/HYB/ICE classification.
- A malformed chassis number stays in staging until reviewed. Never invent or repair an identifier silently.
- Only approved and validated vehicle identity fields may later be promoted to the canonical vehicle registry. Preserve the source batch reference and audit trail.
- Do not create operational work orders from this report.

See the [monthly sales report inventory](../discovery/monthly-sales-report-inventory.md) for source quality and pending owner decisions. The [historical import plan](historical-import.md) governs controlled batch approval, reconciliation, and recovery.
