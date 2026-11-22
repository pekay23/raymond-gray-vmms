import { z } from 'zod';
import { ApiError, notFound } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { afterSalesRoleCodes } from './staff-role-policy.js';

const pageInputSchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
  expectedChecklistVersion: z.number().int().positive().optional(),
}).strict();

const sourceSchema = z.object({
  reference: z.string(),
  title: z.string(),
  revision: z.string(),
  status: z.string(),
  effectiveFrom: z.union([z.date(), z.iso.datetime({ offset: true })]).transform(value => value instanceof Date ? value.toISOString() : value),
  effectiveUntil: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable().transform(value => value instanceof Date ? value.toISOString() : value),
  current: z.boolean(),
}).strict();

const itemSchema = z.object({
  id: uuid,
  code: z.string(),
  ordinal: z.number().int().positive(),
  label: z.string(),
  result: z.enum(['completed','failed','not-checked','not-completed','blocked','not-applicable']).nullable(),
  reason: z.string().nullable(),
  applicabilityReason: z.string().nullable(),
  comments: z.string().nullable(),
  measurement: z.record(z.string(), z.unknown()).nullable(),
  actorName: z.string().nullable(),
  assigneeName: z.string().nullable(),
  taskReference: z.string().nullable(),
  taskTitle: z.string().nullable(),
  revision: z.number().int().positive().nullable(),
  correctionReason: z.string().nullable(),
  recordedAt: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable().transform(value => value instanceof Date ? value.toISOString() : value),
  evidenceLabels: z.array(z.string()),
}).strict();

export const workOrderChecklistReportSchema = z.object({
  workOrderId: uuid,
  bookingReference: z.string(),
  siteName: z.string(),
  vehicle: z.object({ registration: z.string().nullable(), make: z.string(), model: z.string(), variant: z.string().nullable(), powertrain: z.string().nullable() }).strict(),
  checklist: z.object({
    id: uuid,
    kind: z.literal('routine-maintenance'),
    state: z.enum(['draft','in-progress','submitted','returned','approved','closed']),
    version: z.number().int().positive(),
    scheduleBasis: z.enum(['verified-history','customer-request','delivery-inspection','unknown']),
    odometerAtStartKm: z.number().int().nonnegative().nullable(),
    templateCode: z.string(),
    templateRevision: z.number().int().positive(),
    sources: z.array(sourceSchema),
  }).strict(),
  summary: z.object({ totalItems: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), notChecked: z.number().int().nonnegative(), notCompleted: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), notApplicable: z.number().int().nonnegative() }).strict(),
  items: z.array(itemSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }).strict(),
  preparedAt: z.union([z.date(), z.iso.datetime({ offset: true })]).transform(value => value instanceof Date ? value.toISOString() : value),
}).strict();

export async function readWorkOrderChecklistReport(
  pool: Database,
  scope: Scope,
  workOrderId: string,
  checklistId: string,
  requestId: string,
  rawPage: z.input<typeof pageInputSchema>,
) {
  const input = pageInputSchema.parse(rawPage);
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const role = await client.query(`SELECT 1
      FROM public.staff_role_placements placement
      JOIN public.staff_role_profiles profile ON profile.code=placement.role_code AND profile.active
      JOIN public.staff_users actor ON actor.id=placement.staff_user_id AND actor.active
      WHERE placement.organisation_id=$1 AND placement.site_id=$2 AND placement.staff_user_id=$3
        AND placement.state='active' AND placement.role_code=ANY($4::text[]) LIMIT 1`,
    [scope.organisationId, scope.siteId, scope.actorId, afterSalesRoleCodes]);
    if (!role.rowCount) throw new ApiError(403, 'AFTER_SALES_ROLE_REQUIRED', 'Checklist reports are available to active after-sales staff.');

    const headerResult = await client.query(`SELECT work.id AS "workOrderId",work.reference AS "bookingReference",site.name AS "siteName",
        vehicle.registration,vehicle.make,vehicle.model,vehicle.variant,vehicle.powertrain,
        checklist.id,checklist.kind,checklist.state,checklist.version,checklist.schedule_basis AS "scheduleBasis",
        checklist.odometer_at_start_km AS "odometerAtStartKm",template.template_code AS "templateCode",template.revision AS "templateRevision",
        coalesce(source_rows.items,'[]'::jsonb) AS sources
      FROM public.work_order_checklists checklist
      JOIN public.work_orders work ON work.organisation_id=checklist.organisation_id AND work.site_id=checklist.site_id AND work.id=checklist.work_order_id
      JOIN public.sites site ON site.organisation_id=work.organisation_id AND site.id=work.site_id
      JOIN public.vehicles vehicle ON vehicle.organisation_id=work.organisation_id AND vehicle.id=work.vehicle_id
      JOIN public.workshop_checklist_template_revisions template ON template.organisation_id=checklist.organisation_id AND template.site_id=checklist.site_id AND template.id=checklist.template_revision_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('reference',document.reference,'title',revision.title,'revision',revision.revision,
          'status',revision.status,'effectiveFrom',revision.effective_from,'effectiveUntil',revision.effective_until,
          'current',(revision.status='effective' AND revision.effective_from<=clock_timestamp() AND (revision.effective_until IS NULL OR revision.effective_until>clock_timestamp())))
          ORDER BY document.reference,revision.revision) AS items
        FROM public.workshop_checklist_template_sources source
        JOIN public.controlled_document_revisions revision ON revision.organisation_id=source.organisation_id AND revision.site_id=source.site_id AND revision.id=source.source_revision_id
        JOIN public.controlled_documents document ON document.organisation_id=revision.organisation_id AND document.site_id=revision.site_id AND document.id=revision.document_id
        WHERE source.organisation_id=checklist.organisation_id AND source.site_id=checklist.site_id AND source.template_revision_id=template.id
      ) source_rows ON true
      WHERE checklist.organisation_id=$1 AND checklist.site_id=$2 AND checklist.work_order_id=$3 AND checklist.id=$4 AND checklist.kind='routine-maintenance'`,
    [scope.organisationId, scope.siteId, uuid.parse(workOrderId), uuid.parse(checklistId)]);
    if (!headerResult.rowCount) notFound();
    const header = headerResult.rows[0] as Record<string, unknown>;
    const version = z.number().int().positive().parse(header.version);
    if (input.expectedChecklistVersion !== undefined && input.expectedChecklistVersion !== version) {
      throw new ApiError(409, 'CHECKLIST_REPORT_CHANGED', 'Checklist results changed while this report was being prepared. Reload the report.', version);
    }

    const summaryResult = await client.query(`WITH latest AS (
        SELECT DISTINCT ON (item.id) item.id,revision.result
        FROM public.work_order_checklist_items item
        LEFT JOIN public.work_order_checklist_item_revisions revision
          ON revision.organisation_id=item.organisation_id AND revision.site_id=item.site_id
          AND revision.work_order_id=item.work_order_id AND revision.checklist_id=item.checklist_id AND revision.checklist_item_id=item.id
        WHERE item.organisation_id=$1 AND item.site_id=$2 AND item.work_order_id=$3 AND item.checklist_id=$4
        ORDER BY item.id,revision.revision DESC NULLS LAST
      ) SELECT count(*)::int AS total,
          count(*) FILTER (WHERE result='completed')::int AS completed,
          count(*) FILTER (WHERE result='failed')::int AS failed,
          count(*) FILTER (WHERE result='not-checked' OR result IS NULL)::int AS "notChecked",
          count(*) FILTER (WHERE result='not-completed')::int AS "notCompleted",
          count(*) FILTER (WHERE result='blocked')::int AS blocked,
          count(*) FILTER (WHERE result='not-applicable')::int AS "notApplicable"
        FROM latest`, [scope.organisationId, scope.siteId, workOrderId, checklistId]);
    const summary = z.object({ total: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), notChecked: z.number().int().nonnegative(), notCompleted: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), notApplicable: z.number().int().nonnegative() }).parse(summaryResult.rows[0]);
    const totalPages = summary.total ? Math.ceil(summary.total / input.pageSize) : 0;
    const page = Math.min(input.page, Math.max(totalPages, 1));
    const rows = await client.query(`SELECT item.id,item.item_code AS code,item.ordinal,
        coalesce(item.definition_snapshot->>'label',item.definition_snapshot->>'title',item.item_code) AS label,
        latest.result,latest.reason,latest.applicability_reason AS "applicabilityReason",latest.comments,latest.measurement,
        latest.actor_name AS "actorName",latest.assignee_name AS "assigneeName",latest.task_reference AS "taskReference",latest.task_title AS "taskTitle",
        latest.revision,latest.correction_reason AS "correctionReason",latest.recorded_at AS "recordedAt",
        coalesce(latest.evidence_labels,'[]'::jsonb) AS "evidenceLabels"
      FROM public.work_order_checklist_items item
      LEFT JOIN LATERAL (
        SELECT revision.result,revision.reason,revision.applicability_reason,revision.comments,revision.measurement,
          actor.display_name AS actor_name,assignee.display_name AS assignee_name,
          'T'||lpad(task.ordinal::text,2,'0') AS task_reference,task.title AS task_title,
          revision.revision,revision.correction_reason,revision.created_at AS recorded_at,
          (SELECT jsonb_agg(evidence.display_name ORDER BY evidence.display_name)
            FROM public.work_order_checklist_item_revision_evidence link
            JOIN public.evidence_records evidence ON evidence.organisation_id=link.organisation_id AND evidence.site_id=link.site_id AND evidence.id=link.evidence_id
            WHERE link.organisation_id=revision.organisation_id AND link.site_id=revision.site_id AND link.outcome_revision_id=revision.id) AS evidence_labels
        FROM public.work_order_checklist_item_revisions revision
        JOIN public.staff_users actor ON actor.id=revision.actor_id
        JOIN public.staff_users assignee ON assignee.id=revision.assignee_user_id
        JOIN public.tasks task ON task.organisation_id=revision.organisation_id AND task.site_id=revision.site_id AND task.work_order_id=revision.work_order_id AND task.id=revision.task_id
        WHERE revision.organisation_id=item.organisation_id AND revision.site_id=item.site_id AND revision.work_order_id=item.work_order_id
          AND revision.checklist_id=item.checklist_id AND revision.checklist_item_id=item.id
        ORDER BY revision.revision DESC LIMIT 1
      ) latest ON true
      WHERE item.organisation_id=$1 AND item.site_id=$2 AND item.work_order_id=$3 AND item.checklist_id=$4
      ORDER BY item.ordinal,item.id LIMIT $5 OFFSET $6`,
    [scope.organisationId, scope.siteId, workOrderId, checklistId, input.pageSize, (page - 1) * input.pageSize]);
    const items = z.array(itemSchema).parse(rows.rows);
    const finalVersion = await client.query(`SELECT version FROM public.work_order_checklists
      WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND id=$4`,
    [scope.organisationId, scope.siteId, workOrderId, checklistId]);
    if (!finalVersion.rowCount || z.number().int().positive().parse(finalVersion.rows[0].version) !== version) {
      throw new ApiError(409, 'CHECKLIST_REPORT_CHANGED', 'Checklist results changed while this report was being prepared. Reload the report.');
    }
    await recordSensitiveRead(client, scope, 'work-order-checklist-report-read-prepared', Math.min(items.length, 100), uuid.parse(requestId));
    return workOrderChecklistReportSchema.parse({
      workOrderId: header.workOrderId,
      bookingReference: header.bookingReference,
      siteName: header.siteName,
      vehicle: { registration: header.registration, make: header.make, model: header.model, variant: header.variant, powertrain: header.powertrain },
      checklist: { id: header.id, kind: header.kind, state: header.state, version, scheduleBasis: header.scheduleBasis,
        odometerAtStartKm: header.odometerAtStartKm, templateCode: header.templateCode, templateRevision: header.templateRevision, sources: header.sources },
      summary: { totalItems: summary.total, completed: summary.completed, failed: summary.failed, notChecked: summary.notChecked,
        notCompleted: summary.notCompleted, blocked: summary.blocked, notApplicable: summary.notApplicable },
      items, pagination: { page, pageSize: input.pageSize, totalItems: summary.total, totalPages }, preparedAt: new Date().toISOString(),
    });
  });
}
