# Service-advisor backlog workbook inventory

**Review date:** 8 November 2026\
**Source:** `C:\Projects\raymond-gray-vmms\CUSTOMER COMPLAINTS____AFTERSALES SERVICE CENTER.xlsx`, worksheet `AFTERSALES ISSUES`.\
**Handling:** Read-only inventory. Customer names, contact values, VINs, complaint wording, staff names and costs are not copied into this report. The source workbook remains local and is not part of the implementation source.

## Inventory result

The workbook has one visible worksheet and 23 columns (`A:W`). It contains 43 non-empty rows below the header. Fifteen rows contain core complaint and vehicle details. Forty distinct legacy booking references appear, but only 12 of the 15 detailed rows have one. Twenty-eight other rows contain a reference without core complaint details, and three detailed rows have no reference. Do not treat those reference-only rows as complete jobs.

The 15 detailed rows have eight distinct free-text status values. Ten status values contain explicit completion language; five do not. All 15 rows have a value in `DATE RESOLVED`, including the five records whose status does not contain completion language. This date cannot stand in for the system's supervisor-signed completion timestamp.

Other completeness counts across the 15 detailed rows:

| Field group | Present rows | Finding |
| --- | ---: | --- |
| Client and contact names | 15 | Keep as separate proposed roles; validate that the client means the paying party. |
| Vehicle VIN, make/model and registration | 15 | Map as source claims; validate VIN format and duplicates during a later dry run. |
| Complaint, category and severity | 15 | Preserve source wording and labels. Do not infer a safety hold from source severity. |
| Actions taken and root cause | 15 | Preserve as historical narratives, not current approvals or signed technical findings. |
| Reported resolved date | 15 | Keep as source-reported history; do not use for live completion timestamps. |
| Warranty label | 15 | Eleven `Yes`, four `No`. This does not establish covered work or payer allocation. |
| Cost field | 15 | The workbook labels the value as company/client cost in GHS. It does not establish an invoice, charge allocation or payment. |
| Follow-up flag | 15 | Nine `Yes`, five `No`, one `TBD`. Mapping to a current reminder workflow needs review. |

## Column mapping

| Source column | Source meaning | VMMS treatment |
| --- | --- | --- |
| Booking number | Existing service-advisor reference | Ignore as the new VMMS reference. Retain only as a historical source identifier if an import is approved. |
| Date reported | Source-reported date | Preserve with provenance. Do not assume it is the exact reception timestamp. |
| Client name | Client or paying party, per the owner's clarification | Map to the client party only after the import record is validated. Never use it as vehicle owner by default. |
| Contact person | Person named alongside the client | Candidate visit/contact person only. Do not treat it as vehicle owner or an authorised representative without evidence. |
| Make, model, trim, chassis number, registration | Vehicle identity and variant candidates | Map make/model/trim to vehicle identity fields. Validate the VIN/chassis number and preserve the original source value. |
| Issue description | Customer-reported concern | Preserve the original text as a historical complaint. |
| Issue category | Source classification | Preserve the source value and map only through an approved category crosswalk. |
| Severity | Source severity label | Preserve as source data. Do not convert it to a safety/quality hold. |
| Sales representative | Sales attribution | Exclude from VMMS operational records, screens and reports under the owner's direction. |
| Technician assigned | Legacy assignment label | Do not map to the new team-lead/supervisor workflow or grant authority. Retain only if an approved historical audit use needs it. |
| Status | Free-text outcome/progress description | Preserve verbatim with provenance. A reviewed crosswalk is required before assigning historical lifecycle states. |
| Actions taken | Work narrative | Preserve as historical narrative. Do not manufacture task sign-off or independent inspection evidence. |
| Root cause | Source diagnosis narrative | Preserve as a historical claim. Do not present it as a verified diagnostic finding without review. |
| Date resolved | Source date | Preserve as `sourceReportedResolvedDate` only. Do not set the live supervisor completion timestamp from it. |
| Warranty | Yes/no source flag | Preserve as an unverified warranty claim. It does not prove coverage, create a payer allocation or alone determine the new `W` reference marker. |
| Cost to company/client (GHS) | Ambiguous historical cost | Preserve as source data pending interpretation. Do not create invoice lines, customer liability or reconciled payment from it. |
| Client satisfaction | Satisfaction rating | Exclude from VMMS operational records, screens and reports under the owner's direction. |
| Follow-up required | Source follow-up flag | Preserve as historical data. Do not create reminders until the follow-up policy and contact method are approved. |
| Remarks | Supplemental source text | Preserve with provenance if the import schema accepts it. Review each value before exposing it in staff or owner views. |

## Import boundary

The owner previously deferred backlog import until the available data, clients, customers and completion statuses could be inventoried. This workbook is a partial source inventory, not a validated import batch. It contains unused references, missing references and status/date disagreement. Do not import it into production or a development customer ledger yet.

Before import, collect the complete source inventory and confirm:

1. Which client pays for each record, who owns each vehicle, and who the visit contact was. Missing roles remain unknown.
2. Which rows are real jobs, placeholders, duplicates, cancelled bookings or follow-up records.
3. How each free-text status maps to the historical lifecycle without inventing supervisor sign-off or team-lead release.
4. What the cost column means and whether any invoice or payment evidence exists separately.
5. How warranty claims, reported dates, actions, root-cause notes and follow-up flags should be retained.
6. A dry-run reconciliation that counts accepted, rejected, duplicate and incomplete records without writing operational records.

Keep the original file read-only. A future import batch must keep source row identifiers, source field values, mapping version, review result and operator decisions so every imported assertion can be traced back to this workbook.

## Restricted staging extraction

On 8 November 2026, the supplied workbook was parsed read-only by `scripts/stage-service-advisor-workbook.py` into a JSON staging artifact outside the repository at `%LOCALAPPDATA%\RaymondGray\VMMS\staging\historical-import-2026-11-08\service-advisor-staging.json`. The staging directory is protected so only the current user has access. Do not copy the workbook, staging artifact or row-level data into source control, ordinary test fixtures, logs or public documents.

The source SHA-256 is `ea314667b8f26a49aa38ee12d6027f71acaf4f63b83e4ae5da1ea0a72e94692f`. The extractor reconciled 43 non-empty rows: 15 job candidates, 28 reference-only rows and 3 detailed rows without a legacy reference. It explicitly omitted `SALES REP` and `CLIENT SATISFACTION`; all 43 source rows remain pending status review, lack a source owner field and have no VMMS booking reference. It left powertrain and reported owner unresolved. The output records `operationalRecordsWritten=false` and has no authority effect.

`scripts/test_service_advisor_staging.py` passed 3 synthetic-workbook tests. This validates extractor invariants, not the completeness or correctness of the business's full backlog. The staging JSON is a private extraction artifact, not an operational import, review approval or test database seed.
