import { z } from 'zod';
import { lockWorkOrderRoot } from './commands.js';
import { createEvidenceIntentInTransaction, createEvidenceIntentSchema, type EvidenceServices } from './evidence.js';
import { ApiError } from './errors.js';
import { scoped, type Database, type Scope, uuid } from './db.js';
import { requireActiveReadMembership } from './sensitive-read-audit.js';
import { currentAssignment } from './work-order-task-activity.js';

export const taskEvidenceIntentInputSchema = createEvidenceIntentSchema
  .pick({ displayName: true, declaredMediaType: true, expectedBytes: true })
  .extend({
    expectedWorkPlanRevisionId: uuid,
    expectedAssignmentRevision: z.number().int().positive(),
  })
  .strict();

type TaskEvidenceIntentInput = z.infer<typeof taskEvidenceIntentInputSchema>;

export async function createMyTaskEvidenceIntent(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  taskId: string,
  input: TaskEvidenceIntentInput,
  services: EvidenceServices,
) {
  return scoped(pool, scope, async client => {
    const canWrite = await requireActiveReadMembership(client, scope);
    if (!canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit task evidence uploads.');

    await lockWorkOrderRoot(client, scope, workOrderId);
    const current = await currentAssignment(client, scope, workOrderId, taskId);
    if (current.workPlanRevisionId !== input.expectedWorkPlanRevisionId
      || current.assignmentRevision !== input.expectedAssignmentRevision) {
      throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'This task assignment changed. Refresh your assigned tasks before uploading evidence.');
    }

    const created = await createEvidenceIntentInTransaction(client, scope, commandId, {
      purpose: 'work-order',
      targetId: workOrderId,
      displayName: input.displayName,
      declaredMediaType: input.declaredMediaType,
      expectedBytes: input.expectedBytes,
    }, services);

    if (created.created) {
      await client.query(
        'SELECT public.bind_work_order_task_evidence_intent($1,$2,$3,$4,$5)',
        [created.intent.id, workOrderId, taskId, current.workPlanRevisionId, current.assignmentRevision],
      );
    } else {
      const bound = await client.query(`SELECT 1 FROM public.work_order_task_evidence_intents
        WHERE organisation_id=$1 AND site_id=$2 AND upload_intent_id=$3 AND work_order_id=$4 AND task_id=$5
          AND work_plan_revision_id=$6 AND assignment_revision=$7 AND created_by=$8`,
      [scope.organisationId, scope.siteId, created.intent.id, workOrderId, taskId,
        current.workPlanRevisionId, current.assignmentRevision, scope.actorId]);
      if (!bound.rowCount) {
        throw new ApiError(409, 'EVIDENCE_INTENT_CONFLICT', 'This upload request is already in use. Start a new task evidence upload.');
      }
    }
    return created.intent;
  });
}
