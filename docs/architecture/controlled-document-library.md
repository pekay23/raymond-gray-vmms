# Controlled document library

## Current implementation boundary

The staff workspace has a read-only catalog and a protected download route for controlled procedures. A listed document must have a revision whose status is `effective`, whose effective interval includes the current transaction time, whose distribution is `all-site-staff`, and whose linked procedure evidence has an accepted clean scan. The list is site-scoped and searchable with bounded pagination. Responses are not cached.

All active workspace roles, including the VMMS Operator when they hold an active site role placement, may read the catalog and current effective files. A membership without an active role placement, vehicle-owner session, customer, external or suspended identity cannot use the staff document route. Generic evidence routes apply the same effective-revision predicate so they cannot expose draft procedure files through an alternate URL.

Read and download attempts append staff-attributed, site-scoped audit events. Document metadata is not writable by the web runtime. The current page does not create, review, approve, publish, supersede or acknowledge documents. No SOPs or synthetic production documents are seeded.

## Governance still required

The owner will provide the SOPs and current document register. Before operational use, reconcile each source document and revision, define the approver and independent verification authority, confirm review intervals and distribution rules, and decide how staff acknowledgements and supersession are recorded. No draft or unknown procedure may satisfy a work or safety gate. The accepted design for the future lifecycle is in [controlled-document governance lifecycle](controlled-document-governance-lifecycle.md); implement its write path only after those inputs and grants are approved.

The backlog workbook is a separate later import. Its source records and completion statuses will be inventoried when the owner supplies the available client, customer, vehicle and work history. Never treat document test fixtures as operational data.

## API contract

- `GET /api/v1/sites/:siteId/documents?q=&page=&pageSize=` returns only current effective revisions for the authenticated site and active staff role.
- `GET /api/v1/sites/:siteId/documents/:documentId/download` streams the current revision through the evidence service with private, no-store response headers.
- Publication remains a governance-controlled server operation defined by the accepted design; there is no client-side write control or runtime metadata write grant in this slice.

## Verification boundary

The integration test uses synthetic fixtures in disposable PostgreSQL to exercise current-effective versus draft filtering, pagination/search, tenant isolation, role-less and owner denial, no-store responses, metadata auditing and immutable read events. This is not evidence that a real SOP has been approved, that the publication lifecycle is complete, or that staff UAT has passed. See the dated check under `docs/verification/checks/`.
