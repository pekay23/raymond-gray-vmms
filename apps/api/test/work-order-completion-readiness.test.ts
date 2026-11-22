import assert from 'node:assert/strict';
import test from 'node:test';
import { projectWorkOrderCompletionReadiness } from '../src/work-order-completion-readiness.js';

const taskId = '00000000-0000-4000-8000-000000000001';

function task(overrides: Record<string, unknown> = {}) {
  return {
    taskId, reference: 'T01', title: 'Inspect reported concern', assigneeName: 'Synthetic technician',
    workEntryCount: 2, completedActionCount: 1, openActionCount: 0, followUpCount: 0,
    checklistOutcomeCount: 0, checklistNeedsReviewCount: 0,
    ...overrides,
  };
}

function blockerCodes(tasks: unknown[]) {
  return projectWorkOrderCompletionReadiness({
    currentWorkPlan: true, currentSupervisorHandoff: true, openHoldCount: 0, tasks,
  }).blockers.map(blocker => blocker.code);
}

test('readiness remains blocked for unconfigured G2 and sign-off even when work records have no open items', () => {
  const blockers = blockerCodes([task()]);
  assert.ok(!blockers.includes('task-action-not-complete'));
  assert.ok(!blockers.includes('task-follow-up-open'));
  assert.ok(!blockers.includes('task-checklist-review-required'));
  assert.ok(blockers.includes('effective-g2-scope-unavailable'));
  assert.ok(blockers.includes('effective-task-instructions-unavailable'));
  assert.ok(blockers.includes('authority-validation-unavailable'));
  assert.ok(blockers.includes('signoff-command-unavailable'));
});

test('readiness identifies partial actions, outstanding follow-ups and checklist outcomes awaiting review by task', () => {
  const result = projectWorkOrderCompletionReadiness({
    currentWorkPlan: true, currentSupervisorHandoff: true, openHoldCount: 0,
    tasks: [task({ openActionCount: 2, followUpCount: 1, checklistNeedsReviewCount: 3 })],
  });
  const blockers = result.blockers.filter(blocker => blocker.taskId === taskId);
  assert.deepEqual(blockers.map(blocker => blocker.code), [
    'task-action-not-complete', 'task-follow-up-open', 'task-checklist-review-required',
  ]);
  assert.match(blockers[0]!.message, /2 action records marked partial or blocked/);
  assert.match(blockers[1]!.message, /1 open follow-up item/);
  assert.match(blockers[2]!.message, /3 checklist outcomes awaiting a separate review/);
  assert.equal(result.state, 'blocked');
});

test('readiness reports all task-specific issues without losing assignment and work-record blockers', () => {
  const secondTaskId = '00000000-0000-4000-8000-000000000002';
  const result = projectWorkOrderCompletionReadiness({
    currentWorkPlan: false, currentSupervisorHandoff: false, openHoldCount: 1,
    tasks: [
      task({ assigneeName: null, workEntryCount: 0, taskId }),
      task({ taskId: secondTaskId, openActionCount: 1, followUpCount: 2 }),
    ],
  });
  assert.deepEqual(result.blockers.filter(blocker => blocker.taskId === taskId).map(blocker => blocker.code), [
    'task-assignment-required',
  ]);
  assert.deepEqual(result.blockers.filter(blocker => blocker.taskId === secondTaskId).map(blocker => blocker.code), [
    'task-action-not-complete', 'task-follow-up-open',
  ]);
  assert.ok(result.blockers.some(blocker => blocker.code === 'current-work-plan-required'));
  assert.ok(result.blockers.some(blocker => blocker.code === 'supervisor-handoff-required'));
  assert.ok(result.blockers.some(blocker => blocker.code === 'open-hold'));
});
