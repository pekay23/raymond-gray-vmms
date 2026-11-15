# Task-scoped evidence upload — Candidate B

## Caller usage

```ts
// A Technician attaches a just-uploaded, accepted file while recording a finding,
// test, action or follow-up against the current assigned task.
const result = await recordMyTaskWorkEntry(pool, scope, commandId, workOrderId, taskId, {
  expectedWorkPlanRevisionId,
  expectedAssignmentRevision,
  kind: 'action',
  result: 'done',
  summary: 'Adjusted the indicator sound setting',
  detail: 'Changed the setting and checked the result with the vehicle stationary.',
  observedAt,
  evidenceIds: [acceptedTaskUploadId],
  supersedesEntryId: null,
  correctionReason: null,
});
```

The Technician creates a task-bound upload intent, uploads through the existing same-origin quarantine route, waits for a clean accepted scan, and selects the file while saving a work entry. The work-entry command is the durable attachment point. A staged file alone is not yet part of the task record and cannot appear as completed work.

## Type sketch

```ts
type CurrentTaskRevision = {
  workOrderId: string;
  taskId: string;
  workPlanRevisionId: string;
  assignmentRevision: number;
};

type TaskEvidenceIntentInput = {
  revision: CurrentTaskRevision;
  displayName: string;
  declaredMediaType: string;
  expectedBytes: number;
};

type TaskEvidenceDraft = {
  evidenceId: string;
  revision: CurrentTaskRevision;
  displayName: string;
  mediaType: string;
  state: 'pending' | 'quarantined' | 'accepted' | 'rejected';
};

type TaskEvidenceLink = CurrentTaskRevision & {
  evidenceId: string;
  linkedBy: string;
  linkedAt: string;
  workEntryId: string;
};
```

The task upload intent remains represented to the shared evidence pipeline as a `work-order` purpose with the verified `workOrderId` target. A new immutable task-intent binding stores `taskId`, plan revision and assignment revision, keyed by the evidence upload intent and later resolved to its evidence record through `upload_intent_id`. The existing upload intent type remains private to the evidence boundary; no object key or free-form table/ID target is introduced.

## Function signatures

```ts
createMyTaskEvidenceIntent(
  pool: Database,
  scope: Scope,
  commandId: string,
  input: TaskEvidenceIntentInput,
  services: EvidenceServices,
): Promise<EvidenceIntentStatus>;

readMyTaskEvidenceDrafts(
  pool: Database,
  scope: Scope,
  revision: CurrentTaskRevision,
  page: number,
): Promise<TaskEvidenceOptions>;

recordMyTaskWorkEntry(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  taskId: string,
  input: TaskWorkEntryInput,
): Promise<TaskWorkEntryResult>;
```

## Module map

- `evidence.ts`: keep byte validation, quarantine write, scan state, latest-clean hash validation, accepted-object access and private download behavior.
- `work-order-task-evidence.ts`: add current-assignment validation for task upload intent and safe draft/read projections; provide an internal assertion used during work-entry commit.
- `work-order-task-work-entries.ts`: link selected task drafts to the work entry in the same task-aggregate command. Continue accepting already attached work-order evidence through the current path.
- `work-order-task-activity.ts`: keep `currentAssignment()` unchanged. It remains the authority that rejects any work-order aggregate event after handoff except the expected task-assignment event.
- `work-order-service-report.ts`: include accepted evidence from both established work-order links and task-evidence links, only for matching work entries; emit file name and media type, never storage keys.
- `evidence.ts` read/download checks: permit a current site reader with access to the corresponding work order/task to read or download a task-linked accepted file; preserve creator-only access for unlinked drafts.
- `apps/api/migrations`: add immutable task-intent bindings and task evidence links. Use composite organisation/site/work-order/task/evidence keys, RLS, forced RLS, append-only grants and foreign keys. Do not update `work_orders.version` or write an event to the work-order aggregate.
- `apps/web/src/pages/my-assigned-tasks.tsx`: add a native file picker and scan status in each current task panel. Only accepted drafts from that exact plan/assignment revision can be selected. Save the evidence link together with the work entry and expose retry/reselect guidance without browser-persisting file bytes.

## Command sketch

1. `createMyTaskEvidenceIntent` runs in a scoped transaction. It requires writable membership and calls `currentAssignment()`; supplied work-order/task/revision values must equal the current row. It creates the normal work-order-targeted upload intent and an immutable task-intent binding in the same transaction, using the same command replay contract.
2. The same-origin upload route streams bytes into the existing private quarantine, checks configured size and signature, computes SHA-256, and leaves the upload unavailable while pending/quarantined. The scan worker remains the only component able to accept content; the binding is not a scan verdict.
3. The Technician refreshes the task’s evidence options. The server lists only files bound to that exact task, current plan and assignment, created by the actor and with accepted evidence state, latest clean verdict matching the stored hash, and an accepted object key.
4. `recordMyTaskWorkEntry` locks the work-order serialization root as it does today, verifies the current assignment and payload revisions, and validates all selected IDs. For a task-bound draft it repeats the task binding, actor, site, work order, plan and assignment checks and the latest-clean scan check. It inserts the task-evidence link, work entry, work-entry/evidence relation, domain event, idempotency receipt and outbox row atomically in the existing task-aggregate command.
5. The command does not mutate the work-order aggregate, its version, or its events. If assignment changes between upload and save, the command returns a stale-assignment conflict and leaves the evidence unlinked. The user must refresh and cannot carry the old file to a different assignment implicitly.
6. The report reads the durable link through the work-entry relation and returns safe file labels. Correcting an entry preserves the same selected evidence unless the worker explicitly changes it; the old entry and link history remain intact.

## Rationale and alternatives

This candidate uses the existing append-only work-entry command as the only point where a new task-evidence link becomes durable. It avoids introducing a second user-visible attach action, a second task command protocol or an event unrelated to recorded work. The existing command already locks the work-order root, validates the current plan/assignment, stores evidence IDs with the entry and emits an event under the task aggregate; task evidence naturally belongs with that record.

The immutable intent binding is necessary because the shared `work-order` upload target alone would let a creator submit any unlinked same-order evidence as task evidence. Binding the upload intent to the exact task/plan/assignment at creation keeps unrelated staged files out and lets stale assignments fail closed. Task evidence links are created only alongside a work entry, which supplies actor, timestamp and reasoned correction provenance.

Alternatives considered:

- A separate `attach-task-evidence` command immediately after scan was rejected for this candidate. It adds a new interaction and another idempotent command, but does not let a worker record the evidence context as cleanly as the work entry that explains why it matters.
- Whitelisting `work-order.evidence-attached` in `currentAssignment()` was rejected. Generic evidence may change repair or safety scope and must continue to invalidate the handoff.
- Reusing only `work_order_evidence_links` was rejected because it changes the work-order aggregate/version and invalidates assignment.
- Allowing a generic unlinked work-order upload to be selected by any currently assigned task was rejected because it lacks an immutable task/plan/assignment binding.

## Verification cases

- Current assigned Technician, writable membership, correct task/plan/assignment, accepted latest-clean file: work-entry and task link commit once; work-order version/events remain unchanged.
- Pending, quarantined, rejected, hash-mismatched or missing-object file: no task link or work entry is committed.
- Wrong organisation/site, another user’s draft, another task, another work order, stale plan, stale assignment, removed role, read-only membership: deny with no partial mutation.
- Lost response with the same idempotency key replays the same work entry and evidence link; changed payload with the same key conflicts.
- Concurrent assignment revocation or reassignment serializes with the write; no stale actor can link evidence.
- Supervisor/current authorized work-order reader can retrieve linked evidence through an audited private/no-store download. Unlinked drafts remain creator-only; storage keys never enter API or report output.
- Append-only correction preserves original evidence and associates any changed evidence only with the correction entry.
- Daily Service Report includes the readable name and media type for task evidence, with no object key or sign-off claim; paginated report consistency remains enforced.
- Browser checks cover upload pending/accepted/failure, file reselection after refresh, no local file bytes, keyboard operation, narrow screens, delayed scan, stale assignment and response-loss retry.

## Synthesis note

Candidate B is intentionally distinct from a dedicated attachment-command design: it commits the task link atomically with the attributed work entry. Its main trade-off is that a worker cannot durably attach a file before deciding what kind of work record explains it. For this workflow, that is acceptable because a standalone upload is only a creator-owned staged draft; the canonical evidence association should be made with a finding, test, action or follow-up.
