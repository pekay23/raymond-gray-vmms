# Candidate A — append-only revisions and author notes

**Artifact:** migration/API/UI design for preserving vehicle-learning draft history and follow-up author comments. This is an independent arena candidate; it changes no role authority and grants no reviewer access.

## Caller flow

1. A staff author saves or submits a learning entry through the existing command. The current row remains the fast read model; the same transaction stores a complete immutable version snapshot.
2. The author opens one of their own saved entries and adds a follow-up note or question. A comment is appended once, identified by an idempotency key, and shown in chronological order.
3. The author can read their own snapshots and notes. No other staff member, client, owner, public visitor or Operator-only account can read them through the current endpoints. Reviewers can be enabled later using a separately configured grant without changing the author model.

## Type and record sketch

```ts
type LearningRevision = {
  entryId: string;
  revision: number;
  authorId: string;
  snapshot: LearningEntryContent;
  status: 'draft' | 'submitted';
  savedAt: string;
};

type LearningComment = {
  id: string;
  entryId: string;
  authorId: string;
  body: string;
  createdAt: string;
};

type AddLearningComment = {
  entryId: string;
  body: string;
};
```

All network inputs are parsed from Zod schemas. Database rows have dedicated schemas. Comments are plain text with bounded length and no edit/delete path. The revision snapshot is derived from the authoritative saved-entry schema; it does not copy customer, canonical vehicle or work-order information.

## Module and endpoint map

- `apps/api/migrations/065_vehicle_learning_history.sql`: immutable `vehicle_learning_revisions` plus `vehicle_learning_comments`. Each row has organisation/site scope, the parent learning entry, actor and timestamp. Composite foreign keys bind both to the same parent. RLS policies require the current actor to own the parent entry. Runtime can read/insert revisions and comments; it cannot update/delete them.
- `apps/api/src/vehicle-learning.ts`: add `readVehicleLearningHistory(pool, scope, entryId)`, `listVehicleLearningComments(pool, scope, entryId)`, and `addVehicleLearningComment(pool, scope, commandId, entryId, input)`. Keep the entry scope check in this module rather than exposing a generic comment repository.
- `saveVehicleLearning`: within its current `runStaffCommand` transaction, insert a version snapshot after create/update. Keep the entry's current version as the snapshot sequence. A conflict or failed event/outbox insert rolls back both the current row and snapshot.
- `addVehicleLearningComment`: a command that locks the parent learning entry before current membership/role authorization and replay; confirm current actor owns the entry and it is draft or submitted; create a deterministic comment UUID; insert a comment aggregate root, immutable comment and metadata-only audit event/outbox atomically. Do not increment the learning-entry version for a comment, because comments do not change the submitted answer.
- `apps/api/src/app.ts`: `GET /sites/:siteId/vehicle-learning/:entryId/history`, `GET /sites/:siteId/vehicle-learning/:entryId/comments`, `POST /sites/:siteId/vehicle-learning/:entryId/comments`; all use `authorisedScope`, no-store reads, CSRF on writes and required idempotency keys.
- `apps/web/src/pages/vehicle-learning.tsx`: a per-entry expandable “My notes” area. Load history/comments only when expanded. Provide a labelled comment form and clear empty, loading, offline, conflict and failure states. Keep existing `questions` as the original exercise response; don't rewrite it into an artificial first comment.

## Concurrency and authority

- Retain `runStaffCommand`'s membership lock, advisory parent lock, action-time after-sales role check, command receipt, event and outbox transaction. Lock the parent before checking ownership so a concurrent submit/update cannot race the comment decision.
- Draft save requires the currently expected version. Submitted answers remain immutable. A comment is a separate child fact and does not re-open or revise a submitted answer.
- Author-facing operations require active site membership, active after-sales role and current site write membership. RLS repeats organization, site and author ownership. The VMMS Operator-only identity and owner session remain denied.
- No review queue is exposed, no role label grants review permission, and no source is published. When the owner decides reviewers, add one dedicated current grant/capability check to the relevant review endpoints and audit its decision snapshot.
- Audit/outbox payloads record entry/comment IDs, revision number and operation only; do not copy the full evidence narrative or comment text into the general event stream.

## Verification plan

1. Disposable PostgreSQL test creates revision 1, saves revision 2, and proves both immutable snapshots retain exact content and scope.
2. Verify author can read own history/comments; a second active after-sales role cannot read them; client/owner, Operator-only, site-crossed and roleless sessions are denied; direct scoped SQL confirms RLS row isolation.
3. Verify duplicate command replay creates one comment/event/outbox item, changed payload key reuse conflicts, stale entry save fails, and comments do not increment the answer version.
4. Verify submitted entry cannot be revised, but author can add a separate follow-up comment; comment/revision update or delete is denied to runtime.
5. Inject event/outbox failure and prove entry mutation, snapshot, comment, event, receipt and outbox all roll back together.
6. Browser-check keyboard flow, author-only disclosure, saved/reloaded history, confirmation toast and 200%/400% zoom on phone and desktop layouts.

## Alternatives considered

- **Only keep current entry row plus an activity feed.** Rejected: a mutable row does not preserve what the author submitted at earlier revisions, and a generic feed conflates commentary with answer changes.
- **Represent each revision as a separate canonical entry row and derive the current answer.** Rejected for this increment: it changes the existing endpoint identity and adds latest-revision joins to every read. A write-through immutable snapshot plus the current draft projection preserves history while keeping the current shape stable; a later redesign can promote revisions to the canonical model if additional consumers require it.
- **Put comments in one mutable text field.** Rejected: it loses attribution, ordering, idempotency and correction history.
- **Allow all after-sales roles to comment/review other users' entries.** Rejected: the owner has not selected reviewer scope and the current RLS design intentionally keeps entries author-private.
- **Use a generic comments service.** Rejected: access and lifecycle rules are specific to vehicle-learning records. A generic service would make parent authorization and state rules too easy to bypass.

## Risks and limits

- Submitted answers remain private and cannot be reviewed by another user until reviewer authority and queue access are configured. This design improves authorship/history; it does not claim the requested reviewer workflow is complete.
- Snapshot rows can grow without bound. Retention/export policy should be reviewed before production; do not silently delete learning history.
- Text comments must not contain customer identifiers or replace controlled work evidence. UI copy should remind authors to reference source documents rather than paste customer or vehicle-owner details.
- None of these records establish a verified technical fact, employee competence, OEM procedure or authority to work.
