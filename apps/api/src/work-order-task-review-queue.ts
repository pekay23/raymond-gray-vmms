import { z } from 'zod';
import { type Database, type Scope, scoped, uuid } from './db.js';
import { ApiError } from './errors.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';

const queueItem = z.object({
  activityId: uuid,
  workOrderId: uuid,
  bookingReference: z.string(),
  vehicleLabel: z.string(),
  registration: z.string().nullable(),
  taskId: uuid,
  taskReference: z.string(),
  taskTitle: z.string(),
  technicianName: z.string(),
  requesterName: z.string(),
  note: z.string(),
  createdAt: z.union([z.date(), z.iso.datetime({ offset: true })]).transform(value => value instanceof Date ? value.toISOString() : value),
}).strict();

export const taskReviewQueueSchema = z.object({
  items: z.array(queueItem),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export async function readWorkOrderTaskReviewQueue(
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
        bool_or(role_code IN ('ev-team-lead','ice-team-lead')) AS is_team_lead,
        bool_or(role_code='supervisor') AS is_supervisor
      FROM public.staff_role_placements
      WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND state='active'`,
    [scope.organisationId, scope.siteId, scope.actorId]);
    const role = z.object({ is_head: z.boolean().nullable(), is_team_lead: z.boolean().nullable(), is_supervisor: z.boolean().nullable() }).parse(roles.rows[0]);
    if (!role.is_head && !role.is_team_lead && !role.is_supervisor) {
      throw new ApiError(403, 'TASK_REVIEW_QUEUE_REQUIRED', 'Task review requests are available to the current Supervisor, assigned Team Lead, and Head of Service Centre.');
    }

    const currentHandoffs = `
      SELECT work.id AS work_order_id,work.reference AS booking_reference,
        vehicle.make||' '||vehicle.model AS vehicle_label,vehicle.registration,
        plan.id AS work_plan_revision_id,supervisor_placement.id AS supervisor_placement_id
      FROM public.work_orders work
      JOIN public.vehicles vehicle ON vehicle.organisation_id=work.organisation_id AND vehicle.id=work.vehicle_id
      JOIN LATERAL (
        SELECT assignment.id,assignment.lead_user_id,assignment.operations_review_id
        FROM public.work_order_lead_assignments assignment
        WHERE assignment.organisation_id=work.organisation_id AND assignment.site_id=work.site_id AND assignment.work_order_id=work.id
        ORDER BY assignment.created_at DESC,assignment.id DESC LIMIT 1
      ) lead ON true
      JOIN LATERAL (
        SELECT review.id FROM public.work_order_operations_reviews review
        WHERE review.organisation_id=work.organisation_id AND review.site_id=work.site_id AND review.work_order_id=work.id
        ORDER BY review.reviewed_work_order_version DESC,review.id DESC LIMIT 1
      ) latest_review ON latest_review.id=lead.operations_review_id
      JOIN LATERAL (
        SELECT revision.id,revision.created_work_order_version
        FROM public.work_order_work_plan_revisions revision
        WHERE revision.organisation_id=work.organisation_id AND revision.site_id=work.site_id
          AND revision.work_order_id=work.id AND revision.lead_assignment_id=lead.id
        ORDER BY revision.revision_number DESC LIMIT 1
      ) plan ON true
      JOIN LATERAL (
        SELECT handoff.supervisor_user_id,handoff.work_plan_revision_id,handoff.work_order_version
        FROM public.work_order_supervisor_handoffs handoff
        WHERE handoff.organisation_id=work.organisation_id AND handoff.site_id=work.site_id
          AND handoff.work_order_id=work.id AND handoff.lead_assignment_id=lead.id
          AND handoff.work_plan_revision_id=plan.id
        ORDER BY handoff.created_at DESC,handoff.id DESC LIMIT 1
      ) handoff ON true
      JOIN public.staff_role_placements supervisor_placement
        ON supervisor_placement.organisation_id=work.organisation_id AND supervisor_placement.site_id=work.site_id
        AND supervisor_placement.staff_user_id=handoff.supervisor_user_id AND supervisor_placement.role_code='supervisor'
        AND supervisor_placement.state='active'
      WHERE work.organisation_id=$1 AND work.site_id=$2
        AND plan.id=handoff.work_plan_revision_id
        AND handoff.work_order_version<=work.version
        AND (plan.created_work_order_version=work.version OR handoff.work_order_version<work.version)
        AND NOT EXISTS (
          SELECT 1 FROM public.domain_events event
          WHERE event.organisation_id=work.organisation_id AND event.site_id=work.site_id
            AND event.aggregate_id=work.id AND event.aggregate_version>handoff.work_order_version
            AND event.event_type<>'work-order.tasks-assigned'
        )
        AND ($4::boolean OR lead.lead_user_id=$3 OR handoff.supervisor_user_id=$3)
    `;
    const pendingRequests = `
      SELECT activity.id AS "activityId",work.work_order_id AS "workOrderId",
        work.booking_reference AS "bookingReference",work.vehicle_label AS "vehicleLabel",work.registration AS registration,
        task.id AS "taskId",'T'||lpad(task.ordinal::text,2,'0') AS "taskReference",task.title AS "taskTitle",
        technician.display_name AS "technicianName",requester.display_name AS "requesterName",
        activity.note,activity.created_at AS "createdAt"
      FROM public.work_order_task_activity activity
      JOIN (${currentHandoffs}) work ON work.work_order_id=activity.work_order_id
        AND work.work_plan_revision_id=activity.work_plan_revision_id
      JOIN public.work_order_work_plan_revision_tasks planned
        ON planned.organisation_id=$1 AND planned.site_id=$2 AND planned.work_order_id=work.work_order_id
        AND planned.work_plan_revision_id=work.work_plan_revision_id AND planned.task_id=activity.task_id
      JOIN public.tasks task ON task.organisation_id=planned.organisation_id AND task.site_id=planned.site_id
        AND task.work_order_id=planned.work_order_id AND task.id=planned.task_id
      JOIN LATERAL (
        SELECT revision.assignee_user_id,revision.assignee_placement_id,revision.assignment_revision
        FROM public.work_order_task_assignment_revisions revision
        WHERE revision.organisation_id=planned.organisation_id AND revision.site_id=planned.site_id
          AND revision.work_order_id=planned.work_order_id AND revision.work_plan_revision_id=planned.work_plan_revision_id
          AND revision.task_id=planned.task_id
        ORDER BY revision.assignment_revision DESC,revision.id DESC LIMIT 1
      ) current_assignment ON current_assignment.assignment_revision=activity.assignment_revision
      JOIN public.staff_role_placements technician_placement
        ON technician_placement.organisation_id=planned.organisation_id AND technician_placement.site_id=planned.site_id
        AND technician_placement.id=current_assignment.assignee_placement_id
        AND technician_placement.staff_user_id=current_assignment.assignee_user_id
        AND technician_placement.role_code='technician-engineer-trainee' AND technician_placement.state='active'
        AND technician_placement.reports_to_placement_id=work.supervisor_placement_id
      JOIN public.staff_users technician ON technician.id=current_assignment.assignee_user_id AND technician.active
      JOIN public.memberships technician_membership ON technician_membership.user_id=technician.id
        AND technician_membership.site_id=planned.site_id AND technician_membership.active AND technician_membership.can_write
      JOIN public.staff_users requester ON requester.id=activity.actor_user_id AND requester.active
      WHERE activity.organisation_id=$1 AND activity.site_id=$2
        AND activity.entry_type='request' AND activity.request_type='supervisor-review'
        AND NOT EXISTS (
          SELECT 1 FROM public.work_order_task_activity response
          WHERE response.organisation_id=activity.organisation_id AND response.site_id=activity.site_id
            AND response.response_to_activity_id=activity.id AND response.entry_type='review-response'
        )
    `;
    const values = [scope.organisationId, scope.siteId, scope.actorId, Boolean(role.is_head)];
    const totalResult = await client.query(`SELECT count(*)::int AS total FROM (${pendingRequests}) pending`, values);
    const totalItems = z.object({ total: z.number().int().nonnegative() }).parse(totalResult.rows[0]).total;
    const totalPages = Math.ceil(totalItems / pageSize);
    const effectivePage = Math.min(page, Math.max(totalPages, 1));
    const results = await client.query(`SELECT * FROM (${pendingRequests}) pending
      ORDER BY "createdAt" ASC,"activityId" ASC LIMIT $5 OFFSET $6`,
    [...values, pageSize, (effectivePage - 1) * pageSize]);
    const projection = taskReviewQueueSchema.parse({
      items: results.rows,
      pagination: { page: effectivePage, pageSize, totalItems, totalPages },
    });
    await recordSensitiveRead(client, scope, 'work-order-task-review-queue-read-prepared', projection.items.length, requestId);
    return projection;
  });
}
