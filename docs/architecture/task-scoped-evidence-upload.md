# Task-scoped evidence upload

Status: implemented and verified locally. Production storage, scanner, retention, backup and restore operations remain governed by the evidence storage review.

## Problem

Assigned workers need to capture evidence after Supervisor handoff. The existing work-order attachment command increments the work-order version and appends a work-order event. The current assignment check intentionally treats later work-order events as a possible scope change and invalidates the handoff. Keep that safety boundary. Task evidence must be bound to the assignment when uploaded, then become durable with an attributed finding, test, action or follow-up without changing the work-order version or event stream.

## Caller usage

The assigned worker picks a file from the current task panel. VMMS creates an upload intent for the current work-order, task, work-plan revision and assignment revision, then sends the file through the existing private quarantine and scan pipeline. The task panel shows the file name, size and scan state. After a clean accepted scan, the worker selects the file while recording the work entry that explains it.

```ts
const intent = await createMyTaskEvidenceIntent(pool, scope, commandId, {
  workOrderId,
  taskId,
  expectedWorkPlanRevisionId,
  expectedAssignmentRevision,
  displayName: file.name,
  declaredMediaType,
  expectedBytes: file.size,
}, evidenceServices);

const uploaded = await uploadEvidenceFile(
  evidenceIntentContentPath(siteId, intent.id),
  file,
  onProgress,
);

await recordMyTaskWorkEntry(pool, scope, commandId, workOrderId, taskId, {
  expectedWorkPlanRevisionId,
  expectedAssignmentRevision,
  kind: 'action',
  result: 'done',
  summary,
  detail,
  observedAt,
  evidenceIds: [uploaded.evidenceId],
  supersedesEntryId: null,
  correctionReason: null,
});
```

The staged file remains private to its uploader until it is accepted and linked by a successful task work-entry command. The browser may retain a short-lived intent pointer and safe file metadata only; file bytes stay in the file picker and must be reselected after reload. A stale assignment leaves the staged file unlinked and requires a fresh task review.

## Shape

```ts
type CurrentTaskRevision = {
  workOrderId: UUID;
  taskId: UUID;
  workPlanRevisionId: UUID;
  assignmentRevision: number;
};

type TaskEvidenceIntentInput = CurrentTaskRevision & {
  displayName: string;
  declaredMediaType: string;
  expectedBytes: number;
};

type TaskEvidenceOption = {
  evidenceId: UUID;
  displayName: string;
  mediaType: string;
  state: 'ready' | 'attached';
  uploadedAt: string;
};

createMyTaskEvidenceIntent(
  pool: Database,
  scope: Scope,
  commandId: UUID,
  input: TaskEvidenceIntentInput,
  services: EvidenceServices,
): Promise<EvidenceIntentStatus>;

readMyTaskWorkEvidenceOptions(
  pool: Database,
  scope: Scope,
  workOrderId: UUID,
  taskId: UUID,
  requestId: string,
  page: number,
): Promise<TaskEvidenceOptions>;

recordMyTaskWorkEntry(
  pool: Database,
  scope: Scope,
  commandId: UUID,
  workOrderId: UUID,
  taskId: UUID,
  input: TaskWorkEntryInput,
): Promise<TaskWorkEntryResult>;
```

The API derives organisation, site, actor and active role placement from the session. The task intent binds the ordinary work-order-targeted evidence intent to the exact current task assignment in the same PostgreSQL transaction. This keeps the shared upload and scanner pipeline independent from task policy while preventing a generic staged work-order upload from being selected as task evidence.

New append-only relations:

- `work_order_task_evidence_intents` binds one upload intent to organisation, site, work order, task, plan revision, assignment revision and creator.
- `work_order_task_evidence_links` records the task evidence link after a successful accepted scan and task work-entry command.
- `work_order_task_work_entry_task_evidence` associates a task link with the immutable work entry that explains it. The existing `work_order_task_work_entry_evidence` continues to reference only generic work-order attachments.

The task work-entry command remains the one durable association action. Under the work-order serialization lock it rechecks current assignment and writable membership, then the final apply validates each selected ID as either an already linked accepted work-order attachment or an accepted task upload whose immutable binding matches the current task revision and creator. For task uploads, a narrow database function rechecks the latest clean verdict, matching content hash, accepted object key and binding before inserting the task link. It inserts the work entry and its evidence associations in the same transaction as the existing task aggregate event, receipt and outbox record.

This interface hides upload, binding, scan and task-link validation behind one task intent and one work-entry save. The web caller still handles file selection, visible upload progress, scan state and retry/reselection. It never handles object keys, scanner details or authority decisions.

Task evidence does not write a work-order aggregate event, increment `work_orders.version`, authorize repair, mark a task technically complete, clear a hold, perform an inspection or release a vehicle. The existing `currentAssignment()` invalidation rule remains unchanged. Generic evidence attached to a work order after handoff continues to require Operations review and a new handoff.

Task evidence reads and downloads require active site membership and a durable same-site task link. Before linking, only the intent creator can read its upload status or evidence metadata. Download still checks accepted state and the latest matching clean scan, writes an access audit before streaming, and uses a private no-store response. Work entries and corrections retain their own selected evidence links. The report returns display name and media type only, with no object key.

### Module map

- `apps/api/src/evidence.ts`: shared upload validation, quarantine, scan and private download; expose a transaction-scoped intent creation primitive for domain binding.
- `apps/api/src/work-order-task-evidence.ts`: create the task-bound intent and validate its current assignment context.
- `apps/api/src/work-order-task-work-entries.ts`: combine accepted generic and task evidence options; link task evidence atomically with an immutable work entry or correction.
- `apps/api/src/evidence.ts` read and download authorization: include durable task links while preserving creator-only access for unlinked uploads.
- `apps/api/src/work-order-service-report.ts`: include both evidence link types for each entry; return safe file labels only.
- `apps/api/src/app.ts` and `apps/web/src/api.ts`: expose task intent creation and reuse the existing upload/status routes.
- `apps/web/src/task-work-evidence.tsx`: file selection, upload progress, scan state, retry and reselect states for one current task.
- `apps/web/src/pages/my-assigned-tasks.tsx`: host the task evidence control and connect accepted evidence to the task work-entry form.
- New migration: immutable scoped intent and link tables, forced RLS, append-only triggers, narrow accepted-evidence link function and least-privilege grants.

## Synthesis decision

Candidate B is the base: a task upload stays staged and creator-only until a work-entry command links it atomically with the finding, test, action or follow-up. Candidate A's visible scan-state review is grafted into the task UI. The cross-judge scored B 25/25 and A 23/25 because the work-entry command avoids a second attachment command and presents evidence in its work context. Both candidates preserve the fail-closed work-order handoff rule. The selected synthesis and scoring are recorded in [the candidate review](candidates/task-scoped-evidence-judge.md).

## Tradeoffs accepted

- We accept that an accepted upload is still only a creator-owned staged file until the worker saves a work entry, in exchange for one attributable, replay-safe association point.
- We accept a task-specific evidence relation and report union, in exchange for leaving the generic work-order scope and handoff model intact.
- We accept that a worker must reselect a file after reload when the browser no longer has the file, in exchange for keeping private file bytes out of browser storage.
- We accept that evidence captured under an old assignment cannot be linked by a new assignment implicitly, in exchange for an explicit supervisor review when assignment context changes.

## Alternatives considered

- A separate `attach-task-evidence` command was rejected because it adds another user action and event/receipt path without an accepted need for task files that have no work-entry context.
- A new generic evidence purpose of `work-order-task` was rejected because it would make the shared scanner and upload intent carry task assignment rules and duplicate the work-order target already needed for access.
- Reusing `work_order_evidence_links` was rejected because it emits a scope-changing work-order event and changes the work-order version after handoff.
- Whitelisting `work-order.evidence-attached` in `currentAssignment()` was rejected because an attachment can signal changed repair or safety scope.

## Open questions and risks

- Should task evidence be visible to all staff who can currently read the same work order, or should later policy introduce role-specific evidence categories? The first implementation follows existing work-order evidence visibility and keeps the required grant review open.
- Browser storage keeps only a short-lived intent pointer and safe file metadata. Its final lifetime remains subject to the existing saved-draft review.
- Production object storage, scanning, retention, backup and restore remain unverified and must not be inferred from local tests.

## Next implementation step

Configure and rehearse production storage and malware scanning under their separate approved operations plan; do not change the generic work-order scope rule.

## Implementation run

1. Ground current upload, assignment, task-entry, report and access flows — complete.
2. Sketch two designs and cross-judge — complete.
3. Implement the database and API command path — complete in migration `062`.
4. Add task file picker, scan feedback and task-entry connection — complete.
5. Verify PostgreSQL denials, replay, rollback, unchanged work-order version and report output — complete with synthetic local services.
6. Verify responsive browser flow, response recovery and access scope — complete for the tested browser matrix; production storage/scanner, physical devices and staff UAT remain open.
