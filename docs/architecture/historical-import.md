# Historical maintenance import

The old portal contains no real records to migrate, according to the owner. A separate backlog of maintenance activities and information does exist. The owner wants to import it later, after listing the available information about clients, their customers, work performed and completion statuses. Build the import controls independently of that data collection.

## Inventory before mapping

Record every source's owner, format, date range, row or document count, stable keys, access permission and data quality. Possible sources must be confirmed rather than assumed. Identify how the source distinguishes the contracting client, the vehicle owner, the driver/contact and the payer. One client may represent several customers; a customer may change vehicles or vehicle ownership over time.

Keep the raw source immutable in a restricted staging location with a checksum and batch ID. CSV/XLSX import is a candidate delivery route, not an assumption about the files that will be supplied. Handle supporting images and job documents with their own manifest and access rules.

## Minimum mapping contract

| Group | Fields to map when available | Missing-data handling |
| --- | --- | --- |
| Provenance | Source system, source entity type, source ID, batch ID, raw status, original dates and author | Missing stable IDs require deterministic batch keys; retain source rows |
| Client and customer | Contracting organisation, customer/owner, contacts, account references, ownership dates | Quarantine ambiguous relationships for review |
| Vehicle | VIN, registration, make, model, variant and powertrain | Never invent a VIN; allow an explicitly unresolved historical vehicle record |
| Maintenance | Original job reference, complaint, tasks, labour, parts, dates, technician, completion status | Preserve unknown task breakdown and unknown outcome |
| Evidence and authority | Photos, scans, manuals, inspections, signatories, approval documents | Missing approval remains unknown, never approved by import |
| Commercial | Cost lines, currencies, payer, invoice, payment and outstanding amount | Unreconciled amounts and unknown payer remain flagged |

The production intake workflow may require fields that historical records lack. Use a distinct historical provenance state and a review queue rather than weakening new-work safety requirements to fit old records.

## Status mapping

Map each original label to an approved historical status plus its verbatim source label. Completed historical work can be recorded as completed in the source without creating a current G3 declaration, G4 release or G5 financial closure. An open historical job enters a reconciliation queue. A named staff member decides whether to create or link a current work order after checking custody, safety and remaining scope.

Historical imports never issue current technician privileges, approve SOPs, declare equipment serviceable, sign inspections or certify legal compliance. Reports distinguish source-reported completion from verified VMMS closure.

## Import workflow

1. Inventory sources and obtain the owner's field and status mapping decisions.
2. Upload a restricted batch manifest and validate file types, limits and checksums.
3. Parse into staging, preserving raw rows and original identifiers.
4. Validate values and relationships. Produce duplicate candidates, conflicting vehicle owners, unsupported statuses and missing evidence for review.
5. Preview counts, totals, references and status distributions without committing business records.
6. Obtain a named import approval for the exact batch hash and mapping version.
7. Commit idempotently with source aliases, provenance and an attributable import audit. Retry cannot duplicate records.
8. Reconcile source and imported counts, identifiers, attachments, money and relationships. Record every excluded or quarantined row.
9. Preserve a recovery plan. Reverse an unreferenced failed batch through a controlled audited operation; use forward correction when later records depend on it.

## Acceptance

Test with synthetic sources before the real inventory arrives. Cover duplicate VIN and source IDs, missing VIN, changed ownership, several customers per client, ambiguous payer, source-completed work without QA evidence, open jobs, invalid dates, timezone handling, partial failures, batch replay, cross-site access, malicious formulas and oversized files. Verify all source rows are accounted for as imported, rejected or awaiting review. Real-backlog acceptance remains pending the source inventory and owner review.
