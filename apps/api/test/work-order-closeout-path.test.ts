import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkOrderWorkflowContext } from '../src/schemas.js';
import { projectWorkOrderCloseoutPath } from '../src/work-order-closeout-path.js';

function context(stage: WorkOrderWorkflowContext['stage']): WorkOrderWorkflowContext {
  const current = {
    'operations-review': { role: 'operations', source: 'operations-queue', nextAction: 'review-job' },
    'team-lead-assignment': { role: 'operations', source: 'operations-queue', nextAction: 'assign-team-lead' },
    'team-lead-work-plan': { role: 'team-lead', source: 'team-lead-assignment', nextAction: 'prepare-work-plan' },
    'supervisor-handoff': { role: 'team-lead', source: 'team-lead-assignment', nextAction: 'assign-supervisor' },
    'supervisor-task-work': { role: 'supervisor', source: 'supervisor-handoff', nextAction: 'manage-task-work' },
  }[stage];
  return {
    stage,
    responsibility: { role: current.role, name: null, source: current.source },
    nextAction: current.nextAction,
    actionReadiness: 'check-action-section',
    blockReason: null,
    dueAt: null,
    evidenceChecklist: 'awaiting-approved-sop',
  } as WorkOrderWorkflowContext;
}

test('closeout path follows current server stage and never enables unconfigured sign-offs', () => {
  const early = projectWorkOrderCloseoutPath({
    workflowContext: context('operations-review'),
    operationsReviewIsCurrent: false,
    supervisorHandoffIsCurrent: false,
  });
  assert.deepEqual(early.map(stage => stage.state), [
    'current', 'waiting', 'waiting', 'not-available', 'not-available', 'not-available', 'waiting',
  ]);

  const workInProgress = projectWorkOrderCloseoutPath({
    workflowContext: context('supervisor-task-work'),
    operationsReviewIsCurrent: false,
    supervisorHandoffIsCurrent: true,
  });
  assert.deepEqual(workInProgress.map(stage => stage.label), [
    'Operations review',
    'Plan and Supervisor handover',
    'Assigned task work',
    'Supervisor completion check',
    'Team Lead release to collection area',
    'Head of Service Centre inspection',
    'Service Advisor updates the client',
  ]);
  assert.deepEqual(workInProgress.map(stage => stage.state), [
    'complete', 'complete', 'current', 'not-available', 'not-available', 'not-available', 'waiting',
  ]);
  assert.equal(workInProgress[3]?.responsibleRole, 'Assigned Supervisor');
  assert.equal(workInProgress[4]?.responsibleRole, 'Eligible Team Lead');
  assert.equal(workInProgress[5]?.responsibleRole, 'Head of Service Centre or eligible independent checker');
  assert.match(workInProgress[3]?.detail ?? '', /are configured/);
  assert.match(workInProgress[4]?.detail ?? '', /can be verified/);
  assert.match(workInProgress[6]?.detail ?? '', /linked service request contact history/);
});

test('stale handoff does not appear complete before the current supervisor work stage', () => {
  const path = projectWorkOrderCloseoutPath({
    workflowContext: context('supervisor-handoff'),
    operationsReviewIsCurrent: true,
    supervisorHandoffIsCurrent: false,
  });
  assert.deepEqual(path.slice(0, 3).map(stage => stage.state), ['complete', 'current', 'waiting']);
  assert.equal(path.length, 7);
});
