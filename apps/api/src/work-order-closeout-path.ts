import { workOrderCloseoutPathSchema } from './schemas.js';
import type { WorkOrderWorkflowContext } from './schemas.js';

export type WorkOrderCloseoutPathFacts = {
  workflowContext: WorkOrderWorkflowContext;
  operationsReviewIsCurrent: boolean;
  supervisorHandoffIsCurrent: boolean;
};

const workflowStageOrder: Record<WorkOrderWorkflowContext['stage'], number> = {
  'operations-review': 0,
  'team-lead-assignment': 1,
  'team-lead-work-plan': 2,
  'supervisor-handoff': 3,
  'supervisor-task-work': 4,
};

export function projectWorkOrderCloseoutPath(facts: WorkOrderCloseoutPathFacts) {
  const stage = facts.workflowContext.stage;
  const stageOrder = workflowStageOrder[stage];
  const hasCurrentHandoff = facts.supervisorHandoffIsCurrent && stage === 'supervisor-task-work';

  return workOrderCloseoutPathSchema.parse([
    {
      code: 'operations-review',
      label: 'Operations review',
      responsibleRole: 'Head of Service Centre / Operations',
      state: stageOrder > 0 || facts.operationsReviewIsCurrent ? 'complete' : 'current',
      detail: 'Review the reported concern and assign an eligible Team Lead.',
    },
    {
      code: 'lead-handoff',
      label: 'Plan and Supervisor handover',
      responsibleRole: 'Team Lead',
      state: hasCurrentHandoff ? 'complete' : stageOrder >= 1 && stageOrder <= 3 ? 'current' : 'waiting',
      detail: 'Prepare the job plan, then hand the work to a named Supervisor.',
    },
    {
      code: 'technician-work',
      label: 'Assigned task work',
      responsibleRole: 'Supervisor and assigned technicians',
      state: stage === 'supervisor-task-work' ? 'current' : 'waiting',
      detail: 'Record assigned work, findings, actions, evidence and requests for review.',
    },
    {
      code: 'supervisor-completion',
      label: 'Supervisor completion check',
      responsibleRole: 'Assigned Supervisor',
      state: 'not-available',
      detail: 'Sign-off is unavailable until effective task instructions, evidence rules, individual qualifications and a separate completion permission are configured.',
    },
    {
      code: 'team-lead-release',
      label: 'Team Lead release to collection area',
      responsibleRole: 'Eligible Team Lead',
      state: 'not-available',
      detail: 'Release is unavailable until Supervisor completion, required inspection checks, current qualifications and a separate release permission can be verified.',
    },
    {
      code: 'head-inspection',
      label: 'Head of Service Centre inspection',
      responsibleRole: 'Head of Service Centre or eligible independent checker',
      state: 'not-available',
      detail: 'This post-release check needs an approved inspection list and current inspection authority; the inspection action is not enabled.',
    },
    {
      code: 'client-update',
      label: 'Service Advisor updates the client',
      responsibleRole: 'Service Advisor',
      state: 'waiting',
      detail: 'After the Head inspection, record the client update in the linked service request contact history.',
    },
  ]);
}
