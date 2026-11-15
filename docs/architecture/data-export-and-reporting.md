# Data exports and reporting

Status: proposed product contract. Purpose-built report templates are an accepted product direction. The report catalog, export permissions and field sets remain pending owner review under [REV-027](../decisions/review-register.md).

Implementation update (10–11 November 2026): the staff work-order page links to a dedicated, text-based Work Order Summary template. The browser check extracts PDF text, confirms expected fields and the disclaimer, excludes workspace navigation, verifies long-note pagination and sequential section numbering, and visually inspects the first and last pages. The page also passes an automated WCAG 2.1 A/AA scan in the real workflow; that scan caught and prompted a fix for a Print summary button label mismatch. This summary is not a closeout pack or authorization. PDF assistive-technology review remains open; the synthetic long note is a pagination fixture rather than a claim that all real report shapes are covered. See the [print layout](../verification/checks/print-report-layout-2026-11-10.md) and [accessibility check](../verification/checks/work-order-report-accessibility-2026-11-11.md).

Implementation update (11 November 2026): a second, distinct template is available to the Head of Service Centre at `/sites/:siteId/overview/print`. It is built from the authenticated, site-scoped aggregate overview and covers current workload, pending review/assignment steps and staffing. Its disclaimer states that it is not a work authorization, vehicle release, invoice or financial statement. The [Head report browser verification](../verification/checks/head-overview-report-2026-11-11.md) passed 20 checks, including responsive layout at four widths, an automated WCAG 2.1 A/AA scan, print isolation and generated PDF output. The [work-order report layout record](../verification/checks/print-report-layout-2026-11-10.md) covers the other template. Both checks use synthetic browser data and do not establish staff UAT or assistive-technology review of the resulting PDFs.

Implementation update (13 November 2026): an internal Work Order Progress Report is available from the task-update panel only when the API identifies the reader as the current Supervisor, assigned Team Lead or Head of Service Centre. The report uses the same site-scoped task-allocation and activity endpoints as the live read-only feed, gathers every page for the current handed-over plan, and fails if access, plan revision, assignments or result count changes during generation. Its distinct print template shows current planned tasks, assignees and timestamped updates; it omits payer and owner contact details and states that updates do not confirm completed repairs, inspection, release, payment or collection. The route has no new backend authorization path. The [task progress report check](../verification/task-progress-report-2026-11-13.md) passed 47 browser checks with a 52-entry, two-page synthetic activity fixture, selectable multi-page PDF text, a changed-count denial, WCAG scan, five responsive widths, and an unassigned-lead denial. This is a narrow internal report, not an approval of the outstanding general report catalog or exports.

These three templates demonstrate report-specific print layouts for a work-order summary, Head overview and internal task progress. No protected-data export endpoint or general report builder exists. The report catalog, allowed filters, selected-client and filtered-work exports, fields, grants and formats remain subject to owner/management/privacy review under REV-027.

## Purpose-built print and report templates

Print output and generated reports are dedicated documents built from authorized record data. They must not screenshot, rasterize, or print the current application page. Each named report has its own definition and layout, chosen for its audience and purpose; there is no single generic layout for unrelated report types. A report may offer approved filters and selections, and its template includes only the relevant permitted information for that request.

Represent each report definition with a stable report type and version, intended audience and purpose, server-owned data query, allowed filters and fields, section order, groupings and totals, labels, required source notes, page layout, and generation timestamp. User-selected filters narrow the report's authorized data. They cannot add fields, widen the site scope, or create a report definition at runtime.

Render each output as semantic, accessible HTML using its report-specific template. Browser printing and PDF output use print styles for page size, repeated table headings, page numbering, intentional page breaks, and safe wrapping of long text. Keep identifying headers and filter/date context with the report, prevent clipped columns, and avoid carrying navigation, sidebars, buttons, notifications, or dashboard layout into the printed document. Text and tables remain selectable and readable; do not render a screenshot or canvas image.

Examples that need separate designs include a work-order sheet or closeout pack, a client's vehicle service history, an Operations queue or workload report, and a finance or quality scorecard. These are examples for the report catalog, not approved first-release reports. A closeout pack must distinguish pending or unknown approvals from accepted decisions and include only evidence and fields the requesting role may access. A report template cannot imply approval or completion that is absent from canonical records.

Before implementing a report, define its audience, purpose, source query, field allowlist, filters, grouping, totals, source drill-down, privacy rules and acceptance cases in the catalog. Test each template with representative data of its own shape, including empty results, long lists and long text. Verify rendered text and pagination in a browser/print output; a screenshot of the live page is not report verification.

## Export routes

Plan for three distinct export routes. They share transport and audit infrastructure, but each has a separate server authorization check.

1. **Paying-client record export:** an authorized staff member selects one paying client and downloads only that client's permitted account and work-order data for the selected site. Reported owners and visit contacts stay separate. Include their personal details only when the export purpose and grant allow them.
2. **Filtered operations export:** an authorized staff member exports the server-filtered work-order set. Candidate filters include site, date range, booking powertrain, paying client, workflow state, team assignment, source category/severity, warranty claim state, invoice/payment state and collection/delivery state. Filters never replace row authorization.
3. **Curated report export:** finance, quality and management reports export only their named metrics and drill-down fields. A report grant does not grant access to all source records.

The browser sends filter values and selected output options, not trusted site scope, role or authorization. The server derives the actor and site, validates an endpoint-specific export grant, applies tenant/site/relationship policy in the query, and caps rows and time range. Cross-site rollups need an explicit organization-level grant and a separate report definition.

## Candidate formats

Keep the first format decision open until management confirms the intended recipients and fields.

| Format | Suitable use | Guardrails |
| --- | --- | --- |
| CSV | Flat client lists, filtered work-order lists, and handoff to other tools | UTF-8, stable header/version, formula-injection neutralization, explicit date and currency columns |
| XLSX | Staff review and filtering in Excel | Values written as text unless a documented numeric column is safe; no executable formulas, macros, external links or hidden data |
| JSON | Controlled system-to-system transfer and round-trip reconciliation | Versioned schema, stable source/VMMS IDs, explicit null/unknown states, no implicit authority or lifecycle effects |
| PDF | Human-readable point-in-time report or a record pack | Render from its own versioned, purpose-built template; paginate and label filters and generation time; not the editable or reconciliation master |

CSV/XLSX are candidate first outputs. JSON supports a separately approved integration contract. PDF is for human review and printing from report-specific templates, not bulk data interchange. The user has confirmed that reports must use different purpose-specific templates and must not be page screenshots; exact outputs and fields remain pending.

## Privacy, safety and audit

- Keep business exports staff-only until named grants and field allowlists are configured. Site membership, the Operator's account-administration duties, and the Head's overview access do not grant export authority; each export route needs its own approved grant.
- Customer/vehicle-owner exports use the current verified owner relationship and owner-visible field policy. A paying-client export is not automatically a vehicle-owner export.
- Keep source-reported history clearly labeled. Exports must not turn source status, dates, costs or narratives into current supervisor sign-off, technical release, payment or warranty approval.
- Append an export audit record with actor, organisation/site, audience, grant and revision, purpose, request correlation ID, schema version, normalized filter hash, selected field set, format, row count, output hash and outcome. Never log row values, contact values, VINs or exported file bytes.
- Use authenticated `no-store` downloads with safe filenames and content disposition. Do not return public storage URLs. Larger exports may use a private, encrypted, expiring download job after recovery and deletion rules are approved.
- Escape spreadsheet formula prefixes in CSV/XLSX display values while retaining the canonical value in protected source records. Never evaluate workbook formulas during import or export.
- Recheck current authority when a download starts. Record denied attempts without returning whether a cross-site target exists.

## Recommended implementation sequence after approval

1. Start with the paying-client export for one selected client at the authenticated site. Use CSV first, a purpose-specific named grant, a strict approved field allowlist, bounded row counts, deterministic order, formula-safe values, an immutable metadata-only audit event and an authenticated `no-store` download.
2. Add filtered work-order exports separately after Operations and privacy owners approve the filter/field matrix and grant rules. Do not let filters widen the authenticated site's scope.
3. Add curated finance/quality/management reports from named metric definitions, then consider XLSX, JSON and PDF for their distinct approved uses. JSON needs a versioned integration contract; PDF must remain a fixed report, not the reconciliation master.

This is a proposed delivery order only. It does not approve fields, audiences, grants, recipient sharing, retention, or any export endpoint.

## Pending review

Management/privacy review must specify: first export audiences and purposes, permitted columns for each route, which PII fields are included, site and cross-site grants, requester and approver roles, row and date-range limits, whether exports are synchronous, retention/deletion, customer-owner downloads, and whether reports require approval or watermarking. Until then, do not add a protected-data export endpoint.

## Verification needed

Use synthetic records for automated tests and an approved, isolated fixture for any live-data rehearsal. Verify client-only isolation, site filters, cross-site denial, overbroad filter denial, role/grant denial, formula-injection handling, exact format columns, audit completeness without values, no-store headers, download expiry, and deterministic reconciliation. Do not claim export coverage from a work-order list API or a PDF screenshot.
