import type { PoolClient } from 'pg';
import { z } from 'zod';
import { type Scope } from './db.js';
import { workOrderCompletionReadinessSchema } from './schemas.js';

const taskRowsSchema = z.array(z.object({
  taskId:z.string().uuid(),reference:z.string(),title:z.string(),assigneeName:z.string().nullable(),
  workEntryCount:z.number().int().nonnegative(),completedActionCount:z.number().int().nonnegative(),openActionCount:z.number().int().nonnegative(),
  followUpCount:z.number().int().nonnegative(),
  checklistOutcomeCount:z.number().int().nonnegative(),checklistNeedsReviewCount:z.number().int().nonnegative(),
}).strict());

/** Read-only operational checklist. These counts never imply approval or sign-off. */
export async function readWorkOrderCompletionReadiness(
  client:PoolClient,
  scope:Scope,
  workOrderId:string,
  currentPlanId:string|null,
  currentSupervisorHandoff:boolean,
  openHoldCount:number,
) {
  const rows=currentPlanId?await client.query(`
    SELECT task.id AS "taskId",'T'||lpad(task.ordinal::text,2,'0') AS reference,task.title,
      assignee.display_name AS "assigneeName",
      coalesce(entries.entry_count,0)::int AS "workEntryCount",
      coalesce(entries.done_count,0)::int AS "completedActionCount",
      coalesce(entries.open_action_count,0)::int AS "openActionCount",
      coalesce(entries.follow_up_count,0)::int AS "followUpCount",
      coalesce(checklists.outcome_count,0)::int AS "checklistOutcomeCount",
      coalesce(checklists.review_count,0)::int AS "checklistNeedsReviewCount"
    FROM public.work_order_work_plan_revision_tasks planned
    JOIN public.tasks task ON task.organisation_id=planned.organisation_id AND task.site_id=planned.site_id
      AND task.work_order_id=planned.work_order_id AND task.id=planned.task_id
    LEFT JOIN LATERAL (
      SELECT assignment.assignee_user_id,assignment.assignment_revision
      FROM public.work_order_task_assignment_revisions assignment
      WHERE assignment.organisation_id=planned.organisation_id AND assignment.site_id=planned.site_id
        AND assignment.work_order_id=planned.work_order_id AND assignment.task_id=planned.task_id
        AND assignment.work_plan_revision_id=planned.work_plan_revision_id
      ORDER BY assignment.assignment_revision DESC LIMIT 1
    ) current_assignment ON true
    LEFT JOIN public.staff_users assignee ON assignee.id=current_assignment.assignee_user_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS entry_count,
        count(*) FILTER(WHERE entry.entry_kind='action' AND entry.result='done')::int AS done_count,
        count(*) FILTER(WHERE entry.entry_kind='action' AND entry.result IN ('partial','blocked'))::int AS open_action_count,
        count(*) FILTER(WHERE entry.entry_kind='follow-up' AND entry.result IN ('pending','blocked'))::int AS follow_up_count
      FROM public.work_order_task_work_entries entry
      WHERE current_assignment.assignment_revision IS NOT NULL
        AND entry.organisation_id=planned.organisation_id AND entry.site_id=planned.site_id
        AND entry.work_order_id=planned.work_order_id AND entry.task_id=planned.task_id
        AND entry.work_plan_revision_id=planned.work_plan_revision_id
        AND entry.assignment_revision=current_assignment.assignment_revision
        AND NOT EXISTS (SELECT 1 FROM public.work_order_task_work_entries correction
          WHERE correction.organisation_id=entry.organisation_id AND correction.site_id=entry.site_id
            AND correction.work_order_id=entry.work_order_id AND correction.task_id=entry.task_id
            AND correction.supersedes_entry_id=entry.id)
    ) entries ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT outcome.id)::int AS outcome_count,
        count(DISTINCT outcome.id) FILTER(WHERE outcome.id IS NOT NULL AND coalesce(review.confirmed,false)=false)::int AS review_count
      FROM public.work_order_checklists checklist
      JOIN public.work_order_checklist_items item ON item.organisation_id=checklist.organisation_id
        AND item.site_id=checklist.site_id AND item.work_order_id=checklist.work_order_id
        AND item.checklist_id=checklist.id
      LEFT JOIN LATERAL (
        SELECT revision.id,revision.result,revision.organisation_id,revision.site_id
        FROM public.work_order_checklist_item_revisions revision
        WHERE revision.organisation_id=item.organisation_id AND revision.site_id=item.site_id
          AND revision.work_order_id=item.work_order_id AND revision.checklist_id=item.checklist_id
          AND revision.checklist_item_id=item.id AND revision.task_id=planned.task_id
          AND revision.work_plan_revision_id=planned.work_plan_revision_id
          AND revision.assignment_revision=current_assignment.assignment_revision
          AND NOT EXISTS (SELECT 1 FROM public.work_order_checklist_item_revisions newer
            WHERE newer.organisation_id=revision.organisation_id AND newer.site_id=revision.site_id
              AND newer.checklist_item_id=revision.checklist_item_id AND newer.supersedes_revision_id=revision.id)
        ORDER BY revision.revision DESC LIMIT 1
      ) outcome ON true
      LEFT JOIN LATERAL (
        SELECT bool_or(review.disposition='record-confirmed') AS confirmed
        FROM public.work_order_checklist_item_reviews review
        WHERE outcome.id IS NOT NULL AND review.organisation_id=outcome.organisation_id
          AND review.site_id=outcome.site_id AND review.outcome_revision_id=outcome.id
      ) review ON true
      WHERE checklist.organisation_id=planned.organisation_id AND checklist.site_id=planned.site_id
        AND checklist.work_order_id=planned.work_order_id
    ) checklists ON true
    WHERE planned.organisation_id=$1 AND planned.site_id=$2 AND planned.work_order_id=$3
      AND planned.work_plan_revision_id=$4
    ORDER BY planned.line_number
  `,[scope.organisationId,scope.siteId,workOrderId,currentPlanId]):{rows:[]};
  return projectWorkOrderCompletionReadiness({
    currentWorkPlan:Boolean(currentPlanId),currentSupervisorHandoff,openHoldCount,tasks:rows.rows,
  });
}

export function projectWorkOrderCompletionReadiness(input:{
  currentWorkPlan:boolean;currentSupervisorHandoff:boolean;openHoldCount:number;tasks:unknown;
}) {
  const tasks=taskRowsSchema.parse(input.tasks);
  const blockers:z.infer<typeof workOrderCompletionReadinessSchema>['blockers']=[];
  if(!input.currentWorkPlan) blockers.push({code:'current-work-plan-required',message:'The Team Lead must prepare a current work plan.',taskId:null});
  if(!input.currentSupervisorHandoff) blockers.push({code:'supervisor-handoff-required',message:'The Team Lead must hand the current plan to a Supervisor.',taskId:null});
  for(const task of tasks){
    if(!task.assigneeName) blockers.push({code:'task-assignment-required',message:`${task.reference} has no assigned technician or engineer.`,taskId:task.taskId});
    else if(task.workEntryCount===0) blockers.push({code:'task-work-record-required',message:`${task.reference} has no recorded task work yet.`,taskId:task.taskId});
    if(task.openActionCount>0) blockers.push({code:'task-action-not-complete',message:`${task.reference} has ${task.openActionCount} action record${task.openActionCount===1?'':'s'} marked partial or blocked. Correct or complete each action before Supervisor review.`,taskId:task.taskId});
    if(task.followUpCount>0) blockers.push({code:'task-follow-up-open',message:`${task.reference} has ${task.followUpCount} open follow-up item${task.followUpCount===1?'':'s'}. Record the result or why it remains blocked.`,taskId:task.taskId});
    if(task.checklistNeedsReviewCount>0) blockers.push({code:'task-checklist-review-required',message:`${task.reference} has ${task.checklistNeedsReviewCount} checklist outcome${task.checklistNeedsReviewCount===1?'':'s'} awaiting a separate review.`,taskId:task.taskId});
  }
  if(input.openHoldCount>0) blockers.push({code:'open-hold',message:`${input.openHoldCount} work-order hold${input.openHoldCount===1?' is':'s are'} still open.`,taskId:null});
  // These remain explicit until an effective G2/policy resolver and G3 command exist.
  blockers.push({code:'effective-g2-scope-unavailable',message:'The current scope response does not authorize technical work; effective G2 approval is not available.',taskId:null});
  blockers.push({code:'effective-task-instructions-unavailable',message:'No approved, effective instruction package is available for this vehicle and work scope.',taskId:null});
  blockers.push({code:'authority-validation-unavailable',message:'This view does not verify current task-execution grants or qualifications. Recorded task notes are not proof of authorized completion.',taskId:null});
  blockers.push({code:'signoff-command-unavailable',message:'Supervisor technical completion is not yet enabled. This readiness view does not sign off the work.',taskId:null});
  return workOrderCompletionReadinessSchema.parse({currentWorkPlan:input.currentWorkPlan,currentSupervisorHandoff:input.currentSupervisorHandoff,
    openHoldCount:input.openHoldCount,tasks,blockers,state:'blocked'});
}
