import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockAdvisoryRoots, lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { ApiError, notFound } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { currentAssignment } from './work-order-task-activity.js';

const startInputSchema = z.object({
  expectedWorkPlanRevisionId: uuid,
  expectedAssignmentRevision: z.number().int().positive(),
}).strict();

const stopInputSchema = z.object({
  expectedStartedAt: z.iso.datetime({ offset: true }),
}).strict();

const laborSessionSchema = z.object({
  id: uuid,
  workOrderId: uuid,
  taskId: uuid,
  workPlanRevisionId: uuid,
  assignmentRevision: z.number().int().positive(),
  startedAt: z.iso.datetime({ offset: true }),
  stoppedAt: z.iso.datetime({ offset: true }).nullable(),
  elapsedSeconds: z.number().int().nonnegative(),
}).strict();

const activeLaborSessionResponseSchema = z.object({
  session: laborSessionSchema.nullable(),
}).strict();

type LaborSession = z.infer<typeof laborSessionSchema>;

function actorLock(scope: Scope) {
  return `task-labor-actor:${scope.organisationId}:${scope.actorId}`;
}

function workOrderLock(scope: Scope, workOrderId: string) {
  return `work-order:${scope.organisationId}:${scope.siteId}:${workOrderId}`;
}

function sessionId(scope: Scope, commandId: string) {
  const bytes = createHash('sha256')
    .update(`${scope.organisationId}:${scope.siteId}:${scope.actorId}:${commandId}`)
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function projectSession(row: {
  id: string; workOrderId: string; taskId: string; workPlanRevisionId: string;
  assignmentRevision: number; startedAt: Date | string; stoppedAt: Date | string | null;
}): LaborSession {
  const startedAt = row.startedAt instanceof Date ? row.startedAt.toISOString() : row.startedAt;
  const stoppedAt = row.stoppedAt instanceof Date ? row.stoppedAt.toISOString() : row.stoppedAt;
  const end = stoppedAt ? Date.parse(stoppedAt) : Date.now();
  return laborSessionSchema.parse({
    ...row,
    startedAt,
    stoppedAt,
    elapsedSeconds: Math.max(0, Math.floor((end - Date.parse(startedAt)) / 1000)),
  });
}

const readSessionQuery = `SELECT id,work_order_id AS "workOrderId",task_id AS "taskId",
    work_plan_revision_id AS "workPlanRevisionId",assignment_revision AS "assignmentRevision",
    started_at AS "startedAt",stopped_at AS "stoppedAt"
  FROM public.work_order_task_labor_sessions`;

export async function readMyActiveTaskLaborSession(
  pool: Database,
  scope: Scope,
  requestId: string,
) {
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    await requireTechnicianRole(client, scope);
    const result = await client.query(`${readSessionQuery}
      WHERE organisation_id=$1 AND site_id=$2 AND actor_user_id=$3 AND stopped_at IS NULL`,
    [scope.organisationId, scope.siteId, scope.actorId]);
    await recordSensitiveRead(client, scope, 'work-order-task-labor-read-prepared', result.rowCount ?? 0, requestId);
    return activeLaborSessionResponseSchema.parse({
      session: result.rows[0] ? projectSession(result.rows[0]) : null,
    });
  });
}

export async function startMyTaskLaborSession(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  taskId: string,
  raw: unknown,
) {
  const input = startInputSchema.parse(raw);
  const id = sessionId(scope, commandId);
  let startedAt: string | null = null;
  try {
    return await runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'work-order.task-labor.started',
    targetAggregateId: id,
    payload: { workOrderId, taskId, ...input },
    responseSchema: laborSessionSchema,
    lockSerializationRoots: async client => {
      await lockAdvisoryRoots(client, [actorLock(scope), workOrderLock(scope, workOrderId)]);
      await lockWorkOrderRoot(client, scope, workOrderId);
    },
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit time recording.');
      const current = await currentAssignment(client, scope, workOrderId, taskId);
      if (current.workPlanRevisionId !== input.expectedWorkPlanRevisionId
        || current.assignmentRevision !== input.expectedAssignmentRevision) {
        throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'This assignment changed. Refresh your task list before starting time.');
      }
    },
    apply: async client => {
      const active = await client.query(`SELECT id FROM public.work_order_task_labor_sessions
        WHERE organisation_id=$1 AND site_id=$2 AND actor_user_id=$3 AND stopped_at IS NULL FOR UPDATE`,
      [scope.organisationId, scope.siteId, scope.actorId]);
      if (active.rowCount) {
        throw new ApiError(409, 'TASK_LABOR_ALREADY_ACTIVE', 'Finish your current task time session before starting another.');
      }
      const current = await currentAssignment(client, scope, workOrderId, taskId);
      if (current.workPlanRevisionId !== input.expectedWorkPlanRevisionId
        || current.assignmentRevision !== input.expectedAssignmentRevision) {
        throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'This assignment changed. Refresh your task list before starting time.');
      }
      await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
        VALUES($1,$2,$3,'work-order-task-labor-session')`, [id, scope.organisationId, scope.siteId]);
      const inserted = await client.query(`INSERT INTO public.work_order_task_labor_sessions
        (id,organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,actor_user_id,actor_placement_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING started_at AS "startedAt"`,
      [id, scope.organisationId, scope.siteId, workOrderId, taskId, current.workPlanRevisionId,
        current.assignmentRevision, scope.actorId, current.actorPlacementId]);
      startedAt = (inserted.rows[0]?.startedAt as Date).toISOString();
      return {
        aggregateId: id,
        aggregateType: 'work-order-task-labor-session',
        version: 1,
        previous: { exists: false },
        next: { workOrderId, taskId, workPlanRevisionId: current.workPlanRevisionId,
          assignmentRevision: current.assignmentRevision, startedAt },
        reason: 'Assigned technician started a server-timed task labour session.',
      };
    },
    project: async client => {
      const result = await client.query(`${readSessionQuery}
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3`, [scope.organisationId, scope.siteId, id]);
      if (!result.rowCount) notFound();
      return projectSession(result.rows[0]);
    },
    });
  } catch (error) {
    if (error !== null && typeof error === 'object'
      && 'code' in error && error.code === '23505'
      && 'constraint' in error && error.constraint === 'work_order_task_labor_one_open_per_actor_org') {
      throw new ApiError(409, 'TASK_LABOR_ALREADY_ACTIVE', 'You already have an active task time record in this organisation. Switch to its site and stop it before starting another.');
    }
    throw error;
  }
}

export async function stopMyTaskLaborSession(
  pool: Database,
  scope: Scope,
  commandId: string,
  id: string,
  raw: unknown,
) {
  const input = stopInputSchema.parse(raw);
  let workOrderId = '';
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'work-order.task-labor.stopped',
    targetAggregateId: id,
    payload: { sessionId: id, ...input },
    responseSchema: laborSessionSchema,
    lockSerializationRoots: async client => {
      await lockAdvisoryRoots(client, [actorLock(scope)]);
      const found = await client.query(`SELECT work_order_id AS "workOrderId" FROM public.work_order_task_labor_sessions
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND actor_user_id=$4 FOR UPDATE`,
      [scope.organisationId, scope.siteId, id, scope.actorId]);
      if (!found.rowCount) notFound();
      workOrderId = uuid.parse(found.rows[0]?.workOrderId);
      await lockWorkOrderRoot(client, scope, workOrderId);
    },
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit time recording.');
      const owner = await client.query(`SELECT started_at AS "startedAt" FROM public.work_order_task_labor_sessions
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND actor_user_id=$4`,
      [scope.organisationId, scope.siteId, id, scope.actorId]);
      if (!owner.rowCount) notFound();
      const startedAt = (owner.rows[0]?.startedAt as Date).toISOString();
      if (startedAt !== input.expectedStartedAt) {
        throw new ApiError(409, 'STALE_TASK_LABOR_SESSION', 'This time session changed. Refresh it before stopping.');
      }
    },
    apply: async client => {
      const updated = await client.query(`UPDATE public.work_order_task_labor_sessions
        SET stopped_at=clock_timestamp()
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND actor_user_id=$4 AND stopped_at IS NULL
        RETURNING started_at AS "startedAt",stopped_at AS "stoppedAt"`,
      [scope.organisationId, scope.siteId, id, scope.actorId]);
      if (!updated.rowCount) throw new ApiError(409, 'TASK_LABOR_SESSION_ALREADY_STOPPED', 'This time session is already stopped. Refresh your task list.');
      const started = updated.rows[0]?.startedAt as Date;
      const stopped = updated.rows[0]?.stoppedAt as Date;
      return {
        aggregateId: id,
        aggregateType: 'work-order-task-labor-session',
        version: 2,
        previous: { startedAt: started.toISOString(), stoppedAt: null },
        next: { startedAt: started.toISOString(), stoppedAt: stopped.toISOString() },
        reason: 'Assigned technician stopped a server-timed task labour session.',
      };
    },
    project: async client => {
      const result = await client.query(`${readSessionQuery}
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3`, [scope.organisationId, scope.siteId, id]);
      if (!result.rowCount) notFound();
      return projectSession(result.rows[0]);
    },
  });
}

async function requireTechnicianRole(client: PoolClient, scope: Scope) {
  const result = await client.query(`SELECT 1 FROM public.staff_role_placements
    WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3
      AND role_code='technician-engineer-trainee' AND state='active' LIMIT 1`,
  [scope.organisationId, scope.siteId, scope.actorId]);
  if (!result.rowCount) throw new ApiError(403, 'TECHNICIAN_ROLE_REQUIRED', 'Task time records are available to assigned Technicians, Engineers and Trainees.');
}
