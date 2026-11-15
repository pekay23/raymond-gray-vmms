# Monthly sales report inventory

**Review date:** 11 November 2026\
**Source:** `MONTHLY SALES REPORT FOR OCTOBER 2025-SEPTEMBER 2026-1.xlsx`, worksheet `SUMMARY`.\
**SHA-256:** `277ca8515a92b1dda4e729fbde9bced9b8b9365d992fb900f6de5b15f9023573`

## Inventory result

The worksheet has 133 populated delivery rows and six used columns: source row number, delivery date, vehicle model, chassis number, registration, and name of customer. The `SALES REP` column is excluded from VMMS data, consistent with the owner's instruction that sales-representative information is irrelevant. The sheet contains no maintenance jobs, complaints, work performed, completion statuses, prices, invoices, or payment details. It is not a replacement for the maintenance backlog workbook.

| Field | Rows with a value | Review finding |
| --- | ---: | --- |
| Delivery date | 132/133 | One blank. Dates parse, but 13 are after the title's stated end date of 30 September 2026. The observed date range is 3 October 2025 to 3 December 2026. Preserve the source date and flag the period mismatch. |
| Vehicle model | 133/133 | Free-text model values; no separate make or powertrain column. Do not infer powertrain from model text. |
| Chassis number | 133/133 | No duplicate values in the source. Forty values do not meet the VMMS 17-character VIN character rule. Preserve and quarantine for review; do not create invalid canonical VIN records. |
| Registration | 130/133 | Three blank; 23 cells say `N/A`. Among the 107 other values, no duplicate values were found. Preserve `N/A` as source text and do not treat it as a usable registration. |
| Name of customer | 133/133 | 107 distinct displayed names. The owner confirmed this means the purchaser at delivery. It remains a historical source claim, not proof of current vehicle ownership or the payer for future service. |

The workbook has no formula cells. No individual customer, chassis, registration, or staff values are copied into this report.

## Import treatment

The user's direction is to bring current business data into VMMS. The source is extracted to a protected local file and then stored in a separate, owner-only source-staging schema in the local VMMS database. The batch has immutable row references, original values, file hash, and explicit review flags. The runtime API role has no schema access. Only validated vehicle identity fields may later be promoted to the canonical vehicle registry under the approved import workflow. The sales-customer name remains a reported-at-sale claim. It must not create a service client, a verified current-owner relationship, an owner account or invitation, warranty coverage, an invoice, a payment, or a work order.

The source row number is provenance, not a VMMS booking reference. The `SALES REP` field is excluded. Do not infer vehicle make or EV/HYB/ICE class from the model name. Do not turn a delivery date into a service visit or resolved date.

## Owner review before operational promotion

1. Confirm whether the 13 dates after 30 September 2026 are valid later deliveries or an incorrect report title/range. Keep these rows in staging until reconciled.
2. Review the 40 nonstandard chassis values and missing/non-applicable registrations before vehicle matching or creation.
3. Decide whether the showroom sales records should be visible to the service centre, and which staff roles may search them. This sheet does not authorize owner portal access.

See [historical import](../architecture/historical-import.md) for batch approval and reconciliation controls. The source remains unchanged.
