# Cross-judge — vehicle-learning comments and revision history

## Rubric and score

Scores are 1–5; 5 is strongest. The review is limited to these two proposals and the current source/access design.

| Criterion | Candidate A | Candidate B | Evidence |
| --- | ---: | ---: | --- |
| Append-only history and correction semantics | 4 | 5 | Both preserve snapshots and separate comments from answers. B explicitly binds every comment to a numbered immutable revision; A leaves comment-to-revision provenance implicit. |
| Author/site privacy; no implicit reviewer grant | 5 | 5 | Both retain author-owned RLS, site scope, staff role checks and make reviewer access a future independently authorized path. |
| Atomic audit, idempotency and concurrency | 4 | 5 | Both use the existing command transaction and parent lock. B explicitly treats the current entry as version authority, gives comments their own aggregate, and keeps comment text out of general events. |
| Small maintainable surface | 5 | 4 | A proposes separate revision/comment reads. B's single activity read reduces UI/API calls and gives history a cohesive boundary, but its comment schema is more explicit and slightly larger. |
| Testability and migration safety | 4 | 5 | B states the required composite FK, immutable snapshot/comment triggers, RLS and atomic failure/replay scenarios more completely. |
| **Total** | **22/25** | **24/25** | |

## Recommendation

Use Candidate B as the base. The crucial improvement is that a comment is linked to a particular saved answer revision, so later reviewers can understand which evidence and classification the author was discussing. The current `vehicle_learning_entries` row remains the fast, version-checked projection; history belongs in explicit append-only tables rather than being reconstructed from command receipts or audit events.

## Grafts and refinements

1. Keep Candidate A's narrow, domain-owned API boundary: do not introduce a generic comments service. Prefer one `readVehicleLearningActivity` response for the selected entry's ordered revisions and comments, loaded only when the user opens its history disclosure.
2. Keep revision snapshots, entry updates, aggregate event, receipt and outbox in the same `runStaffCommand` transaction. A failed event/outbox insert must roll back the current-row update and snapshot together.
3. Keep comments as separate immutable commands and aggregates. Store only IDs, target revision and operation in the general audit event; return comment text only through the author-scoped activity query/command response.
4. Comments should identify the immutable revision they discuss. A comment on a previous revision can remain useful after a newer draft is saved; therefore prefer an explicit selected `revisionNumber` validated against the entry's revision table over requiring it to equal the latest version. The parent lock still verifies ownership and prevents cross-entry races. If the UI only permits comments on the latest version, `expectedEntryVersion` is also acceptable, but that policy must be clear in the UI.
5. For the current slice, RLS must make history/comments visible only to the note author at the same organization/site. A trigger or grants must reject update/delete. Do not expose the queue or comments to other staff until the owner assigns reviewer scope and the server has a separate action-time grant check.
6. Preserve Candidate B's one-page disclosure, stale-save handling, saved confirmation, keyboard access and zoom/browser coverage. No comment should be presented as a diagnostic finding, repair instruction, reviewed vehicle fact or competence evidence.

## Risks that remain

- The existing test fixtures lack a second active after-sales identity at the same site. Add one or construct the author-isolation test directly under RLS, in addition to roleless and cross-site endpoint denials.
- Ensure composite foreign keys are backed by the required unique parent keys; PostgreSQL will not infer a unique `(organisation, site, entry, author)` relationship from the current `(organisation, site, id)` key.
- Define snapshot retention/export before production. Keep the learning text out of general-purpose event payloads and avoid customer/owner identifiers in notes.
- This design still does not provide reviewer access, review decisions, publication, trainer assignment, or staff UAT. Submitted means waiting for an authorized reviewer, not approved.

## Verdict

Candidate B wins on traceable revision semantics, explicit database constraints and verification completeness. Candidate A's smaller read surface is retained as the combined activity read. The explicit revision link and author-only boundary outweigh the small schema cost.
