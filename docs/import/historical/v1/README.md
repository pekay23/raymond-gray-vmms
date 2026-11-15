# Historical import template v1

This package defines the first VMMS historical-maintenance import format. It contains blank CSV templates, a linked fictional example, and a machine-readable manifest. It does not import data or write VMMS records.

The real backlog inventory is still pending. Do not fill these files with business records until the source owner confirms the available fields, access permission, source status meanings, and mapping decisions.

## Files

| File | One row represents |
| --- | --- |
| `batch-manifest.csv` | One source batch and its immutable source-file checksum |
| `clients.csv` | A contracting client or account |
| `customers.csv` | A customer or vehicle owner identity from the source |
| `client-customer-links.csv` | A dated source relationship between a client and a customer |
| `vehicles.csv` | A source vehicle record, including incomplete identifiers |
| `ownership-intervals.csv` | A source-reported customer and vehicle relationship over time |
| `maintenance-jobs.csv` | A source maintenance job, its parties, dates, and raw status |
| `maintenance-tasks.csv` | A source task or labour line under a maintenance job |
| `commercial-lines.csv` | A source cost, invoice, or payment line with explicit currency and tax state |
| `evidence-manifest.csv` | A reference to a source file. It does not contain file bytes or grant access |
| `status-map.csv` | A reviewed mapping from a raw source status to a historical status |
| `field-mapping.csv` | The source file hash, row, and column used for each mapped field |

The empty templates are under `templates/`. The fictional, cross-referenced example is under `examples/`. `manifest.json` defines the package version, headers, required columns, and value sets.

## Import rules

- Use UTF-8 CSV with RFC 4180 quoting, comma separators, a header row, and CRLF record endings. Intake may strip a UTF-8 byte-order mark. Reject invalid UTF-8, other encodings, duplicate headers, malformed quoting, and rows with the wrong number of fields.
- Keep source identifiers as text. Do not substitute VMMS IDs. Scope each source identifier by batch and entity type. If a source has no stable identifier, retain the file hash and source row reference. The staging importer can create a deterministic batch-local key later.
- Keep contracting client, customer or owner, driver or contact, and payer roles separate. Do not infer a party from a shared phone number, email, registration, or VIN.
- Use `YYYY-MM-DD` when the source has a date without a time. Use an RFC 3339 timestamp with an explicit offset when the source has a time. Preserve the original value and its stated precision in source staging. Quarantine values with unclear timezone or date meaning.
- Store amounts as decimal text with a period and no exponent or thousands separator. Include an ISO 4217 currency for each amount. Do not infer currency, tax rate, tax jurisdiction, payer, or rounding. Validate currency precision against the approved currency metadata version before import.
- Preserve each raw completion label in `source_status_raw`. A status map row stays `pending-review` until the owner approves that meaning. `gate_effect` is always `none`. A source-reported completion never creates current inspection, safety, release, ownership, or finance approval.
- Record field-level provenance in `field-mapping.csv`. Every mapped value must point to a source-file checksum, source row, source column, transformation rule, and mapping version. Leave unresolved fields blank and send the row for review.
- Treat CSV values as text. Never evaluate formula-like cells. Escape leading formula characters in any future spreadsheet export.
- Keep source documents outside this CSV package. Add a manifest row only after a person confirms source permission. Do not publish historical evidence to vehicle owners as part of import.

## Example status mapping

The example maps the fictional source value `DONE` to `reported-complete`. Its `mapping_state` is `pending-review`, and its `gate_effect` is `none`. This shows the file shape only. It is not an approved mapping for the real backlog.

## Validation outcomes for the later staging importer

The package checker verifies file encoding, headers, required fields in examples, source checksums, cross-file references, status-map safety, date syntax, and decimal syntax. It does not parse or import a real batch.

The staging importer must return row-level errors and keep rejected or unresolved rows out of live records. Use stable codes such as these:

| Code | Meaning | Staging action |
| --- | --- | --- |
| `CSV_ENCODING_INVALID` | The source is not valid UTF-8 | Reject the file and request a corrected export |
| `CSV_HEADER_INVALID` | A required header is missing or duplicated | Reject the file and name the header problem |
| `CSV_ROW_WIDTH_INVALID` | A row has extra or missing cells | Quarantine the row with its source location |
| `SOURCE_REFERENCE_UNRESOLVED` | A row references a missing source entity | Quarantine the row and name the missing reference |
| `SOURCE_STATUS_UNMAPPED` | The raw status has no approved mapping | Keep the raw value and await review |
| `RELATIONSHIP_AMBIGUOUS` | Client, customer, owner, driver, or payer is unclear | Quarantine the relationship for review |
| `DATE_AMBIGUOUS` | The value or timezone cannot be interpreted safely | Preserve the raw value and request a mapping decision |
| `MONEY_FORMAT_INVALID` | An amount uses a comma, exponent, or unsupported precision | Preserve the raw value and reject the normalized amount |
| `CURRENCY_MISSING` | An amount has no source currency | Keep it unresolved. Do not select a default |
| `TAX_BASIS_UNKNOWN` | Tax rate, amount, or jurisdiction is absent or unclear | Preserve the source values and flag the tax state as unknown |
| `SOURCE_PERMISSION_UNCONFIRMED` | Access or use of a source document is not confirmed | Do not copy or publish the document |
| `FORMULA_LIKE_VALUE` | A source cell starts with a spreadsheet formula character | Preserve it as literal text and flag it for review |

The staging tool emits each row issue as a stable `code` plus a plain-language `message` in the row's `issues` array. Its `errors` array remains a text-only compatibility view. Use `issues` for programmatic handling; never parse the message. It also reports stable codes for duplicate source IDs, duplicate VIN candidates, ambiguous status maps, unsupported status-map entity types, forbidden gate effects, invalid dates/amounts/currencies, missing mapping review details, source checksum/column/row mismatches, unsupported mapping rules and mismatched copied values. Pending or rejected status maps use `SOURCE_STATUS_MAPPING_UNAPPROVED`; they do not resolve a job or task status. Formula-like values in template rows, source rows, and non-control batch metadata use `FORMULA_LIKE_VALUE` and stay literal; linked template rows are quarantined and source reconciliation names affected columns without copying formula content. Formula-like batch control fields fail closed before file selection or checksum handling. A manifest metadata issue contributes to the `requiresReview` result. Missing currency uses `CURRENCY_MISSING`, and unavailable approved currency precision uses `CURRENCY_METADATA_UNAVAILABLE`. Batch-level file/manifest failures remain command errors and do not use this row-level issue contract. This tool is still staging-only and never imports operational records.

## Check the package

Run `python scripts/check-historical-import-templates.py` to validate the templates and fictional example. `npm run verify` also runs the template tests and synthetic staging tests with the docs, typecheck, build and API integration suite.

## Local staging tool

`scripts/stage-historical-import.py` validates a complete batch against this template version and writes a private JSON staging artifact. It requires explicit organisation and site UUIDs so the artifact has one declared scope. That input is a partition label; it does not prove the operator's access to the site. The tool has no database connection and never creates VMMS records, authority, payment facts or gate transitions.

Example using only the fictional package data:

```powershell
python scripts/stage-historical-import.py `
  --batch-dir docs/import/historical/v1/examples `
  --output "$env:LOCALAPPDATA\RaymondGray\VMMS\staging\synthetic-review" `
  --organization-id 8b74fa1d-32ad-4bf0-a0f1-49edb68e98b0 `
  --site-id 41bb56a5-b8e1-4f05-bef7-c1ac178f28b2
```

The output directory must be new and outside both the repository and submitted batch directory. On Windows, the tool creates it with a protected owner-only DACL; on POSIX systems it creates the directory with mode `0700`. It enforces a 50 MiB per-file and 100,000-row per-CSV safety limit. It checks CSV shape, checksums, manifest counts, required fields, batch IDs, references, source statuses, dates, decimal syntax, currency format, duplicate IDs and VIN candidates. It archives the exact raw source bytes used during parsing inside the private output. Rows with validation errors remain in the artifact's `quarantined` collection with their original values. References to ambiguous or quarantined entities are also quarantined. Evidence references without confirmed permission stay quarantined, and an `authorized` evidence row must provide a traceable authority reference. An approved status or field mapping must identify a reviewer and valid review date. These are provenance fields only; the staging tool does not independently validate the authority or reviewer. Because ISO 4217 membership and currency precision metadata have not been approved, monetary rows are currently quarantined and the amount totals are empty. The report separates source rows, template rows, rows accepted into staging, duplicate candidates, quarantined rows, unresolved source rows, source status counts and per-row source-to-staging outcomes; field-map coverage is shown as complete or partial and still awaits owner review.

The fictional example is a parser fixture only. A real batch still needs source-owner permission, the full source inventory, owner-approved mappings and status meanings, verified site scope, a named reviewer and an audited import/commit workflow. The organisation and site UUIDs supplied to the command are partition labels; they do not prove operator access. The staging utility cannot establish those conditions and does not satisfy real-backlog acceptance. File-size and row-count limits are provisional and need checking against the complete source inventory. See the [staging verification report](../../../verification/checks/historical-import-staging-2026-11-09.md).

## Pending review

The business owner still needs to confirm the real source inventory, client and customer roles, source status meanings, currencies and tax treatment, evidence permissions, and field mappings. Review `docs/architecture/historical-import.md` before preparing a real batch.
