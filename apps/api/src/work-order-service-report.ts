import { z } from 'zod';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { ApiError, notFound } from './errors.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { detailSchema } from './schemas.js';
import { detail } from './workshop.js';

const reportEntrySchema = z.object({
  id: uuid,
  taskId: uuid,
  taskReference: z.string(),
  taskTitle: z.string(),
  complaintReference: z.string(),
  kind: z.enum(['finding', 'test', 'action', 'follow-up']),
  result: z.enum(['observed', 'reproduced', 'not-reproduced', 'inconclusive', 'done', 'partial', 'pending', 'blocked']),
  summary: z.string(),
  detail: z.string(),
  observedAt: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable()
    .transform(value => value instanceof Date ? value.toISOString() : value),
  recordedAt: z.union([z.date(), z.iso.datetime({ offset: true })])
    .transform(value => value instanceof Date ? value.toISOString() : value),
  actorName: z.string(),
  evidenceIds: z.array(uuid),
  evidence: z.array(z.object({
    evidenceId: uuid,
    displayName: z.string(),
    mediaType: z.string(),
  }).strict()),
  supersedesEntryId: uuid.nullable(),
  correctionReason: z.string().nullable(),
}).strict();

export const workOrderServiceReportSchema = z.object({
  generatedAt: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable()
    .transform(value => value instanceof Date ? value.toISOString() : value),
  workOrderVersion: z.number().int().positive(),
  order: detailSchema.nullable(),
  entries: z.array(reportEntrySchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export const serviceReportPageSize = 50;

function reportChanged(): never {
  throw new ApiError(409, 'SERVICE_REPORT_CHANGED', 'The work order or its work history changed while the report was being prepared. Reload the report and try again.');
}

export async function readWorkOrderServiceReport(
  pool: Database,
  scope: Scope,
  workOrderId: string,
  requestId: string,
  page = 1,
  expectedVersion?: number,
  expectedTotal?: number,
) {
  const pageNumber = z.number().int().min(1).max(10000).parse(page);
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const root = await client.query<{ version: number }>(`SELECT version FROM public.work_orders
      WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR SHARE`,
    [scope.organisationId, scope.siteId, workOrderId]);
    const version = root.rows[0]?.version;
    if (version === undefined) notFound();
    if (expectedVersion !== undefined && expectedVersion !== version) reportChanged();
    const order = pageNumber === 1 ? await detail(client, workOrderId) : null;
    if (order && order.version !== version) reportChanged();
    const entryCount = await client.query<{ total: number }>(`SELECT count(*)::int AS total
      FROM public.work_order_task_work_entries
      WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3`,
    [scope.organisationId, scope.siteId, workOrderId]);
    const totalItems = z.number().int().nonnegative().parse(entryCount.rows[0]?.total ?? 0);
    if (expectedTotal !== undefined && expectedTotal !== totalItems) reportChanged();
    const totalPages = Math.ceil(totalItems / serviceReportPageSize);
    if (pageNumber > Math.max(totalPages, 1)) {
      throw new ApiError(400, 'SERVICE_REPORT_PAGE_OUT_OF_RANGE', 'That report page does not exist. Reload the report and try again.');
    }
    const entries = await client.query(`SELECT entry.id,entry.task_id AS "taskId",
        'T'||lpad(task.ordinal::text,2,'0') AS "taskReference",task.title AS "taskTitle",
        'C'||lpad(complaint.ordinal::text,2,'0') AS "complaintReference",entry.entry_kind AS kind,entry.result,
        entry.summary,entry.detail,entry.observed_at AS "observedAt",entry.recorded_at AS "recordedAt",
        actor.display_name AS "actorName",entry.supersedes_entry_id AS "supersedesEntryId",
        entry.correction_reason AS "correctionReason",
        coalesce(evidence.ids,'[]'::jsonb) AS "evidenceIds",
        coalesce(evidence.files,'[]'::jsonb) AS evidence
      FROM public.work_order_task_work_entries entry
      JOIN public.tasks task ON task.organisation_id=entry.organisation_id AND task.site_id=entry.site_id
        AND task.work_order_id=entry.work_order_id AND task.id=entry.task_id
      JOIN public.complaints complaint ON complaint.organisation_id=task.organisation_id AND complaint.site_id=task.site_id
        AND complaint.work_order_id=task.work_order_id AND complaint.id=task.complaint_id
      JOIN public.staff_users actor ON actor.id=entry.actor_user_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(evidence.id ORDER BY evidence.display_name,evidence.id) AS ids,
          jsonb_agg(jsonb_build_object(
            'evidenceId', evidence.id,
            'displayName', evidence.display_name,
            'mediaType', evidence.media_type
          ) ORDER BY evidence.display_name,evidence.id) AS files
        FROM (
          SELECT link.organisation_id,link.site_id,link.work_order_id,link.task_id,link.work_entry_id,link.evidence_id
          FROM public.work_order_task_work_entry_evidence link
          JOIN public.work_order_evidence_links order_link
            ON order_link.organisation_id=link.organisation_id AND order_link.site_id=link.site_id
            AND order_link.work_order_id=link.work_order_id AND order_link.evidence_id=link.evidence_id
          UNION
          SELECT link.organisation_id,link.site_id,link.work_order_id,link.task_id,link.work_entry_id,link.evidence_id
          FROM public.work_order_task_work_entry_task_evidence link
          JOIN public.work_order_task_evidence_links task_link
            ON task_link.organisation_id=link.organisation_id AND task_link.site_id=link.site_id
            AND task_link.work_order_id=link.work_order_id AND task_link.task_id=link.task_id
            AND task_link.evidence_id=link.evidence_id
        ) link
        JOIN public.evidence_records evidence
          ON evidence.organisation_id=link.organisation_id AND evidence.site_id=link.site_id
          AND evidence.id=link.evidence_id AND evidence.purpose_kind='work-order'
          AND evidence.target_id=link.work_order_id AND evidence.scan_state='accepted'
        WHERE link.organisation_id=entry.organisation_id AND link.site_id=entry.site_id
          AND link.work_order_id=entry.work_order_id AND link.task_id=entry.task_id AND link.work_entry_id=entry.id
      ) evidence ON true
      WHERE entry.organisation_id=$1 AND entry.site_id=$2 AND entry.work_order_id=$3
      ORDER BY entry.recorded_at,entry.id OFFSET $4 LIMIT $5`,
    [scope.organisationId, scope.siteId, workOrderId, (pageNumber - 1) * serviceReportPageSize, serviceReportPageSize]);
    const generated = pageNumber === 1
      ? await client.query<{ generatedAt: Date }>('SELECT transaction_timestamp() AS "generatedAt"')
      : null;
    const report = workOrderServiceReportSchema.parse({
      generatedAt: generated?.rows[0]?.generatedAt ?? null,
      workOrderVersion: version,
      order,
      entries: entries.rows,
      pagination: { page: pageNumber, pageSize: serviceReportPageSize, totalItems, totalPages },
    });
    await recordSensitiveRead(client, scope, 'work-order-service-report-read-prepared', entries.rowCount ?? 0, requestId);
    return report;
  });
}
