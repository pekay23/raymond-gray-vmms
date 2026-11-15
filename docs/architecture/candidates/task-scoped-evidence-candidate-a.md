# Task scoped evidence upload — Candidate A

Status: design candidate only. It does not change the accepted work-order upload contract.

## Caller usage

A technician opens a current assigned task, chooses a photo or document and uploads it. VMMS creates an intent explicitly scoped to that task and the current work-plan and assignment revisions. The file enters the existing private quarantine and scan pipeline. After a clean accepted scan, the technician confirms **Attach to this task**. A task command rechecks the exact assignment and scan before linking the file. The supervisor and service report can then read the accepted file label. No work-order scope version changes, and no work permission or sign-off is created.

```ts
const intent = await createTaskEvidenceIntent(scope, commandId, {
  workOrderId,
  taskId,
  expectedWorkPlanRevisionId,
  expectedAssignmentRevision,
  displayName,
  declaredMediaType,
  expectedBytes,
});
const upload = await uploadEvidence(scope, intent.id, fileStream, file.size, services);
const evidence = await readEvidenceIntent(scope, intent.id); // Same creator-only recovery boundary.
await attachTaskEvidence(scope, commandId, {
  workOrderId,
  taskId,
  expectedWorkPlanRevisionId,
  expectedAssignmentRevision,
  evidenceId: upload.evidenceId,
});
```

## Type sketch

```ts
type TaskEvidenceIntent = {
  id: UUID;
  evidenceId: UUID | null;
  organisationId: UUID; // server session only
  siteId: UUID;         // server session only
  createdBy: UUID;      // server session only
  workOrderId: UUID;
  taskId: UUID;
  workPlanRevisionId: UUID;
  assignmentRevision: number;
  expiresAt: Date;
};

type AttachTaskEvidence = {
  workOrderId: UUID;
  taskId: UUID;
  expectedWorkPlanRevisionId: UUID;
  expectedAssignmentRevision: number;
  evidenceId: UUID;
};

type TaskEvidenceView = {
  evidenceId: UUID;
  displayName: string;
  mediaType: string;
  scanState: 'accepted';
  attachedAt: string;
};

createTaskEvidenceIntent(scope, commandId, input): Promise<EvidenceIntentStatus>;
attachTaskEvidence(pool, scope, commandId, input): Promise<TaskEvidenceView>;
readMyTaskWorkEvidenceOptions(pool, scope, workOrderId, taskId, requestId, page): Promise<TaskEvidenceOptions>;
readEvidence(pool, scope, evidenceId): Promise<EvidenceView>;
downloadEvidence(pool, scope, evidenceId, services): Promise<AuthorizedEvidenceStream>;
```

`TaskEvidenceIntent` is an internal domain value; never accept organisation, site, creator or actor placement from the browser. Keep existing `EvidencePurpose` as `work-order` for bytes and scanner metadata, with its target set to the work order. The task binding is a separate typed record rather than a free-form purpose string.

## Signatures and module map

- `apps/api/src/work-order-task-evidence.ts`
  - `createTaskEvidenceIntent(...)`: establish writable current assignment, then issue the existing work-order upload intent.
  - `attachTaskEvidence(...)`: a narrow task command with a request receipt and current assignment validation.
  - `readMyTaskEvidenceOptions(...)`: list accepted evidence linked to this exact task and current assignment.
- `apps/api/src/evidence.ts`
  - Preserve streaming, MIME/size validation, quarantine, scan-state transition, hash verification, intent recovery and private download behavior.
  - Extend read/download authorization to permit accepted evidence linked to an authorized current or historical task on the same site, while retaining uploader-only access to unlinked staging records.
- `apps/api/src/app.ts`
  - Add task intent and task attachment routes with normal CSRF/session/site-scope handling. Do not add task-specific byte streaming; reuse the intent content route.
- New migration `apps/api/migrations/062_work_order_task_evidence.sql`
  - Add `work_order_task_evidence_links` with organisation/site/work-order/task/evidence, plan revision, assignment revision, actor, command ID and attachment time.
  - Add composite foreign keys and uniqueness; enable and force RLS; grant runtime no update/delete.
  - Add a narrowly scoped `SECURITY DEFINER` attachment function to check the task, work order, current assignment and accepted latest-clean scan/hash under lock.
  - Keep the relation independent from `work_orders.version` and the work-order aggregate event stream.
- `apps/api/src/work-order-task-work-entries.ts`
  - Return accepted evidence from the task relation. At entry write/correction time, allow IDs only when they are either accepted generic work-order attachments or accepted task evidence for the exact work-order/task and current plan/assignment snapshot.
- `apps/api/src/work-order-service-report.ts`
  - Aggregate evidence from both typed relations for each immutable work entry. Include only safe file name and media type; expose no storage key.
- `apps/web/src/pages/my-assigned-tasks.tsx`
  - Provide a native file picker on each current task. Show filename, size, scan status, retry/reselect guidance, then a distinct Attach action after acceptance. Keep file bytes out of browser storage. Refresh task state after an assignment conflict.

## Command outline

1. `createTaskEvidenceIntent` obtains the current assignment from `currentAssignment()` inside a scoped transaction. It captures the exact plan revision and assignment revision and creates a normal `purpose='work-order'` upload intent targeted to the work-order ID. Only the current assignee with writable membership can initiate it.
2. Existing streamed upload validates size and content type, stores private quarantine bytes, computes SHA-256 and creates the normal scan job. Existing scan worker accepts only a matching clean hash; no task link exists yet.
3. `attachTaskEvidence` runs a task-root command and locks the same work-order serialization root before rechecking current assignment and expected revisions. It checks the evidence was uploaded through the matching creator-owned intent for this work order, is accepted with a latest clean scan whose hash equals the stored digest, and has not already been linked elsewhere.
4. In one database transaction, the command inserts the append-only task link, a task aggregate event, idempotency receipt, outbox item and audit metadata. It does not emit a work-order aggregate event or mutate `work_orders.version`.
5. Task evidence option reads show accepted files in the current assignee's task. Evidence reads/downloads require current site membership plus an accepted generic link or task link. Unlinked task-targeted evidence stays uploader-only. Supervisor/report access uses the existing site/role boundaries and the linked task context.
6. Work entries and corrections preserve their selected evidence IDs. Report pagination, version checks and audit remain unchanged because the task link does not mutate the work order; the report captures evidence links through the entry relation and returns only safe labels.

## Alternatives considered

- **Candidate A: extend the `evidence_records.purpose_kind` enum with `work-order-task`.** Rejected for this candidate. The current evidence target ID and generic work-order upload intent are purpose-validated as a work-order target. A task purpose would need a second target shape, new foreign-key enforcement and coordinated changes across upload recovery, scan processing and download authorization. It duplicates scope facts and makes the common scanner path understand task assignments.
- **Generic attachment to the work-order relation after handoff.** Rejected. `work-order.evidence-attached` is a work-order aggregate event and `currentAssignment()` intentionally invalidates handoff after any later work-order event except task assignment. Whitelisting it would silently preserve work against a possibly changed scope.
- **Auto-link the evidence when the scan worker accepts it.** Rejected. The worker would make an assignment-sensitive domain decision asynchronously. The task may have been reassigned during scanning, and the final action would have no explicit user confirmation or task command receipt.
- **Store evidence IDs only on a work entry without a task-level link.** Rejected. Evidence cannot be attached until an entry is written, and a correction could not safely reuse evidence independently of its original entry. It also fails to make task-level accepted evidence visible to the supervisor.

## Acceptance checks

1. Current assignee with writable membership can create an intent only for their current task and exact plan/assignment revision. Wrong site, wrong user, inactive role, read-only member, task mismatch and stale/reassigned task are denied.
2. Issued, pending, quarantined, infected, unavailable, hash-mismatched and expired uploads cannot be linked or downloaded. Clean, accepted and hash-matching upload can be linked once.
3. Link creation, task event, idempotency receipt, outbox and audit record commit atomically; inject failures and prove full rollback. Same-key replay returns the original result; changed payload conflicts.
4. `work_orders.version` and the work-order aggregate event count do not change after upload or task attachment. Existing generic evidence still invalidates the handoff.
5. Cross-site, wrong task and unlinked reads/downloads are denied. Accepted current task evidence is available to the assigned worker, authorized Supervisor and service report with no storage key. Revoked access stops downloads.
6. Work entry creation and correction preserve task evidence; the report includes readable file labels and media types while keeping its pagination, ordering and duplicate checks.
7. Browser verification covers pending/accepted/rejected scan states, response loss/retry, stale assignment, reselect after refresh, phone widths, keyboard operation and accessible status announcements.

## Rationale

This shape gives the user an explicit task-level attach action while reusing the existing private upload/scanning capability. The task relation carries the assignment snapshot; generic work-order scope remains governed by the work-order event/version. The new task command owns the atomic link and audit trail, while the evidence module owns bytes and scan safety. Its trade-off is one added task-level command and relation instead of extending the existing generic attachment command; that cost protects the independent handoff boundary and keeps the upload service unaware of workshop assignment policy.
