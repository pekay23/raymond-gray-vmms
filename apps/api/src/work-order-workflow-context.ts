import { workOrderWorkflowContextSchema, type WorkOrderDetail } from './schemas.js';

export type WorkOrderWorkflowFacts = Pick<WorkOrderDetail,
  'version' | 'canReviewOperations' | 'operationsReview' | 'teamLeadAssignment' |
  'workPlan' | 'canPrepareWorkPlan' | 'workPlanBlockReason' | 'supervisorHandoff'>;

/**
 * Summarize only the durable workflow stages already represented in the work-order record.
 * This guides navigation; each action endpoint still checks current authority when submitted.
 */
export function projectWorkOrderWorkflowContext(facts: WorkOrderWorkflowFacts) {
  const reviewWasFollowedByItsActiveLeadWorkflow = Boolean(
    facts.operationsReview && facts.teamLeadAssignment
    && facts.teamLeadAssignment.operationsReviewId === facts.operationsReview.id
    && (facts.operationsReview.reviewedWorkOrderVersion + 1 === facts.version
      || facts.workPlan?.isCurrent
      || facts.supervisorHandoff?.isCurrent),
  );

  if (!facts.operationsReview || (!facts.operationsReview.isCurrent && !reviewWasFollowedByItsActiveLeadWorkflow)) {
    return workOrderWorkflowContextSchema.parse({
      stage: 'operations-review',
      responsibility: { role: 'operations', name: null, source: 'operations-queue' },
      nextAction: 'review-job',
      actionReadiness: facts.canReviewOperations ? 'available' : 'blocked',
      blockReason: facts.canReviewOperations ? null : 'operations-review-authority-required',
      dueAt: null,
      evidenceChecklist: 'awaiting-approved-sop',
    });
  }

  if (!facts.teamLeadAssignment) {
    return workOrderWorkflowContextSchema.parse({
      stage: 'team-lead-assignment',
      responsibility: { role: 'operations', name: null, source: 'operations-queue' },
      nextAction: 'assign-team-lead',
      actionReadiness: 'check-action-section',
      blockReason: null,
      dueAt: null,
      evidenceChecklist: 'awaiting-approved-sop',
    });
  }

  if (!facts.workPlan?.isCurrent) {
    const reason = facts.canPrepareWorkPlan ? null : facts.workPlanBlockReason;
    return workOrderWorkflowContextSchema.parse({
      stage: 'team-lead-work-plan',
      responsibility: { role: 'team-lead', name: facts.teamLeadAssignment.leadName, source: 'team-lead-assignment' },
      nextAction: 'prepare-work-plan',
      actionReadiness: facts.canPrepareWorkPlan ? 'available' : reason ? 'blocked' : 'check-action-section',
      blockReason: reason,
      dueAt: null,
      evidenceChecklist: 'awaiting-approved-sop',
    });
  }

  if (!facts.supervisorHandoff?.isCurrent) {
    return workOrderWorkflowContextSchema.parse({
      stage: 'supervisor-handoff',
      responsibility: { role: 'team-lead', name: facts.teamLeadAssignment.leadName, source: 'team-lead-assignment' },
      nextAction: 'assign-supervisor',
      actionReadiness: 'check-action-section',
      blockReason: null,
      dueAt: null,
      evidenceChecklist: 'awaiting-approved-sop',
    });
  }

  return workOrderWorkflowContextSchema.parse({
    stage: 'supervisor-task-work',
    responsibility: { role: 'supervisor', name: facts.supervisorHandoff.supervisorName, source: 'supervisor-handoff' },
    nextAction: 'manage-task-work',
    actionReadiness: 'check-action-section',
    blockReason: null,
    dueAt: null,
    evidenceChecklist: 'awaiting-approved-sop',
  });
}
