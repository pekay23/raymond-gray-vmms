import type { WorkOrder } from "./api";

const workflowSectionTargets: Record<WorkOrder["workflowContext"]["nextAction"], string> = {
  "review-job": "operations-review-title",
  "assign-team-lead": "operations-assignment-title",
  "prepare-work-plan": "work-plan-title",
  "assign-supervisor": "supervisor-handoff-title",
  "manage-task-work": "task-allocations-title",
};

export function workOrderWorkflowSectionTarget(
  nextAction: WorkOrder["workflowContext"]["nextAction"],
) {
  return workflowSectionTargets[nextAction];
}
