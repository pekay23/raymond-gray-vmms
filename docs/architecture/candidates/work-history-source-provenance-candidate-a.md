# Candidate A: per-entry source provenance

Status: design candidate; not an implementation decision.

## Purpose and usage

Add a small, explicit provenance block to each task work-history entry. It separates two questions the current entry can otherwise blur:

- **Who recorded this entry in VMMS?** The authenticated staff actor already supplies this answer and remains server-derived.
- **Whose statement or which source record does the entry describe?** New provenance fields answer this, without treating the statement as a verified observation.

Use the fields when a staff member transcribes or summarizes a prior report, a statement from another person, or a historical record. Leave provenance absent for a direct present-time observation or action unless there is a meaningful external source. Do not copy credentials, unnecessary personal details, or full source documents into free text. Attach a source file only through the existing accepted-evidence workflow.

An entry's `summary` and `detail` continue to express what the authenticated recorder entered into the work history. `sourceStatement` separately preserves the source's relevant wording or a clearly identified summary. Both are claims recorded in VMMS. Provenance is not authenticity proof: without a linked accepted source file, it only records what the staff actor says the source was. A linked file proves that an accepted file is associated with the entry, not that its contents are true or authoritative.

This feature records context only. It grants no repair authority, consent, diagnosis, approval, inspection, safety decision, completion, release, payment, or collection authority. Existing G1–G5 and signed decision boundaries remain independent.

## Type and storage sketch

Keep the existing immutable row, actor, task/site scope, correction chain, and evidence relations. Add nullable per-entry columns in a forward migration:

```sql
source_kind text NULL CHECK (source_kind IN (
  'reported-by-person', 'transcribed-record', 'imported-record', 'other'
)),
source_label text NULL CHECK (source_label IS NULL OR length(btrim(source_label)) BETWEEN 1 AND 160),
source_statement text NULL CHECK (source_statement IS NULL OR length(btrim(source_statement)) BETWEEN 1 AND 4000),
source_reported_at timestamptz NULL,
CHECK (
  (source_kind IS NULL AND source_label IS NULL AND source_statement IS NULL AND source_reported_at IS NULL)
  OR (source_kind IS NOT NULL AND source_statement IS NOT NULL)
)
```

The exact limits should match existing service-work entry limits unless implementation evidence requires another bound. `source_label` is a recorder-entered description such as “driver statement” or “maintenance card”; it is not an identity key and does not replace `actor_user_id`/`actor_placement_id`. `source_reported_at` means the time stated by the source, not VMMS `recorded_at`; it may be unknown. Do not accept a client-supplied recorder name or actor ID.

Equivalent API type:

```ts
type EntryProvenance = {
  sourceKind: 'reported-by-person' | 'transcribed-record' | 'imported-record' | 'other';
  sourceLabel: string | null;
  sourceStatement: string;
  sourceReportedAt: string | null;
};

type WorkEntryInput = ExistingWorkEntryInput & {
  provenance: EntryProvenance | null;
};

type WorkEntry = ExistingWorkEntry & {
  actorName: string; // resolved from authenticated actor, as today
  provenance: EntryProvenance | null;
};
```

No new source-document table is proposed in Candidate A. An accepted file is linked using the existing evidence IDs and task/work-entry evidence joins, with the same site/work-order scope and scan-state rules. The provenance block itself is stored on the immutable entry row so correction history captures exactly what was claimed at the time.

## Function and API impact

Extend the existing command schemas and service functions rather than adding a second write path:

```ts
const entryProvenanceSchema = z.object({
  sourceKind: z.enum(['reported-by-person', 'transcribed-record', 'imported-record', 'other']),
  sourceLabel: z.string().trim().min(1).max(160).nullable(),
  sourceStatement: z.string().trim().min(1).max(4000),
  sourceReportedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export async function recordMyTaskWorkEntry(
  pool: Database, scope: Scope, commandId: string,
  workOrderId: string, taskId: string,
  body: ExistingTaskWorkEntryInput & { provenance: EntryProvenance | null },
): Promise<TaskWorkEntryResult>;

export async function readMyTaskWorkEntries(
  pool: Database, scope: Scope, workOrderId: string, taskId: string,
  requestId: string, page?: number, pageSize?: number,
): Promise<TaskWorkEntryHistory>;

export async function readWorkOrderServiceReport(
  pool: Database, scope: Scope, workOrderId: string,
  requestId: string, page?: number, expectedVersion?: number, expectedTotal?: number,
): Promise<WorkOrderServiceReportPage>;
```

These signatures illustrate added fields; existing command IDs, active membership and assignment checks, aggregate locking, idempotency receipts, audit/outbox transaction, version checks, and evidence classification remain in force. Include provenance in the idempotency payload and canonical response so retries with a changed source statement conflict rather than silently changing the accepted command. Corrections remain new entries: the correcting entry carries the corrected provenance as supplied, points to the prior entry, and requires the existing correction reason. The prior entry and its provenance remain untouched.

Extend both task-history and service-report output schemas with `provenance: EntryProvenance | null`. The route remains the existing site-scoped task work-entry command/read and service-report endpoints. Every read and write is constrained by authenticated organisation/site scope; provenance cannot introduce an unscoped lookup.

## Module, UI, and report impact

- **Database:** one additive migration adds nullable fields to `work_order_task_work_entries`; preserve RLS, forced RLS, immutable triggers, runtime insert/select-only grants, unique correction behavior, and existing foreign keys. Existing rows read as `provenance: null`; do not fabricate source details during backfill.
- **API:** `apps/api/src/work-order-task-work-entries.ts` validates and persists the fields for both ordinary entries and corrections. Its read projections include provenance. The report query/schema in `apps/api/src/work-order-service-report.ts` carries the same block. No authorization predicate changes.
- **Web contract:** extend task-entry and service-report schemas/types in `apps/web/src/api.ts`.
- **Entry UI:** in the assigned worker's entry and correction forms, offer an optional “Based on a source” disclosure. When enabled, require source type and source statement; source label and source-reported time are optional. Make clear that this is the source's reported wording/context and that VMMS records the signed-in staff member as transcriber. Reuse the existing accepted evidence picker and label attachments as linked source evidence where the worker chooses to use them. Keep validation, retry payload persistence, and correction behavior aligned with existing entry flows.
- **History UI:** show the authenticated recorder and time separately from source type/label/time and the source statement. A null provenance state is displayed as no source statement recorded, not as direct proof that the recorder personally observed the event.
- **Printable report:** render source attribution and statement immediately with the relevant entry, separately from the entry summary/detail and actor. Include accepted linked evidence by the existing safe display name/media type behavior. Label source statements as “reported” or “transcribed,” never “verified.” Preserve pagination, selectable text, and report consistency checks.
- **Trackers and evidence:** add a focused implementation and verification task under `docs/delivery/tasks.json`, link the relevant work-history requirement(s), and record the material decision only after selection. Candidate A itself does not change requirement status or mark UAT complete.

## Report-level metadata duplication

Candidate A intentionally keeps provenance per entry. This is the smallest fit for the current entry and correction model, and it permits entries on one work order to cite different speakers or records. It also means the same source label and reported time may be repeated on several entries transcribed from one report. That repetition is acceptable for this candidate because it makes each immutable entry self-contained and avoids adding a source-document lifecycle, shared mutable metadata, or a second association model.

Avoid repeating long report-wide metadata in every `sourceStatement`: each entry should retain only the relevant statement for that finding/action. If repeated metadata proves operationally noisy, a later design can introduce a site-scoped source-document record with its own accepted evidence link and immutable reference. That would require a separate decision on document identity, access, correction, lifecycle, and report rendering; it is outside Candidate A. A source label alone must not be treated as a deduplication key.

## Rationale

This proposal adds a clear boundary at the point where work history is entered: authenticated actor provenance stays trustworthy and server-owned, while source content is explicitly attributed and remains a claim. Per-entry placement works with append-only corrections and existing idempotent commands. Nullable fields preserve historical rows honestly. Reusing accepted evidence links avoids a parallel upload, malware-scanning, authorization, or storage-key pathway.

## Alternatives rejected for Candidate A

1. **Put historical/source wording in `detail` only.** Rejected because the report and UI cannot reliably distinguish the transcriber's prose from the source's statement.
2. **Accept a client-entered `recordedBy`/`actorName`.** Rejected because it undermines authenticated actor attribution.
3. **Add a shared report/source-document entity now.** Rejected for this minimal candidate because it adds document lifecycle and multi-entry linking complexity before duplication has been measured. Keep it as a future option if real usage warrants it.
4. **Treat provenance text or an accepted attachment as verified history.** Rejected because neither establishes source authenticity, authority, or truth.
5. **Backfill old entries from their summary/detail or surrounding records.** Rejected because source context cannot be inferred without evidence.

## Risks and mitigations

- **Readers confuse a transcribed claim with an observation.** Show actor and source in separate labeled fields in the UI and report; retain plain-language claim labels.
- **Free-text overcollection or sensitive content.** Use field guidance, limits, and existing access controls; do not encourage copying whole reports or credentials.
- **Correction could erase provenance.** Preserve append-only correction linkage and retain the original fields unchanged; require the correcting entry to explicitly state its provenance.
- **Duplicate metadata drifts across entries.** Keep source details relevant per entry; describe this limitation and defer shared source records until usage evidence supports them.
- **Accepted evidence is over-read as proof.** State that it establishes an association with a scanned, accepted file only; do not claim authenticity or correctness.
- **New fields accidentally become authority signals.** Do not use provenance in G1–G5, assignment, completion, inspection, release, or finance decisions.

## Gradeable acceptance criteria

1. An entry with no provenance round-trips as `provenance: null`, and existing rows remain unchanged with no inferred source values.
2. A provenance entry requires a valid `sourceKind` and non-empty `sourceStatement`; optional label and source-reported time are validated and bounded. Invalid kind, empty statement, oversized values, or malformed timestamp is rejected before mutation.
3. API and database actor identity always come from the authenticated session and active site placement. Client attempts to supply a recorder identity are rejected by strict schemas.
4. A source entry and its provenance are persisted atomically with the existing audit event, idempotency receipt, and outbox item. An exact retry returns the same result; reusing the key with changed provenance does not create or alter an entry.
5. A correction appends a new entry with its own provenance, preserves the original provenance byte-for-byte, requires a reason, and cannot create a second correction for the same source entry.
6. Wrong organisation/site, inactive membership, stale assignment/revision, and invalid or unaccepted evidence are denied with no partial entry, provenance, audit/outbox, or evidence-link write.
7. The entry history and paginated service report return provenance under the same authenticated site scope. The report's later pages preserve existing version/total consistency checks.
8. The UI and print output visually separate recorder identity/time from source attribution/time/statement. A null provenance value is not labeled as verified or personally observed.
9. When accepted evidence is linked, the report displays only the existing safe file name/media type and never an object-storage key. The UI/report explicitly avoid claiming the file authenticates its contents.
10. Provenance has no effect on authorization or G1–G5 state; a provenance-bearing entry cannot itself complete work, clear a hold, approve, inspect, release, authorize payment, or record collection.
11. Browser and report checks demonstrate accessible entry/correction behavior, stable retry payload, readable printable/selectable source labels, and no pagination truncation. PostgreSQL/API checks exercise site isolation, immutability, correction, replay, and rollback. SQLite-only evidence is insufficient for PostgreSQL concurrency claims.

## Current evidence consulted

This candidate follows the documented service work-history contract and the current immutable task-entry/report shape. The implementation references include migration `059_work_order_task_work_entries.sql`, `apps/api/src/work-order-task-work-entries.ts`, `apps/api/src/work-order-service-report.ts`, `apps/web/src/api.ts`, and the assigned-work/report pages. The relevant delivery records are `BUILD-USER-039-WORK-HISTORY-001` and `CHECK-USER-039-WORK-HISTORY-001`; historical import requirements remain separately tracked under HIST-01 through HIST-11. The repository's implementation plan continues to treat source provenance and accepted evidence as distinct from authority and UAT.
