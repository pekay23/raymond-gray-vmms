# Candidate B — Explicit learning revisions and append-only author comments

## Caller flow

1. A staff member opens one of their learning notes, sees its saved revisions, and adds a dated comment tied to the version being discussed.
2. VMMS saves each draft update as the next revision in the same transaction as the current draft update, event, command receipt and outbox item.
3. VMMS adds a comment as a separate immutable command, links it to the entry and the exact current revision, and shows it beside the revision history.
4. Only the note's author can read or add to their note in this slice. A comment or submission cannot become a reviewed vehicle fact, work instruction, qualification or permission to work.

## Sketch

Keep `vehicle_learning_entries` as the current-state projection. Add an explicit append-only `vehicle_learning_entry_revisions` table with organisation, site, entry ID, author ID, version, full saved learning fields, status and saved timestamp. Require unique `(organisation_id, site_id, entry_id, version)`; reference the scoped entry; set RLS to the current authenticated author and site. A migration trigger rejects revision update/delete. Add revision 1 on create and one new snapshot for each accepted version update or draft-to-submitted transition.

Add an append-only `vehicle_learning_comments` table containing organisation, site, comment ID, entry ID, entry version, entry author ID, commenter ID, body and creation timestamp. Bind comments to a revision with a composite FK. For this author-only slice, require `entry_author_id = commenter_id`, and put both in RLS. A trigger prevents update/delete. Do not allow this table or policy to reveal submissions to reviewers. Later reviewer access must be a separately authorized policy and command path.

The current entry row remains the concurrency authority. Snapshot/comment writes must occur after the same advisory entry-root lock, membership lock and active after-sales-role check used by `runStaffCommand`. Comment input includes `expectedEntryVersion`; reject a stale version rather than silently attaching feedback to newer content. Give every comment its own deterministic aggregate ID from the command UUID; insert its aggregate root before its aggregate event. Event payloads hold identifiers, status, version and a content-free reason, not the note/comment body. The scoped command receipt is the retry response, not the history store.

Proposed API boundary:

- Existing `saveVehicleLearning(pool, scope, commandId, input)` adds a revision snapshot atomically to its current save operation.
- `readVehicleLearningActivity(pool, scope, requestId, entryId)` returns the author's revisions and comments, ordered by version/time, after checking site, author, and active role. Audit the returned metadata without recording comment bodies.
- `addVehicleLearningComment(pool, scope, commandId, entryId, input)` accepts `{ expectedEntryVersion, body }`; validates length; authorizes the current after-sales role and writable membership; verifies the entry owner and current version under lock; writes the immutable comment aggregate, event, receipt and outbox atomically.

The UI adds a per-note “History and comments” disclosure. It displays numbered snapshots with class, drivetrain, systems, evidence and questions; each comment shows writer and time and the revision it refers to. A comment form shows the version being commented on, reports stale-version conflicts, preserves the typed body on retry, and gives a saved confirmation. Submitted notes remain commentable only by their author; no review status is changed by a comment. Existing draft editing stays available only while current status is `draft`.

## Why snapshots are the history source

The command receipt is a replay cache keyed by actor and command ID, not a user-facing revision contract. The aggregate event journal intentionally records a small state summary and is optimized for audit/outbox consistency. Full snapshots in an explicit version table give the author a stable revision history without inflating event records or coupling user-facing history to command receipt retention. The current entry projection keeps list reads inexpensive.

## Alternatives considered

- **Reconstruct from `domain_events` and `command_receipts`: rejected.** Current event `next` deliberately contains only status/version; receipts are command-specific replay material and not a revision-list API. Putting full drafts and comments in event payloads would also expose unnecessary authored content to the audit store.
- **Replace the current row with fully immutable event-sourced state: rejected.** It would require rewriting established commands and every reader for a small learning form. The explicit snapshot table provides complete history with less coupling.
- **Keep only the mutable current row: rejected.** It loses prior learner answers and makes corrections/comments hard to review fairly.
- **Let any site member comment on submitted notes: rejected for now.** Reviewer role and grant ownership remain unresolved (REV-051). An explicit future grant path can extend access, but should not be guessed from role labels.
- **Edit or delete comments: rejected.** Correct a note with another attributable comment tied to a later revision; preserve the earlier record.

## Verification plan

- Disposable PostgreSQL/API: create, update and submit produce revisions 1..N; same command replay produces one revision/comment; changed payload with a used key conflicts; stale entry version is denied; comment attaches to the selected revision; another author sees no row under RLS; client, roleless staff, Operator-only, suspended user and cross-site requests are denied; submitted entries cannot be reopened as drafts; update/delete triggers reject direct runtime changes; injected outbox failure rolls back projection/snapshot/comment/event/receipt/outbox together.
- Browser: open history, add a comment and reload; verify selectable evidence, revision association, conflict recovery and confirmation; keyboard-only, mobile, tablet, 200%/400% zoom, reduced motion and accessible status checks.
- Keep reviewer queue, reviewer feedback, approved reference publication and staff UAT explicitly open until grants and reviewers are chosen.

## Main risks and boundaries

- The author-only RLS rule must continue to apply even if UI routes are guessed or bypassed. Do not weaken it to site-wide visibility to make the future review queue appear to work.
- A comment is collaboration on a learning exercise, not a technician task update, diagnostic finding, customer communication or controlled-SOP change.
- Do not record customer/owner identifiers or live vehicle identifiers in the learning payload. If source attachments are added later, use the accepted private-evidence pipeline and cite revision/page, not storage keys.
- Be explicit that status `submitted` means “ready for a reviewer when authorized review is configured”; it must not imply that anyone has reviewed or approved the vehicle claim.
