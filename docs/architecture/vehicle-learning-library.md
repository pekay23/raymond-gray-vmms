# Reviewed vehicle-learning library

**Status:** Implemented as a same-site, read-only projection of explicitly shared learning notes, with reviewer-controlled withdrawal. It is not a technical-reference publication system.

## Intended use

After-sales staff can study vehicle identification exercises created by colleagues and explicitly shared after review. The library helps staff compare observations and find questions or source material to check when they meet an unfamiliar make, model or variant.

The only content eligible for this library is the exact revision that a separately granted reviewer marks `reviewed-learning-record` and opts to share with after-sales staff. A later draft, requested-changes revision or different revision never inherits the prior revision's library status. Authors and reviewers may keep a learning note private by not selecting the share option.

## Meaning and limits

Every library item is labeled: **Reviewed learning note — unverified training content. It is not an OEM-confirmed reference, work instruction, diagnosis, qualification or permission to perform work.** Review confirms that the learning note was considered for staff sharing; it does not establish that a technical claim is correct.

Vehicle-specific truth still requires a named source, revision/date and exact page/section. Unknowns remain unknown. The supplied EV Afriq PDF remains an exercise sheet, with its non-invasive safety boundary, rather than a model-specific reference or repair procedure.

## Access and privacy

- Any active after-sales role with active site membership can search and read current, explicitly shared notes at that same site. Clients, public users, Operator-only accounts, suspended identities and other sites cannot.
- The author-only draft list and reviewer queue remain separate. Library access does not permit editing, commenting, reviewing, publishing a technical reference or copying content into vehicle/work-order records.
- The projection contains only the shared revision's title, make/model text, structured assessment, revision number and review time. It omits authors, reviewers, comments, review reasons, customer/vehicle links and attachment/storage identifiers.
- A reviewer with current review authority can withdraw a shared revision with a recorded reason. This adds an immutable visibility tombstone; it does not delete or rewrite the source note or its review history. Revocation is checked in API queries and row-level security.
- Current search matches the note title and make/model text. Separate year, variant, system-family and learner-level facets belong to the future governed technical-reference catalog, not this first learning-note library.
- Before sharing, the reviewer must confirm the note contains no customer, staff or vehicle identifiers or other private information. Do not put VINs, registration numbers, names or contact details into a learning note.
- Free-text is not automatically scrubbed. The reviewer is responsible for this check; if private information is found after sharing, an authorized reviewer can withdraw the snapshot immediately and preserve the audit history.
- Database row security independently enforces organisation, site and active after-sales placement. Reads are audited and bounded, paginated and searchable by title/make/model.

## Transaction and revision rules

The library row is an immutable projection inserted in the same transaction as the review decision, audit event, idempotency receipt and outbox item. Only a `reviewed-learning-record` decision with the explicit share choice creates it. `changes-requested` never creates a library row. The projected assessment is taken from the exact immutable submitted revision; legacy unstructured answers are adapted as unconfirmed rather than promoted to facts. A later privacy correction creates a separate immutable revocation command, audit event and outbox item; it hides the snapshot without deleting it. The tombstone keeps the revoker identity, exact grant ID/revision and reason so later grant revocation does not erase the decision basis.

## Verification

Verify visibility for all eleven active after-sales role codes; denial for clients, Operator-only, roleless, inactive, wrong-site and wrong-organisation identities; explicit-share behavior; no share for requested changes; current-revision matching; stale/idempotent review behavior; RLS with `vmms_runtime`; omitted private fields; audit; search/pagination; and browser keyboard, responsive and accessibility behavior. No library item proves technical accuracy or operational readiness.

Reviewer identity/grant assignment, governed technical reference publication, cross-site sharing, retention and staff UAT remain under `REV-051`.
