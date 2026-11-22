import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { ApiError, notFound } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { currentAssignment } from './work-order-task-activity.js';

export const taskWorkEntryInputSchema = z.object({
  expectedWorkPlanRevisionId: uuid,
  expectedAssignmentRevision: z.number().int().positive(),
  kind: z.enum(['finding', 'test', 'action', 'follow-up']),
  result: z.enum(['observed', 'reproduced', 'not-reproduced', 'inconclusive', 'done', 'partial', 'pending', 'blocked']),
  summary: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(4000),
  observedAt: z.iso.datetime({ offset: true }).nullable(),
  evidenceIds: z.array(uuid).max(20).refine(items => new Set(items).size === items.length, 'Choose each evidence file once.'),
  supersedesEntryId: uuid.nullable(),
  correctionReason: z.string().trim().min(1).max(1000).nullable(),
}).strict().superRefine((value, context) => {
  const allowed: Record<typeof value.kind, readonly string[]> = {
    finding: ['observed', 'inconclusive'],
    test: ['reproduced', 'not-reproduced', 'inconclusive'],
    action: ['done', 'partial', 'blocked'],
    'follow-up': ['pending', 'done', 'blocked'],
  };
  if (!allowed[value.kind].includes(value.result)) {
    context.addIssue({ code: 'custom', path: ['result'], message: 'Choose a result that matches this kind of work record.' });
  }
  if ((value.supersedesEntryId === null) !== (value.correctionReason === null)) {
    context.addIssue({ code: 'custom', path: ['correctionReason'], message: 'Give a reason when correcting an earlier entry.' });
  }
});

const workEntryItemSchema = z.object({
  id: uuid,
  assignmentRevision: z.number().int().positive(),
  kind: z.enum(['finding', 'test', 'action', 'follow-up']),
  result: z.enum(['observed', 'reproduced', 'not-reproduced', 'inconclusive', 'done', 'partial', 'pending', 'blocked']),
  summary: z.string(),
  detail: z.string(),
  observedAt: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable()
    .transform(value => value instanceof Date ? value.toISOString() : value),
  actorName: z.string(),
  recordedAt: z.union([z.date(), z.iso.datetime({ offset: true })])
    .transform(value => value instanceof Date ? value.toISOString() : value),
  evidenceIds: z.array(uuid),
  supersedesEntryId: uuid.nullable(),
  correctionReason: z.string().nullable(),
}).strict();

export const taskWorkEntryResultSchema = z.object({
  workOrderId: uuid,
  taskId: uuid,
  entry: workEntryItemSchema,
}).strict();

export const taskWorkEntryHistorySchema = z.object({
  workOrderId: uuid,
  taskId: uuid,
  workPlanRevisionId: uuid,
  assignmentRevision: z.number().int().positive(),
  items: z.array(workEntryItemSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const taskWorkEvidenceOptionSchema = z.object({
  evidenceId: uuid,
  displayName: z.string(),
  mediaType: z.string(),
  state: z.enum(['ready', 'attached']),
  uploadedAt: z.union([z.date(), z.iso.datetime({ offset: true })])
    .transform(value => value instanceof Date ? value.toISOString() : value),
}).strict();

export const taskWorkEvidenceOptionsSchema = z.object({
  workOrderId: uuid,
  taskId: uuid,
  workPlanRevisionId: uuid,
  assignmentRevision: z.number().int().positive(),
  items: z.array(taskWorkEvidenceOptionSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

type TaskWorkEntryInput = z.infer<typeof taskWorkEntryInputSchema>;

function requireEffectiveTaskWorkAuthority(input: TaskWorkEntryInput): void {
  const requiresTechnicalAuthority = input.kind === 'test'
    || input.kind === 'action'
    || (input.kind === 'follow-up' && input.result === 'done');
  if (!requiresTechnicalAuthority) return;
  throw new ApiError(409, 'TECHNICAL_AUTHORIZATION_UNAVAILABLE',
    'This test or repair work cannot be recorded until the job has an approved scope, effective vehicle instructions, a matching qualification, and signed task authority.');
}

async function assertCurrentAssignment(
  client: PoolClient,
  scope: Scope,
  workOrderId: string,
  taskId: string,
  input: Pick<TaskWorkEntryInput, 'expectedWorkPlanRevisionId' | 'expectedAssignmentRevision'>,
) {
  const current = await currentAssignment(client, scope, workOrderId, taskId);
  if (current.workPlanRevisionId !== input.expectedWorkPlanRevisionId
    || current.assignmentRevision !== input.expectedAssignmentRevision) {
    throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'This task assignment changed. Refresh your assigned tasks before recording work.');
  }
  return current;
}

async function classifyTaskEvidence(
  client: PoolClient,
  scope: Scope,
  workOrderId: string,
  taskId: string,
  workPlanRevisionId: string,
  assignmentRevision: number,
  evidenceIds: string[],
) {
  if (evidenceIds.length === 0) return { workOrderIds: [], taskIds: [], stagedTaskIds: [] };
  const result = await client.query(`
    SELECT evidence.id,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.work_order_evidence_links link
          WHERE link.organisation_id=evidence.organisation_id AND link.site_id=evidence.site_id
            AND link.work_order_id=$3 AND link.evidence_id=evidence.id
        ) THEN 'work-order'
        WHEN EXISTS (
          SELECT 1 FROM public.work_order_task_evidence_links link
          WHERE link.organisation_id=evidence.organisation_id AND link.site_id=evidence.site_id
            AND link.work_order_id=$3 AND link.task_id=$4 AND link.evidence_id=evidence.id
        ) THEN 'task'
        ELSE 'staged-task'
      END AS source
    FROM public.evidence_records evidence
    JOIN LATERAL (
      SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
      WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
        AND attempt.evidence_id=evidence.id
      ORDER BY attempt.attempt_no DESC LIMIT 1
    ) latest ON true
    WHERE evidence.organisation_id=$1 AND evidence.site_id=$2 AND evidence.id=ANY($8::uuid[])
      AND evidence.purpose_kind='work-order' AND evidence.target_id=$3
      AND evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
      AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256
      AND (
        EXISTS (
          SELECT 1 FROM public.work_order_evidence_links link
          WHERE link.organisation_id=evidence.organisation_id AND link.site_id=evidence.site_id
            AND link.work_order_id=$3 AND link.evidence_id=evidence.id
        ) OR EXISTS (
          SELECT 1 FROM public.work_order_task_evidence_links link
          WHERE link.organisation_id=evidence.organisation_id AND link.site_id=evidence.site_id
            AND link.work_order_id=$3 AND link.task_id=$4 AND link.evidence_id=evidence.id
        ) OR EXISTS (
          SELECT 1 FROM public.work_order_task_evidence_intents intent
          WHERE intent.organisation_id=evidence.organisation_id AND intent.site_id=evidence.site_id
            AND intent.upload_intent_id=evidence.upload_intent_id AND intent.work_order_id=$3
            AND intent.task_id=$4 AND intent.work_plan_revision_id=$5
            AND intent.assignment_revision=$6 AND intent.created_by=$7
        )
      )`, [scope.organisationId, scope.siteId, workOrderId, taskId, workPlanRevisionId,
    assignmentRevision, scope.actorId, evidenceIds]);
  const found = new Map(result.rows.map(row => [z.string().parse(row.id), z.enum(['work-order', 'task', 'staged-task']).parse(row.source)]));
  if (found.size !== evidenceIds.length) {
    throw new ApiError(409, 'EVIDENCE_NOT_AVAILABLE', 'Choose accepted evidence that is attached to this work order or ready for this task assignment.');
  }
  return {
    workOrderIds: evidenceIds.filter(id => found.get(id) === 'work-order'),
    taskIds: evidenceIds.filter(id => found.get(id) === 'task'),
    stagedTaskIds: evidenceIds.filter(id => found.get(id) === 'staged-task'),
  };
}

export async function readMyTaskWorkEntries(
  pool: Database,
  scope: Scope,
  workOrderId: string,
  taskId: string,
  requestId: string,
  requestedPage = 1,
  requestedPageSize = 25,
) {
  const page = z.number().int().min(1).max(10000).parse(requestedPage);
  const pageSize = z.number().int().min(1).max(50).parse(requestedPageSize);
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const current = await currentAssignment(client, scope, workOrderId, taskId);
    const countResult = await client.query(`SELECT count(*)::int AS total
      FROM public.work_order_task_work_entries
      WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND task_id=$4`,
    [scope.organisationId, scope.siteId, workOrderId, taskId]);
    const totalItems = z.object({ total: z.number().int().nonnegative() }).parse(countResult.rows[0]).total;
    const totalPages = Math.ceil(totalItems / pageSize);
    const effectivePage = Math.min(page, Math.max(totalPages, 1));
    const offset = (effectivePage - 1) * pageSize;
    const rows = await client.query(`SELECT entry.id,entry.assignment_revision AS "assignmentRevision",
        entry.entry_kind AS kind,entry.result,entry.summary,entry.detail,entry.observed_at AS "observedAt",
        entry.recorded_at AS "recordedAt",entry.supersedes_entry_id AS "supersedesEntryId",
        entry.correction_reason AS "correctionReason",actor.display_name AS "actorName",
        coalesce(evidence.evidence_ids,'[]'::jsonb) AS "evidenceIds"
      FROM public.work_order_task_work_entries entry
      JOIN public.staff_users actor ON actor.id=entry.actor_user_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(evidence.evidence_id ORDER BY evidence.evidence_id) AS evidence_ids
        FROM (
          SELECT link.evidence_id
          FROM public.work_order_task_work_entry_evidence link
          WHERE link.organisation_id=entry.organisation_id AND link.site_id=entry.site_id
            AND link.work_order_id=entry.work_order_id AND link.task_id=entry.task_id AND link.work_entry_id=entry.id
          UNION
          SELECT link.evidence_id
          FROM public.work_order_task_work_entry_task_evidence link
          WHERE link.organisation_id=entry.organisation_id AND link.site_id=entry.site_id
            AND link.work_order_id=entry.work_order_id AND link.task_id=entry.task_id AND link.work_entry_id=entry.id
        ) evidence
      ) evidence ON true
      WHERE entry.organisation_id=$1 AND entry.site_id=$2 AND entry.work_order_id=$3 AND entry.task_id=$4
      ORDER BY entry.recorded_at,entry.id OFFSET $5 LIMIT $6`,
    [scope.organisationId, scope.siteId, workOrderId, taskId, offset, pageSize]);
    await recordSensitiveRead(client, scope, 'work-order-task-work-entries-read-prepared', rows.rowCount ?? 0, requestId);
    return taskWorkEntryHistorySchema.parse({
      workOrderId, taskId, workPlanRevisionId: current.workPlanRevisionId,
      assignmentRevision: current.assignmentRevision, items: rows.rows,
      pagination: { page: effectivePage, pageSize, totalItems, totalPages },
    });
  });
}

/** List only accepted evidence already attached to this assigned task's work order. */
export async function readMyTaskWorkEvidenceOptions(
  pool: Database,
  scope: Scope,
  workOrderId: string,
  taskId: string,
  requestId: string,
  requestedPage = 1,
  requestedPageSize = 25,
) {
  const page = z.number().int().min(1).max(10000).parse(requestedPage);
  const pageSize = z.number().int().min(1).max(50).parse(requestedPageSize);
  return scoped(pool, scope, async client => {
    const canWrite = await requireActiveReadMembership(client, scope);
    if (!canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit task evidence selection.');
    const current = await currentAssignment(client, scope, workOrderId, taskId);
    const candidates = `
      SELECT evidence.id AS "evidenceId",evidence.display_name AS "displayName",
        evidence.media_type AS "mediaType",'attached'::text AS state,evidence.created_at AS "uploadedAt"
      FROM public.work_order_evidence_links link
      JOIN public.evidence_records evidence ON evidence.organisation_id=link.organisation_id
        AND evidence.site_id=link.site_id AND evidence.id=link.evidence_id
      JOIN LATERAL (
        SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
        WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id AND attempt.evidence_id=evidence.id
        ORDER BY attempt.attempt_no DESC LIMIT 1
      ) latest ON true
      WHERE link.organisation_id=$1 AND link.site_id=$2 AND link.work_order_id=$3
        AND evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
        AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256
        AND NOT EXISTS (
          SELECT 1 FROM public.work_order_scope_payer_response_evidence response_evidence
          WHERE response_evidence.organisation_id=link.organisation_id
            AND response_evidence.site_id=link.site_id
            AND response_evidence.work_order_id=link.work_order_id
            AND response_evidence.evidence_id=evidence.id
        )
      UNION ALL
      SELECT evidence.id AS "evidenceId",evidence.display_name AS "displayName",
        evidence.media_type AS "mediaType",'attached'::text AS state,evidence.created_at AS "uploadedAt"
      FROM public.work_order_task_evidence_links link
      JOIN public.evidence_records evidence ON evidence.organisation_id=link.organisation_id
        AND evidence.site_id=link.site_id AND evidence.id=link.evidence_id
      JOIN LATERAL (
        SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
        WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id AND attempt.evidence_id=evidence.id
        ORDER BY attempt.attempt_no DESC LIMIT 1
      ) latest ON true
      WHERE link.organisation_id=$1 AND link.site_id=$2 AND link.work_order_id=$3 AND link.task_id=$4
        AND evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
        AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256
      UNION ALL
      SELECT evidence.id AS "evidenceId",evidence.display_name AS "displayName",
        evidence.media_type AS "mediaType",'ready'::text AS state,evidence.created_at AS "uploadedAt"
      FROM public.work_order_task_evidence_intents intent
      JOIN public.evidence_records evidence ON evidence.organisation_id=intent.organisation_id
        AND evidence.site_id=intent.site_id AND evidence.upload_intent_id=intent.upload_intent_id
      JOIN LATERAL (
        SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
        WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id AND attempt.evidence_id=evidence.id
        ORDER BY attempt.attempt_no DESC LIMIT 1
      ) latest ON true
      WHERE intent.organisation_id=$1 AND intent.site_id=$2 AND intent.work_order_id=$3 AND intent.task_id=$4
        AND intent.work_plan_revision_id=$5 AND intent.assignment_revision=$6 AND intent.created_by=$7
        AND evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
        AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256
        AND NOT EXISTS (
          SELECT 1 FROM public.work_order_task_evidence_links linked
          WHERE linked.organisation_id=evidence.organisation_id AND linked.site_id=evidence.site_id
            AND linked.evidence_id=evidence.id
        )
    `;
    const params = [scope.organisationId, scope.siteId, workOrderId, taskId,
      current.workPlanRevisionId, current.assignmentRevision, scope.actorId];
    const countResult = await client.query(`SELECT count(*)::int AS total FROM (
      SELECT DISTINCT "evidenceId" FROM (${candidates}) options
    ) unique_options`, params);
    const totalItems = z.object({ total: z.number().int().nonnegative() }).parse(countResult.rows[0]).total;
    const totalPages = Math.ceil(totalItems / pageSize);
    const effectivePage = Math.min(page, Math.max(totalPages, 1));
    const offset = (effectivePage - 1) * pageSize;
    const rows = await client.query(`SELECT DISTINCT ON ("evidenceId") "evidenceId","displayName","mediaType",state,"uploadedAt"
      FROM (${candidates}) options
      ORDER BY "evidenceId",CASE state WHEN 'attached' THEN 0 ELSE 1 END,"uploadedAt"
      OFFSET $8 LIMIT $9`,
    [...params, offset, pageSize]);
    await recordSensitiveRead(client, scope, 'work-order-task-work-evidence-options-read-prepared', rows.rowCount ?? 0, requestId);
    return taskWorkEvidenceOptionsSchema.parse({
      workOrderId,
      taskId,
      workPlanRevisionId: current.workPlanRevisionId,
      assignmentRevision: current.assignmentRevision,
      items: rows.rows,
      pagination: { page: effectivePage, pageSize, totalItems, totalPages },
    });
  });
}

export async function recordMyTaskWorkEntry(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  taskId: string,
  body: TaskWorkEntryInput,
) {
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'work-order.task.work-entry-recorded',
    targetAggregateId: taskId,
    payload: { workOrderId, taskId, ...body },
    responseSchema: taskWorkEntryResultSchema,
    lockSerializationRoots: client => lockWorkOrderRoot(client, scope, workOrderId),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit task updates.');
      const current = await assertCurrentAssignment(client, scope, workOrderId, taskId, body);
      requireEffectiveTaskWorkAuthority(body);
      if (body.supersedesEntryId) {
        const prior = await client.query(`SELECT entry.id FROM public.work_order_task_work_entries entry
          WHERE entry.organisation_id=$1 AND entry.site_id=$2 AND entry.work_order_id=$3 AND entry.task_id=$4 AND entry.id=$5`,
        [scope.organisationId, scope.siteId, workOrderId, taskId, body.supersedesEntryId]);
        if (!prior.rowCount) throw new ApiError(404, 'NOT_FOUND', 'The entry to correct was not found for this task.');
      }
      await classifyTaskEvidence(client, scope, workOrderId, taskId, current.workPlanRevisionId,
        current.assignmentRevision, body.evidenceIds);
    },
    apply: async client => {
      const current = await assertCurrentAssignment(client, scope, workOrderId, taskId, body);
      if (body.supersedesEntryId) {
        const prior = await client.query(`SELECT entry.id FROM public.work_order_task_work_entries entry
          WHERE entry.organisation_id=$1 AND entry.site_id=$2 AND entry.work_order_id=$3 AND entry.task_id=$4 AND entry.id=$5
            AND NOT EXISTS (SELECT 1 FROM public.work_order_task_work_entries correction
              WHERE correction.organisation_id=entry.organisation_id AND correction.site_id=entry.site_id
                AND correction.work_order_id=entry.work_order_id AND correction.task_id=entry.task_id
                AND correction.supersedes_entry_id=entry.id)`, [scope.organisationId, scope.siteId, workOrderId, taskId, body.supersedesEntryId]);
        if (!prior.rowCount) throw new ApiError(409, 'CORRECTION_SOURCE_UNAVAILABLE', 'That entry has already been corrected. Refresh the task history before trying again.');
      }
      const entryId = randomUUID();
      const inserted = await client.query(`INSERT INTO public.work_order_task_work_entries
        (id,organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,
         actor_user_id,actor_placement_id,entry_kind,result,summary,detail,observed_at,supersedes_entry_id,correction_reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING id,assignment_revision AS "assignmentRevision",entry_kind AS kind,result,summary,detail,
          observed_at AS "observedAt",recorded_at AS "recordedAt",supersedes_entry_id AS "supersedesEntryId",correction_reason AS "correctionReason"`,
      [entryId, scope.organisationId, scope.siteId, workOrderId, taskId, current.workPlanRevisionId,
        current.assignmentRevision, scope.actorId, current.actorPlacementId, body.kind, body.result,
        body.summary, body.detail, body.observedAt, body.supersedesEntryId, body.correctionReason]);
      const evidenceSources = await classifyTaskEvidence(client, scope, workOrderId, taskId,
        current.workPlanRevisionId, current.assignmentRevision, body.evidenceIds);
      for (const evidenceId of evidenceSources.stagedTaskIds) {
        await client.query('SELECT public.attach_work_order_task_evidence($1,$2,$3,$4,$5)',
          [workOrderId, taskId, current.workPlanRevisionId, current.assignmentRevision, evidenceId]);
      }
      for (const evidenceId of evidenceSources.workOrderIds) {
        await client.query(`INSERT INTO public.work_order_task_work_entry_evidence
          (organisation_id,site_id,work_order_id,task_id,work_entry_id,evidence_id)
          VALUES($1,$2,$3,$4,$5,$6)`, [scope.organisationId, scope.siteId, workOrderId, taskId, entryId, evidenceId]);
      }
      for (const evidenceId of [...evidenceSources.taskIds, ...evidenceSources.stagedTaskIds]) {
        await client.query(`INSERT INTO public.work_order_task_work_entry_task_evidence
          (organisation_id,site_id,work_order_id,task_id,work_entry_id,evidence_id)
          VALUES($1,$2,$3,$4,$5,$6)`, [scope.organisationId, scope.siteId, workOrderId, taskId, entryId, evidenceId]);
      }
      await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
        VALUES($1,$2,$3,'work-order-task-work-entry')`, [entryId, scope.organisationId, scope.siteId]);
      const actor = await client.query('SELECT display_name AS "actorName" FROM public.staff_users WHERE id=$1 AND active', [scope.actorId]);
      if (!actor.rowCount) notFound();
      const item = workEntryItemSchema.parse({ ...inserted.rows[0], ...actor.rows[0], evidenceIds: body.evidenceIds });
      return {
        aggregateId: entryId,
        aggregateType: 'work-order-task-work-entry',
        version: 1,
        previous: body.supersedesEntryId ? { supersedesEntryId: body.supersedesEntryId } : null,
        next: item,
        reason: 'Assigned worker recorded a work note. This entry is not a technical completion, inspection, release or payment decision.',
      };
    },
    project: async (_client, mutation) => taskWorkEntryResultSchema.parse({ workOrderId, taskId, entry: mutation.next }),
  });
}
