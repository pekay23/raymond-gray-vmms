# Service-report pagination synthesis

## Selected design

Use Candidate A: keep the existing report endpoint, add fixed-size page reads, and bind every continuation page to the first page's work-order version and total entry count. Sort entries by `recorded_at, id`; keep the full work-order header on page one only. The print page assembles all pages in order and does not render a report or expose Print until the complete expected count is present and every entry ID is unique.

## Review

The five-criterion cross-judge scored Candidate A 22/25 and Candidate B 12/25. Candidate A uses one existing scoped request and audit event per page and keeps each audited result below the database's 100-row audit bound. Candidate B's proposed single creation audit fails for reports above 100 entries and would store additional sensitive report copies with expiry and cleanup obligations.

The grounding review confirmed that task work-entry mutations lock the same work-order root before inserting, and work entries are append-only. A shared root lock during each page prevents an insert from interleaving with that page. A later append changes the total; a changed work order changes its version. Both make the next page fail closed. VMMS does not currently expose a runtime staff-name update command, so the report continues to resolve the stored staff display name used by current report reads. Revisit a stored name snapshot if staff-profile editing is added.

## Grafts and rejections

- Graft the judge's first-page-only header, exact page-sequence and item-count checks, unique-ID validation, and a locked print control until loading finishes.
- Reject Candidate B's persisted snapshot tables, creator-bound snapshot lifecycle, expiry policy, cleanup job, and duplicated customer/work-history content. Current append-only work entries plus the root version and count checks provide the needed report consistency without storing a second report copy.
- Keep per-page read authorization and audit on every request; the opaque continuation values are consistency checks, never authorization tokens.

## Criteria and verification

Acceptance requires more than 100 entries to be returned exactly once in stable order, every page to be authorized and audited by its actual returned count, concurrent append/version changes to prevent a partial report from printing, and a multi-page selectable-text PDF containing its first and last entries without workspace chrome. A report may not be marked complete after a page error, count mismatch, missing page, duplicate ID, or response-order mismatch.
