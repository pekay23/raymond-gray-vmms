import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { type Database, type Scope, scoped, uuid } from './db.js';
import { ApiError } from './errors.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { assertChecklistSource } from './work-order-checklist-outcomes.js';
import { currentPlanContext, getPlanState, resolveTaskActivityAudience } from './work-order-task-allocations.js';

const pageSchema = z.object({ page: z.number().int().min(1).max(10_000), pageSize: z.number().int().min(1).max(50) }).strict();
const dispositionSchema = z.enum(['record-confirmed', 'returned-for-correction']);

const reviewItemSchema = z.object({
  workOrderId: uuid,
  bookingReference: z.string(),
  vehicleLabel: z.string(),
  registration: z.string().nullable(),
  taskId: uuid,
  taskReference: z.string(),
  taskTitle: z.string(),
  checklistId: uuid,
  checklistVersion: z.number().int().positive(),
  itemId: uuid,
  itemCode: z.string(),
  itemLabel: z.string(),
  outcomeRevisionId: uuid,
  outcomeRevision: z.number().int().positive(),
  result: z.enum(['completed', 'failed', 'not-checked', 'not-completed', 'blocked', 'not-applicable']),
  reason: z.string().nullable(),
  comments: z.string().nullable(),
  measurement: z.record(z.string(), z.unknown()).nullable(),
  evidence: z.array(z.object({ displayName: z.string(), mediaType: z.string() }).strict()),
  evidenceRequired: z.boolean(),
  evidenceCurrent: z.boolean(),
  hasOpenHold: z.boolean(),
  technicianName: z.string(),
  recordedAt: z.union([z.date(), z.iso.datetime({ offset: true })]).transform(value => value instanceof Date ? value.toISOString() : value),
  workPlanRevisionId: uuid,
  assignmentRevision: z.number().int().positive(),
}).strict();

export const checklistReviewQueueSchema = z.object({
  canReview: z.boolean(),
  blockReason: z.enum(['authority-required']).nullable(),
  items: z.array(reviewItemSchema),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().positive(), totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative() }).strict(),
}).strict();

export const checklistItemReviewInputSchema = z.object({
  expectedChecklistVersion: z.number().int().positive(),
  expectedWorkPlanRevisionId: uuid,
  expectedAssignmentRevision: z.number().int().positive(),
  outcomeRevisionId: uuid,
  disposition: dispositionSchema,
  reason: z.string().trim().min(1).max(1200),
}).strict();

export const checklistItemReviewResultSchema = z.object({
  reviewId: uuid,
  workOrderId: uuid,
  checklistId: uuid,
  itemId: uuid,
  outcomeRevisionId: uuid,
  disposition: dispositionSchema,
  checklistVersion: z.number().int().positive(),
  reviewedAt: z.iso.datetime({ offset: true }),
}).strict();

type ReviewInput = z.infer<typeof checklistItemReviewInputSchema>;

async function activeReviewer(client: PoolClient, scope: Scope, workOrderId: string) {
  const context = await currentPlanContext(client, scope, workOrderId);
  const planState = getPlanState(context);
  if (!planState.handoffIsCurrent || !context.planRevisionId) {
    throw new ApiError(409, 'CURRENT_WORK_PLAN_REQUIRED', 'A current handed-off work plan is required before checklist records can be reviewed.');
  }
  const audience = await resolveTaskActivityAudience(client, scope, context);
  if (!audience) throw new ApiError(403, 'CHECKLIST_REVIEW_ROLE_REQUIRED', 'Checklist record review is available to the current Supervisor, assigned Team Lead, or Head of Service Centre.');
  const placementId = audience === 'supervisor' ? context.supervisorPlacementId
    : audience === 'team-lead' ? context.leadPlacementId
      : (await client.query(`SELECT id FROM public.staff_role_placements
          WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3
            AND role_code='head-service-centre' AND state='active'
          ORDER BY id LIMIT 1`, [scope.organisationId, scope.siteId, scope.actorId])).rows[0]?.id;
  if (!placementId) throw new ApiError(403, 'CHECKLIST_REVIEW_ROLE_REQUIRED', 'Your current service-centre role placement could not be confirmed.');
  const grantResult = await client.query(`SELECT public.lock_work_order_authority_grant('work-order.checklist.item-review') AS snapshot`);
  return { context, audience, placementId: uuid.parse(placementId), grant: grantResult.rows[0]?.snapshot as Record<string, unknown> | null };
}

const queueSql = `
  WITH current_handoffs AS (
    SELECT work.id AS work_order_id,work.reference AS booking_reference,work.version AS work_order_version,
      vehicle.make||' '||vehicle.model AS vehicle_label,vehicle.registration,
      lead.lead_user_id,plan.id AS work_plan_revision_id,supervisor_placement.id AS supervisor_placement_id
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
        AND handoff.work_order_id=work.id AND handoff.lead_assignment_id=lead.id AND handoff.work_plan_revision_id=plan.id
      ORDER BY handoff.created_at DESC,handoff.id DESC LIMIT 1
    ) handoff ON true
    JOIN public.staff_role_placements supervisor_placement
      ON supervisor_placement.organisation_id=work.organisation_id AND supervisor_placement.site_id=work.site_id
      AND supervisor_placement.staff_user_id=handoff.supervisor_user_id AND supervisor_placement.role_code='supervisor'
      AND supervisor_placement.state='active'
    WHERE work.organisation_id=$1 AND work.site_id=$2
      AND handoff.work_order_version<=work.version
      AND (plan.created_work_order_version=work.version OR handoff.work_order_version<work.version)
      AND NOT EXISTS (
        SELECT 1 FROM public.domain_events event
        WHERE event.organisation_id=work.organisation_id AND event.site_id=work.site_id
          AND event.aggregate_id=work.id AND event.aggregate_version>handoff.work_order_version
          AND event.event_type<>'work-order.tasks-assigned'
      )
      AND ($4::boolean OR lead.lead_user_id=$3 OR handoff.supervisor_user_id=$3)
  ), current_assignments AS (
    SELECT work.*,planned.task_id,task.ordinal,task.title,assignment.assignment_revision,
      assignment.assignee_user_id,assignment.assignee_placement_id,assignee.display_name AS technician_name,
      assignee_placement.reports_to_placement_id
    FROM current_handoffs work
    JOIN public.work_order_work_plan_revision_tasks planned
      ON planned.organisation_id=$1 AND planned.site_id=$2 AND planned.work_order_id=work.work_order_id
        AND planned.work_plan_revision_id=work.work_plan_revision_id
    JOIN public.tasks task ON task.organisation_id=planned.organisation_id AND task.site_id=planned.site_id
      AND task.work_order_id=planned.work_order_id AND task.id=planned.task_id
    JOIN LATERAL (
      SELECT revision.assignment_revision,revision.assignee_user_id,revision.assignee_placement_id
      FROM public.work_order_task_assignment_revisions revision
      WHERE revision.organisation_id=planned.organisation_id AND revision.site_id=planned.site_id
        AND revision.work_order_id=planned.work_order_id AND revision.work_plan_revision_id=planned.work_plan_revision_id
        AND revision.task_id=planned.task_id
      ORDER BY revision.assignment_revision DESC,revision.id DESC LIMIT 1
    ) assignment ON true
    JOIN public.staff_role_placements assignee_placement
      ON assignee_placement.organisation_id=planned.organisation_id AND assignee_placement.site_id=planned.site_id
      AND assignee_placement.id=assignment.assignee_placement_id AND assignee_placement.staff_user_id=assignment.assignee_user_id
      AND assignee_placement.role_code='technician-engineer-trainee' AND assignee_placement.state='active'
    JOIN public.staff_users assignee ON assignee.id=assignment.assignee_user_id AND assignee.active
    JOIN public.memberships membership ON membership.user_id=assignee.id AND membership.site_id=planned.site_id
      AND membership.active AND membership.can_write
    WHERE ($4::boolean OR work.lead_user_id=$3 OR (work.supervisor_placement_id IS NOT NULL
      AND assignee_placement.reports_to_placement_id=work.supervisor_placement_id))
  ), latest_outcomes AS (
    SELECT DISTINCT ON (revision.organisation_id,revision.site_id,revision.checklist_item_id)
      revision.*
    FROM public.work_order_checklist_item_revisions revision
    WHERE revision.organisation_id=$1 AND revision.site_id=$2
      AND NOT EXISTS (SELECT 1 FROM public.work_order_checklist_item_revisions newer
        WHERE newer.organisation_id=revision.organisation_id AND newer.site_id=revision.site_id
          AND newer.checklist_item_id=revision.checklist_item_id AND newer.supersedes_revision_id=revision.id)
    ORDER BY revision.organisation_id,revision.site_id,revision.checklist_item_id,revision.revision DESC,revision.id DESC
  ), pending AS (
    SELECT assignment.work_order_id AS "workOrderId",assignment.booking_reference AS "bookingReference",
      assignment.vehicle_label AS "vehicleLabel",assignment.registration,assignment.task_id AS "taskId",
      'T'||lpad(assignment.ordinal::text,2,'0') AS "taskReference",assignment.title AS "taskTitle",
      checklist.id AS "checklistId",checklist.version AS "checklistVersion",item.id AS "itemId",item.item_code AS "itemCode",
      coalesce(item.definition_snapshot->>'label',item.item_code) AS "itemLabel",outcome.id AS "outcomeRevisionId",
      outcome.revision AS "outcomeRevision",outcome.result,outcome.reason,outcome.comments,outcome.measurement,
      coalesce(evidence.files,'[]'::jsonb) AS evidence,
      coalesce((item.definition_snapshot->>'evidenceRequired')::boolean,false) AS "evidenceRequired",
      coalesce(evidence.current_count,0)>0 AS "evidenceCurrent",
      EXISTS(SELECT 1 FROM public.holds hold WHERE hold.organisation_id=$1 AND hold.site_id=$2
        AND hold.work_order_id=assignment.work_order_id
        AND NOT EXISTS (SELECT 1 FROM public.work_order_hold_resolutions resolved
          WHERE resolved.organisation_id=hold.organisation_id AND resolved.site_id=hold.site_id
            AND resolved.work_order_id=hold.work_order_id AND resolved.hold_id=hold.id)) AS "hasOpenHold",
      assignment.technician_name AS "technicianName",outcome.created_at AS "recordedAt",
      assignment.work_plan_revision_id AS "workPlanRevisionId",assignment.assignment_revision AS "assignmentRevision"
    FROM current_assignments assignment
    JOIN public.work_order_checklists checklist ON checklist.organisation_id=$1 AND checklist.site_id=$2
      AND checklist.work_order_id=assignment.work_order_id AND checklist.kind='routine-maintenance' AND checklist.state='in-progress'
    JOIN public.work_order_checklist_items item ON item.organisation_id=checklist.organisation_id AND item.site_id=checklist.site_id
      AND item.work_order_id=checklist.work_order_id AND item.checklist_id=checklist.id
    JOIN latest_outcomes outcome ON outcome.organisation_id=$1 AND outcome.site_id=$2
      AND outcome.work_order_id=assignment.work_order_id AND outcome.checklist_id=checklist.id AND outcome.checklist_item_id=item.id
      AND outcome.task_id=assignment.task_id AND outcome.work_plan_revision_id=assignment.work_plan_revision_id
      AND outcome.assignment_revision=assignment.assignment_revision AND outcome.assignee_user_id=assignment.assignee_user_id
      AND outcome.assignee_placement_id=assignment.assignee_placement_id AND outcome.actor_id<>$3
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('displayName',evidence.display_name,'mediaType',evidence.media_type)
        ORDER BY evidence.display_name,evidence.id) FILTER (WHERE evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
          AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256) AS files,
        count(*) FILTER (WHERE evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
          AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256)::int AS current_count
      FROM public.work_order_checklist_item_revision_evidence link
      JOIN public.evidence_records evidence ON evidence.organisation_id=link.organisation_id
        AND evidence.site_id=link.site_id AND evidence.id=link.evidence_id
      LEFT JOIN LATERAL (SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
        WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
          AND attempt.evidence_id=evidence.id ORDER BY attempt.attempt_no DESC LIMIT 1) latest ON true
        WHERE link.organisation_id=$1 AND link.site_id=$2 AND link.work_order_id=assignment.work_order_id
          AND link.outcome_revision_id=outcome.id
    ) evidence ON true
    WHERE NOT EXISTS (SELECT 1 FROM public.work_order_checklist_item_reviews review
      WHERE review.organisation_id=$1 AND review.site_id=$2 AND review.outcome_revision_id=outcome.id)
      AND ($4::boolean OR assignment.lead_user_id=$3 OR assignment.reports_to_placement_id=assignment.supervisor_placement_id)
  )
`;

export async function readChecklistReviewQueue(
  pool: Database, scope: Scope, requestId: string, requestedPage = 1, requestedPageSize = 10,
) {
  const { page, pageSize } = pageSchema.parse({ page: requestedPage, pageSize: requestedPageSize });
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const roles = await client.query(`SELECT bool_or(role_code='head-service-centre') AS is_head,
        bool_or(role_code IN ('ev-team-lead','ice-team-lead')) AS is_lead,
        bool_or(role_code='supervisor') AS is_supervisor
      FROM public.staff_role_placements WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND state='active'`,
    [scope.organisationId, scope.siteId, scope.actorId]);
    const role = z.object({ is_head: z.boolean().nullable(), is_lead: z.boolean().nullable(), is_supervisor: z.boolean().nullable() }).parse(roles.rows[0]);
    if (!role.is_head && !role.is_lead && !role.is_supervisor) {
      throw new ApiError(403, 'CHECKLIST_REVIEW_ROLE_REQUIRED', 'Checklist record review is available to the current Supervisor, assigned Team Lead, or Head of Service Centre.');
    }
    const grant = await client.query(`SELECT public.lock_work_order_authority_grant('work-order.checklist.item-review') AS snapshot`);
    const values = [scope.organisationId, scope.siteId, scope.actorId, Boolean(role.is_head)];
    if (!grant.rows[0]?.snapshot) {
      await recordSensitiveRead(client, scope, 'work-order-checklist-review-queue-read-prepared', 0, requestId);
      return checklistReviewQueueSchema.parse({ canReview: false, blockReason: 'authority-required', items: [], pagination: { page: 1, pageSize, totalItems: 0, totalPages: 0 } });
    }
    const totalResult = await client.query(`${queueSql} SELECT count(*)::int AS total FROM pending`, values);
    const totalItems = z.number().int().nonnegative().parse(totalResult.rows[0]?.total);
    const totalPages = Math.ceil(totalItems / pageSize);
    const effectivePage = Math.min(page, Math.max(totalPages, 1));
    const result = await client.query(`${queueSql} SELECT * FROM pending
      ORDER BY "recordedAt" ASC,"workOrderId" ASC,"itemCode" ASC LIMIT $5 OFFSET $6`,
    [...values, pageSize, (effectivePage - 1) * pageSize]);
    const projection = checklistReviewQueueSchema.parse({ canReview: true, blockReason: null, items: result.rows,
      pagination: { page: effectivePage, pageSize, totalItems, totalPages } });
    await recordSensitiveRead(client, scope, 'work-order-checklist-review-queue-read-prepared', projection.items.length, requestId);
    return projection;
  });
}

async function currentOutcome(client: PoolClient, scope: Scope, workOrderId: string, taskId: string, checklistId: string, itemId: string, input: ReviewInput, checkVersion = true) {
  const source = await assertChecklistSource(client, scope, workOrderId, checklistId, itemId);
  if (checkVersion && source.version !== input.expectedChecklistVersion) {
    throw new ApiError(409, 'STALE_CHECKLIST_VERSION', 'This checklist changed. Refresh the review queue before deciding.');
  }
  const found = await client.query(`SELECT outcome.id,outcome.revision,outcome.actor_id AS "actorId",
      outcome.result,outcome.task_id AS "taskId",outcome.work_plan_revision_id AS "workPlanRevisionId",
      outcome.assignment_revision AS "assignmentRevision",outcome.assignee_user_id AS "assigneeUserId",
      outcome.assignee_placement_id AS "assigneePlacementId",outcome.authority_snapshot AS "authoritySnapshot",
      outcome.qualification_snapshots AS "qualificationSnapshots",outcome.created_at AS "recordedAt",
      coalesce(item.definition_snapshot->>'evidenceRequired','false')::boolean AS "evidenceRequired"
    FROM public.work_order_checklist_item_revisions outcome
    JOIN public.work_order_checklist_items item ON item.organisation_id=outcome.organisation_id
      AND item.site_id=outcome.site_id AND item.work_order_id=outcome.work_order_id
      AND item.checklist_id=outcome.checklist_id AND item.id=outcome.checklist_item_id
    WHERE outcome.organisation_id=$1 AND outcome.site_id=$2 AND outcome.work_order_id=$3
      AND outcome.checklist_id=$4 AND outcome.checklist_item_id=$5 AND outcome.id=$6 AND outcome.task_id=$7
      AND NOT EXISTS (SELECT 1 FROM public.work_order_checklist_item_revisions newer
        WHERE newer.organisation_id=outcome.organisation_id AND newer.site_id=outcome.site_id
          AND newer.checklist_item_id=outcome.checklist_item_id AND newer.supersedes_revision_id=outcome.id)
      `, [scope.organisationId, scope.siteId, workOrderId, checklistId, itemId, input.outcomeRevisionId, taskId]);
  const row = found.rows[0];
  if (!row) throw new ApiError(409, 'CHECKLIST_OUTCOME_CHANGED', 'This outcome is no longer the current record. Refresh the review queue.');
  const data = z.object({ id: uuid, revision: z.number().int().positive(), actorId: uuid, result: z.enum(['completed','failed','not-checked','not-completed','blocked','not-applicable']),
    taskId: uuid, workPlanRevisionId: uuid, assignmentRevision: z.number().int().positive(), assigneeUserId: uuid, assigneePlacementId: uuid,
    authoritySnapshot: z.record(z.string(), z.unknown()), qualificationSnapshots: z.array(z.unknown()), recordedAt: z.union([z.date(),z.iso.datetime({offset:true})]), evidenceRequired: z.boolean() }).parse(row);
  return { source, outcome: data };
}

async function assertCurrentTaskAssignment(client: PoolClient, scope: Scope, workOrderId: string, taskId: string, input: ReviewInput, outcome: Awaited<ReturnType<typeof currentOutcome>>['outcome']) {
  const result = await client.query(`SELECT current.assignment_revision AS "assignmentRevision",
      current.assignee_user_id AS "assigneeUserId",current.assignee_placement_id AS "assigneePlacementId",
      placement.reports_to_placement_id AS "reportsToPlacementId",placement.state AS "placementState"
    FROM public.work_order_task_assignment_revisions current
    JOIN public.staff_role_placements placement ON placement.organisation_id=current.organisation_id
      AND placement.site_id=current.site_id AND placement.id=current.assignee_placement_id
      AND placement.staff_user_id=current.assignee_user_id
    WHERE current.organisation_id=$1 AND current.site_id=$2 AND current.work_order_id=$3
      AND current.work_plan_revision_id=$4 AND current.task_id=$5
      AND current.assignment_revision=(SELECT max(latest.assignment_revision)
        FROM public.work_order_task_assignment_revisions latest WHERE latest.organisation_id=current.organisation_id
          AND latest.site_id=current.site_id AND latest.work_order_id=current.work_order_id
          AND latest.work_plan_revision_id=current.work_plan_revision_id AND latest.task_id=current.task_id)
    `, [scope.organisationId, scope.siteId, workOrderId, input.expectedWorkPlanRevisionId, taskId]);
  const assignment = result.rows[0];
  if (!assignment || outcome.workPlanRevisionId !== input.expectedWorkPlanRevisionId
    || outcome.assignmentRevision !== input.expectedAssignmentRevision
    || Number(assignment.assignmentRevision) !== input.expectedAssignmentRevision
    || assignment.assigneeUserId !== outcome.assigneeUserId || assignment.assigneePlacementId !== outcome.assigneePlacementId
    || assignment.placementState !== 'active') {
    throw new ApiError(409, 'STALE_TASK_ASSIGNMENT', 'The task assignment changed after this outcome was recorded. Refresh the review queue.');
  }
  return { ...assignment, assignmentRevision: Number(assignment.assignmentRevision) };
}

async function assertReviewEvidence(client: PoolClient, scope: Scope, workOrderId: string, outcomeRevisionId: string, required: boolean) {
  const result = await client.query(`SELECT count(*)::int AS accepted FROM public.work_order_checklist_item_revision_evidence link
    JOIN public.evidence_records evidence ON evidence.organisation_id=link.organisation_id
      AND evidence.site_id=link.site_id AND evidence.id=link.evidence_id
    JOIN LATERAL (SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
      WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
        AND attempt.evidence_id=evidence.id ORDER BY attempt.attempt_no DESC LIMIT 1) latest ON true
    WHERE link.organisation_id=$1 AND link.site_id=$2 AND link.work_order_id=$3 AND link.outcome_revision_id=$4
      AND evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
      AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256`,
  [scope.organisationId, scope.siteId, workOrderId, outcomeRevisionId]);
  const accepted = z.number().int().nonnegative().parse(result.rows[0]?.accepted);
  if (required && accepted === 0) throw new ApiError(409, 'CHECKLIST_REVIEW_EVIDENCE_REQUIRED', 'This record needs current accepted evidence before it can be confirmed. Return it for correction or attach the required evidence first.');
}

async function hasOpenHold(client: PoolClient, scope: Scope, workOrderId: string) {
  const result = await client.query(`SELECT EXISTS(SELECT 1 FROM public.holds hold
    WHERE hold.organisation_id=$1 AND hold.site_id=$2 AND hold.work_order_id=$3
      AND NOT EXISTS (SELECT 1 FROM public.work_order_hold_resolutions resolved
        WHERE resolved.organisation_id=hold.organisation_id AND resolved.site_id=hold.site_id
          AND resolved.work_order_id=hold.work_order_id AND resolved.hold_id=hold.id)) AS blocked`,
  [scope.organisationId, scope.siteId, workOrderId]);
  return z.object({ blocked: z.boolean() }).parse(result.rows[0]).blocked;
}

export async function reviewChecklistOutcome(
  pool: Database, scope: Scope, commandId: string, workOrderId: string, taskId: string, checklistId: string, itemId: string, input: ReviewInput,
) {
  const reviewId = randomUUID();
  let reviewedAt = '';
  return runStaffCommand(pool, {
    scope, commandId, operation: 'work-order.checklist.item-review-recorded', targetAggregateId: itemId,
    payload: { workOrderId, taskId, checklistId, itemId, ...input }, responseSchema: checklistItemReviewResultSchema,
    lockSerializationRoots: client => lockWorkOrderRoot(client, scope, workOrderId),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit checklist record review.');
      const reviewer = await activeReviewer(client, scope, workOrderId);
      if (!reviewer.grant) throw new ApiError(403, 'CHECKLIST_REVIEW_AUTHORITY_REQUIRED', 'A current checklist-record review grant is required.');
      const { outcome } = await currentOutcome(client, scope, workOrderId, taskId, checklistId, itemId, input, false);
      if (outcome.actorId === scope.actorId) throw new ApiError(403, 'INDEPENDENT_REVIEW_REQUIRED', 'You cannot review an outcome that you recorded.');
      if (reviewer.context.planRevisionId !== input.expectedWorkPlanRevisionId) throw new ApiError(409, 'STALE_WORK_PLAN', 'The work plan changed. Refresh the review queue.');
      const assignment = await assertCurrentTaskAssignment(client, scope, workOrderId, taskId, input, outcome);
      if (reviewer.audience === 'supervisor' && assignment.reportsToPlacementId !== reviewer.context.supervisorPlacementId) {
        throw new ApiError(403, 'DIRECT_REPORT_REVIEW_REQUIRED', 'A Supervisor can review only checklist records from a current direct report.');
      }
      if (input.disposition === 'record-confirmed') {
        if (await hasOpenHold(client, scope, workOrderId)) throw new ApiError(409, 'OPEN_SAFETY_HOLD', 'Resolve the current safety hold before confirming this record. You may return it for correction.');
        await assertReviewEvidence(client, scope, workOrderId, outcome.id, outcome.evidenceRequired);
      }
    },
    apply: async client => {
      const reviewer = await activeReviewer(client, scope, workOrderId);
      if (!reviewer.grant) throw new ApiError(403, 'CHECKLIST_REVIEW_AUTHORITY_REQUIRED', 'A current checklist-record review grant is required.');
      const { source, outcome } = await currentOutcome(client, scope, workOrderId, taskId, checklistId, itemId, input);
      if (outcome.actorId === scope.actorId) throw new ApiError(403, 'INDEPENDENT_REVIEW_REQUIRED', 'You cannot review an outcome that you recorded.');
      if (reviewer.context.planRevisionId !== input.expectedWorkPlanRevisionId) throw new ApiError(409, 'STALE_WORK_PLAN', 'The work plan changed. Refresh the review queue.');
      await assertCurrentTaskAssignment(client, scope, workOrderId, taskId, input, outcome);
      if (reviewer.audience === 'supervisor') {
        const report = await client.query(`SELECT reports_to_placement_id AS "reportsToPlacementId" FROM public.staff_role_placements
          WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND staff_user_id=$4 AND state='active' FOR SHARE`,
        [scope.organisationId, scope.siteId, outcome.assigneePlacementId, outcome.assigneeUserId]);
        if (report.rows[0]?.reportsToPlacementId !== reviewer.context.supervisorPlacementId) {
          throw new ApiError(403, 'DIRECT_REPORT_REVIEW_REQUIRED', 'A Supervisor can review only checklist records from a current direct report.');
        }
      }
      if (input.disposition === 'record-confirmed') {
        if (await hasOpenHold(client, scope, workOrderId)) throw new ApiError(409, 'OPEN_SAFETY_HOLD', 'Resolve the current safety hold before confirming this record. You may return it for correction.');
        await assertReviewEvidence(client, scope, workOrderId, outcome.id, outcome.evidenceRequired);
      }
      const existing = await client.query(`SELECT id FROM public.work_order_checklist_item_reviews
        WHERE organisation_id=$1 AND site_id=$2 AND outcome_revision_id=$3`,
      [scope.organisationId, scope.siteId, outcome.id]);
      if (existing.rowCount) throw new ApiError(409, 'CHECKLIST_OUTCOME_ALREADY_REVIEWED', 'This outcome already has a review decision. Refresh the queue.');
      reviewedAt = new Date().toISOString();
      await client.query(`INSERT INTO public.work_order_checklist_item_reviews
        (id,organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,outcome_revision_id,
          reviewer_user_id,reviewer_placement_id,disposition,reason,reviewed_at,work_plan_revision_id,
          assignment_revision,authority_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
      [reviewId,scope.organisationId,scope.siteId,workOrderId,checklistId,itemId,outcome.id,scope.actorId,
        reviewer.placementId,input.disposition,input.reason,reviewedAt,input.expectedWorkPlanRevisionId,
        input.expectedAssignmentRevision,JSON.stringify({ grant: reviewer.grant, audience: reviewer.audience,
          outcomeRevisionId: outcome.id, sourceTemplateRevisionId: source.templateRevisionId,
          qualificationSnapshots: outcome.qualificationSnapshots, decidedAt: reviewedAt })]);
      const checklistVersion = source.version + 1;
      await client.query(`UPDATE public.work_order_checklists SET version=$5,updated_at=clock_timestamp()
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND id=$4 AND version=$6`,
      [scope.organisationId,scope.siteId,workOrderId,checklistId,checklistVersion,source.version]);
      return { aggregateId: itemId, aggregateType: 'work-order-checklist-item', version: checklistVersion,
        previous: { outcomeRevisionId: outcome.id, disposition: null },
        next: { outcomeRevisionId: outcome.id, disposition: input.disposition, checklistVersion },
        reason: input.reason };
    },
    project: async () => checklistItemReviewResultSchema.parse({ reviewId, workOrderId, checklistId, itemId,
      outcomeRevisionId: input.outcomeRevisionId, disposition: input.disposition,
      checklistVersion: input.expectedChecklistVersion + 1, reviewedAt }),
  });
}
