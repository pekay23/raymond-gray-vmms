import { z } from 'zod';
import { ApiError } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';

const assignedTaskSchema = z.object({
  workOrderId: uuid,
  bookingReference: z.string(),
  registration: z.string().nullable(),
  vehicleLabel: z.string(),
  taskId: uuid,
  taskReference: z.string(),
  taskTitle: z.string(),
  supervisorName: z.string(),
  planRevisionNumber: z.number().int().positive(),
  workPlanRevisionId: uuid,
  assignmentRevision: z.number().int().positive(),
  assignedAt: z.union([z.date(), z.iso.datetime({ offset: true })])
    .transform(value => value instanceof Date ? value.toISOString() : value),
}).strict();

const assignedTaskPageSchema = z.object({
  items: z.array(assignedTaskSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export async function readMyAssignedTasks(
  pool: Database,
  scope: Scope,
  requestId: string,
  requestedPage: number,
  requestedPageSize: number,
  requestedQuery = '',
) {
  const page = z.number().int().min(1).max(10000).parse(requestedPage);
  const pageSize = z.number().int().min(1).max(50).parse(requestedPageSize);
  const query = z.string().trim().max(120).parse(requestedQuery);

  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const role = await client.query(`SELECT 1 FROM public.staff_role_placements
      WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3
        AND role_code='technician-engineer-trainee' AND state='active' LIMIT 1`,
    [scope.organisationId, scope.siteId, scope.actorId]);
    if (!role.rowCount) {
      throw new ApiError(403, 'TECHNICIAN_ROLE_REQUIRED', 'An active Technician, Engineer or Trainee role is required to view assigned tasks.');
    }

    const currentTasks = `
      WITH latest_review AS (
        SELECT DISTINCT ON (r.organisation_id,r.site_id,r.work_order_id)
          r.organisation_id,r.site_id,r.work_order_id,r.id
        FROM public.work_order_operations_reviews r
        WHERE r.organisation_id=$1 AND r.site_id=$2
        ORDER BY r.organisation_id,r.site_id,r.work_order_id,r.reviewed_work_order_version DESC,r.id DESC
      ), latest_lead AS (
        SELECT DISTINCT ON (a.organisation_id,a.site_id,a.work_order_id)
          a.organisation_id,a.site_id,a.work_order_id,a.id,a.operations_review_id
        FROM public.work_order_lead_assignments a
        WHERE a.organisation_id=$1 AND a.site_id=$2
        ORDER BY a.organisation_id,a.site_id,a.work_order_id,a.created_at DESC,a.id DESC
      ), latest_plan AS (
        SELECT DISTINCT ON (p.organisation_id,p.site_id,p.work_order_id,p.lead_assignment_id)
          p.organisation_id,p.site_id,p.work_order_id,p.lead_assignment_id,p.id,p.revision_number
        FROM public.work_order_work_plan_revisions p
        WHERE p.organisation_id=$1 AND p.site_id=$2
        ORDER BY p.organisation_id,p.site_id,p.work_order_id,p.lead_assignment_id,p.revision_number DESC,p.id DESC
      ), current_work AS (
        SELECT w.organisation_id,w.site_id,w.id AS work_order_id,w.reference,w.vehicle_id,
          plan.id AS plan_revision_id,plan.id AS work_plan_revision_id,plan.revision_number,h.supervisor_user_id,
          supervisor.display_name AS supervisor_name
        FROM public.work_orders w
        JOIN latest_review review ON review.organisation_id=w.organisation_id
          AND review.site_id=w.site_id AND review.work_order_id=w.id
        JOIN latest_lead lead ON lead.organisation_id=w.organisation_id
          AND lead.site_id=w.site_id AND lead.work_order_id=w.id
          AND lead.operations_review_id=review.id
        JOIN latest_plan plan ON plan.organisation_id=w.organisation_id
          AND plan.site_id=w.site_id AND plan.work_order_id=w.id AND plan.lead_assignment_id=lead.id
        JOIN LATERAL (
          SELECT handoff.supervisor_user_id,handoff.work_order_version
          FROM public.work_order_supervisor_handoffs handoff
          WHERE handoff.organisation_id=w.organisation_id AND handoff.site_id=w.site_id
            AND handoff.work_order_id=w.id AND handoff.lead_assignment_id=lead.id
            AND handoff.work_plan_revision_id=plan.id AND handoff.work_order_version<=w.version
            AND NOT EXISTS (
              SELECT 1 FROM public.domain_events event
              WHERE event.organisation_id=w.organisation_id AND event.site_id=w.site_id
                AND event.aggregate_id=w.id AND event.aggregate_version>handoff.work_order_version
                AND event.event_type<>'work-order.tasks-assigned'
            )
          ORDER BY handoff.created_at DESC,handoff.id DESC LIMIT 1
        ) h ON true
        JOIN public.staff_users supervisor ON supervisor.id=h.supervisor_user_id AND supervisor.active
        WHERE w.organisation_id=$1 AND w.site_id=$2
          AND EXISTS (
            SELECT 1 FROM public.staff_role_placements active_supervisor
            WHERE active_supervisor.organisation_id=w.organisation_id
              AND active_supervisor.site_id=w.site_id
              AND active_supervisor.staff_user_id=h.supervisor_user_id
              AND active_supervisor.role_code='supervisor' AND active_supervisor.state='active'
          )
      )
      SELECT current.work_order_id AS "workOrderId",current.reference AS "bookingReference",
        vehicle.registration,concat_ws(' ',vehicle.make,vehicle.model,vehicle.variant) AS "vehicleLabel",
        task.id AS "taskId",'T'||lpad(task.ordinal::text,2,'0') AS "taskReference",task.title AS "taskTitle",
        current.supervisor_name AS "supervisorName",current.revision_number AS "planRevisionNumber",
        current.work_plan_revision_id AS "workPlanRevisionId",
        allocation.assignment_revision AS "assignmentRevision",allocation.created_at AS "assignedAt"
      FROM current_work current
      JOIN public.vehicles vehicle ON vehicle.organisation_id=current.organisation_id
        AND vehicle.id=current.vehicle_id
      JOIN public.work_order_work_plan_revision_tasks planned ON planned.organisation_id=current.organisation_id
        AND planned.site_id=current.site_id AND planned.work_order_id=current.work_order_id
        AND planned.work_plan_revision_id=current.plan_revision_id
      JOIN public.tasks task ON task.organisation_id=planned.organisation_id AND task.site_id=planned.site_id
        AND task.work_order_id=planned.work_order_id AND task.id=planned.task_id
      JOIN LATERAL (
        SELECT revision.assignee_user_id,revision.assignee_placement_id,revision.assignment_revision,revision.created_at
        FROM public.work_order_task_assignment_revisions revision
        WHERE revision.organisation_id=planned.organisation_id AND revision.site_id=planned.site_id
          AND revision.work_order_id=planned.work_order_id
          AND revision.work_plan_revision_id=planned.work_plan_revision_id AND revision.task_id=planned.task_id
        ORDER BY revision.assignment_revision DESC,revision.id DESC LIMIT 1
      ) allocation ON allocation.assignee_user_id=$3
      JOIN public.staff_users assignee ON assignee.id=allocation.assignee_user_id AND assignee.active
      JOIN public.staff_role_placements placement ON placement.id=allocation.assignee_placement_id
        AND placement.organisation_id=current.organisation_id AND placement.site_id=current.site_id
        AND placement.staff_user_id=allocation.assignee_user_id
        AND placement.role_code='technician-engineer-trainee' AND placement.state='active'
      JOIN public.memberships membership ON membership.user_id=allocation.assignee_user_id
        AND membership.site_id=current.site_id AND membership.active
      WHERE current.organisation_id=$1 AND current.site_id=$2`;

    const searchFilter = `($4='' OR strpos(lower(concat_ws(' ',assigned."bookingReference",assigned.registration,assigned."taskReference",assigned."taskTitle")),lower($4))>0)`;
    const count = await client.query(`SELECT count(*)::int AS total FROM (${currentTasks}) assigned WHERE ${searchFilter}`,
      [scope.organisationId, scope.siteId, scope.actorId, query]);
    const totalItems = z.object({ total: z.number().int().nonnegative() }).parse(count.rows[0]).total;
    const totalPages = Math.ceil(totalItems / pageSize);
    const effectivePage = Math.min(page, Math.max(1, totalPages));
    const found = await client.query(`SELECT * FROM (${currentTasks}) assigned
      WHERE ${searchFilter}
      ORDER BY "assignedAt" DESC,"bookingReference", "taskReference", "workOrderId"
      LIMIT $5 OFFSET $6`,
    [scope.organisationId, scope.siteId, scope.actorId, query, pageSize, (effectivePage - 1) * pageSize]);
    const projection = assignedTaskPageSchema.parse({
      items: found.rows,
      pagination: { page: effectivePage, pageSize, totalItems, totalPages },
    });
    await recordSensitiveRead(client, scope, 'work-order-queue-read-prepared', projection.items.length, requestId);
    return projection;
  });
}
