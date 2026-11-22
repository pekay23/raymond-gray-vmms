import assert from "node:assert/strict";
import test from "node:test";
import { workOrderWorkflowSectionTarget } from "./work-order-workflow-navigation";

test("each current job action points to its existing action section", () => {
  assert.equal(workOrderWorkflowSectionTarget("review-job"), "operations-review-title");
  assert.equal(workOrderWorkflowSectionTarget("assign-team-lead"), "operations-assignment-title");
  assert.equal(workOrderWorkflowSectionTarget("prepare-work-plan"), "work-plan-title");
  assert.equal(workOrderWorkflowSectionTarget("assign-supervisor"), "supervisor-handoff-title");
  assert.equal(workOrderWorkflowSectionTarget("manage-task-work"), "task-allocations-title");
});
