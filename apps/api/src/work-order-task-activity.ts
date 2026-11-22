import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { ApiError, notFound } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { currentPlanContext, getPlanState, resolveTaskActivityAudience } from './work-order-task-allocations.js';

export const taskActivityInputSchema = z.object({
  expectedWorkPlanRevisionId: uuid,
  expectedAssignmentRevision: z.number().int().positive(),
  entryType: z.enum(['acknowledgement', 'progress', 'request', 'comment']),
  progressState: z.enum(['working', 'waiting', 'blocked']).nullable().default(null),
  requestType: z.enum(['help', 'parts', 'information', 'access', 'evidence', 'supervisor-review']).nullable().default(null),
  completionDeclaration: z.object({
    actionsSummary: z.string().trim().min(1).max(4000),
    checksSummary: z.string().trim().min(1).max(4000),
    outcome: z.enum(['reported-complete', 'reported-incomplete', 'blocked']),
    remainingWork: z.string().trim().min(1).max(2000),
  }).strict().nullable().default(null),
  note: z.string().trim().min(1).max(1500),
}).strict().superRefine((value, context) => {
  if ((value.entryType === 'progress') !== (value.progressState !== null)) {
    context.addIssue({ code: 'custom', path: ['progressState'], message: 'Choose a progress status only for a progress update.' });
  }
  if ((value.entryType === 'request') !== (value.requestType !== null)) {
    context.addIssue({ code: 'custom', path: ['requestType'], message: 'Choose a request type only for a request.' });
  }
  if (value.completionDeclaration && (value.entryType !== 'request' || value.requestType !== 'supervisor-review')) {
    context.addIssue({ code: 'custom', path: ['completionDeclaration'], message: 'A work declaration must be sent as a Supervisor review request.' });
  }
});
export const supervisorTaskReviewResponseInputSchema = z.object({
  expectedWorkPlanRevisionId: uuid,
  expectedAssignmentRevision: z.number().int().positive(),
  note: z.string().trim().min(1).max(1500),
}).strict();

const activityItem = z.object({
  id: uuid,
  assignmentRevision: z.number().int().positive(),
  entryType: z.enum(['acknowledgement', 'progress', 'request', 'comment', 'review-response']),
  progressState: z.enum(['working', 'waiting', 'blocked']).nullable(),
  requestType: z.enum(['help', 'parts', 'information', 'access', 'evidence', 'supervisor-review']).nullable(),
  completionDeclaration: z.object({
    actionsSummary: z.string(), checksSummary: z.string(), outcome: z.enum(['reported-complete', 'reported-incomplete', 'blocked']),
    remainingWork: z.string(),
  }).strict().nullable(),
  declarationWorkEntryIds: z.array(uuid).nullable(),
  responseToActivityId: uuid.nullable(),
  responseToActorName: z.string().nullable(),
  responseToNote: z.string().nullable(),
  hasSupervisorResponse: z.boolean(),
  note: z.string(),
  actorName: z.string(),
  createdAt: z.union([z.date(), z.iso.datetime({ offset: true })])
    .transform(value => value instanceof Date ? value.toISOString() : value),
}).strict();

export const taskActivityResultSchema = z.object({
  workOrderId: uuid,
  taskId: uuid,
  activity: activityItem,
}).strict();

export const taskActivityHistorySchema = z.object({
  workOrderId: uuid,
  taskId: uuid,
  workPlanRevisionId: uuid,
  assignmentRevision: z.number().int().positive(),
  items: z.array(activityItem),
}).strict();

const supervisorActivityItem = activityItem.extend({
  taskId: uuid,
  taskReference: z.string(),
  taskTitle: z.string(),
  currentAssigneeName: z.string(),
  currentAssignmentRevision: z.number().int().positive(),
}).strict();

export const supervisorTaskActivityPageSchema = z.object({
  workOrderId: uuid,
  planRevisionId: uuid,
  canRespond: z.boolean(),
  responseBlockReason: z.enum(['authority-required', 'read-only']).nullable(),
  items: z.array(supervisorActivityItem),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type CurrentAssignment = {
  workPlanRevisionId: string;
  assignmentRevision: number;
  actorPlacementId: string;
  workOrderVersion: number;
};

export async function currentAssignment(client: PoolClient, scope: Scope, workOrderId: string, taskId: string): Promise<CurrentAssignment> {
  const found = await client.query(`
    WITH latest_review AS (
      SELECT DISTINCT ON (organisation_id,site_id,work_order_id) organisation_id,site_id,work_order_id,id
      FROM public.work_order_operations_reviews
      WHERE organisation_id=$1 AND site_id=$2
      ORDER BY organisation_id,site_id,work_order_id,reviewed_work_order_version DESC,id DESC
    ), latest_lead AS (
      SELECT DISTINCT ON (organisation_id,site_id,work_order_id) organisation_id,site_id,work_order_id,id,operations_review_id
      FROM public.work_order_lead_assignments
      WHERE organisation_id=$1 AND site_id=$2
      ORDER BY organisation_id,site_id,work_order_id,created_at DESC,id DESC
    ), latest_plan AS (
      SELECT DISTINCT ON (organisation_id,site_id,work_order_id,lead_assignment_id)
        organisation_id,site_id,work_order_id,lead_assignment_id,id
      FROM public.work_order_work_plan_revisions
      WHERE organisation_id=$1 AND site_id=$2
      ORDER BY organisation_id,site_id,work_order_id,lead_assignment_id,revision_number DESC,id DESC
    )
    SELECT plan.id AS "workPlanRevisionId",allocation.assignment_revision AS "assignmentRevision",
      allocation.assignee_placement_id AS "actorPlacementId",w.version AS "workOrderVersion"
    FROM public.work_orders w
    JOIN latest_review review ON review.organisation_id=w.organisation_id AND review.site_id=w.site_id AND review.work_order_id=w.id
    JOIN latest_lead lead ON lead.organisation_id=w.organisation_id AND lead.site_id=w.site_id
      AND lead.work_order_id=w.id AND lead.operations_review_id=review.id
    JOIN latest_plan plan ON plan.organisation_id=w.organisation_id AND plan.site_id=w.site_id
      AND plan.work_order_id=w.id AND plan.lead_assignment_id=lead.id
    JOIN LATERAL (
      SELECT handoff.work_plan_revision_id,handoff.work_order_version,handoff.supervisor_user_id
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
    ) handoff ON true
    JOIN LATERAL (
      SELECT revision.assignment_revision,revision.assignee_user_id,revision.assignee_placement_id
      FROM public.work_order_task_assignment_revisions revision
      WHERE revision.organisation_id=w.organisation_id AND revision.site_id=w.site_id
        AND revision.work_order_id=w.id AND revision.work_plan_revision_id=plan.id AND revision.task_id=$4
      ORDER BY revision.assignment_revision DESC,revision.id DESC LIMIT 1
    ) allocation ON allocation.assignee_user_id=$3
    JOIN public.staff_role_placements placement ON placement.organisation_id=w.organisation_id
      AND placement.site_id=w.site_id AND placement.id=allocation.assignee_placement_id
      AND placement.staff_user_id=allocation.assignee_user_id
      AND placement.role_code='technician-engineer-trainee' AND placement.state='active'
    JOIN public.staff_users actor ON actor.id=allocation.assignee_user_id AND actor.active
    JOIN public.memberships membership ON membership.user_id=actor.id AND membership.site_id=w.site_id
      AND membership.active AND membership.can_write
    WHERE w.organisation_id=$1 AND w.site_id=$2 AND w.id=$5 AND allocation.assignee_user_id=$3
  `, [scope.organisationId, scope.siteId, scope.actorId, taskId, workOrderId]);
  const row = z.object({ workPlanRevisionId: uuid, assignmentRevision: z.number().int().positive(), actorPlacementId: uuid, workOrderVersion: z.number().int().positive() }).safeParse(found.rows[0]);
  if (!row.success) throw new ApiError(409, 'CURRENT_TASK_ASSIGNMENT_REQUIRED', 'This task is no longer assigned to you under the current work plan. Refresh your assignments or ask your Supervisor.');
  return row.data;
}

export async function readMyTaskActivity(pool: Database, scope: Scope, workOrderId: string, taskId: string, requestId: string) {
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const role = await client.query(`SELECT 1 FROM public.staff_role_placements
      WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3
        AND role_code='technician-engineer-trainee' AND state='active' LIMIT 1`,
    [scope.organisationId, scope.siteId, scope.actorId]);
    if (!role.rowCount) throw new ApiError(403, 'TECHNICIAN_ROLE_REQUIRED', 'An active Technician, Engineer or Trainee role is required.');
    const current = await currentAssignment(client, scope, workOrderId, taskId);
    const result = await client.query(`SELECT activity.id,activity.assignment_revision AS "assignmentRevision",
      activity.entry_type AS "entryType",activity.progress_state AS "progressState",activity.request_type AS "requestType",
      activity.completion_declaration AS "completionDeclaration",activity.declaration_work_entry_ids AS "declarationWorkEntryIds",
      activity.response_to_activity_id AS "responseToActivityId",
      parent_actor.display_name AS "responseToActorName",parent.note AS "responseToNote",
      EXISTS (SELECT 1 FROM public.work_order_task_activity reply
        WHERE reply.organisation_id=activity.organisation_id AND reply.site_id=activity.site_id
          AND reply.response_to_activity_id=activity.id AND reply.entry_type='review-response') AS "hasSupervisorResponse",
      activity.note,actor.display_name AS "actorName",activity.created_at AS "createdAt"
      FROM public.work_order_task_activity activity
      JOIN public.staff_users actor ON actor.id=activity.actor_user_id
      LEFT JOIN public.work_order_task_activity parent ON parent.organisation_id=activity.organisation_id
        AND parent.site_id=activity.site_id AND parent.work_order_id=activity.work_order_id
        AND parent.task_id=activity.task_id AND parent.id=activity.response_to_activity_id
      LEFT JOIN public.staff_users parent_actor ON parent_actor.id=parent.actor_user_id
      WHERE activity.organisation_id=$1 AND activity.site_id=$2 AND activity.work_order_id=$3 AND activity.task_id=$4
      ORDER BY activity.created_at,activity.id`, [scope.organisationId, scope.siteId, workOrderId, taskId]);
    await recordSensitiveRead(client, scope, 'work-order-task-activity-read-prepared', Math.min(result.rowCount ?? 0, 100), requestId);
    return taskActivityHistorySchema.parse({
      workOrderId, taskId, workPlanRevisionId: current.workPlanRevisionId,
      assignmentRevision: current.assignmentRevision, items: result.rows,
    });
  });
}

export async function readSupervisorTaskActivity(
  pool: Database,
  scope: Scope,
  workOrderId: string,
  requestId: string,
  requestedPage: number,
  requestedPageSize: number,
) {
  const page = z.number().int().min(1).max(10000).parse(requestedPage);
  const pageSize = z.number().int().min(1).max(50).parse(requestedPageSize);
  return scoped(pool, scope, async client => {
    const canWrite = await requireActiveReadMembership(client, scope);
    const context = await currentPlanContext(client, scope, workOrderId);
    const state = getPlanState(context);
    const planRevisionId = context.planRevisionId;
    const activityAudience = await resolveTaskActivityAudience(client, scope, context);
    if (!state.handoffIsCurrent || !planRevisionId || !activityAudience) {
      throw new ApiError(403, 'TASK_ACTIVITY_READ_REQUIRED', 'Task updates are available to the current Supervisor, assigned Team Lead and Head of Service Centre.');
    }
    const supervisorPlacementId = context.supervisorPlacementId;

    const currentTasks = `
      SELECT task.id AS task_id,'T'||lpad(task.ordinal::text,2,'0') AS task_reference,task.title AS task_title,
        assignment.assignment_revision AS current_assignment_revision,assignee.display_name AS current_assignee_name
      FROM public.work_order_work_plan_revision_tasks planned
      JOIN public.tasks task ON task.organisation_id=planned.organisation_id AND task.site_id=planned.site_id
        AND task.work_order_id=planned.work_order_id AND task.id=planned.task_id
      JOIN LATERAL (
        SELECT revision.assignee_user_id,revision.assignee_placement_id,revision.assignment_revision
        FROM public.work_order_task_assignment_revisions revision
        WHERE revision.organisation_id=planned.organisation_id AND revision.site_id=planned.site_id
          AND revision.work_order_id=planned.work_order_id
          AND revision.work_plan_revision_id=planned.work_plan_revision_id AND revision.task_id=planned.task_id
        ORDER BY revision.assignment_revision DESC,revision.id DESC LIMIT 1
      ) assignment ON true
      JOIN public.staff_role_placements placement ON placement.organisation_id=planned.organisation_id
        AND placement.site_id=planned.site_id AND placement.id=assignment.assignee_placement_id
        AND placement.staff_user_id=assignment.assignee_user_id
        AND placement.role_code='technician-engineer-trainee' AND placement.state='active'
        AND placement.reports_to_placement_id=$5
      JOIN public.staff_users assignee ON assignee.id=assignment.assignee_user_id AND assignee.active
      JOIN public.memberships membership ON membership.user_id=assignee.id AND membership.site_id=planned.site_id
        AND membership.active AND membership.can_write
      WHERE planned.organisation_id=$1 AND planned.site_id=$2 AND planned.work_order_id=$3
        AND planned.work_plan_revision_id=$4
    `;
    const totalResult = await client.query(`SELECT count(*)::int AS total
      FROM public.work_order_task_activity activity
      JOIN (${currentTasks}) current_task ON current_task.task_id=activity.task_id
      WHERE activity.organisation_id=$1 AND activity.site_id=$2 AND activity.work_order_id=$3`,
    [scope.organisationId, scope.siteId, workOrderId, planRevisionId, supervisorPlacementId]);
    const totalItems = z.object({ total: z.number().int().nonnegative() }).parse(totalResult.rows[0]).total;
    const totalPages = Math.ceil(totalItems / pageSize);
    const effectivePage = Math.min(page, Math.max(totalPages, 1));
    const result = await client.query(`SELECT activity.id,activity.assignment_revision AS "assignmentRevision",
        activity.entry_type AS "entryType",activity.progress_state AS "progressState",activity.request_type AS "requestType",
        activity.completion_declaration AS "completionDeclaration",activity.declaration_work_entry_ids AS "declarationWorkEntryIds",
        activity.response_to_activity_id AS "responseToActivityId",
        parent_actor.display_name AS "responseToActorName",parent.note AS "responseToNote",
        EXISTS (SELECT 1 FROM public.work_order_task_activity reply
          WHERE reply.organisation_id=activity.organisation_id AND reply.site_id=activity.site_id
            AND reply.response_to_activity_id=activity.id AND reply.entry_type='review-response') AS "hasSupervisorResponse",
        activity.note,actor.display_name AS "actorName",activity.created_at AS "createdAt",
        current_task.task_id AS "taskId",current_task.task_reference AS "taskReference",
        current_task.task_title AS "taskTitle",current_task.current_assignee_name AS "currentAssigneeName",
        current_task.current_assignment_revision AS "currentAssignmentRevision"
      FROM public.work_order_task_activity activity
      JOIN (${currentTasks}) current_task ON current_task.task_id=activity.task_id
      JOIN public.staff_users actor ON actor.id=activity.actor_user_id
      LEFT JOIN public.work_order_task_activity parent ON parent.organisation_id=activity.organisation_id
        AND parent.site_id=activity.site_id AND parent.work_order_id=activity.work_order_id
        AND parent.task_id=activity.task_id AND parent.id=activity.response_to_activity_id
      LEFT JOIN public.staff_users parent_actor ON parent_actor.id=parent.actor_user_id
      WHERE activity.organisation_id=$1 AND activity.site_id=$2 AND activity.work_order_id=$3
      ORDER BY activity.created_at DESC,activity.id DESC LIMIT $6 OFFSET $7`,
    [scope.organisationId, scope.siteId, workOrderId, planRevisionId, supervisorPlacementId,
      pageSize, (effectivePage - 1) * pageSize]);
    const responseGrant = await client.query("SELECT public.lock_work_order_authority_grant('work-order.task.review-response') AS grant");
    const canRespond = canWrite && Boolean(responseGrant.rows[0]?.grant);
    const projection = supervisorTaskActivityPageSchema.parse({
      workOrderId, planRevisionId, canRespond,
      responseBlockReason: canRespond ? null : canWrite ? 'authority-required' : 'read-only',
      items: result.rows,
      pagination: { page: effectivePage, pageSize, totalItems, totalPages },
    });
    await recordSensitiveRead(client, scope, 'work-order-task-activity-read-prepared', Math.min(projection.items.length, 100), requestId);
    return projection;
  });
}

export async function recordMyTaskActivity(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  taskId: string,
  body: z.infer<typeof taskActivityInputSchema>,
) {
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: body.completionDeclaration ? 'work-order.task.completion-declaration' : `work-order.task.${body.entryType}`,
    targetAggregateId: taskId,
    payload: { workOrderId, taskId, ...body },
    responseSchema: taskActivityResultSchema,
    lockSerializationRoots: client => lockWorkOrderRoot(client, scope, workOrderId),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit task updates.');
      const current = await currentAssignment(client, scope, workOrderId, taskId);
      if (current.workPlanRevisionId !== body.expectedWorkPlanRevisionId
        || current.assignmentRevision !== body.expectedAssignmentRevision) {
        throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'This assignment changed. Refresh your task list before adding an update.');
      }
      if (body.entryType === 'acknowledgement') {
        const acknowledged = await client.query(`SELECT 1 FROM public.work_order_task_activity
          WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND task_id=$4
            AND assignment_revision=$5 AND entry_type='acknowledgement'`,
        [scope.organisationId, scope.siteId, workOrderId, taskId, current.assignmentRevision]);
        if (acknowledged.rowCount) throw new ApiError(409, 'ALREADY_ACKNOWLEDGED', 'You have already acknowledged this assignment.');
      }
    },
    apply: async client => {
      const current = await currentAssignment(client, scope, workOrderId, taskId);
      if (current.workPlanRevisionId !== body.expectedWorkPlanRevisionId
        || current.assignmentRevision !== body.expectedAssignmentRevision) {
        throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'This assignment changed. Refresh your task list before adding an update.');
      }
      await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
        VALUES($1,$2,$3,'work-order-task') ON CONFLICT(id) DO NOTHING`,
      [taskId, scope.organisationId, scope.siteId]);
      const root = await client.query(`SELECT 1 FROM public.aggregate_roots
        WHERE id=$1 AND organisation_id=$2 AND site_id=$3 AND aggregate_type='work-order-task'`,
      [taskId, scope.organisationId, scope.siteId]);
      if (!root.rowCount) throw new ApiError(409, 'TASK_AGGREGATE_CONFLICT', 'This task activity cannot be recorded because its audit root is inconsistent.');
      let declarationWorkEntryIds: string[] | null = null;
      if (body.completionDeclaration) {
        const entries = await client.query(`SELECT id FROM public.work_order_task_work_entries
          WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND task_id=$4
            AND work_plan_revision_id=$5 AND assignment_revision=$6
          ORDER BY recorded_at,id LIMIT 1001`,
        [scope.organisationId, scope.siteId, workOrderId, taskId, current.workPlanRevisionId, current.assignmentRevision]);
        if (!entries.rowCount) throw new ApiError(409, 'TASK_WORK_ENTRY_REQUIRED', 'Record the actions or checks for this assignment before sending a work declaration.');
        if (entries.rowCount > 1000) throw new ApiError(409, 'TASK_WORK_ENTRY_LIMIT', 'This assignment has too many work entries to bind to one declaration. Ask the Supervisor to review the task history.');
        declarationWorkEntryIds = entries.rows.map(row => uuid.parse(row.id));
      }
      const id = randomUUID();
      const inserted = await client.query(`INSERT INTO public.work_order_task_activity
        (id,organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,
         actor_user_id,actor_placement_id,entry_type,progress_state,request_type,completion_declaration,declaration_work_entry_ids,note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING id,assignment_revision AS "assignmentRevision",entry_type AS "entryType",
          progress_state AS "progressState",request_type AS "requestType",completion_declaration AS "completionDeclaration",
          declaration_work_entry_ids AS "declarationWorkEntryIds",note,created_at AS "createdAt"`,
      [id, scope.organisationId, scope.siteId, workOrderId, taskId, current.workPlanRevisionId,
        current.assignmentRevision, scope.actorId, current.actorPlacementId, body.entryType,
        body.progressState, body.requestType, body.completionDeclaration, declarationWorkEntryIds, body.note]);
      const name = await client.query('SELECT display_name AS "actorName" FROM public.staff_users WHERE id=$1 AND active', [scope.actorId]);
      if (!name.rowCount) notFound();
      const item = activityItem.parse({ ...inserted.rows[0], ...name.rows[0], responseToActivityId: null,
        responseToActorName: null, responseToNote: null, hasSupervisorResponse: false });
      const sequence = await client.query(`SELECT count(*)::int AS version
        FROM public.work_order_task_activity
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND task_id=$4`,
      [scope.organisationId, scope.siteId, workOrderId, taskId]);
      const version = z.object({ version: z.number().int().positive() }).parse(sequence.rows[0]).version;
      return {
        aggregateId: taskId,
        aggregateType: 'work-order-task',
        version,
        previous: null,
        next: item,
        reason: body.completionDeclaration
          ? 'Assigned worker submitted an immutable report for Supervisor review; no task completion, technical authority or vehicle release was recorded.'
          : 'Assigned worker added a coordination update; no technical completion or authority was recorded.',
      };
    },
    project: async (_client, mutation) => taskActivityResultSchema.parse({
      workOrderId, taskId, activity: mutation.next,
    }),
  });
}

export async function respondToSupervisorTaskReviewRequest(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  taskId: string,
  activityId: string,
  body: z.infer<typeof supervisorTaskReviewResponseInputSchema>,
) {
  let responseTaskId: string | null = null;
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'work-order.task.supervisor-review-responded',
    targetAggregateId: taskId,
    payload: { workOrderId, taskId, activityId, ...body },
    responseSchema: taskActivityResultSchema,
    lockSerializationRoots: client => lockWorkOrderRoot(client, scope, workOrderId),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit task review responses.');
      const context = await currentPlanContext(client, scope, workOrderId);
      const state = getPlanState(context);
      const audience = await resolveTaskActivityAudience(client, scope, context);
      if (!state.handoffIsCurrent || !context.planRevisionId || !audience) {
        throw new ApiError(403, 'TASK_REVIEW_RESPONSE_REQUIRED', 'Only the current Supervisor, assigned Team Lead or Head can respond to task review requests.');
      }
      if (context.planRevisionId !== body.expectedWorkPlanRevisionId) {
        throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'The work plan changed. Refresh task activity before responding.');
      }
      const authority = await client.query("SELECT public.lock_work_order_authority_grant('work-order.task.review-response') AS grant");
      if (!authority.rows[0]?.grant) {
        throw new ApiError(403, 'TASK_REVIEW_RESPONSE_AUTHORITY_REQUIRED', 'A current permission is required to respond to task review requests. Ask the responsible manager to review access.');
      }
      const target = await client.query(`SELECT activity.task_id AS "taskId",activity.actor_user_id AS "requesterId",
          activity.assignment_revision AS "assignmentRevision",current.assignment_revision AS "currentAssignmentRevision"
        FROM public.work_order_task_activity activity
        JOIN LATERAL (
          SELECT revision.assignment_revision
          FROM public.work_order_task_assignment_revisions revision
          WHERE revision.organisation_id=activity.organisation_id AND revision.site_id=activity.site_id
            AND revision.work_order_id=activity.work_order_id AND revision.work_plan_revision_id=$4
            AND revision.task_id=activity.task_id
          ORDER BY revision.assignment_revision DESC,revision.id DESC LIMIT 1
        ) current ON true
        WHERE activity.organisation_id=$1 AND activity.site_id=$2 AND activity.work_order_id=$3
          AND activity.id=$5 AND activity.work_plan_revision_id=$4
          AND activity.entry_type='request' AND activity.request_type='supervisor-review'`,
      [scope.organisationId, scope.siteId, workOrderId, body.expectedWorkPlanRevisionId, uuid.parse(activityId)]);
      const parsed = z.object({
        taskId: uuid,
        requesterId: uuid,
        assignmentRevision: z.number().int().positive(),
        currentAssignmentRevision: z.number().int().positive(),
      }).safeParse(target.rows[0]);
      if (!parsed.success) throw new ApiError(404, 'TASK_REVIEW_REQUEST_NOT_FOUND', 'This review request is not available under the current work plan.');
      if (parsed.data.taskId !== uuid.parse(taskId)) {
        throw new ApiError(404, 'TASK_REVIEW_REQUEST_NOT_FOUND', 'This review request is not available under the current work plan.');
      }
      if (parsed.data.assignmentRevision !== parsed.data.currentAssignmentRevision
        || parsed.data.assignmentRevision !== body.expectedAssignmentRevision) {
        throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'This review request belongs to an earlier assignment. Refresh current task activity.');
      }
      if (parsed.data.requesterId === scope.actorId) {
        throw new ApiError(403, 'SELF_REVIEW_NOT_ALLOWED', 'A worker cannot respond to their own request for review.');
      }
      responseTaskId = parsed.data.taskId;
    },
    apply: async client => {
      if (!responseTaskId) throw new Error('Task review response was not authorized against a current assignment.');
      const target = await client.query(`SELECT task_id AS "taskId",work_plan_revision_id AS "workPlanRevisionId",
          assignment_revision AS "assignmentRevision",actor_user_id AS "requesterId"
        FROM public.work_order_task_activity
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND id=$4
          AND entry_type='request' AND request_type='supervisor-review'`,
      [scope.organisationId, scope.siteId, workOrderId, uuid.parse(activityId)]);
      const request = z.object({ taskId: uuid, workPlanRevisionId: uuid, assignmentRevision: z.number().int().positive(), requesterId: uuid })
        .parse(target.rows[0]);
      if (request.taskId !== uuid.parse(taskId) || request.workPlanRevisionId !== body.expectedWorkPlanRevisionId
        || request.assignmentRevision !== body.expectedAssignmentRevision) {
        throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'This review request changed. Refresh current task activity.');
      }
      const prior = await client.query(`SELECT 1 FROM public.work_order_task_activity
        WHERE organisation_id=$1 AND site_id=$2 AND response_to_activity_id=$3 AND entry_type='review-response'`,
      [scope.organisationId, scope.siteId, uuid.parse(activityId)]);
      if (prior.rowCount) throw new ApiError(409, 'TASK_REVIEW_ALREADY_ANSWERED', 'A response is already recorded. Ask the worker to send a new review request if more review is needed.');
      const authority = await client.query("SELECT public.lock_work_order_authority_grant('work-order.task.review-response') AS grant");
      if (!authority.rows[0]?.grant) throw new ApiError(403, 'TASK_REVIEW_RESPONSE_AUTHORITY_REQUIRED', 'A current permission is required to respond to task review requests.');
      const placement = await client.query(`SELECT id FROM public.staff_role_placements
        WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND state='active'
        ORDER BY id LIMIT 1`, [scope.organisationId, scope.siteId, scope.actorId]);
      if (!placement.rowCount) throw new ApiError(403, 'ACTIVE_ROLE_REQUIRED', 'An active staff role is required to respond to task review requests.');
      const id = randomUUID();
      const inserted = await client.query(`INSERT INTO public.work_order_task_activity
        (id,organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,
         actor_user_id,actor_placement_id,entry_type,progress_state,request_type,note,response_to_activity_id,authority_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'review-response',NULL,NULL,$10,$11,$12::jsonb)
        RETURNING id,assignment_revision AS "assignmentRevision",entry_type AS "entryType",
          progress_state AS "progressState",request_type AS "requestType",NULL::jsonb AS "completionDeclaration",
          NULL::uuid[] AS "declarationWorkEntryIds",response_to_activity_id AS "responseToActivityId",
          note,created_at AS "createdAt"`,
      [id, scope.organisationId, scope.siteId, workOrderId, request.taskId, request.workPlanRevisionId,
        request.assignmentRevision, scope.actorId, placement.rows[0]?.id, body.note, uuid.parse(activityId), JSON.stringify(authority.rows[0].grant)]);
      const actor = await client.query('SELECT display_name AS "actorName" FROM public.staff_users WHERE id=$1 AND active', [scope.actorId]);
      if (!actor.rowCount) notFound();
      const response = activityItem.parse({ ...inserted.rows[0], ...actor.rows[0], responseToActorName: null,
        responseToNote: null, hasSupervisorResponse: false });
      const count = await client.query(`SELECT count(*)::int AS version FROM public.work_order_task_activity
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND task_id=$4`,
      [scope.organisationId, scope.siteId, workOrderId, request.taskId]);
      const version = z.object({ version: z.number().int().positive() }).parse(count.rows[0]).version;
      return { aggregateId: request.taskId, aggregateType: 'work-order-task', version, previous: null, next: response,
        reason: 'Supervisor responded to a review request; this response does not sign off or complete work.' };
    },
    project: async (_client, mutation) => taskActivityResultSchema.parse({
      workOrderId, taskId, activity: mutation.next,
    }),
  });
}
