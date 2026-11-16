import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { ApiError, notFound } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { currentAssignment } from './work-order-task-activity.js';

const outcome = z.enum(['completed','failed','not-checked','not-completed','blocked','not-applicable']);
const measurementSchema = z.object({
  field: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(160),
  unit: z.string().trim().min(1).max(40),
}).strict();

export const checklistOutcomeInputSchema = z.object({
  expectedChecklistVersion: z.number().int().positive(),
  expectedWorkPlanRevisionId: uuid,
  expectedAssignmentRevision: z.number().int().positive(),
  result: outcome,
  reason: z.string().trim().min(1).max(1200).nullable(),
  applicabilityReason: z.string().trim().min(1).max(1200).nullable(),
  comments: z.string().trim().min(1).max(2400).nullable(),
  measurement: measurementSchema.nullable(),
  evidenceIds: z.array(uuid).max(20).refine(ids => new Set(ids).size === ids.length, 'Choose each evidence file once.'),
  supersedesRevisionId: uuid.nullable(),
  correctionReason: z.string().trim().min(1).max(1200).nullable(),
}).strict().superRefine((value, context) => {
  if ((value.result !== 'completed') !== (value.reason !== null)) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'Give a reason for every outcome except completed.' });
  }
  if ((value.result === 'not-applicable') !== (value.applicabilityReason !== null)) {
    context.addIssue({ code: 'custom', path: ['applicabilityReason'], message: 'Give an applicability reason only for a not-applicable outcome.' });
  }
  if ((value.supersedesRevisionId === null) !== (value.correctionReason === null)) {
    context.addIssue({ code: 'custom', path: ['correctionReason'], message: 'Give a reason when correcting an earlier outcome.' });
  }
});

const outcomeRowSchema = z.object({
  id: uuid,
  revision: z.number().int().positive(),
  result: outcome,
  reason: z.string().nullable(),
  applicabilityReason: z.string().nullable(),
  comments: z.string().nullable(),
  measurement: measurementSchema.nullable(),
  evidenceIds: z.array(uuid),
  actorName: z.string(),
  assigneeName: z.string(),
  assignmentRevision: z.number().int().positive(),
  workPlanRevisionId: uuid,
  supersedesRevisionId: uuid.nullable(),
  correctionReason: z.string().nullable(),
  recordedAt: z.union([z.date(),z.iso.datetime({ offset: true })]).transform(value => value instanceof Date ? value.toISOString() : value),
}).strict();

export const checklistOutcomeResultSchema = z.object({
  workOrderId: uuid,
  taskId: uuid,
  checklistId: uuid,
  checklistVersion: z.number().int().positive(),
  itemId: uuid,
  sourceTemplateRevisionId: uuid,
  outcome: outcomeRowSchema,
}).strict();

export const checklistOutcomeHistorySchema = z.object({
  workOrderId: uuid,
  taskId: uuid,
  checklistId: uuid,
  checklistVersion: z.number().int().positive(),
  sourceTemplateRevisionId: uuid,
  itemCode: z.string(),
  definition: z.record(z.string(),z.unknown()),
  items: z.array(outcomeRowSchema),
  pagination: z.object({ page:z.number().int().positive(), pageSize:z.number().int().positive(), totalItems:z.number().int().nonnegative(), totalPages:z.number().int().nonnegative() }).strict(),
}).strict();

type Input = z.infer<typeof checklistOutcomeInputSchema>;
const itemRulesSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().optional(),
  requiredQualifications: z.array(z.string().regex(/^[A-Z0-9][A-Z0-9._-]{1,79}$/)).min(1).max(20),
  evidenceRequired: z.boolean().optional(),
  notApplicableAllowed: z.boolean().optional(),
  measurementRule: z.object({
    field: z.string().trim().min(1).max(100),
    unit: z.string().trim().min(1).max(40),
    required: z.boolean(),
  }).strict().optional(),
}).passthrough();
type ItemRules = z.infer<typeof itemRulesSchema>;

export function validateOutcomeAgainstItemRules(input: Input, rawRules: unknown): ItemRules {
  const rules = itemRulesSchema.safeParse(rawRules);
  if (!rules.success || rules.data.requiredQualifications.length === 0) {
    throw new ApiError(409,'CHECKLIST_MODEL_RULES_INCOMPLETE','This checklist item is missing an approved qualification requirement. Ask the technical owner to complete and approve the exact vehicle checklist.');
  }
  if (input.result === 'not-applicable' && rules.data.notApplicableAllowed !== true) {
    throw new ApiError(409,'CHECKLIST_NOT_APPLICABLE_NOT_ALLOWED','The approved checklist does not allow this item to be marked not applicable.');
  }
  if (rules.data.evidenceRequired && input.evidenceIds.length === 0) {
    throw new ApiError(409,'CHECKLIST_EVIDENCE_REQUIRED','Attach accepted evidence already linked to this work order before recording this outcome.');
  }
  const rule = rules.data.measurementRule;
  if (rule?.required && !input.measurement) {
    throw new ApiError(409,'CHECKLIST_MEASUREMENT_REQUIRED','Record the measurement and unit prescribed by the approved vehicle checklist.');
  }
  if (input.measurement && (!rule || input.measurement.field !== rule.field || input.measurement.unit !== rule.unit)) {
    throw new ApiError(409,'CHECKLIST_MEASUREMENT_NOT_PRESCRIBED','This measurement field and unit do not match the approved vehicle checklist.');
  }
  return rules.data;
}

async function assertCurrentAssignment(client: PoolClient, scope: Scope, workOrderId: string, taskId: string, input: Input) {
  const assignment = await currentAssignment(client,scope,workOrderId,taskId);
  if (assignment.workPlanRevisionId !== input.expectedWorkPlanRevisionId || assignment.assignmentRevision !== input.expectedAssignmentRevision) {
    throw new ApiError(409,'STALE_TASK_ASSIGNMENT','This task assignment changed. Refresh your assigned tasks before recording an outcome.');
  }
  return assignment;
}

async function assertChecklistSource(client: PoolClient, scope: Scope, workOrderId: string, checklistId: string, itemId: string) {
  const result = await client.query(`
    SELECT checklist.id,checklist.version,checklist.state,checklist.kind,checklist.template_revision_id AS "templateRevisionId",
      checklist.vehicle_snapshot AS "vehicleSnapshot",template.kind AS "templateKind",template.items,template.vehicle_make AS make,template.vehicle_model AS model,
      template.vehicle_variant AS variant,template.powertrain,
      vehicle.vin AS "actualVin",vehicle.make AS "actualMake",vehicle.model AS "actualModel",vehicle.variant AS "actualVariant",vehicle.powertrain AS "actualPowertrain",
      item.id AS "itemId",item.item_code AS "itemCode",item.definition_snapshot AS definition
    FROM public.work_order_checklists checklist
    JOIN public.work_orders work ON work.organisation_id=checklist.organisation_id AND work.site_id=checklist.site_id
      AND work.id=checklist.work_order_id
    JOIN public.vehicles vehicle ON vehicle.organisation_id=work.organisation_id AND vehicle.id=work.vehicle_id
    JOIN public.workshop_checklist_template_revisions template ON template.organisation_id=checklist.organisation_id
      AND template.site_id=checklist.site_id AND template.id=checklist.template_revision_id
    JOIN public.work_order_checklist_items item ON item.organisation_id=checklist.organisation_id
      AND item.site_id=checklist.site_id AND item.work_order_id=checklist.work_order_id
      AND item.checklist_id=checklist.id AND item.id=$5
    WHERE checklist.organisation_id=$1 AND checklist.site_id=$2 AND checklist.work_order_id=$3 AND checklist.id=$4
    FOR UPDATE OF checklist,item`,[scope.organisationId,scope.siteId,workOrderId,checklistId,itemId]);
  const row = result.rows[0] as Record<string,unknown>|undefined;
  if (!row) notFound();
  const parsed = z.object({
    id:uuid,version:z.number().int().positive(),state:z.enum(['draft','in-progress','submitted','returned','approved','closed']),
    kind:z.enum(['pdi','routine-maintenance']),templateKind:z.enum(['pdi','routine-maintenance']),templateRevisionId:uuid,items:z.array(z.unknown()),make:z.string(),model:z.string(),variant:z.string(),powertrain:z.string(),
    vehicleSnapshot:z.record(z.string(),z.unknown()),actualVin:z.string(),actualMake:z.string(),actualModel:z.string(),actualVariant:z.string().nullable(),actualPowertrain:z.string().nullable(),
    itemId:uuid,itemCode:z.string(),definition:z.record(z.string(),z.unknown()),
  }).parse(row);
  if (parsed.version !== undefined && parsed.state !== 'in-progress') {
    throw new ApiError(409,'CHECKLIST_NOT_IN_PROGRESS','Only an active routine-maintenance checklist can receive item outcomes.');
  }
  if (parsed.kind !== 'routine-maintenance') throw new ApiError(409,'ROUTINE_MAINTENANCE_ONLY','This API records routine-maintenance outcomes only.');
  if (parsed.templateKind !== 'routine-maintenance') throw new ApiError(409,'ROUTINE_MAINTENANCE_ONLY','The source template is not approved for routine maintenance.');
  if (!parsed.actualVariant || !parsed.actualPowertrain || parsed.make.trim().toLowerCase() !== parsed.actualMake.trim().toLowerCase()
    || parsed.model.trim().toLowerCase() !== parsed.actualModel.trim().toLowerCase()
    || parsed.variant.trim().toLowerCase() !== parsed.actualVariant.trim().toLowerCase()
    || parsed.powertrain.trim().toLowerCase() !== parsed.actualPowertrain.trim().toLowerCase()) {
    throw new ApiError(409,'EXACT_VEHICLE_MATCH_REQUIRED','Confirm the vehicle make, model, variant and powertrain before recording checklist outcomes.');
  }
  const snapshot=z.object({vin:z.string(),make:z.string(),model:z.string(),variant:z.string(),powertrain:z.string()}).safeParse(parsed.vehicleSnapshot);
  if (!snapshot.success || snapshot.data.vin.trim().toUpperCase() !== parsed.actualVin.trim().toUpperCase()
    || snapshot.data.make.trim().toLowerCase() !== parsed.actualMake.trim().toLowerCase()
    || snapshot.data.model.trim().toLowerCase() !== parsed.actualModel.trim().toLowerCase()
    || snapshot.data.variant.trim().toLowerCase() !== parsed.actualVariant.trim().toLowerCase()
    || snapshot.data.powertrain.trim().toLowerCase() !== parsed.actualPowertrain.trim().toLowerCase()) {
    throw new ApiError(409,'EXACT_VEHICLE_MATCH_REQUIRED','The checklist vehicle snapshot no longer matches this work order vehicle. Confirm vehicle details before continuing.');
  }
  const source = await client.query(`
    SELECT decision.id,decision.grant_snapshot,decision.decided_by
    FROM public.workshop_checklist_template_decisions decision
    WHERE decision.organisation_id=$1 AND decision.site_id=$2 AND decision.template_revision_id=$3
      AND decision.decision='effective' AND decision.effective_from<=clock_timestamp()
      AND (decision.effective_until IS NULL OR decision.effective_until>clock_timestamp())
      AND decision.id=(SELECT latest.id FROM public.workshop_checklist_template_decisions latest
        WHERE latest.organisation_id=decision.organisation_id AND latest.site_id=decision.site_id
          AND latest.template_revision_id=decision.template_revision_id ORDER BY latest.decided_at DESC,latest.id DESC LIMIT 1)
      AND NOT EXISTS (
        SELECT 1 FROM public.workshop_checklist_template_revisions newer
        JOIN LATERAL (SELECT d.decision,d.effective_from,d.effective_until FROM public.workshop_checklist_template_decisions d
          WHERE d.organisation_id=newer.organisation_id AND d.site_id=newer.site_id AND d.template_revision_id=newer.id
          ORDER BY d.decided_at DESC,d.id DESC LIMIT 1) latest ON true
        WHERE newer.organisation_id=$1 AND newer.site_id=$2 AND newer.template_code=(SELECT template_code FROM public.workshop_checklist_template_revisions WHERE id=$3)
          AND newer.revision>(SELECT revision FROM public.workshop_checklist_template_revisions WHERE id=$3)
          AND latest.decision='effective' AND latest.effective_from<=clock_timestamp()
          AND (latest.effective_until IS NULL OR latest.effective_until>clock_timestamp())
      )
      AND EXISTS (SELECT 1 FROM public.workshop_checklist_template_sources src
        JOIN public.controlled_document_revisions docrev ON docrev.organisation_id=src.organisation_id AND docrev.site_id=src.site_id AND docrev.id=src.source_revision_id
        JOIN public.controlled_documents doc ON doc.organisation_id=docrev.organisation_id AND doc.site_id=docrev.site_id AND doc.id=docrev.document_id
        JOIN public.evidence_records evidence ON evidence.organisation_id=docrev.organisation_id AND evidence.site_id=docrev.site_id AND evidence.id=docrev.evidence_id
        JOIN LATERAL (SELECT scan.verdict,scan.scanned_sha256 FROM public.evidence_scan_attempts scan
          WHERE scan.organisation_id=evidence.organisation_id AND scan.site_id=evidence.site_id AND scan.evidence_id=evidence.id
          ORDER BY scan.attempt_no DESC LIMIT 1) scan ON true
        WHERE src.organisation_id=$1 AND src.site_id=$2 AND src.template_revision_id=$3
          AND docrev.status='effective' AND docrev.effective_from<=clock_timestamp()
          AND (docrev.effective_until IS NULL OR docrev.effective_until>clock_timestamp())
          AND docrev.distribution='all-site-staff' AND evidence.upload_intent_id IS NOT NULL
          AND evidence.purpose_kind='procedure-reference' AND evidence.target_id=doc.id
          AND evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
          AND scan.verdict='clean' AND scan.scanned_sha256=evidence.sha256)
      AND NOT EXISTS (SELECT 1 FROM public.workshop_checklist_template_sources bad_src
        LEFT JOIN public.controlled_document_revisions bad_doc ON bad_doc.organisation_id=bad_src.organisation_id
          AND bad_doc.site_id=bad_src.site_id AND bad_doc.id=bad_src.source_revision_id
        LEFT JOIN public.controlled_documents bad_document ON bad_document.organisation_id=bad_doc.organisation_id
          AND bad_document.site_id=bad_doc.site_id AND bad_document.id=bad_doc.document_id
        LEFT JOIN public.evidence_records bad_evidence ON bad_evidence.organisation_id=bad_doc.organisation_id
          AND bad_evidence.site_id=bad_doc.site_id AND bad_evidence.id=bad_doc.evidence_id
        LEFT JOIN LATERAL (SELECT scan.verdict,scan.scanned_sha256 FROM public.evidence_scan_attempts scan
          WHERE scan.organisation_id=bad_evidence.organisation_id AND scan.site_id=bad_evidence.site_id
            AND scan.evidence_id=bad_evidence.id ORDER BY scan.attempt_no DESC LIMIT 1) bad_scan ON true
        WHERE bad_src.organisation_id=$1 AND bad_src.site_id=$2 AND bad_src.template_revision_id=$3
          AND (bad_doc.id IS NULL OR bad_doc.status<>'effective' OR bad_doc.effective_from>clock_timestamp()
            OR (bad_doc.effective_until IS NOT NULL AND bad_doc.effective_until<=clock_timestamp())
            OR bad_doc.distribution<>'all-site-staff' OR bad_document.id IS NULL OR bad_evidence.id IS NULL
            OR bad_evidence.upload_intent_id IS NULL OR bad_evidence.purpose_kind<>'procedure-reference'
            OR bad_evidence.target_id IS DISTINCT FROM bad_document.id OR bad_evidence.scan_state<>'accepted'
            OR bad_evidence.accepted_key IS NULL OR bad_scan.verdict IS DISTINCT FROM 'clean'
            OR bad_scan.scanned_sha256 IS DISTINCT FROM bad_evidence.sha256))
      AND jsonb_typeof(decision.grant_snapshot)='object'
      AND decision.grant_snapshot->>'capability'='work-order.checklist-template.publish'
      AND EXISTS (SELECT 1 FROM public.staff_authority_grants grant_row
        WHERE grant_row.organisation_id=$1 AND grant_row.site_id=$2
          AND grant_row.id::text=decision.grant_snapshot->>'id' AND grant_row.staff_user_id=decision.decided_by
          AND grant_row.capability='work-order.checklist-template.publish'
          AND grant_row.grant_revision::text=decision.grant_snapshot->>'grant_revision'
          AND grant_row.revoked_at IS NULL AND grant_row.valid_from<=clock_timestamp()
          AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp()))
    ORDER BY decision.decided_at DESC,decision.id DESC LIMIT 1 FOR SHARE OF decision`,
  [scope.organisationId,scope.siteId,parsed.templateRevisionId]);
  if (!source.rowCount) throw new ApiError(409,'CHECKLIST_SOURCE_NOT_EFFECTIVE','The exact vehicle checklist or its approved source is not currently effective.');
  const definition = parsed.items.find(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    return (candidate as Record<string,unknown>).id === parsed.itemCode && isDeepStrictEqual(candidate,parsed.definition);
  });
  if (!definition) throw new ApiError(409,'CHECKLIST_ITEM_SOURCE_MISMATCH','This checklist item does not match its immutable source template revision.');
  return { version:parsed.version,templateRevisionId:parsed.templateRevisionId,itemCode:parsed.itemCode,definition:parsed.definition };
}

async function lockOutcomeAuthority(client: PoolClient, scope: Scope) {
  const result = await client.query(`SELECT to_jsonb(grant_row) AS snapshot FROM public.staff_authority_grants grant_row
    WHERE grant_row.organisation_id=$1 AND grant_row.site_id=$2 AND grant_row.staff_user_id=$3
      AND grant_row.capability='work-order.checklist.item-outcome.record' AND grant_row.revoked_at IS NULL
      AND grant_row.valid_from<=clock_timestamp() AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp())
    ORDER BY grant_row.grant_revision DESC,grant_row.id LIMIT 1 FOR SHARE`,[scope.organisationId,scope.siteId,scope.actorId]);
  if (!result.rowCount) throw new ApiError(403,'CHECKLIST_OUTCOME_AUTHORITY_REQUIRED','A current checklist-outcome authority grant is required. Ask the authorized technical manager to review access.');
  return z.record(z.string(),z.unknown()).parse((result.rows[0] as {snapshot:unknown}).snapshot);
}

async function lockQualifications(client: PoolClient, scope: Scope, codes: string[]) {
  const result = await client.query(`SELECT qualification_code AS code,qualification_revision AS revision,
      evidence_reference AS "evidenceReference",assessed_by AS "assessedBy",assessed_at AS "assessedAt",valid_from AS "validFrom",valid_until AS "validUntil"
    FROM public.staff_qualifications WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3
      AND qualification_code=ANY($4::text[]) AND state='accepted'
      AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp())
    ORDER BY qualification_code,qualification_revision DESC FOR SHARE`,[scope.organisationId,scope.siteId,scope.actorId,codes]);
  const latest = new Map<string,Record<string,unknown>>();
  for (const row of result.rows as Array<Record<string,unknown>>) if (!latest.has(String(row.code))) latest.set(String(row.code),row);
  if (codes.some(code => !latest.has(code))) throw new ApiError(403,'CHECKLIST_QUALIFICATION_REQUIRED','One or more qualifications required by the approved item are missing or expired. Ask the technical manager to verify qualifications.');
  return codes.map(code => latest.get(code)!);
}

async function assertAcceptedOrderEvidence(client: PoolClient, scope: Scope, workOrderId: string, evidenceIds: string[]) {
  if (!evidenceIds.length) return;
  const found = await client.query(`SELECT evidence.id FROM public.work_order_evidence_links link
    JOIN public.evidence_records evidence ON evidence.organisation_id=link.organisation_id AND evidence.site_id=link.site_id
      AND evidence.id=link.evidence_id
    JOIN LATERAL (SELECT scan.verdict,scan.scanned_sha256 FROM public.evidence_scan_attempts scan
      WHERE scan.organisation_id=evidence.organisation_id AND scan.site_id=evidence.site_id AND scan.evidence_id=evidence.id
      ORDER BY scan.attempt_no DESC LIMIT 1) latest ON true
    WHERE link.organisation_id=$1 AND link.site_id=$2 AND link.work_order_id=$3 AND evidence.id=ANY($4::uuid[])
      AND evidence.purpose_kind='work-order' AND evidence.target_id=$3
      AND evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
      AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256`,[scope.organisationId,scope.siteId,workOrderId,evidenceIds]);
  if (found.rowCount !== evidenceIds.length) throw new ApiError(409,'CHECKLIST_EVIDENCE_NOT_ACCEPTED','Use evidence already linked to this work order with a current accepted scan.');
}

async function lockChecklistOutcomeContext(
  client: PoolClient,scope: Scope,workOrderId: string,taskId: string,checklistId: string,itemId: string,input: Input,forMutation: boolean,
) {
  const assignment = await assertCurrentAssignment(client,scope,workOrderId,taskId,input);
  const checklist = await assertChecklistSource(client,scope,workOrderId,checklistId,itemId);
  if (forMutation && checklist.version !== input.expectedChecklistVersion) throw new ApiError(409,'STALE_CHECKLIST_VERSION','This checklist changed. Refresh it before recording an outcome.');
  const sourceItem = itemRulesSchema.safeParse(checklist.definition);
  if (!sourceItem.success) throw new ApiError(409,'CHECKLIST_MODEL_RULES_INCOMPLETE','The item lacks approved model-specific qualification and measurement rules.');
  const rules = validateOutcomeAgainstItemRules(input,checklist.definition);
  const grant = await lockOutcomeAuthority(client,scope);
  const qualifications = await lockQualifications(client,scope,rules.requiredQualifications);
  if (forMutation) await assertAcceptedOrderEvidence(client,scope,workOrderId,input.evidenceIds);
  const isRequiredMeasurement = rules.measurementRule?.required === true;
  if (isRequiredMeasurement && !input.measurement) throw new ApiError(409,'CHECKLIST_MEASUREMENT_REQUIRED','Record the measurement and unit prescribed by the approved vehicle checklist.');
  if (forMutation && input.supersedesRevisionId) {
    const prior = await client.query(`SELECT id FROM public.work_order_checklist_item_revisions previous
      WHERE previous.organisation_id=$1 AND previous.site_id=$2 AND previous.work_order_id=$3 AND previous.checklist_id=$4
        AND previous.checklist_item_id=$5 AND previous.id=$6
        AND NOT EXISTS (SELECT 1 FROM public.work_order_checklist_item_revisions later
          WHERE later.organisation_id=previous.organisation_id AND later.site_id=previous.site_id
            AND later.checklist_item_id=previous.checklist_item_id AND later.supersedes_revision_id=previous.id)`,
    [scope.organisationId,scope.siteId,workOrderId,checklistId,itemId,input.supersedesRevisionId]);
    if (!prior.rowCount) throw new ApiError(409,'CHECKLIST_CORRECTION_SOURCE_UNAVAILABLE','Refresh the checklist history; the selected outcome is not the current uncorrected outcome.');
  }
  return { assignment,checklist,grant,qualifications };
}

export async function recordMyTaskChecklistOutcome(
  pool: Database, scope: Scope, commandId: string, workOrderId: string, taskId: string, checklistId: string, itemId: string, input: Input,
) {
  return runStaffCommand(pool,{
    scope,commandId,operation:'work-order.checklist-item.outcome-recorded',targetAggregateId:itemId,
    payload:{workOrderId,taskId,checklistId,itemId,...input},responseSchema:checklistOutcomeResultSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,workOrderId),
    authorize:async(client,membership)=>{
      if (!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit checklist updates.');
      await lockChecklistOutcomeContext(client,scope,workOrderId,taskId,checklistId,itemId,input,false);
    },
    apply:async client=>{
      const context=await lockChecklistOutcomeContext(client,scope,workOrderId,taskId,checklistId,itemId,input,true);
      const row=await client.query(`SELECT coalesce(max(revision),0)::int+1 AS revision
        FROM public.work_order_checklist_item_revisions
        WHERE organisation_id=$1 AND site_id=$2 AND checklist_item_id=$3`,[scope.organisationId,scope.siteId,itemId]);
      const revision=z.number().int().positive().parse((row.rows[0] as {revision:unknown}).revision);
      const outcomeId=randomUUID();
      await client.query(`INSERT INTO public.work_order_checklist_item_revisions
        (id,organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,revision,result,reason,applicability_reason,
         comments,measurement,actor_id,actor_placement_id,task_id,work_plan_revision_id,assignment_revision,
         assignee_user_id,assignee_placement_id,supersedes_revision_id,correction_reason,authority_snapshot,qualification_snapshots)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$13,$18,$19,$20,$21::jsonb,$22::jsonb)`,
      [outcomeId,scope.organisationId,scope.siteId,workOrderId,checklistId,itemId,revision,input.result,input.reason,
        input.applicabilityReason,input.comments,input.measurement?JSON.stringify(input.measurement):null,scope.actorId,
        context.assignment.actorPlacementId,taskId,context.assignment.workPlanRevisionId,context.assignment.assignmentRevision,
        context.assignment.actorPlacementId,input.supersedesRevisionId,input.correctionReason,JSON.stringify(context.grant),JSON.stringify(context.qualifications)]);
      for (const evidenceId of input.evidenceIds) await client.query(`INSERT INTO public.work_order_checklist_item_revision_evidence
        (organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,outcome_revision_id,evidence_id)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[scope.organisationId,scope.siteId,workOrderId,checklistId,itemId,outcomeId,evidenceId]);
      const checklistVersion=context.checklist.version+1;
      await client.query(`UPDATE public.work_order_checklists SET version=$5,updated_at=clock_timestamp()
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND id=$4 AND version=$6`,
      [scope.organisationId,scope.siteId,workOrderId,checklistId,checklistVersion,context.checklist.version]);
      return {aggregateId:itemId,aggregateType:'work-order-checklist-item',version:revision,
        previous:{checklistVersion:context.checklist.version},next:{checklistVersion,itemId,revision,result:input.result,
          taskId,assignmentRevision:context.assignment.assignmentRevision,templateRevisionId:context.checklist.templateRevisionId},
        reason:'Checklist outcome revision recorded.'};
    },
    project:async client=>{
      const result=await readOutcomeRows(client,scope,workOrderId,taskId,checklistId,itemId,1,1,true);
      const item=result.items[0];
      if (!item) throw new Error('Recorded checklist outcome is missing from its projection.');
      return checklistOutcomeResultSchema.parse({workOrderId,taskId,checklistId,checklistVersion:result.checklistVersion,
        itemId,sourceTemplateRevisionId:result.sourceTemplateRevisionId,outcome:item});
    },
  });
}

async function readOutcomeRows(
  client:PoolClient,scope:Scope,workOrderId:string,taskId:string,checklistId:string,itemId?:string,page=1,pageSize=100,latestOnly=false,
) {
  const checklist=await client.query(`SELECT version,template_revision_id AS "sourceTemplateRevisionId",kind
    FROM public.work_order_checklists WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND id=$4`,
  [scope.organisationId,scope.siteId,workOrderId,checklistId]);
  const row=checklist.rows[0] as {version:number;sourceTemplateRevisionId:string;kind:string}|undefined;
  if (!row) notFound();
  if (row.kind!=='routine-maintenance') throw new ApiError(409,'ROUTINE_MAINTENANCE_ONLY','This API reads routine-maintenance outcomes only.');
  const totalResult=await client.query(`SELECT count(*)::int AS total FROM public.work_order_checklist_item_revisions revision
    WHERE revision.organisation_id=$1 AND revision.site_id=$2 AND revision.work_order_id=$3
      AND revision.task_id=$4 AND revision.checklist_id=$5 AND ($6::uuid IS NULL OR revision.checklist_item_id=$6)`,
  [scope.organisationId,scope.siteId,workOrderId,taskId,checklistId,itemId??null]);
  const totalItems=z.object({total:z.number().int().nonnegative()}).parse(totalResult.rows[0]).total;
  const totalPages=totalItems?Math.ceil(totalItems/pageSize):0;
  const effectivePage=Math.min(page,Math.max(totalPages,1));
  const history=await client.query(`SELECT revision.id,revision.revision,revision.result,revision.reason,
      revision.applicability_reason AS "applicabilityReason",revision.comments,revision.measurement,
      revision.assignment_revision AS "assignmentRevision",revision.work_plan_revision_id AS "workPlanRevisionId",
      revision.supersedes_revision_id AS "supersedesRevisionId",revision.correction_reason AS "correctionReason",
      revision.recorded_at AS "recordedAt",actor.display_name AS "actorName",assignee.display_name AS "assigneeName",
      coalesce(evidence.items,'[]'::jsonb) AS "evidenceIds"
    FROM public.work_order_checklist_item_revisions revision
    JOIN public.staff_users actor ON actor.id=revision.actor_id
    JOIN public.staff_users assignee ON assignee.id=revision.assignee_user_id
    LEFT JOIN LATERAL (SELECT jsonb_agg(link.evidence_id ORDER BY link.evidence_id) AS items
      FROM public.work_order_checklist_item_revision_evidence link
      WHERE link.organisation_id=revision.organisation_id AND link.site_id=revision.site_id
        AND link.outcome_revision_id=revision.id) evidence ON true
    WHERE revision.organisation_id=$1 AND revision.site_id=$2 AND revision.work_order_id=$3
      AND revision.task_id=$4 AND revision.checklist_id=$5 AND ($6::uuid IS NULL OR revision.checklist_item_id=$6)
    ORDER BY revision.recorded_at ${latestOnly?'DESC':'ASC'},revision.id ${latestOnly?'DESC':'ASC'}
    OFFSET CASE WHEN $7 THEN 0 ELSE $8 END LIMIT CASE WHEN $7 THEN 1 ELSE $9 END`,
  [scope.organisationId,scope.siteId,workOrderId,taskId,checklistId,itemId??null,latestOnly,(effectivePage-1)*pageSize,pageSize]);
  return {checklistVersion:row.version,sourceTemplateRevisionId:row.sourceTemplateRevisionId,
    items:z.array(outcomeRowSchema).parse(history.rows),pagination:{page:effectivePage,pageSize,totalItems,totalPages}};
}

export async function readMyTaskChecklistOutcomeHistory(
  pool:Database,scope:Scope,workOrderId:string,taskId:string,checklistId:string,itemId:string,requestId:string,requestedPage=1,requestedPageSize=25,
) {
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    await currentAssignment(client,scope,workOrderId,taskId);
    const page=z.number().int().min(1).max(10000).parse(requestedPage);
    const pageSize=z.number().int().min(1).max(100).parse(requestedPageSize);
    const checklist=await readOutcomeRows(client,scope,workOrderId,taskId,checklistId,itemId,page,pageSize);
    const item=await client.query(`SELECT item.item_code AS "itemCode",item.definition_snapshot AS definition
      FROM public.work_order_checklist_items item WHERE item.organisation_id=$1 AND item.site_id=$2
        AND item.work_order_id=$3 AND item.checklist_id=$4 AND item.id=$5`,[scope.organisationId,scope.siteId,workOrderId,checklistId,itemId]);
    if (!item.rowCount) notFound();
    await recordSensitiveRead(client,scope,'work-order-checklist-outcomes-read-prepared',Math.min(checklist.items.length,100),requestId);
    return checklistOutcomeHistorySchema.parse({workOrderId,taskId,checklistId,checklistVersion:checklist.checklistVersion,
      sourceTemplateRevisionId:checklist.sourceTemplateRevisionId,itemCode:(item.rows[0] as {itemCode:string}).itemCode,
      definition:(item.rows[0] as {definition:unknown}).definition,items:checklist.items,pagination:checklist.pagination});
  });
}
