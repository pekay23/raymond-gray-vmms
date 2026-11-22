import { z } from 'zod';
import { type Database, type Scope, scoped, uuid } from './db.js';
import { ApiError } from './errors.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';

const findingSchema = z.object({
  findingId: uuid,
  workOrderId: uuid,
  bookingReference: z.string(),
  vehicleLabel: z.string(),
  registration: z.string().nullable(),
  complaintReference: z.string(),
  taskReference: z.string().nullable(),
  taskTitle: z.string().nullable(),
  summary: z.string(),
  certaintyState: z.enum(['stated', 'inconclusive']),
  certaintyExplanation: z.string(),
  residualRisk: z.string(),
  restrictions: z.string().nullable(),
  recordedAt: z.union([z.date(), z.iso.datetime({ offset: true })]).transform(value => value instanceof Date ? value.toISOString() : value),
}).strict();

export const workOrderDiagnosticReviewQueueSchema = z.object({
  items: z.array(findingSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export async function readWorkOrderDiagnosticReviewQueue(
  pool: Database,
  scope: Scope,
  requestId: string,
  requestedPage: number,
  requestedPageSize: number,
) {
  const page = z.number().int().min(1).max(10_000).parse(requestedPage);
  const pageSize = z.number().int().min(1).max(50).parse(requestedPageSize);
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const roles = await client.query(`SELECT
        bool_or(role_code='head-service-centre') AS is_head,
        bool_or(role_code IN ('ev-team-lead','ice-team-lead')) AS is_team_lead
      FROM public.staff_role_placements
      WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND state='active'`,
    [scope.organisationId, scope.siteId, scope.actorId]);
    const role = z.object({ is_head: z.boolean().nullable(), is_team_lead: z.boolean().nullable() }).parse(roles.rows[0]);
    if (!role.is_head && !role.is_team_lead) {
      throw new ApiError(403, 'DIAGNOSTIC_REVIEW_QUEUE_REQUIRED', 'This review list is available to the Head of Service Centre and Team Leads.');
    }

    const where = `finding.organisation_id=$1 AND finding.site_id=$2
      AND NOT EXISTS (
        SELECT 1 FROM public.diagnostic_findings newer
        WHERE newer.organisation_id=finding.organisation_id AND newer.site_id=finding.site_id
          AND newer.work_order_id=finding.work_order_id AND newer.supersedes_finding_id=finding.id
      )
      AND ($4::boolean OR lead.lead_user_id=$3)`;
    const from = `FROM public.diagnostic_findings finding
      JOIN public.work_orders work ON work.organisation_id=finding.organisation_id
        AND work.site_id=finding.site_id AND work.id=finding.work_order_id
      JOIN public.vehicles vehicle ON vehicle.organisation_id=work.organisation_id
        AND vehicle.id=work.vehicle_id
      JOIN public.complaints complaint ON complaint.organisation_id=finding.organisation_id
        AND complaint.site_id=finding.site_id AND complaint.work_order_id=finding.work_order_id
        AND complaint.id=finding.complaint_id
      LEFT JOIN public.tasks task ON task.organisation_id=finding.organisation_id
        AND task.site_id=finding.site_id AND task.work_order_id=finding.work_order_id
        AND task.id=finding.task_id
      LEFT JOIN LATERAL (
        SELECT assignment.lead_user_id FROM public.work_order_lead_assignments assignment
        WHERE assignment.organisation_id=work.organisation_id AND assignment.site_id=work.site_id
          AND assignment.work_order_id=work.id
        ORDER BY assignment.created_at DESC,assignment.id DESC LIMIT 1
      ) lead ON true`;
    const values = [scope.organisationId, scope.siteId, scope.actorId, Boolean(role.is_head)];
    const totalResult = await client.query(`SELECT count(*)::int AS total ${from} WHERE ${where}`, values);
    const totalItems = z.object({ total: z.number().int().nonnegative() }).parse(totalResult.rows[0]).total;
    const totalPages = Math.ceil(totalItems / pageSize);
    const effectivePage = Math.min(page, Math.max(1, totalPages));
    const result = await client.query(`SELECT finding.id AS "findingId",work.id AS "workOrderId",
        work.reference AS "bookingReference",vehicle.make||' '||vehicle.model AS "vehicleLabel",
        vehicle.registration, 'C'||lpad(complaint.ordinal::text,2,'0') AS "complaintReference",
        CASE WHEN task.id IS NULL THEN NULL ELSE 'T'||lpad(task.ordinal::text,2,'0') END AS "taskReference",
        task.title AS "taskTitle",finding.summary,finding.certainty_state AS "certaintyState",
        finding.certainty_explanation AS "certaintyExplanation",finding.residual_risk AS "residualRisk",
        finding.restrictions,finding.recorded_at AS "recordedAt"
      ${from} WHERE ${where}
      ORDER BY finding.recorded_at DESC,finding.id DESC LIMIT $5 OFFSET $6`,
    [...values, pageSize, (effectivePage - 1) * pageSize]);
    const projection = {
      items: z.array(findingSchema).parse(result.rows),
      pagination: { page: effectivePage, pageSize, totalItems, totalPages },
    };
    await recordSensitiveRead(client, scope, 'work-order-diagnostic-review-queue-read-prepared', projection.items.length, requestId);
    return projection;
  });
}
