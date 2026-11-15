import assert from 'node:assert/strict';
import test from 'node:test';
import { projectWorkOrderWorkflowContext, type WorkOrderWorkflowFacts } from '../src/work-order-workflow-context.js';

const currentReview: NonNullable<WorkOrderWorkflowFacts['operationsReview']> = {
  id: '10000000-0000-4000-8000-000000000001',
  reviewedByName: 'Synthetic Operations Reviewer',
  reviewedAt: '2026-11-13T09:00:00.000Z',
  notes: 'Synthetic review',
  reviewedWorkOrderVersion: 2,
  isCurrent: true,
};
const leadAssignment: NonNullable<WorkOrderWorkflowFacts['teamLeadAssignment']> = {
  id: '10000000-0000-4000-8000-000000000002',
  leadUserId: '10000000-0000-4000-8000-000000000003',
  leadName: 'Synthetic EV Team Lead',
  operationsReviewId: currentReview.id,
  powertrainClass: 'EV',
  assignedByName: 'Synthetic Operations Reviewer',
  assignedAt: '2026-11-13T09:10:00.000Z',
  reason: 'Synthetic assignment',
};
const currentPlan: NonNullable<WorkOrderWorkflowFacts['workPlan']> = {
  id: '10000000-0000-4000-8000-000000000004',
  revisionNumber: 1,
  leadAssignmentId: leadAssignment.id,
  workOrderVersion: 3,
  plannedBy: leadAssignment.leadName,
  plannedAt: '2026-11-13T09:20:00.000Z',
  rationale: 'Synthetic plan',
  tasks: [{ taskId: '10000000-0000-4000-8000-000000000005', reference: 'T01', title: 'Synthetic task' }],
  isCurrent: true,
};
const currentHandoff: NonNullable<WorkOrderWorkflowFacts['supervisorHandoff']> = {
  supervisorUserId: '10000000-0000-4000-8000-000000000006',
  supervisorName: 'Synthetic EV Supervisor',
  assignedByName: leadAssignment.leadName,
  powertrainClass: 'EV',
  assignedAt: '2026-11-13T09:30:00.000Z',
  reason: 'Synthetic handover',
  workPlanRevisionId: currentPlan.id,
  workPlanRevisionNumber: 1,
  workOrderVersion: 4,
  isCurrent: true,
};

const initial: WorkOrderWorkflowFacts = {
  version: 1,
  canReviewOperations: false,
  operationsReview: null,
  teamLeadAssignment: null,
  workPlan: null,
  canPrepareWorkPlan: false,
  workPlanBlockReason: null,
  supervisorHandoff: null,
};

test('new or stale work orders return responsibility to Operations with exact authority block', () => {
  const context = projectWorkOrderWorkflowContext(initial);
  assert.equal(context.stage, 'operations-review');
  assert.deepEqual(context.responsibility, { role: 'operations', name: null, source: 'operations-queue' });
  assert.equal(context.nextAction, 'review-job');
  assert.equal(context.actionReadiness, 'blocked');
  assert.equal(context.blockReason, 'operations-review-authority-required');
});

test('current Operations review without a current lead assignment stays with the assignment queue', () => {
  const context = projectWorkOrderWorkflowContext({ ...initial, version: 2, canReviewOperations: true, operationsReview: currentReview });
  assert.equal(context.stage, 'team-lead-assignment');
  assert.equal(context.responsibility.role, 'operations');
  assert.equal(context.nextAction, 'assign-team-lead');
  assert.equal(context.actionReadiness, 'check-action-section');
});

test('a blocked work plan uses the server returned reason and names its assigned team lead', () => {
  const context = projectWorkOrderWorkflowContext({
    ...initial,
    version: 3,
    operationsReview: { ...currentReview, isCurrent: false },
    teamLeadAssignment: leadAssignment,
    canPrepareWorkPlan: false,
    workPlanBlockReason: 'qualification-required',
  });
  assert.equal(context.stage, 'team-lead-work-plan');
  assert.deepEqual(context.responsibility, { role: 'team-lead', name: leadAssignment.leadName, source: 'team-lead-assignment' });
  assert.equal(context.actionReadiness, 'blocked');
  assert.equal(context.blockReason, 'qualification-required');
});

test('a later work-order change returns an unplanned assignment to Operations review', () => {
  const context = projectWorkOrderWorkflowContext({
    ...initial,
    version: 4,
    canReviewOperations: true,
    operationsReview: { ...currentReview, isCurrent: false },
    teamLeadAssignment: leadAssignment,
  });
  assert.equal(context.stage, 'operations-review');
  assert.equal(context.nextAction, 'review-job');
});

test('a current work plan keeps responsibility with the lead until the current supervisor handoff', () => {
  const context = projectWorkOrderWorkflowContext({
    ...initial,
    version: 4,
    operationsReview: { ...currentReview, isCurrent: false },
    teamLeadAssignment: leadAssignment,
    workPlan: currentPlan,
    canPrepareWorkPlan: true,
    supervisorHandoff: { ...currentHandoff, isCurrent: false },
  });
  assert.equal(context.stage, 'supervisor-handoff');
  assert.equal(context.responsibility.name, leadAssignment.leadName);
  assert.equal(context.nextAction, 'assign-supervisor');
  assert.equal(context.actionReadiness, 'check-action-section');
});

test('a current handoff names the supervisor without pretending one technician owns every task', () => {
  const context = projectWorkOrderWorkflowContext({
    ...initial,
    version: 5,
    operationsReview: { ...currentReview, isCurrent: false },
    teamLeadAssignment: leadAssignment,
    workPlan: currentPlan,
    canPrepareWorkPlan: true,
    supervisorHandoff: currentHandoff,
  });
  assert.equal(context.stage, 'supervisor-task-work');
  assert.deepEqual(context.responsibility, { role: 'supervisor', name: currentHandoff.supervisorName, source: 'supervisor-handoff' });
  assert.equal(context.nextAction, 'manage-task-work');
});

test('the projection leaves due time unset and does not fabricate SOP evidence requirements', () => {
  const context = projectWorkOrderWorkflowContext({ ...initial, canReviewOperations: true });
  assert.equal(context.dueAt, null);
  assert.equal(context.evidenceChecklist, 'awaiting-approved-sop');
});
