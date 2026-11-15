import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { type Database, type Scope, scoped, uuid } from './db.js';
import { ApiError, notFound } from './errors.js';
import { clientMatchSchema, complaintSchema, detailSchema, eligibleTeamLeadSchema, eligibleSupervisorSchema, holdSchema, intakeSchema, leadAssignmentSchema, partyMatchSchema, supervisorHandoffSchema, summarySchema, taskSchema, vehicleMatchSchema, workPlanBlockReasonSchema, workPlanCommandSchema, workPlanSchema, type WorkOrderDetail } from './schemas.js';
import { lockAdvisoryRoots, lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { operationsReviewCommandSchema, operationsReviewResultSchema } from './schemas.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { requestAccess } from './service-requests.js';
import { projectWorkOrderWorkflowContext } from './work-order-workflow-context.js';

const summarySql = `SELECT w.id,w.reference,w.version,w.created_at AS "createdAt",p.display_name AS "clientName",concat_ws(' ',v.make,v.model,v.variant) AS "vehicleLabel",v.vin,v.registration,w.status,
(SELECT count(*)::int FROM complaints x WHERE x.work_order_id=w.id) AS "complaintCount",
(SELECT count(*)::int FROM holds x WHERE x.work_order_id=w.id) AS "openHoldCount"
FROM work_orders w LEFT JOIN parties p ON p.id=w.client_party_id AND p.organisation_id=w.organisation_id JOIN vehicles v ON v.id=w.vehicle_id`;

const gates = [
  {code:'G1',label:'Reception',state:'pending',missing:['Custody acknowledgement','Condition photographs','Safety triage and complete intake evidence']},
  {code:'G2',label:'Authorised scope',state:'pending',missing:['Diagnostic consent','Versioned scope and named approvals']},
  {code:'G3',label:'Technical completion',state:'pending',missing:['Current technician privileges','Execution and test evidence','Technician declaration']},
  {code:'G4',label:'Quality and technical release',state:'pending',missing:['Independent inspection where required','Resolved safety holds','Named technical release']},
  {code:'G5',label:'Commercial closure',state:'pending',missing:['Technical release','Approved payer and commercial disposition','Handover acknowledgement']},
];

export async function detail(client: PoolClient, id: string): Promise<WorkOrderDetail> {
  const found = await client.query(`${summarySql} WHERE w.id=$1`,[id]);
  const raw: unknown = found.rows[0];
  if (!raw) notFound();
  const summary = summarySchema.parse(raw);
  const extraResult = await client.query(`SELECT
    CASE WHEN cp.id IS NULL THEN NULL ELSE jsonb_build_object('id',cp.id,'kind',cp.party_kind,'name',cp.display_name,'phone',cp.phone,'email',cp.email) END AS client,
    (SELECT jsonb_build_object('id',op.id,'kind',op.party_kind,'name',op.display_name,'phone',op.phone,'email',op.email,'state',oo.assertion_state)
      FROM vehicle_owner_observations oo JOIN parties op ON op.id=oo.party_id AND op.organisation_id=oo.organisation_id
      WHERE oo.work_order_id=w.id ORDER BY oo.recorded_at DESC,oo.id DESC LIMIT 1) AS owner,
    CASE WHEN vc.id IS NULL THEN NULL ELSE jsonb_build_object('id',vc.id,'kind',vc.party_kind,'name',vc.display_name,'phone',vc.phone,'email',vc.email) END AS "visitContact",
    w.client_code_snapshot AS "clientCode",w.client_booking_sequence AS "clientBookingSequence",w.powertrain_class AS "powertrainClass",w.warranty_status_at_booking AS "warrantyStatusAtBooking",
    jsonb_build_object('id',v.id,'vin',v.vin,'registration',v.registration,'make',v.make,'model',v.model,'variant',v.variant,'powertrain',v.powertrain) AS vehicle,
    w.odometer_km AS "odometerKm",w.soc_percent AS "socPercent"
    FROM work_orders w LEFT JOIN parties cp ON cp.id=w.client_party_id AND cp.organisation_id=w.organisation_id
    JOIN visits vs ON vs.id=w.visit_id AND vs.organisation_id=w.organisation_id
    LEFT JOIN parties vc ON vc.id=vs.visit_contact_party_id AND vc.organisation_id=vs.organisation_id
    JOIN vehicles v ON v.id=w.vehicle_id WHERE w.id=$1`,[id]);
  const extra = z.object({client:detailSchema.shape.client,owner:detailSchema.shape.owner,visitContact:detailSchema.shape.visitContact,clientCode:detailSchema.shape.clientCode,clientBookingSequence:detailSchema.shape.clientBookingSequence,powertrainClass:detailSchema.shape.powertrainClass,warrantyStatusAtBooking:detailSchema.shape.warrantyStatusAtBooking,vehicle:detailSchema.shape.vehicle,odometerKm:z.number(),socPercent:z.number().nullable()}).parse(extraResult.rows[0]);
  const vehicleHistory = await client.query(`SELECT w.id,w.reference,w.created_at AS "openedAt",v.registration,
      (SELECT p.display_name FROM parties p WHERE p.id=w.client_party_id AND p.organisation_id=w.organisation_id) AS "clientName",
      (SELECT p.display_name FROM vehicle_owner_observations oo JOIN parties p ON p.id=oo.party_id AND p.organisation_id=oo.organisation_id WHERE oo.work_order_id=w.id ORDER BY oo.recorded_at DESC,oo.id DESC LIMIT 1) AS "reportedOwnerName",
      w.odometer_km AS "odometerKm",w.soc_percent AS "socPercent",
      coalesce((SELECT jsonb_agg(jsonb_build_object('reference','C'||lpad(c.ordinal::text,2,'0'),'wording',c.wording) ORDER BY c.ordinal)
        FROM complaints c WHERE c.work_order_id=w.id),'[]'::jsonb) AS complaints
    FROM work_orders w JOIN vehicles v ON v.id=w.vehicle_id
    WHERE w.vehicle_id=$1 AND w.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    ORDER BY w.created_at DESC,w.id`,[extra.vehicle.id]);
  const historyItems=z.array(detailSchema.shape.vehicleHistory.element).parse(vehicleHistory.rows);
  const complaints = await client.query(`SELECT id,'C'||lpad(ordinal::text,2,'0') AS reference,wording FROM complaints WHERE work_order_id=$1 ORDER BY ordinal`,[id]);
  const tasks = await client.query(`SELECT id,'T'||lpad(ordinal::text,2,'0') AS reference,title,complaint_id AS "complaintId",state FROM tasks WHERE work_order_id=$1 ORDER BY ordinal`,[id]);
  const holds = await client.query(`SELECT h.id,h.category,h.severity,h.reason,h.source,h.task_id AS "taskId",h.opened_at AS "openedAt",u.display_name AS "openedBy" FROM holds h JOIN staff_users u ON u.id=h.owner_id WHERE h.work_order_id=$1 ORDER BY h.opened_at,h.id`,[id]);
  const evidence = await client.query(`
    SELECT e.id AS "evidenceId",
           CASE WHEN l.id IS NULL THEN e.upload_intent_id ELSE NULL END AS "uploadIntentId",
           e.display_name AS "displayName",e.media_type AS "mediaType",e.size_bytes::int AS "sizeBytes",e.sha256,
           e.scan_state AS state,latest.detail_code AS "scanDetailCode",e.created_at AS "uploadedAt",
           l.attached_at AS "attachedAt",u.display_name AS "attachedBy"
    FROM evidence_records e
    LEFT JOIN work_order_evidence_links l
      ON l.organisation_id=e.organisation_id AND l.site_id=e.site_id AND l.evidence_id=e.id
    LEFT JOIN staff_users u ON u.id=l.attached_by
    LEFT JOIN LATERAL (
      SELECT a.detail_code FROM evidence_scan_attempts a
      WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
      ORDER BY a.attempt_no DESC LIMIT 1
    ) latest ON true
    WHERE e.purpose_kind='work-order' AND e.target_id=$1
      AND (l.id IS NOT NULL OR e.created_by=nullif(current_setting('app.actor_id',true),'')::uuid)
    ORDER BY e.created_at,e.id`,[id]);
  const diagnosticFindings = await client.query(`
    SELECT d.id,d.complaint_id AS "complaintId",d.task_id AS "taskId",
           d.supersedes_finding_id AS "supersedesFindingId",u.display_name AS "recordedBy",
           d.recorded_at AS "recordedAt",d.observed_at AS "observedAt",d.summary,
           jsonb_build_object('state',d.certainty_state,'explanation',d.certainty_explanation) AS certainty,
           d.residual_risk AS "residualRisk",d.restrictions,d.observations,
           coalesce((SELECT jsonb_agg(link.evidence_id ORDER BY link.evidence_id)
                     FROM diagnostic_finding_evidence link
                     WHERE link.organisation_id=d.organisation_id AND link.site_id=d.site_id
                       AND link.work_order_id=d.work_order_id AND link.finding_id=d.id),'[]'::jsonb) AS "evidenceIds"
    FROM diagnostic_findings d JOIN staff_users u ON u.id=d.recorded_by
    WHERE d.work_order_id=$1 ORDER BY d.recorded_at,d.id`,[id]);
  const intakeFacts = await client.query(`
    SELECT f.id,
      jsonb_build_object('kind',f.fact->>'kind') || (f.fact - 'kind' - 'evidenceIds') ||
        jsonb_build_object('evidenceIds',coalesce(jsonb_agg(fe.evidence_id ORDER BY fe.evidence_id) FILTER (WHERE fe.evidence_id IS NOT NULL),'[]'::jsonb)) AS fact,
      f.supersedes_fact_id AS "supersedesFactId",f.correction_reason AS "correctionReason",
      u.display_name AS "recordedBy",f.recorded_at AS "recordedAt"
    FROM intake_facts f
    JOIN staff_users u ON u.id=f.recorded_by
    LEFT JOIN intake_fact_evidence fe ON fe.organisation_id=f.organisation_id AND fe.site_id=f.site_id AND fe.work_order_id=f.work_order_id AND fe.fact_id=f.id
    WHERE f.work_order_id=$1
    GROUP BY f.id,u.display_name
    ORDER BY f.recorded_at,f.id`,[id]);
  const history = await client.query(`SELECT a.id,a.event_type AS action,a.created_at AS at,u.display_name AS actor,a.reason FROM domain_events a JOIN staff_users u ON u.id=a.actor_id WHERE a.aggregate_id=$1 AND a.aggregate_type='work-order' ORDER BY a.aggregate_version,a.id`,[id]);
  const reviewResult=await client.query(`SELECT r.id,u.display_name AS "reviewedByName",r.reviewed_at AS "reviewedAt",r.notes,r.reviewed_work_order_version AS "reviewedWorkOrderVersion"
    FROM work_order_operations_reviews r JOIN staff_users u ON u.id=r.reviewed_by
    WHERE r.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND r.site_id=nullif(current_setting('app.site_id',true),'')::uuid AND r.work_order_id=$1
    ORDER BY r.reviewed_work_order_version DESC,r.id DESC LIMIT 1`,[id]);
  const reviewRow=reviewResult.rows[0] as {id:string;reviewedByName:string;reviewedAt:Date|string;notes:string;reviewedWorkOrderVersion:number}|undefined;
  const assignmentResult=await client.query(`SELECT a.id,a.lead_user_id AS "leadUserId",lead.display_name AS "leadName",a.operations_review_id AS "operationsReviewId",a.powertrain_class AS "powertrainClass",assigner.display_name AS "assignedByName",a.created_at AS "assignedAt",a.reason
    FROM work_order_lead_assignments a JOIN staff_users lead ON lead.id=a.lead_user_id JOIN staff_users assigner ON assigner.id=a.assigned_by
    WHERE a.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND a.site_id=nullif(current_setting('app.site_id',true),'')::uuid AND a.work_order_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,[id]);
  const assignmentRow=assignmentResult.rows[0] as {id:string;leadUserId:string;operationsReviewId:string|null}|undefined;
  const assignmentUsesLatestReview=Boolean(reviewRow&&assignmentRow?.operationsReviewId===reviewRow.id);
  const teamLeadAssignment=detailSchema.shape.teamLeadAssignment.parse(assignmentUsesLatestReview?assignmentResult.rows[0]:null);
  const operationsReview=detailSchema.shape.operationsReview.parse(reviewRow?{...reviewRow,isCurrent:reviewRow.reviewedWorkOrderVersion===summary.version}:null);
  const reviewCapability=await client.query(`SELECT EXISTS(
      SELECT 1 FROM staff_authority_grants g JOIN memberships m ON m.user_id=g.staff_user_id AND m.site_id=g.site_id
      WHERE g.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
        AND g.site_id=nullif(current_setting('app.site_id',true),'')::uuid
        AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND g.capability='work-order.operations-review' AND g.revoked_at IS NULL
        AND g.valid_from<=now() AND (g.valid_until IS NULL OR g.valid_until>now()) AND m.active AND m.can_write
    ) AS "canReviewOperations"`);
  const canReviewOperations=z.object({canReviewOperations:z.boolean()}).parse(reviewCapability.rows[0]).canReviewOperations;
  const workPlanResult=teamLeadAssignment?await client.query(`SELECT r.id,r.revision_number AS "revisionNumber",r.lead_assignment_id AS "leadAssignmentId",
      r.created_work_order_version AS "workOrderVersion",author.display_name AS "plannedBy",r.created_at AS "plannedAt",r.rationale,
      coalesce(jsonb_agg(jsonb_build_object('taskId',t.id,'reference','T'||lpad(t.ordinal::text,2,'0'),'title',t.title) ORDER BY line.line_number),'[]'::jsonb) AS tasks,
       (SELECT h.work_order_version FROM work_order_supervisor_handoffs h WHERE h.organisation_id=r.organisation_id AND h.site_id=r.site_id AND h.work_order_id=r.work_order_id AND h.work_plan_revision_id=r.id ORDER BY h.created_at DESC,h.id DESC LIMIT 1) AS "handoffWorkOrderVersion",
       coalesce((SELECT NOT EXISTS (
         SELECT 1 FROM domain_events event WHERE event.organisation_id=h.organisation_id AND event.site_id=h.site_id
           AND event.aggregate_id=h.work_order_id AND event.aggregate_version>h.work_order_version
           AND event.event_type<>'work-order.tasks-assigned'
       ) FROM work_order_supervisor_handoffs h
         WHERE h.organisation_id=r.organisation_id AND h.site_id=r.site_id AND h.work_order_id=r.work_order_id AND h.work_plan_revision_id=r.id
         ORDER BY h.created_at DESC,h.id DESC LIMIT 1),false) AS "handoffHasNoInvalidatingEvents"
    FROM work_order_work_plan_revisions r JOIN staff_users author ON author.id=r.planned_by
    JOIN work_order_work_plan_revision_tasks line ON line.organisation_id=r.organisation_id AND line.site_id=r.site_id AND line.work_order_id=r.work_order_id AND line.work_plan_revision_id=r.id
    JOIN tasks t ON t.organisation_id=line.organisation_id AND t.site_id=line.site_id AND t.work_order_id=line.work_order_id AND t.id=line.task_id
    WHERE r.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND r.site_id=nullif(current_setting('app.site_id',true),'')::uuid AND r.work_order_id=$1 AND r.lead_assignment_id=$2
    GROUP BY r.id,author.display_name ORDER BY r.revision_number DESC LIMIT 1`,[id,teamLeadAssignment.id]):{rows:[]};
  const rawWorkPlan=workPlanResult.rows[0];
  let workPlan:WorkOrderDetail['workPlan']=null;
  if(rawWorkPlan){
     const parsed=z.object({...workPlanSchema.shape,isCurrent:z.boolean().optional(),handoffWorkOrderVersion:z.number().int().nullable(),handoffHasNoInvalidatingEvents:z.boolean()}).parse({...rawWorkPlan,isCurrent:false});
     workPlan=workPlanSchema.parse({...parsed,isCurrent:parsed.workOrderVersion===summary.version||(parsed.handoffWorkOrderVersion!==null&&parsed.handoffWorkOrderVersion<=summary.version&&parsed.handoffHasNoInvalidatingEvents)});
  }
  const supervisorResult=await client.query(`SELECT h.supervisor_user_id AS "supervisorUserId",supervisor.display_name AS "supervisorName",assigner.display_name AS "assignedByName",h.powertrain_class AS "powertrainClass",h.created_at AS "assignedAt",h.reason,h.work_plan_revision_id AS "workPlanRevisionId",r.revision_number AS "workPlanRevisionNumber",h.work_order_version AS "workOrderVersion"
    FROM work_order_supervisor_handoffs h JOIN staff_users supervisor ON supervisor.id=h.supervisor_user_id JOIN staff_users assigner ON assigner.id=h.assigned_by
    JOIN work_order_work_plan_revisions r ON r.organisation_id=h.organisation_id AND r.site_id=h.site_id AND r.work_order_id=h.work_order_id AND r.id=h.work_plan_revision_id
    WHERE h.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND h.site_id=nullif(current_setting('app.site_id',true),'')::uuid AND h.work_order_id=$1 AND h.work_plan_revision_id=$2
      AND h.lead_assignment_id=(SELECT a.id FROM work_order_lead_assignments a WHERE a.organisation_id=h.organisation_id AND a.site_id=h.site_id AND a.work_order_id=h.work_order_id ORDER BY a.created_at DESC,a.id DESC LIMIT 1)
      AND EXISTS(SELECT 1 FROM work_order_lead_assignments a WHERE a.id=h.lead_assignment_id AND a.operations_review_id=(SELECT x.id FROM work_order_operations_reviews x WHERE x.organisation_id=h.organisation_id AND x.site_id=h.site_id AND x.work_order_id=h.work_order_id ORDER BY x.reviewed_work_order_version DESC,x.id DESC LIMIT 1))
    ORDER BY h.created_at DESC,h.id DESC LIMIT 1`,[id,workPlan?.id??null]);
  const rawHandoff=supervisorResult.rows[0];
   const supervisorHandoff=detailSchema.shape.supervisorHandoff.parse(rawHandoff?{...rawHandoff,isCurrent:workPlan?.isCurrent===true}:null);
  let workPlanBlockReason:z.infer<typeof workPlanBlockReasonSchema>|null='assigned-lead-required';
  if(!assignmentRow) workPlanBlockReason='assigned-lead-required';
  else if(!assignmentUsesLatestReview) workPlanBlockReason='operations-review-required';
  else if(assignmentRow.leadUserId!==z.string().uuid().nullable().parse(await client.query("SELECT nullif(current_setting('app.actor_id',true),'')::uuid AS actor").then(result=>result.rows[0]?.actor))) workPlanBlockReason='assigned-lead-required';
  else {
    const eligibility=await client.query(`SELECT
      EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND m.site_id=nullif(current_setting('app.site_id',true),'')::uuid AND m.active AND m.can_write) AS "canWrite",
      EXISTS(SELECT 1 FROM staff_authority_grants g WHERE g.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND g.site_id=nullif(current_setting('app.site_id',true),'')::uuid AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND g.capability='work-order.prepare-work-plan' AND g.revoked_at IS NULL AND g.valid_from<=clock_timestamp() AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())) AS "hasGrant",
      EXISTS(SELECT 1 FROM staff_qualifications q JOIN staff_users u ON u.id=q.staff_user_id JOIN memberships m ON m.user_id=u.id AND m.site_id=q.site_id
        WHERE q.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND q.site_id=nullif(current_setting('app.site_id',true),'')::uuid AND q.staff_user_id=$1 AND q.qualification_code=$2
          AND q.state='accepted' AND q.powertrain_classes @> ARRAY[$3]::text[] AND q.restrictions='[]'::jsonb
          AND q.qualification_revision=(SELECT max(q2.qualification_revision) FROM staff_qualifications q2 WHERE q2.organisation_id=q.organisation_id AND q2.site_id=q.site_id AND q2.staff_user_id=q.staff_user_id AND q2.qualification_code=q.qualification_code AND q2.state<>'pending')
          AND q.valid_from<=clock_timestamp() AND (q.valid_until IS NULL OR q.valid_until>clock_timestamp()) AND u.active AND m.active) AS "hasQualification"`,[assignmentRow.leadUserId,`${extra.powertrainClass}-TEAM-LEAD`,extra.powertrainClass]);
    const can= z.object({canWrite:z.boolean(),hasGrant:z.boolean(),hasQualification:z.boolean()}).parse(eligibility.rows[0]);
    if(!can.canWrite) workPlanBlockReason='site-write-required';
    else if(!can.hasGrant) workPlanBlockReason='authority-required';
    else if(!can.hasQualification) workPlanBlockReason='qualification-required';
    else if(!tasks.rowCount) workPlanBlockReason='planned-tasks-required';
    else workPlanBlockReason=null;
  }
  const canPrepareWorkPlan=workPlanBlockReason===null;
  const workflowContext=projectWorkOrderWorkflowContext({version:summary.version,canReviewOperations,operationsReview,teamLeadAssignment,workPlan,canPrepareWorkPlan,workPlanBlockReason,supervisorHandoff});
  return detailSchema.parse({...summary,...extra,canReviewOperations,operationsReview,teamLeadAssignment,supervisorHandoff,workPlan,canPrepareWorkPlan,workPlanBlockReason,workflowContext,vehicleHistory:historyItems,complaints:complaints.rows,tasks:tasks.rows,holds:holds.rows,evidence:evidence.rows,diagnosticFindings:diagnosticFindings.rows,intakeFacts:intakeFacts.rows,history:history.rows,gates});
}

export type WorkOrderQueue = 'all'|'operations'|'awaiting-operations'|'held'|'awaiting-lead'|'assigned'|'team-lead'|'supervisor';

export async function listWorkOrders(pool: Database, scope: Scope, q: string, requestId: string, queue: WorkOrderQueue = 'all', page = 1, pageSize = 25) {
  return scoped(pool,scope,async client => {
    await requireActiveReadMembership(client,scope);
    const pattern=`%${q.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')}%`;
    const where=`($1='' OR w.reference ILIKE $2 OR v.vin ILIKE $2 OR v.registration ILIKE $2 OR p.display_name ILIKE $2)
      AND ($3='all'
        OR ($3='operations' AND NOT EXISTS (
          SELECT 1 FROM work_order_lead_assignments a
          WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id
            AND a.operations_review_id=(SELECT r.id FROM work_order_operations_reviews r
              WHERE r.organisation_id=w.organisation_id AND r.site_id=w.site_id AND r.work_order_id=w.id
              ORDER BY r.reviewed_work_order_version DESC,r.id DESC LIMIT 1)
        ))
        OR ($3='team-lead' AND EXISTS (
          SELECT 1 FROM work_order_lead_assignments a
          WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id
            AND a.id=(SELECT latest.id FROM work_order_lead_assignments latest
              WHERE latest.organisation_id=w.organisation_id AND latest.site_id=w.site_id AND latest.work_order_id=w.id
              ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
            AND a.lead_user_id=$4
        ))
        OR ($3='supervisor' AND EXISTS (
          SELECT 1 FROM work_order_supervisor_handoffs h
          WHERE h.organisation_id=w.organisation_id AND h.site_id=w.site_id AND h.work_order_id=w.id
            AND h.id=(SELECT latest.id FROM work_order_supervisor_handoffs latest
              WHERE latest.organisation_id=w.organisation_id AND latest.site_id=w.site_id AND latest.work_order_id=w.id
              ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
            AND h.supervisor_user_id=$4
        ))
        OR ($3='held' AND EXISTS (
          SELECT 1 FROM holds h
          WHERE h.organisation_id=w.organisation_id AND h.site_id=w.site_id AND h.work_order_id=w.id
        ))
        OR ($3='awaiting-operations' AND (
          NOT EXISTS (SELECT 1 FROM work_order_operations_reviews r
            WHERE r.organisation_id=w.organisation_id AND r.site_id=w.site_id AND r.work_order_id=w.id
              AND r.id=(SELECT latest.id FROM work_order_operations_reviews latest
                WHERE latest.organisation_id=w.organisation_id AND latest.site_id=w.site_id AND latest.work_order_id=w.id
                ORDER BY latest.reviewed_work_order_version DESC,latest.id DESC LIMIT 1)
              AND r.reviewed_work_order_version=w.version)
          AND NOT EXISTS (SELECT 1 FROM work_order_lead_assignments a
            WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id
              AND a.id=(SELECT latest.id FROM work_order_lead_assignments latest
                WHERE latest.organisation_id=w.organisation_id AND latest.site_id=w.site_id AND latest.work_order_id=w.id
                ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
              AND a.operations_review_id=(SELECT latest.id FROM work_order_operations_reviews latest
                WHERE latest.organisation_id=w.organisation_id AND latest.site_id=w.site_id AND latest.work_order_id=w.id
                ORDER BY latest.reviewed_work_order_version DESC,latest.id DESC LIMIT 1))
        ))
        OR ($3='awaiting-lead' AND EXISTS (
          SELECT 1 FROM work_order_operations_reviews r
          WHERE r.organisation_id=w.organisation_id AND r.site_id=w.site_id AND r.work_order_id=w.id
            AND r.id=(SELECT latest.id FROM work_order_operations_reviews latest
              WHERE latest.organisation_id=w.organisation_id AND latest.site_id=w.site_id AND latest.work_order_id=w.id
              ORDER BY latest.reviewed_work_order_version DESC,latest.id DESC LIMIT 1)
            AND r.reviewed_work_order_version=w.version
            AND NOT EXISTS (SELECT 1 FROM work_order_lead_assignments a
              WHERE a.organisation_id=r.organisation_id AND a.site_id=r.site_id
                AND a.work_order_id=r.work_order_id AND a.operations_review_id=r.id)
        ))
        OR ($3='assigned' AND EXISTS (
          SELECT 1 FROM work_order_lead_assignments a
          WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id
            AND a.id=(SELECT latest.id FROM work_order_lead_assignments latest
              WHERE latest.organisation_id=w.organisation_id AND latest.site_id=w.site_id AND latest.work_order_id=w.id
              ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
            AND a.operations_review_id=(SELECT latest.id FROM work_order_operations_reviews latest
              WHERE latest.organisation_id=w.organisation_id AND latest.site_id=w.site_id AND latest.work_order_id=w.id
              ORDER BY latest.reviewed_work_order_version DESC,latest.id DESC LIMIT 1)
        )))`;
    const values=[q,pattern,queue,scope.actorId];
    const matching = await client.query(`SELECT count(*)::int AS total_items FROM work_orders w LEFT JOIN parties p ON p.id=w.client_party_id AND p.organisation_id=w.organisation_id JOIN vehicles v ON v.id=w.vehicle_id WHERE ${where}`,values);
    const totalItems=z.object({total_items:z.number()}).parse(matching.rows[0]).total_items;
    const totalPages=Math.ceil(totalItems/pageSize);
    const effectivePage=Math.min(page,Math.max(1,totalPages));
    const found = await client.query(`${summarySql} WHERE ${where} ORDER BY w.created_at DESC,w.id LIMIT $5 OFFSET $6`,[...values,pageSize,(effectivePage-1)*pageSize]);
    const counts = await client.query(`SELECT count(*)::int AS open,count(*) FILTER (WHERE EXISTS(SELECT 1 FROM holds h WHERE h.work_order_id=w.id))::int AS held,count(*)::int AS "intakeDrafts" FROM work_orders w`);
    const projection={items:z.array(summarySchema).parse(found.rows),pagination:{page:effectivePage,pageSize,totalItems,totalPages},totals:z.object({open:z.number(),held:z.number(),intakeDrafts:z.number()}).parse(counts.rows[0]),asOf:new Date().toISOString()};
    await recordSensitiveRead(client,scope,'work-order-queue-read-prepared',projection.items.length,requestId);
    return projection;
  });
}

export async function findVehicleAtSite(pool: Database, scope: Scope, vin: string, requestId: string) {
  return scoped(pool,scope,async client => {
    await requireActiveReadMembership(client,scope);
    const found=await client.query(`SELECT v.id,v.vin,v.registration,v.make,v.model,v.variant,v.powertrain
      FROM vehicles v
      WHERE v.organisation_id=$1 AND v.vin=$2
        AND (EXISTS (SELECT 1 FROM visits x WHERE x.organisation_id=v.organisation_id AND x.site_id=$3 AND x.vehicle_id=v.id)
          OR EXISTS (SELECT 1 FROM public.sales_deliveries d WHERE d.organisation_id=v.organisation_id AND d.site_id=$3 AND d.vehicle_id=v.id)
          OR (EXISTS (SELECT 1 FROM public.delivery_preparations p WHERE p.organisation_id=v.organisation_id AND p.site_id=$3 AND p.vehicle_id=v.id)
            AND EXISTS (SELECT 1 FROM public.staff_role_placements r
              JOIN public.staff_role_profiles rp ON rp.code=r.role_code AND rp.active
              JOIN public.staff_users ru ON ru.id=r.staff_user_id AND ru.active
              WHERE r.organisation_id=$1 AND r.site_id=$3 AND r.staff_user_id=$4 AND r.state='active'
                AND r.role_code=ANY(ARRAY['head-service-centre','sales-representative','pdi-observer']::text[]))))
      LIMIT 1`,[scope.organisationId,vin,scope.siteId,scope.actorId]);
    const projection=vehicleMatchSchema.parse(found.rows[0]??null);
    await recordSensitiveRead(client,scope,'vehicle-lookup-read-prepared',projection?1:0,requestId);
    return projection;
  });
}

export async function findClientsAtSite(pool:Database,scope:Scope,query:string,requestId:string) {
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    const found=await client.query(`SELECT p.id,p.client_code AS "clientCode",p.party_kind AS kind,p.display_name AS name
      FROM parties p WHERE p.organisation_id=$1 AND p.client_code IS NOT NULL
        AND EXISTS(SELECT 1 FROM work_orders w WHERE w.organisation_id=p.organisation_id AND w.site_id=$2 AND w.client_party_id=p.id)
        AND (p.client_code ILIKE $3 OR p.display_name ILIKE $3)
      ORDER BY p.display_name,p.client_code LIMIT 20`,[scope.organisationId,scope.siteId,`%${query.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')}%`]);
    const projection=clientMatchSchema.parse(found.rows);
    await recordSensitiveRead(client,scope,'client-lookup-read-prepared',projection.length,requestId);
    return projection;
  });
}

export async function findPartiesAtSite(pool:Database,scope:Scope,query:string,requestId:string) {
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    const escaped=`%${query.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')}%`;
    const found=await client.query(`SELECT DISTINCT p.id,p.party_kind AS kind,p.display_name AS name
      FROM parties p WHERE p.organisation_id=$1 AND p.party_kind IN ('person','organisation')
        AND (EXISTS(SELECT 1 FROM work_orders w WHERE w.organisation_id=p.organisation_id AND w.site_id=$2 AND w.client_party_id=p.id)
          OR EXISTS(SELECT 1 FROM visits v WHERE v.organisation_id=p.organisation_id AND v.site_id=$2 AND v.visit_contact_party_id=p.id)
          OR EXISTS(SELECT 1 FROM vehicle_owner_observations o WHERE o.organisation_id=p.organisation_id AND o.site_id=$2 AND o.party_id=p.id))
        AND p.display_name ILIKE $3 ESCAPE '\\'
      ORDER BY p.display_name,p.id LIMIT 20`,[scope.organisationId,scope.siteId,escaped]);
    const projection=partyMatchSchema.parse(found.rows);
    await recordSensitiveRead(client,scope,'party-lookup-read-prepared',projection.length,requestId);
    return projection;
  });
}

function requireSiteWrite(canWrite: boolean) {
  if (!canWrite) throw new ApiError(403,'READ_ONLY','Your site membership does not permit changes.');
}

async function lockVersion(client: PoolClient, id: string, expected: number) {
  const found = await client.query('SELECT version FROM work_orders WHERE id=$1 FOR UPDATE',[id]);
  if (!found.rows.length) notFound();
  const {version} = z.object({version:z.number().int()}).parse(found.rows[0]);
  if (version !== expected) throw new ApiError(409,'STALE_VERSION','This work order changed. Refresh it and review the latest information before submitting again.',version);
  await client.query('UPDATE work_orders SET version=version+1 WHERE id=$1',[id]);
  return version;
}

export async function createIntake(pool: Database, scope: Scope, key: string, body: z.infer<typeof intakeSchema>, source?:{requestId:string;expectedVersion:number;reason:string}) {
  let shared=false;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'reception.draft-created',targetAggregateId:source?.requestId??'new',payload:source?{intake:body,source}:body,responseSchema:detailSchema,
    lockSerializationRoots:async client=>{
      if(source){
        shared=await requestAccess(client,scope);
        const found=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,source.requestId]);
        if(!found.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
      }
      await lockAdvisoryRoots(client,[
      ...(body.vehicle.kind==='new'?[`vin:${scope.organisationId}:${body.vehicle.vin}`]:[]),
      ...(body.client.kind==='new'&&body.client.clientCode?[`client-code:${scope.organisationId}:${body.client.clientCode}`]:[]),
      ...(body.client.kind==='existing'?[`client-booking:${scope.organisationId}:${body.client.partyId}`]:[]),
    ]);},
    authorize:async(_client,membership)=>{requireSiteWrite(membership.canWrite);if(source&&!shared)throw new ApiError(403,'ROLE_REQUIRED','Only customer care staff or the Head can create a job from a request.');},
    apply:async client => {
    if(source){
      const found=await client.query('SELECT version,status FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,source.requestId]);
      const current=z.object({version:z.number().int().positive(),status:z.string()}).parse(found.rows[0]);
      if(current.version!==source.expectedVersion)throw new ApiError(409,'STALE_VERSION','This request changed. Refresh and try again.',current.version);
      if(current.status!=='open')throw new ApiError(409,'REQUEST_NOT_OPEN','This request is already linked or closed.');
    }
    let vehicleId:string;
    if (body.vehicle.kind==='new') {
      const duplicate = await client.query('SELECT id FROM vehicles WHERE organisation_id=$1 AND vin=$2',[scope.organisationId,body.vehicle.vin]);
      if (duplicate.rows.length) throw new ApiError(409,'VEHICLE_RECORDED','This vehicle could not be added as a new record. Search this site or ask an administrator to review the VIN.');
      vehicleId=randomUUID();
    } else {
      const selected=await client.query(`SELECT v.id FROM vehicles v
        WHERE v.organisation_id=$1 AND v.id=$2
          AND EXISTS (SELECT 1 FROM visits x WHERE x.organisation_id=v.organisation_id AND x.site_id=$3 AND x.vehicle_id=v.id)
        LIMIT 1`,[scope.organisationId,body.vehicle.vehicleId,scope.siteId]);
      if (!selected.rows.length) notFound();
      vehicleId=body.vehicle.vehicleId;
    }
    let clientPartyId:string,clientCode:string;
    if(body.client.kind==='existing'){
      const selectedClient=await client.query(`SELECT p.id,p.client_code FROM parties p
        WHERE p.id=$1 AND p.organisation_id=$2 AND p.party_kind IN ('person','organisation')
          AND EXISTS(SELECT 1 FROM work_orders w WHERE w.organisation_id=p.organisation_id AND w.site_id=$3 AND w.client_party_id=p.id)`,[body.client.partyId,scope.organisationId,scope.siteId]);
      if(!selectedClient.rowCount) throw new ApiError(404,'CLIENT_NOT_FOUND','Select a client already recorded at this service centre.');
      const selected=z.object({id:z.string().uuid(),client_code:z.string()}).parse(selectedClient.rows[0]);
      clientPartyId=selected.id;clientCode=selected.client_code;
    }else{
      clientPartyId=randomUUID();
      clientCode=body.client.clientCode??`CL${String((await client.query("SELECT nextval('client_code_seq')::text AS value")).rows[0]?.value).padStart(6,'0')}`;
      if(body.client.clientCode){
        const duplicateCode=await client.query('SELECT 1 FROM parties WHERE organisation_id=$1 AND upper(client_code)=upper($2)',[scope.organisationId,clientCode]);
        if(duplicateCode.rowCount) throw new ApiError(409,'CLIENT_CODE_TAKEN','That client code is already in use. Search for the client and select the existing record.');
      }
      await client.query('INSERT INTO parties(id,organisation_id,party_kind,display_name,phone,email,client_code) VALUES($1,$2,$3,$4,$5,$6,$7)',[clientPartyId,scope.organisationId,body.client.partyKind,body.client.name,body.client.phone||null,body.client.email||null,clientCode]);
    }
    const selectParty=async(partyId:string,allowedKinds:string[],role:string)=>{
      const selected=await client.query(`SELECT p.id FROM parties p WHERE p.id=$1 AND p.organisation_id=$2 AND p.party_kind=ANY($3::text[])
        AND (EXISTS(SELECT 1 FROM work_orders w WHERE w.organisation_id=p.organisation_id AND w.site_id=$4 AND w.client_party_id=p.id)
          OR EXISTS(SELECT 1 FROM visits v WHERE v.organisation_id=p.organisation_id AND v.site_id=$4 AND v.visit_contact_party_id=p.id)
          OR EXISTS(SELECT 1 FROM vehicle_owner_observations o WHERE o.organisation_id=p.organisation_id AND o.site_id=$4 AND o.party_id=p.id))`,[partyId,scope.organisationId,allowedKinds,scope.siteId]);
      if(!selected.rowCount) throw new ApiError(404,'PARTY_NOT_FOUND_AT_SITE',`Select a ${role} already recorded at this service centre.`);
      return partyId;
    };
    const ownerPartyId=body.owner.kind==='existing'?await selectParty(body.owner.partyId,['person','organisation'],'vehicle owner'):randomUUID();
    const contactPartyId=body.visitContact.kind==='existing'?await selectParty(body.visitContact.partyId,['person'],'visit contact'):randomUUID();
    const visitId=randomUUID(),workOrderId=randomUUID(),complaintId=randomUUID(),ownerObservationId=randomUUID();
    if(body.owner.kind==='new') await client.query('INSERT INTO parties(id,organisation_id,party_kind,display_name,phone,email) VALUES($1,$2,$3,$4,$5,$6)',[ownerPartyId,scope.organisationId,body.owner.partyKind,body.owner.name,body.owner.phone||null,body.owner.email||null]);
    if(body.visitContact.kind==='new') await client.query("INSERT INTO parties(id,organisation_id,party_kind,display_name,phone,email) VALUES($1,$2,'person',$3,$4,$5)",[contactPartyId,scope.organisationId,body.visitContact.name,body.visitContact.phone||null,body.visitContact.email||null]);
    if (body.vehicle.kind==='new') await client.query('INSERT INTO vehicles(id,organisation_id,vin,registration,make,model,variant,powertrain) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[vehicleId,scope.organisationId,body.vehicle.vin,body.vehicle.registration,body.vehicle.make,body.vehicle.model,body.vehicle.variant,body.vehicle.powertrain]);
    await client.query('INSERT INTO visits(id,organisation_id,site_id,vehicle_id,visit_contact_party_id) VALUES($1,$2,$3,$4,$5)',[visitId,scope.organisationId,scope.siteId,vehicleId,contactPartyId]);
    await client.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'work-order')",[workOrderId,scope.organisationId,scope.siteId]);
    const allocated=await client.query('SELECT public.allocate_client_booking_sequence($1,$2) AS sequence',[scope.organisationId,clientPartyId]);
    const bookingSequence=z.number().int().positive().parse(allocated.rows[0]?.sequence);
    const reference=`${body.powertrainClass}-${clientCode}-${String(bookingSequence).padStart(5,'0')}${body.warrantyStatus==='confirmed'?'W':''}`;
    await client.query(`INSERT INTO work_orders(id,organisation_id,site_id,visit_id,customer_id,client_party_id,client_code_snapshot,client_booking_sequence,powertrain_class,warranty_status_at_booking,warranty_confirmation_note,vehicle_id,reference,odometer_km,soc_percent)
      VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[workOrderId,scope.organisationId,scope.siteId,visitId,clientPartyId,clientCode,bookingSequence,body.powertrainClass,body.warrantyStatus,body.warrantyStatus==='confirmed'?body.warrantyConfirmationNote:null,vehicleId,reference,body.odometerKm,body.socPercent]);
    await client.query("INSERT INTO vehicle_owner_observations(id,organisation_id,site_id,work_order_id,vehicle_id,party_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[ownerObservationId,scope.organisationId,scope.siteId,workOrderId,vehicleId,ownerPartyId,scope.actorId]);
    await client.query('INSERT INTO complaints(id,organisation_id,site_id,work_order_id,ordinal,wording) VALUES($1,$2,$3,$4,1,$5)',[complaintId,scope.organisationId,scope.siteId,workOrderId,body.complaint]);
    if(source){
      const version=source.expectedVersion+1,eventId=randomUUID();
      await client.query("UPDATE service_requests SET version=$4,status='converted',work_order_id=$5 WHERE organisation_id=$1 AND site_id=$2 AND id=$3",[scope.organisationId,scope.siteId,source.requestId,version,workOrderId]);
      await client.query(`INSERT INTO domain_events(id,organisation_id,site_id,aggregate_id,aggregate_type,aggregate_version,actor_id,event_type,reason,previous_state,new_state)
        VALUES($1,$2,$3,$4,'service-request',$5,$6,'service-request.linked-to-work-order',$7,$8,$9)`,[eventId,scope.organisationId,scope.siteId,source.requestId,version,scope.actorId,source.reason,JSON.stringify({version:source.expectedVersion,status:'open',workOrderId:null}),JSON.stringify({version,status:'converted',workOrderId})]);
      await client.query('INSERT INTO outbox(id,organisation_id,site_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',[randomUUID(),scope.organisationId,scope.siteId,eventId,JSON.stringify({eventId,aggregateId:source.requestId,aggregateType:'service-request',version,eventType:'service-request.linked-to-work-order'})]);
    }
    return {aggregateId:workOrderId,aggregateType:'work-order',version:1,previous:{},next:{version:1,clientPartyId,clientCode,clientBookingSequence:bookingSequence,powertrainClass:body.powertrainClass,warrantyStatusAtBooking:body.warrantyStatus,ownerPartyId,visitContactPartyId:contactPartyId,vehicleId,visitId,complaintId},reason:'Reception draft saved; payer, reported owner, and visit contact were recorded as separate identities. Owner remains unverified.'};
    },
    project:(client,mutation)=>detail(client,mutation.aggregateId),
  });
}

export async function addComplaint(pool: Database, scope: Scope, key: string, id: string, body: z.infer<typeof complaintSchema>) {
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'workshop.complaint-added',targetAggregateId:id,payload:body,responseSchema:detailSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,id),
    authorize:async(_client,membership)=>requireSiteWrite(membership.canWrite),
    apply:async client => {
    const version = await lockVersion(client,id,body.expectedVersion);
    const complaintId=randomUUID();
    await client.query('INSERT INTO complaints(id,organisation_id,site_id,work_order_id,ordinal,wording) SELECT $1,$2,$3,$4,coalesce(max(ordinal),0)+1,$5 FROM complaints WHERE work_order_id=$4',[complaintId,scope.organisationId,scope.siteId,id,body.wording]);
    return {aggregateId:id,aggregateType:'work-order',version:version+1,previous:{version},next:{version:version+1,complaintId},reason:'Customer complaint appended.'};
    },
    project:client=>detail(client,id),
  });
}

export async function addTask(pool: Database, scope: Scope, key: string, id: string, body: z.infer<typeof taskSchema>) {
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'workshop.task-planned',targetAggregateId:id,payload:body,responseSchema:detailSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,id),
    authorize:async(_client,membership)=>requireSiteWrite(membership.canWrite),
    apply:async client => {
    const version=await lockVersion(client,id,body.expectedVersion);
    const complaint=await client.query('SELECT id FROM complaints WHERE id=$1 AND work_order_id=$2',[body.complaintId,id]);
    if (!complaint.rows.length) notFound();
    const taskId=randomUUID();
    await client.query(`INSERT INTO tasks(id,organisation_id,site_id,work_order_id,complaint_id,ordinal,title) SELECT $1,$2,$3,$4,$5,coalesce(max(ordinal),0)+1,$6 FROM tasks WHERE work_order_id=$4`,[taskId,scope.organisationId,scope.siteId,id,body.complaintId,body.title]);
    return {aggregateId:id,aggregateType:'work-order',version:version+1,previous:{version},next:{version:version+1,taskId,complaintId:body.complaintId},reason:'Task planned; no work or scope approval granted.'};
    },
    project:client=>detail(client,id),
  });
}

export async function createWorkPlanRevision(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof workPlanCommandSchema>) {
  const responseSchema=z.object({workOrderId:uuid,workPlan:workPlanSchema,version:z.number().int().positive()});
  let decision:unknown;
  let selectedAssignmentId:string|undefined;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'work-order.plan-revised',targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,id),
    authorize:async(client,membership)=>{
      requireSiteWrite(membership.canWrite);
      const order=await client.query(`SELECT w.powertrain_class,la.id AS assignment_id,la.lead_user_id,la.operations_review_id,r.id AS latest_review_id
        FROM work_orders w
        LEFT JOIN LATERAL (SELECT id,lead_user_id,operations_review_id FROM work_order_lead_assignments a WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1) la ON true
        LEFT JOIN LATERAL (SELECT id FROM work_order_operations_reviews x WHERE x.organisation_id=w.organisation_id AND x.site_id=w.site_id AND x.work_order_id=w.id ORDER BY x.reviewed_work_order_version DESC,x.id DESC LIMIT 1) r ON true
        WHERE w.organisation_id=$1 AND w.site_id=$2 AND w.id=$3`,[scope.organisationId,scope.siteId,id]);
      if(!order.rowCount) notFound();
      if(!order.rows[0].assignment_id) throw new ApiError(409,'TEAM_LEAD_ASSIGNMENT_REQUIRED','Operations must assign a team lead before a work plan can be prepared.');
      if(!order.rows[0].latest_review_id||order.rows[0].operations_review_id!==order.rows[0].latest_review_id)
        throw new ApiError(409,'OPERATIONS_REVIEW_REQUIRED','A current Operations review and lead assignment are required before preparing a work plan.');
      if(order.rows[0].lead_user_id!==scope.actorId) throw new ApiError(403,'ASSIGNED_LEAD_REQUIRED','Only the currently assigned team lead can prepare this work plan.');
      const powertrainClass=z.enum(['EV','HYB','ICE']).parse(order.rows[0].powertrain_class);
      selectedAssignmentId=uuid.parse(order.rows[0].assignment_id);
      decision=await lockAssignmentDecision(client,'work-order.prepare-work-plan',scope.actorId,`${powertrainClass}-TEAM-LEAD`,powertrainClass);
    },
    apply:async client=>{
      const version=await lockVersion(client,id,body.expectedVersion);
      const validTasks=await client.query(`SELECT id FROM tasks WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND id=ANY($4::uuid[]) AND state='planned'`,[scope.organisationId,scope.siteId,id,body.taskIds]);
      if(validTasks.rowCount!==body.taskIds.length) throw new ApiError(409,'PLAN_TASKS_CHANGED','Choose current proposed tasks from this work order and try again.');
      const latest=await client.query('SELECT coalesce(max(revision_number),0)::int AS current FROM work_order_work_plan_revisions WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3',[scope.organisationId,scope.siteId,id]);
      const revisionNumber=z.object({current:z.number().int().nonnegative()}).parse(latest.rows[0]).current+1;
      const revisionId=randomUUID();
      const authorityDecision=assignmentDecisionSchema.parse(decision);
      const createdWorkOrderVersion=version+1;
      await client.query(`INSERT INTO work_order_work_plan_revisions(id,organisation_id,site_id,work_order_id,lead_assignment_id,revision_number,created_work_order_version,planned_by,rationale,authority_decision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[revisionId,scope.organisationId,scope.siteId,id,uuid.parse(selectedAssignmentId),revisionNumber,createdWorkOrderVersion,scope.actorId,body.rationale,JSON.stringify(authorityDecision)]);
      await client.query(`INSERT INTO work_order_work_plan_revision_tasks(organisation_id,site_id,work_order_id,work_plan_revision_id,task_id,line_number)
        SELECT $1,$2,$3,$4,task_id,line_number::int FROM unnest($5::uuid[]) WITH ORDINALITY AS selected(task_id,line_number)`,[scope.organisationId,scope.siteId,id,revisionId,body.taskIds]);
      return {aggregateId:id,aggregateType:'work-order',version:createdWorkOrderVersion,previous:{version},next:{version:createdWorkOrderVersion,revisionId,revisionNumber,leadAssignmentId:selectedAssignmentId,taskIds:body.taskIds,state:'draft',authorityDecision},reason:body.rationale};
    },
    project:async(client,mutation)=>{
      const current=await detail(client,id);
      return responseSchema.parse({workOrderId:id,workPlan:current.workPlan,version:mutation.version});
    },
  });
}

export async function openHold(pool: Database, scope: Scope, key: string, id: string, body: z.infer<typeof holdSchema>) {
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'safety.hold-opened',targetAggregateId:id,payload:body,responseSchema:detailSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,id),
    authorize:async(_client,membership)=>requireSiteWrite(membership.canWrite),
    apply:async client => {
    const version=await lockVersion(client,id,body.expectedVersion);
    const taskId=body.scope.kind==='task'?body.scope.taskId:null;
    if (taskId) {
      const task=await client.query('SELECT id FROM tasks WHERE id=$1 AND work_order_id=$2',[taskId,id]);
      if (!task.rows.length) notFound();
    }
    const holdId=randomUUID();
    await client.query('INSERT INTO holds(id,organisation_id,site_id,work_order_id,task_id,category,severity,reason,source,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[holdId,scope.organisationId,scope.siteId,id,taskId,body.category,body.severity,body.reason,body.source,scope.actorId]);
    return {aggregateId:id,aggregateType:'work-order',version:version+1,previous:{version},next:{version:version+1,holdId,taskId},reason:body.reason};
    },
    project:client=>detail(client,id),
  });
}

const assignmentDecisionSchema=z.object({
  grant:z.object({id:uuid,grant_revision:z.number().int().positive()}).passthrough(),
  qualification:z.object({id:uuid,qualification_revision:z.number().int().positive()}).passthrough(),
  decidedAt:z.iso.datetime(),
});

const operationsReviewDecisionSchema=z.object({
  grant:z.object({id:uuid,grant_revision:z.number().int().positive()}).passthrough(),
  decidedAt:z.iso.datetime(),
});

async function lockOperationsReviewDecision(client:PoolClient) {
  const grant=await client.query("SELECT public.lock_work_order_authority_grant('work-order.operations-review') AS grant");
  if(!grant.rows[0]?.grant) throw new ApiError(403,'AUTHORITY_REQUIRED','An active Operations review grant is required.');
  const clock=await client.query('SELECT clock_timestamp() AS at');
  return operationsReviewDecisionSchema.parse({grant:grant.rows[0].grant,decidedAt:z.date().parse(clock.rows[0].at).toISOString()});
}

export async function recordOperationsReview(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof operationsReviewCommandSchema>) {
  let decision:unknown;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'operations.work-order-reviewed',targetAggregateId:id,payload:body,responseSchema:operationsReviewResultSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,id),
    authorize:async(client,membership)=>{
      requireSiteWrite(membership.canWrite);
      decision=await lockOperationsReviewDecision(client);
    },
    apply:async client=>{
      const version=await lockVersion(client,id,body.expectedVersion);
      const prior=await client.query(`SELECT id FROM work_order_operations_reviews
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND reviewed_work_order_version=$4`,[scope.organisationId,scope.siteId,id,version]);
      if(prior.rowCount) throw new ApiError(409,'OPERATIONS_REVIEW_ALREADY_RECORDED','Operations has already reviewed this version of the work order. Refresh after the work order changes before reviewing again.');
      const authorityDecision=operationsReviewDecisionSchema.parse(decision);
      const reviewId=randomUUID();
      const reviewedWorkOrderVersion=version+1;
      await client.query(`INSERT INTO work_order_operations_reviews(id,organisation_id,site_id,work_order_id,reviewed_by,reviewed_at,notes,reviewed_work_order_version,authority_decision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[reviewId,scope.organisationId,scope.siteId,id,scope.actorId,authorityDecision.decidedAt,body.notes,reviewedWorkOrderVersion,JSON.stringify(authorityDecision)]);
      const reviewer=await client.query('SELECT display_name AS name FROM staff_users WHERE id=$1',[scope.actorId]);
      const reviewerName=z.object({name:z.string()}).parse(reviewer.rows[0]).name;
      const next={version:version+1,reviewId,reviewedAt:authorityDecision.decidedAt,reviewedByName:reviewerName,reviewedWorkOrderVersion,notes:body.notes,authorityDecision};
      return {aggregateId:id,aggregateType:'work-order',version:version+1,previous:{version,operationsReviewId:null},next,reason:'Operations review recorded.'};
    },
    project:async(_client,mutation)=>{
      const next=z.object({reviewId:uuid,reviewedByName:z.string(),reviewedAt:z.iso.datetime(),reviewedWorkOrderVersion:z.number().int().positive()}).parse(mutation.next);
      return operationsReviewResultSchema.parse({workOrderId:id,...next,reviewerName:next.reviewedByName,version:mutation.version});
    },
  });
}

async function lockAssignmentDecision(client:PoolClient,capability:'work-order.assign-lead'|'work-order.handoff-supervisor'|'work-order.prepare-work-plan',targetUserId:string,qualificationCode:string,powertrainClass:string) {
  const grant=await client.query('SELECT public.lock_work_order_authority_grant($1) AS grant',[capability]);
  if(!grant.rows[0]?.grant) throw new ApiError(403,'AUTHORITY_REQUIRED','An active site assignment authority grant is required.');
  const qualification=await client.query('SELECT public.lock_work_order_assignment_qualification($1,$2,$3) AS qualification',[targetUserId,qualificationCode,powertrainClass]);
  if(!qualification.rows[0]?.qualification) {
    const lead=capability==='work-order.assign-lead';
    throw new ApiError(409,lead?'LEAD_NOT_QUALIFIED':'SUPERVISOR_NOT_QUALIFIED',`The selected ${lead?'lead':'supervisor'} lacks an active site qualification for this vehicle class.`);
  }
  const clock=await client.query('SELECT clock_timestamp() AS at');
  return assignmentDecisionSchema.parse({grant:grant.rows[0].grant,qualification:qualification.rows[0].qualification,decidedAt:z.date().parse(clock.rows[0].at).toISOString()});
}

export async function assignTeamLead(pool: Database, scope: Scope, key: string, id: string, body: z.infer<typeof leadAssignmentSchema>) {
  const responseSchema=z.object({workOrderId:uuid,leadUserId:uuid,operationsReviewId:uuid,powertrainClass:z.enum(['EV','HYB','ICE']),assignedAt:z.iso.datetime()});
  let decision:unknown;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'operations.team-lead-assigned',targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,id),
    authorize:async(client,membership)=>{
      requireSiteWrite(membership.canWrite);
      const order=await client.query('SELECT powertrain_class FROM work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
      if(!order.rowCount) notFound();
      const review=await client.query(`SELECT id,reviewed_work_order_version FROM work_order_operations_reviews
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 ORDER BY reviewed_work_order_version DESC,id DESC LIMIT 1`,[scope.organisationId,scope.siteId,id]);
      const latestReview=z.object({id:uuid,reviewed_work_order_version:z.number().int()}).safeParse(review.rows[0]);
      if(!latestReview.success||latestReview.data.id!==body.operationsReviewId||latestReview.data.reviewed_work_order_version!==body.expectedVersion)
        throw new ApiError(409,'OPERATIONS_REVIEW_REQUIRED','Record an Operations review for the current work-order version before assigning a team lead.');
      const powertrainClass=z.enum(['EV','HYB','ICE']).parse(order.rows[0].powertrain_class);
      decision=await lockAssignmentDecision(client,'work-order.assign-lead',body.leadUserId,`${powertrainClass}-TEAM-LEAD`,powertrainClass);
    },
    apply:async client=>{
      const version=await lockVersion(client,id,body.expectedVersion);
      const order=await client.query('SELECT powertrain_class FROM work_orders WHERE id=$1',[id]);
      const powertrainClass=z.enum(['EV','HYB','ICE']).parse(order.rows[0].powertrain_class);
      const authorityDecision=assignmentDecisionSchema.parse(decision);
      const assignmentId=randomUUID();
      await client.query(`INSERT INTO work_order_lead_assignments(id,organisation_id,site_id,work_order_id,lead_user_id,powertrain_class,assigned_by,reason,authority_decision,operations_review_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[assignmentId,scope.organisationId,scope.siteId,id,body.leadUserId,powertrainClass,scope.actorId,body.reason,JSON.stringify(authorityDecision),body.operationsReviewId]);
      const assignedAt=authorityDecision.decidedAt;
      return {aggregateId:id,aggregateType:'work-order',version:version+1,previous:{version},next:{version:version+1,assignmentId,operationsReviewId:body.operationsReviewId,leadUserId:body.leadUserId,powertrainClass,assignedAt,authorityDecision},reason:body.reason};
    },
    project:async(_client,mutation)=>responseSchema.parse({workOrderId:id,leadUserId:body.leadUserId,operationsReviewId:body.operationsReviewId,...z.object({powertrainClass:z.enum(['EV','HYB','ICE']),assignedAt:z.iso.datetime()}).parse(mutation.next)}),
  });
}

export async function handoffToSupervisor(pool: Database, scope: Scope, key: string, id: string, body: z.infer<typeof supervisorHandoffSchema>) {
  const responseSchema=z.object({workOrderId:uuid,supervisorUserId:uuid,powertrainClass:z.enum(['EV','HYB','ICE']),assignedAt:z.iso.datetime(),workPlanRevisionId:uuid,workPlanRevisionNumber:z.number().int().positive(),version:z.number().int().positive()});
  let decision:unknown;
  let selectedAssignment:unknown;
  let selectedWorkPlan:unknown;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'work-order.supervisor-handed-off',targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,id),
    authorize:async(client,membership)=>{
      requireSiteWrite(membership.canWrite);
      const order=await client.query(`SELECT w.powertrain_class,la.id AS assignment_id,la.lead_user_id,la.operations_review_id,r.id AS latest_review_id FROM work_orders w
        LEFT JOIN LATERAL (SELECT id,lead_user_id,operations_review_id FROM work_order_lead_assignments a WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1) la ON true
        LEFT JOIN LATERAL (SELECT id FROM work_order_operations_reviews x WHERE x.organisation_id=w.organisation_id AND x.site_id=w.site_id AND x.work_order_id=w.id ORDER BY x.reviewed_work_order_version DESC,x.id DESC LIMIT 1) r ON true
        WHERE w.organisation_id=$1 AND w.site_id=$2 AND w.id=$3`,[scope.organisationId,scope.siteId,id]);
      if(!order.rowCount) notFound();
      if(!order.rows[0].assignment_id) throw new ApiError(409,'TEAM_LEAD_ASSIGNMENT_REQUIRED','Operations must assign a team lead before supervisor handoff.');
      if(!order.rows[0].latest_review_id||order.rows[0].operations_review_id!==order.rows[0].latest_review_id)
        throw new ApiError(409,'OPERATIONS_REVIEW_REQUIRED','The team-lead assignment must follow the latest Operations review before supervisor handoff.');
      if(order.rows[0].lead_user_id!==scope.actorId) throw new ApiError(403,'ASSIGNED_LEAD_REQUIRED','Only the currently assigned team lead can hand this work order to a supervisor.');
      const powertrainClass=z.enum(['EV','HYB','ICE']).parse(order.rows[0].powertrain_class);
      selectedAssignment=order.rows[0].assignment_id;
      decision=await lockAssignmentDecision(client,'work-order.handoff-supervisor',body.supervisorUserId,`${powertrainClass}-SUPERVISOR`,powertrainClass);
      const leadQualification=await client.query('SELECT public.lock_work_order_assignment_qualification($1,$2,$3) AS qualification',[scope.actorId,`${powertrainClass}-TEAM-LEAD`,powertrainClass]);
      if(!leadQualification.rows[0]?.qualification) throw new ApiError(409,'LEAD_NOT_QUALIFIED','The assigned team lead no longer has an active qualification for this vehicle class.');
      decision={...assignmentDecisionSchema.parse(decision),leadQualification:leadQualification.rows[0].qualification};
    },
    apply:async client=>{
      const version=await lockVersion(client,id,body.expectedVersion);
      const plan=await client.query(`SELECT id,revision_number,created_work_order_version FROM work_order_work_plan_revisions
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND lead_assignment_id=$4 ORDER BY revision_number DESC LIMIT 1`,[scope.organisationId,scope.siteId,id,selectedAssignment]);
      if(!plan.rowCount) throw new ApiError(409,'WORK_PLAN_REQUIRED','Prepare a work-plan draft before handing the job to a supervisor.');
      if(plan.rows[0].id!==body.workPlanRevisionId||plan.rows[0].created_work_order_version!==version)
        throw new ApiError(409,'WORK_PLAN_STALE','Prepare a current work-plan revision before handing the job to a supervisor.');
      selectedWorkPlan=plan.rows[0].id;
      const order=await client.query('SELECT powertrain_class FROM work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
      const powertrainClass=z.enum(['EV','HYB','ICE']).parse(order.rows[0].powertrain_class);
      const leadAssignmentId=uuid.parse(selectedAssignment);
      const authorityDecision=assignmentDecisionSchema.parse(decision);
      const planRevisionId=uuid.parse(selectedWorkPlan);
      const planRevisionNumber=z.object({revision_number:z.number().int().positive()}).parse(plan.rows[0]).revision_number;
      const handoffId=randomUUID();
      await client.query(`INSERT INTO work_order_supervisor_handoffs(id,organisation_id,site_id,work_order_id,supervisor_user_id,assigned_by,powertrain_class,reason,lead_assignment_id,authority_decision,work_plan_revision_id,work_order_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[handoffId,scope.organisationId,scope.siteId,id,body.supervisorUserId,scope.actorId,powertrainClass,body.reason,leadAssignmentId,JSON.stringify(authorityDecision),planRevisionId,version+1]);
      const assignedAt=authorityDecision.decidedAt;
      return {aggregateId:id,aggregateType:'work-order',version:version+1,previous:{version},next:{version:version+1,handoffId,leadAssignmentId,workPlanRevisionId:planRevisionId,workPlanRevisionNumber:planRevisionNumber,supervisorUserId:body.supervisorUserId,powertrainClass,assignedAt,authorityDecision},reason:body.reason};
    },
    project:async(_client,mutation)=>responseSchema.parse({workOrderId:id,supervisorUserId:body.supervisorUserId,...z.object({powertrainClass:z.enum(['EV','HYB','ICE']),assignedAt:z.iso.datetime(),workPlanRevisionId:uuid,workPlanRevisionNumber:z.number().int().positive(),version:z.number().int().positive()}).parse(mutation.next)}),
  });
}

export async function listEligibleTeamLeads(pool:Database,scope:Scope,id:string) {
  return scoped(pool,scope,async client=>{
    const order=await client.query('SELECT powertrain_class,version FROM work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
    if(!order.rowCount) notFound();
    const allowed=await client.query(`SELECT 1 FROM staff_authority_grants g JOIN memberships m ON m.user_id=g.staff_user_id AND m.site_id=g.site_id
      WHERE g.organisation_id=$1 AND g.site_id=$2 AND g.staff_user_id=$3 AND g.capability='work-order.assign-lead'
        AND g.revoked_at IS NULL AND g.valid_from<=now() AND (g.valid_until IS NULL OR g.valid_until>now()) AND m.active AND m.can_write`,[scope.organisationId,scope.siteId,scope.actorId]);
    if(!allowed.rowCount) return eligibleTeamLeadSchema.parse({canAssign:false,blockReason:'authority-required',teamLeads:[]});
    const review=await client.query(`SELECT id,reviewed_work_order_version FROM work_order_operations_reviews
      WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 ORDER BY reviewed_work_order_version DESC,id DESC LIMIT 1`,[scope.organisationId,scope.siteId,id]);
    const latestReview=z.object({id:uuid,reviewed_work_order_version:z.number().int()}).safeParse(review.rows[0]);
    if(!latestReview.success||latestReview.data.reviewed_work_order_version!==order.rows[0].version)
      return eligibleTeamLeadSchema.parse({canAssign:false,blockReason:'operations-review-required',teamLeads:[]});
    const options=await client.query(`SELECT u.id,u.display_name AS name,q.qualification_code AS "qualificationCode"
      FROM staff_qualifications q JOIN staff_users u ON u.id=q.staff_user_id JOIN memberships m ON m.user_id=u.id AND m.site_id=q.site_id
      WHERE q.organisation_id=$1 AND q.site_id=$2 AND q.qualification_code=$3 AND q.state='accepted'
        AND q.powertrain_classes @> ARRAY[$4]::text[] AND q.restrictions='[]'::jsonb AND q.valid_from<=now()
        AND q.qualification_revision=(SELECT max(q2.qualification_revision) FROM staff_qualifications q2 WHERE q2.organisation_id=q.organisation_id AND q2.site_id=q.site_id AND q2.staff_user_id=q.staff_user_id AND q2.qualification_code=q.qualification_code AND q2.state<>'pending')
        AND (q.valid_until IS NULL OR q.valid_until>now()) AND u.active AND m.active AND m.can_write ORDER BY u.display_name,u.id`,[scope.organisationId,scope.siteId,`${order.rows[0].powertrain_class}-TEAM-LEAD`,order.rows[0].powertrain_class]);
    return eligibleTeamLeadSchema.parse({canAssign:true,blockReason:options.rowCount?null:'no-qualified-leads',teamLeads:options.rows});
  });
}

export async function listEligibleSupervisors(pool: Database, scope: Scope, id: string) {
  return scoped(pool,scope,async client=>{
    const order=await client.query(`SELECT w.powertrain_class,la.lead_user_id,la.operations_review_id,
        (SELECT r.id FROM work_order_operations_reviews r WHERE r.organisation_id=w.organisation_id AND r.site_id=w.site_id AND r.work_order_id=w.id ORDER BY r.reviewed_work_order_version DESC,r.id DESC LIMIT 1) AS latest_review_id
      FROM work_orders w
      JOIN LATERAL (SELECT lead_user_id,operations_review_id FROM work_order_lead_assignments a WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id ORDER BY a.created_at DESC,a.id DESC LIMIT 1) la ON true
      WHERE w.organisation_id=$1 AND w.site_id=$2 AND w.id=$3`,[scope.organisationId,scope.siteId,id]);
    if(!order.rowCount) notFound();
    if(order.rows[0].lead_user_id!==scope.actorId||!order.rows[0].operations_review_id||order.rows[0].operations_review_id!==order.rows[0].latest_review_id) return {canHandoff:false,supervisors:[]};
    const grant=await client.query(`SELECT 1 FROM staff_authority_grants g
      JOIN memberships m ON m.user_id=g.staff_user_id AND m.site_id=g.site_id
      WHERE g.organisation_id=$1 AND g.site_id=$2 AND g.staff_user_id=$3
        AND g.capability='work-order.handoff-supervisor' AND g.revoked_at IS NULL
        AND g.valid_from<=now() AND (g.valid_until IS NULL OR g.valid_until>now())
        AND m.active AND m.can_write`,[scope.organisationId,scope.siteId,scope.actorId]);
    if(!grant.rowCount) return {canHandoff:false,supervisors:[]};
    const qualificationCode=`${order.rows[0].powertrain_class}-SUPERVISOR`;
    const options=await client.query(`SELECT u.id,u.display_name AS name,q.qualification_code AS "qualificationCode"
      FROM staff_qualifications q JOIN staff_users u ON u.id=q.staff_user_id JOIN memberships m ON m.user_id=u.id AND m.site_id=q.site_id
      WHERE q.organisation_id=$1 AND q.site_id=$2 AND q.qualification_code=$3 AND q.state='accepted'
        AND q.powertrain_classes @> ARRAY[$4]::text[] AND q.restrictions='[]'::jsonb AND q.valid_from<=now()
        AND q.qualification_revision=(SELECT max(q2.qualification_revision) FROM staff_qualifications q2 WHERE q2.organisation_id=q.organisation_id AND q2.site_id=q.site_id AND q2.staff_user_id=q.staff_user_id AND q2.qualification_code=q.qualification_code AND q2.state<>'pending')
        AND (q.valid_until IS NULL OR q.valid_until>now()) AND u.active AND m.active AND m.can_write ORDER BY u.display_name,u.id`,[scope.organisationId,scope.siteId,qualificationCode,order.rows[0].powertrain_class]);
    return eligibleSupervisorSchema.parse({canHandoff:true,supervisors:options.rows});
  });
}
