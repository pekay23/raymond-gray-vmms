import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runStaffCommand, lockWorkOrderRoot } from './commands.js';
import { ApiError, notFound } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { requireActiveReadMembership } from './sensitive-read-audit.js';

const allocationBlockReason = z.enum([
  'handoff-required',
  'current-plan-required',
  'operations-review-required',
  'no-direct-reports',
  'site-write-required',
]);

export const taskAllocationsSchema = z.object({
  workOrderId: uuid,
  workOrderVersion: z.number().int().positive(),
  planRevisionId: uuid.nullable(),
  planRevisionNumber: z.number().int().positive().nullable(),
  canAssign: z.boolean(),
  blockReason: allocationBlockReason.nullable(),
  activityAudience: z.enum(['supervisor', 'team-lead', 'head-service-centre']).nullable(),
  tasks: z.array(z.object({
    taskId: uuid,
    reference: z.string(),
    title: z.string(),
    assigneeId: uuid.nullable(),
    assigneeName: z.string().nullable(),
    assignmentRevision: z.number().int().positive().nullable(),
  }).strict()),
  assignees: z.array(z.object({
    staffUserId: uuid,
    displayName: z.string(),
    roleCode: z.literal('technician-engineer-trainee'),
    placementId: uuid,
    currentPlanTaskCount: z.number().int().nonnegative(),
    lastReportedBlockedTaskCount: z.number().int().nonnegative(),
    lastReportedWaitingTaskCount: z.number().int().nonnegative(),
  }).strict()),
}).strict();

export const taskAllocationCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  planRevisionId: uuid,
  assignments: z.array(z.object({ taskId: uuid, staffUserId: uuid }).strict())
    .min(1).max(50)
    .refine(items => new Set(items.map(item => item.taskId)).size === items.length, 'Choose each task once.'),
}).strict();

const taskAllocationResultSchema = z.object({
  workOrderId: uuid,
  version: z.number().int().positive(),
  planRevisionId: uuid,
  assignments: z.array(z.object({
    taskId: uuid,
    staffUserId: uuid,
    displayName: z.string(),
    revision: z.number().int().positive(),
  }).strict()),
}).strict();

export type PlanContext = {
  version: number;
  powertrainClass: 'EV' | 'HYB' | 'ICE';
  leadAssignmentId: string | null;
  leadUserId: string | null;
  leadPlacementId: string | null;
  latestReviewId: string | null;
  planRevisionId: string | null;
  planRevisionNumber: number | null;
  planCreatedVersion: number | null;
  handoffSupervisorUserId: string | null;
  handoffPlanRevisionId: string | null;
  handoffWorkOrderVersion: number | null;
  handoffHasNoInvalidatingEvents: boolean;
  assignmentReviewId: string | null;
  supervisorPlacementId: string | null;
};

export async function currentPlanContext(client: PoolClient, scope: Scope, workOrderId: string): Promise<PlanContext> {
  const result = await client.query(`
    SELECT w.version,w.powertrain_class AS "powertrainClass",
      lead.id AS "leadAssignmentId",lead.lead_user_id AS "leadUserId",lead.operations_review_id AS "assignmentReviewId",review.id AS "latestReviewId",
      plan.id AS "planRevisionId",plan.revision_number AS "planRevisionNumber",plan.created_work_order_version AS "planCreatedVersion",
      handoff.supervisor_user_id AS "handoffSupervisorUserId",handoff.work_plan_revision_id AS "handoffPlanRevisionId",
      handoff.work_order_version AS "handoffWorkOrderVersion",
      coalesce(NOT EXISTS (
        SELECT 1 FROM public.domain_events event
        WHERE event.organisation_id=w.organisation_id AND event.site_id=w.site_id AND event.aggregate_id=w.id
          AND event.aggregate_version>handoff.work_order_version AND event.event_type<>'work-order.tasks-assigned'
      ),false) AS "handoffHasNoInvalidatingEvents",
      supervisorPlacement.id AS "supervisorPlacementId",leadPlacement.id AS "leadPlacementId"
    FROM public.work_orders w
    LEFT JOIN LATERAL (
      SELECT a.id,a.lead_user_id,a.operations_review_id
      FROM public.work_order_lead_assignments a
      WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id
      ORDER BY a.created_at DESC,a.id DESC LIMIT 1
    ) lead ON true
    LEFT JOIN LATERAL (
      SELECT r.id FROM public.work_order_operations_reviews r
      WHERE r.organisation_id=w.organisation_id AND r.site_id=w.site_id AND r.work_order_id=w.id
      ORDER BY r.reviewed_work_order_version DESC,r.id DESC LIMIT 1
    ) review ON true
    LEFT JOIN LATERAL (
      SELECT p.id,p.revision_number,p.created_work_order_version
      FROM public.work_order_work_plan_revisions p
      WHERE p.organisation_id=w.organisation_id AND p.site_id=w.site_id AND p.work_order_id=w.id
        AND p.lead_assignment_id=lead.id
      ORDER BY p.revision_number DESC LIMIT 1
    ) plan ON true
    LEFT JOIN LATERAL (
      SELECT h.supervisor_user_id,h.work_plan_revision_id,h.work_order_version
      FROM public.work_order_supervisor_handoffs h
      WHERE h.organisation_id=w.organisation_id AND h.site_id=w.site_id AND h.work_order_id=w.id
        AND h.lead_assignment_id=lead.id AND h.work_plan_revision_id=plan.id
      ORDER BY h.created_at DESC,h.id DESC LIMIT 1
    ) handoff ON true
    LEFT JOIN public.staff_role_placements supervisorPlacement
      ON supervisorPlacement.organisation_id=w.organisation_id AND supervisorPlacement.site_id=w.site_id
      AND supervisorPlacement.staff_user_id=handoff.supervisor_user_id AND supervisorPlacement.role_code='supervisor'
      AND supervisorPlacement.state='active'
    LEFT JOIN public.staff_role_placements leadPlacement
      ON leadPlacement.organisation_id=w.organisation_id AND leadPlacement.site_id=w.site_id
      AND leadPlacement.staff_user_id=lead.lead_user_id AND leadPlacement.role_code IN ('ev-team-lead','ice-team-lead')
      AND leadPlacement.state='active'
    WHERE w.organisation_id=$1 AND w.site_id=$2 AND w.id=$3
  `, [scope.organisationId, scope.siteId, uuid.parse(workOrderId)]);
  if (!result.rowCount) notFound();
  return z.object({
    version: z.number().int().positive(),
    powertrainClass: z.enum(['EV', 'HYB', 'ICE']),
    leadAssignmentId: uuid.nullable(),
    leadUserId: uuid.nullable(),
    leadPlacementId: uuid.nullable(),
    latestReviewId: uuid.nullable(),
    planRevisionId: uuid.nullable(),
    planRevisionNumber: z.number().int().positive().nullable(),
    planCreatedVersion: z.number().int().positive().nullable(),
    handoffSupervisorUserId: uuid.nullable(),
    handoffPlanRevisionId: uuid.nullable(),
    handoffWorkOrderVersion: z.number().int().positive().nullable(),
    handoffHasNoInvalidatingEvents: z.boolean(),
    assignmentReviewId: uuid.nullable(),
    supervisorPlacementId: uuid.nullable(),
  }).parse(result.rows[0]);
}

export const taskActivityAudienceSchema = z.enum(['supervisor', 'team-lead', 'head-service-centre']);
export type TaskActivityAudience = z.infer<typeof taskActivityAudienceSchema>;

export async function resolveTaskActivityAudience(
  client: PoolClient,
  scope: Scope,
  context: PlanContext,
): Promise<TaskActivityAudience | null> {
  const state = getPlanState(context);
  if (!state.handoffIsCurrent || !context.planRevisionId || !context.supervisorPlacementId) return null;
  if (context.handoffSupervisorUserId === scope.actorId && context.supervisorPlacementId) return 'supervisor';
  if (context.leadUserId === scope.actorId && context.leadPlacementId) return 'team-lead';
  const head = await client.query(`SELECT 1 FROM public.staff_role_placements
    WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3
      AND role_code='head-service-centre' AND state='active' LIMIT 1`,
  [scope.organisationId, scope.siteId, scope.actorId]);
  return head.rowCount ? 'head-service-centre' : null;
}

export function getPlanState(context: PlanContext) {
  const hasCurrentLead = Boolean(context.leadAssignmentId && context.assignmentReviewId === context.latestReviewId);
  const hasCurrentPlan = Boolean(hasCurrentLead && context.planRevisionId && context.planCreatedVersion !== null
    && (context.planCreatedVersion === context.version
      || (context.handoffWorkOrderVersion !== null && context.handoffWorkOrderVersion <= context.version && context.handoffHasNoInvalidatingEvents)));
  const handoffIsCurrent = Boolean(hasCurrentPlan && context.handoffPlanRevisionId === context.planRevisionId
    && context.handoffWorkOrderVersion !== null && context.handoffWorkOrderVersion <= context.version
    && context.handoffHasNoInvalidatingEvents);
  return { hasCurrentLead, hasCurrentPlan, handoffIsCurrent };
}

async function activeDirectReports(client: PoolClient, scope: Scope, supervisorPlacementId: string) {
  const result = await client.query(`
    SELECT placement.id AS "placementId",placement.staff_user_id AS "staffUserId",
      staff.display_name AS "displayName",placement.role_code AS "roleCode",
      coalesce(workload.task_count,0)::int AS "currentPlanTaskCount",
      coalesce(workload.blocked_task_count,0)::int AS "lastReportedBlockedTaskCount",
      coalesce(workload.waiting_task_count,0)::int AS "lastReportedWaitingTaskCount"
    FROM public.staff_role_placements placement
    JOIN public.staff_users staff ON staff.id=placement.staff_user_id AND staff.active
    JOIN public.memberships membership ON membership.user_id=placement.staff_user_id
      AND membership.site_id=placement.site_id
      AND membership.active AND membership.can_write
    LEFT JOIN LATERAL (
      WITH latest_review AS (
        SELECT DISTINCT ON (review.work_order_id) review.work_order_id,review.id
        FROM public.work_order_operations_reviews review
        WHERE review.organisation_id=$1 AND review.site_id=$2
        ORDER BY review.work_order_id,review.reviewed_work_order_version DESC,review.id DESC
      ), latest_lead AS (
        SELECT DISTINCT ON (assignment.work_order_id) assignment.work_order_id,assignment.id,assignment.operations_review_id
        FROM public.work_order_lead_assignments assignment
        WHERE assignment.organisation_id=$1 AND assignment.site_id=$2
        ORDER BY assignment.work_order_id,assignment.created_at DESC,assignment.id DESC
      ), latest_plan AS (
        SELECT DISTINCT ON (plan.work_order_id,plan.lead_assignment_id)
          plan.work_order_id,plan.lead_assignment_id,plan.id,plan.created_work_order_version
        FROM public.work_order_work_plan_revisions plan
        WHERE plan.organisation_id=$1 AND plan.site_id=$2
        ORDER BY plan.work_order_id,plan.lead_assignment_id,plan.revision_number DESC,plan.id DESC
      ), current_handoffs AS (
        SELECT work.id AS work_order_id,plan.id AS plan_revision_id,handoff.work_order_version
        FROM public.work_orders work
        JOIN latest_review review ON review.work_order_id=work.id
        JOIN latest_lead lead ON lead.work_order_id=work.id AND lead.operations_review_id=review.id
        JOIN latest_plan plan ON plan.work_order_id=work.id AND plan.lead_assignment_id=lead.id
        JOIN LATERAL (
          SELECT current_handoff.work_order_version
          FROM public.work_order_supervisor_handoffs current_handoff
          WHERE current_handoff.organisation_id=$1 AND current_handoff.site_id=$2
            AND current_handoff.work_order_id=work.id AND current_handoff.lead_assignment_id=lead.id
            AND current_handoff.work_plan_revision_id=plan.id
          ORDER BY current_handoff.created_at DESC,current_handoff.id DESC LIMIT 1
        ) handoff ON true
        WHERE work.organisation_id=$1 AND work.site_id=$2
          AND (plan.created_work_order_version=work.version OR handoff.work_order_version<=work.version)
          AND NOT EXISTS (
            SELECT 1 FROM public.domain_events event
            WHERE event.organisation_id=work.organisation_id AND event.site_id=work.site_id
              AND event.aggregate_id=work.id AND event.aggregate_version>handoff.work_order_version
              AND event.event_type<>'work-order.tasks-assigned'
          )
      ), latest_assignments AS (
        SELECT DISTINCT ON (assignment.work_order_id,assignment.work_plan_revision_id,assignment.task_id)
          assignment.work_order_id,assignment.work_plan_revision_id,assignment.task_id,
          assignment.assignee_placement_id,assignment.assignment_revision
        FROM public.work_order_task_assignment_revisions assignment
        JOIN current_handoffs current ON current.work_order_id=assignment.work_order_id
          AND current.plan_revision_id=assignment.work_plan_revision_id
        JOIN public.work_order_work_plan_revision_tasks planned ON planned.organisation_id=assignment.organisation_id
          AND planned.site_id=assignment.site_id AND planned.work_order_id=assignment.work_order_id
          AND planned.work_plan_revision_id=assignment.work_plan_revision_id AND planned.task_id=assignment.task_id
        WHERE assignment.organisation_id=$1 AND assignment.site_id=$2
        ORDER BY assignment.work_order_id,assignment.work_plan_revision_id,assignment.task_id,
          assignment.assignment_revision DESC,assignment.id DESC
      )
      , latest_progress AS (
        SELECT DISTINCT ON (activity.work_order_id,activity.work_plan_revision_id,activity.task_id)
          activity.work_order_id,activity.work_plan_revision_id,activity.task_id,
          activity.progress_state
        FROM public.work_order_task_activity activity
        JOIN latest_assignments assignment ON assignment.work_order_id=activity.work_order_id
          AND assignment.work_plan_revision_id=activity.work_plan_revision_id
          AND assignment.task_id=activity.task_id
          AND assignment.assignment_revision=activity.assignment_revision
        WHERE activity.organisation_id=$1 AND activity.site_id=$2 AND activity.entry_type='progress'
        ORDER BY activity.work_order_id,activity.work_plan_revision_id,activity.task_id,
          activity.created_at DESC,activity.id DESC
      )
      SELECT count(*)::int AS task_count,
        count(*) FILTER (WHERE progress.progress_state='blocked')::int AS blocked_task_count,
        count(*) FILTER (WHERE progress.progress_state='waiting')::int AS waiting_task_count
      FROM latest_assignments assignment
      LEFT JOIN latest_progress progress ON progress.work_order_id=assignment.work_order_id
        AND progress.work_plan_revision_id=assignment.work_plan_revision_id
        AND progress.task_id=assignment.task_id
      WHERE assignment.assignee_placement_id=placement.id
    ) workload ON true
    WHERE placement.organisation_id=$1 AND placement.site_id=$2
      AND placement.reports_to_placement_id=$3 AND placement.state='active'
      AND placement.role_code='technician-engineer-trainee'
    ORDER BY staff.display_name,placement.staff_user_id
  `, [scope.organisationId, scope.siteId, supervisorPlacementId]);
  return z.array(z.object({
    placementId: uuid,
    staffUserId: uuid,
    displayName: z.string(),
    roleCode: z.literal('technician-engineer-trainee'),
    currentPlanTaskCount: z.number().int().nonnegative(),
    lastReportedBlockedTaskCount: z.number().int().nonnegative(),
    lastReportedWaitingTaskCount: z.number().int().nonnegative(),
  })).parse(result.rows);
}

export async function readTaskAllocations(pool: Database, scope: Scope, workOrderId: string, requestId: string) {
  return scoped(pool, scope, async client => {
    const canWrite = await requireActiveReadMembership(client, scope);
    const role = await client.query(`SELECT 1 FROM public.staff_role_placements
      WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND state='active' LIMIT 1`,
    [scope.organisationId, scope.siteId, scope.actorId]);
    if (!role.rowCount) throw new ApiError(403, 'ACTIVE_ROLE_REQUIRED', 'An active staff role is required to read task allocations.');

    const context = await currentPlanContext(client, scope, workOrderId);
    const state = getPlanState(context);
    const activityAudience = await resolveTaskActivityAudience(client, scope, context);
    const tasks = state.hasCurrentPlan && context.planRevisionId
      ? await client.query(`
          SELECT task.id AS "taskId",'T'||lpad(task.ordinal::text,2,'0') AS reference,task.title,
            current.assignee_user_id AS "assigneeId",assignee.display_name AS "assigneeName",
            current.assignment_revision AS "assignmentRevision"
          FROM public.work_order_work_plan_revision_tasks planned
          JOIN public.tasks task ON task.organisation_id=planned.organisation_id AND task.site_id=planned.site_id
            AND task.work_order_id=planned.work_order_id AND task.id=planned.task_id
          LEFT JOIN LATERAL (
            SELECT assignment.assignee_user_id,assignment.assignment_revision
            FROM public.work_order_task_assignment_revisions assignment
            WHERE assignment.organisation_id=planned.organisation_id AND assignment.site_id=planned.site_id
              AND assignment.work_order_id=planned.work_order_id AND assignment.work_plan_revision_id=planned.work_plan_revision_id
              AND assignment.task_id=planned.task_id
            ORDER BY assignment.assignment_revision DESC LIMIT 1
          ) current ON true
          LEFT JOIN public.staff_users assignee ON assignee.id=current.assignee_user_id
          WHERE planned.organisation_id=$1 AND planned.site_id=$2 AND planned.work_order_id=$3
            AND planned.work_plan_revision_id=$4
          ORDER BY planned.line_number
        `, [scope.organisationId, scope.siteId, workOrderId, context.planRevisionId])
      : { rows: [] };
    const isCurrentSupervisor = Boolean(state.handoffIsCurrent && context.handoffSupervisorUserId === scope.actorId
      && context.supervisorPlacementId);
    const assignees = isCurrentSupervisor && context.supervisorPlacementId
      ? await activeDirectReports(client, scope, context.supervisorPlacementId)
      : [];
    const blockReason = !state.hasCurrentLead
      ? 'operations-review-required'
      : !state.hasCurrentPlan
        ? 'current-plan-required'
        : !state.handoffIsCurrent || !isCurrentSupervisor
          ? 'handoff-required'
          : !canWrite
            ? 'site-write-required'
            : assignees.length === 0
              ? 'no-direct-reports'
              : null;
    await client.query(`INSERT INTO public.work_order_read_events
      (organisation_id,site_id,work_order_id,actor_id,action,projection_revision,work_order_version,request_id)
      VALUES($1,$2,$3,$4,'detail-read-prepared',1,$5,$6)`,
    [scope.organisationId, scope.siteId, workOrderId, scope.actorId, context.version, uuid.parse(requestId)]);
    return taskAllocationsSchema.parse({
      workOrderId,
      workOrderVersion: context.version,
      planRevisionId: state.hasCurrentPlan ? context.planRevisionId : null,
      planRevisionNumber: state.hasCurrentPlan ? context.planRevisionNumber : null,
      canAssign: blockReason === null,
      blockReason,
      activityAudience,
      tasks: tasks.rows,
      assignees,
    });
  });
}

export async function assignWorkPlanTasks(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  body: z.infer<typeof taskAllocationCommandSchema>,
) {
  let assignmentRows: Array<{ taskId: string; staffUserId: string; displayName: string; revision: number }> = [];
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'work-order.tasks-assigned',
    targetAggregateId: workOrderId,
    payload: body,
    responseSchema: taskAllocationResultSchema,
    lockSerializationRoots: client => lockWorkOrderRoot(client, scope, workOrderId),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'This account can view jobs but cannot assign tasks.');
      const context = await currentPlanContext(client, scope, workOrderId);
      const state = getPlanState(context);
      if (!state.hasCurrentLead) throw new ApiError(409, 'OPERATIONS_REVIEW_REQUIRED', 'A current Operations review and lead assignment are required.');
      if (!state.hasCurrentPlan || context.planRevisionId !== body.planRevisionId) throw new ApiError(409, 'CURRENT_PLAN_REQUIRED', 'Use the current work plan before assigning tasks.');
      if (!state.handoffIsCurrent || context.handoffPlanRevisionId !== body.planRevisionId) throw new ApiError(409, 'CURRENT_HANDOFF_REQUIRED', 'The current work plan must be handed to a Supervisor before task assignment.');
      if (context.handoffSupervisorUserId !== scope.actorId || !context.supervisorPlacementId) {
        throw new ApiError(403, 'CURRENT_SUPERVISOR_REQUIRED', 'Only the Supervisor currently assigned to this work plan can allocate tasks.');
      }
      const selectedTasks = body.assignments.map(item => item.taskId);
      const planTasks = await client.query(`SELECT task_id FROM public.work_order_work_plan_revision_tasks
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND work_plan_revision_id=$4
          AND task_id=ANY($5::uuid[])`,
      [scope.organisationId, scope.siteId, workOrderId, body.planRevisionId, selectedTasks]);
      if (planTasks.rowCount !== selectedTasks.length) throw new ApiError(409, 'TASK_NOT_IN_CURRENT_PLAN', 'Every assigned task must be listed in the current handed-over work plan.');
      const requestedStaff = [...new Set(body.assignments.map(item => item.staffUserId))];
      const eligible = await client.query(`SELECT placement.staff_user_id AS "staffUserId",placement.id AS "placementId"
        FROM public.staff_role_placements placement
        JOIN public.staff_users staff ON staff.id=placement.staff_user_id AND staff.active
        JOIN public.memberships membership ON membership.user_id=placement.staff_user_id
          AND membership.site_id=placement.site_id
          AND membership.active AND membership.can_write
        WHERE placement.organisation_id=$1 AND placement.site_id=$2
          AND placement.reports_to_placement_id=$3 AND placement.state='active'
          AND placement.role_code='technician-engineer-trainee'
          AND placement.staff_user_id=ANY($4::uuid[])`,
      [scope.organisationId, scope.siteId, context.supervisorPlacementId, requestedStaff]);
      const eligibleByUser = new Map(eligible.rows.map(row => [String(row.staffUserId), String(row.placementId)]));
      if (eligibleByUser.size !== requestedStaff.length) throw new ApiError(409, 'STAFF_ASSIGNMENT_INELIGIBLE', 'Choose active Technician / Engineer / Trainee staff who report directly to you at this site.');
    },
    apply: async client => {
      const locked = await client.query('SELECT version FROM public.work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',
        [scope.organisationId, scope.siteId, workOrderId]);
      if (!locked.rowCount) notFound();
      const currentVersion = z.object({ version: z.number().int().positive() }).parse(locked.rows[0]).version;
      if (currentVersion !== body.expectedVersion) throw new ApiError(409, 'STALE_VERSION', 'This job changed. Refresh before assigning tasks.', currentVersion);
      await client.query('UPDATE public.work_orders SET version=version+1 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',
        [scope.organisationId, scope.siteId, workOrderId]);
      const context = await currentPlanContext(client, scope, workOrderId);
      if (context.planRevisionId !== body.planRevisionId || !getPlanState(context).handoffIsCurrent) {
        throw new ApiError(409, 'CURRENT_HANDOFF_REQUIRED', 'The handed-over work plan changed. Refresh and review the current handoff.');
      }
      const supervisorPlacementId = context.supervisorPlacementId;
      if (!supervisorPlacementId || context.handoffSupervisorUserId !== scope.actorId) {
        throw new ApiError(403, 'CURRENT_SUPERVISOR_REQUIRED', 'Only the current Supervisor can allocate tasks.');
      }
      const requestedStaff = [...new Set(body.assignments.map(item => item.staffUserId))];
      const eligible = await client.query(`SELECT placement.staff_user_id AS "staffUserId",placement.id AS "placementId",staff.display_name AS "displayName"
        FROM public.staff_role_placements placement
        JOIN public.staff_users staff ON staff.id=placement.staff_user_id AND staff.active
        JOIN public.memberships membership ON membership.user_id=placement.staff_user_id
          AND membership.site_id=placement.site_id
          AND membership.active AND membership.can_write
        WHERE placement.organisation_id=$1 AND placement.site_id=$2
          AND placement.reports_to_placement_id=$3 AND placement.state='active'
          AND placement.role_code='technician-engineer-trainee'
          AND placement.staff_user_id=ANY($4::uuid[])`,
      [scope.organisationId, scope.siteId, supervisorPlacementId, requestedStaff]);
      const eligibleByUser = new Map(eligible.rows.map(row => [String(row.staffUserId), { placementId: String(row.placementId), displayName: String(row.displayName) }]));
      if (eligibleByUser.size !== requestedStaff.length) throw new ApiError(409, 'STAFF_ASSIGNMENT_INELIGIBLE', 'The selected staff member is no longer an active direct report.');

      const previousVersion = currentVersion;
      assignmentRows = [];
      for (const item of body.assignments) {
        const target = eligibleByUser.get(item.staffUserId);
        if (!target) throw new ApiError(409, 'STAFF_ASSIGNMENT_INELIGIBLE', 'The selected staff member is no longer eligible.');
        const latest = await client.query(`SELECT coalesce(max(assignment_revision),0)::int AS revision
          FROM public.work_order_task_assignment_revisions
          WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND task_id=$4`,
        [scope.organisationId, scope.siteId, workOrderId, item.taskId]);
        const revision = z.object({ revision: z.number().int().nonnegative() }).parse(latest.rows[0]).revision + 1;
        await client.query(`INSERT INTO public.work_order_task_assignment_revisions
          (id,organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,
            supervisor_user_id,supervisor_placement_id,assignee_user_id,assignee_placement_id,assigned_by,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$8,'Supervisor task allocation.')`,
        [randomUUID(), scope.organisationId, scope.siteId, workOrderId, item.taskId, body.planRevisionId, revision,
          scope.actorId, supervisorPlacementId, item.staffUserId, target.placementId]);
        assignmentRows.push({ taskId: item.taskId, staffUserId: item.staffUserId, displayName: target.displayName, revision });
      }
      const nextVersion = previousVersion + 1;
      return {
        aggregateId: workOrderId,
        aggregateType: 'work-order',
        version: nextVersion,
        previous: { version: previousVersion, taskAssignments: [] },
        next: { version: nextVersion, planRevisionId: body.planRevisionId, assignments: assignmentRows },
        reason: 'Supervisor allocated planned tasks to direct-report staff.',
      };
    },
    project: async (_client, mutation) => taskAllocationResultSchema.parse({
      workOrderId,
      version: mutation.version,
      planRevisionId: body.planRevisionId,
      assignments: assignmentRows,
    }),
  });
}
