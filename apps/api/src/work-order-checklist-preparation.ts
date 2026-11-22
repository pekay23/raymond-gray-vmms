import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { runStaffCommand, lockWorkOrderRoot } from './commands.js';
import { uuid, type Database, type Scope } from './db.js';
import { ApiError, notFound } from './errors.js';
import { afterSalesRoleCodes } from './staff-role-policy.js';

const inputSchema = z.object({
  expectedWorkOrderVersion: z.number().int().positive(),
  templateRevisionId: uuid,
  scheduleBasis: z.enum(['customer-request', 'unknown']),
}).strict();

const itemSchema = z.object({
  id: z.string().trim().min(1).max(100),
  classification: z.object({
    systemCode: z.string().regex(/^[A-Z0-9][A-Z0-9._:-]{1,159}$/),
    taskClassCode: z.string().regex(/^[A-Z0-9][A-Z0-9._:-]{1,159}$/),
  }).strict(),
  requiredQualifications: z.array(z.string().regex(/^[A-Z0-9][A-Z0-9._-]{1,79}$/)).min(1).max(20),
  evidenceRequired: z.boolean().optional(),
  notApplicableAllowed: z.boolean().optional(),
  measurementRule: z.object({
    field: z.string().trim().min(1).max(100),
    unit: z.string().trim().min(1).max(40),
    required: z.boolean(),
  }).strict().optional(),
}).passthrough();

const resultSchema = z.object({
  workOrderId: uuid,
  checklist: z.object({
    id: uuid,
    kind: z.literal('routine-maintenance'),
    state: z.literal('draft'),
    version: z.literal(1),
    scheduleBasis: z.enum(['customer-request', 'unknown']),
    odometerAtStartKm: z.number().int().nonnegative().nullable(),
    templateRevisionId: uuid,
    createdAt: z.iso.datetime({ offset: true }),
  }).strict(),
}).strict();

type Input = z.infer<typeof inputSchema>;

async function activeAfterSalesPlacement(client: PoolClient, scope: Scope) {
  const result = await client.query(`SELECT placement.id
    FROM public.staff_role_placements placement
    JOIN public.staff_role_profiles profile ON profile.code=placement.role_code AND profile.active
    JOIN public.staff_users actor ON actor.id=placement.staff_user_id AND actor.active
    WHERE placement.organisation_id=$1 AND placement.site_id=$2 AND placement.staff_user_id=$3
      AND placement.state='active' AND placement.role_code=ANY($4::text[])
    ORDER BY placement.id LIMIT 1 FOR SHARE OF placement`,
  [scope.organisationId,scope.siteId,scope.actorId,afterSalesRoleCodes]);
  const id = result.rows[0]?.id;
  if (!id) throw new ApiError(403,'AFTER_SALES_ROLE_REQUIRED','Only active after-sales staff can prepare a maintenance checklist draft.');
  return uuid.parse(id);
}

async function checklistPrepareGrant(client: PoolClient) {
  const result = await client.query("SELECT public.lock_work_order_authority_grant('work-order.checklist.prepare') AS grant");
  if (!result.rows[0]?.grant) throw new ApiError(403,'CHECKLIST_PREPARATION_AUTHORITY_REQUIRED','A current checklist-preparation authority grant is required.');
  return z.record(z.string(),z.unknown()).parse(result.rows[0].grant);
}

async function exactEffectiveTemplate(client: PoolClient, scope: Scope, workOrderId: string, templateRevisionId: string) {
  const result = await client.query(`SELECT template.id,template.items,template.template_code AS "templateCode",template.revision,
      template.vehicle_make AS make,template.vehicle_model AS model,template.vehicle_variant AS variant,
      template.powertrain,decision.id AS "decisionId",decision.grant_snapshot AS "grantSnapshot",decision.decided_by AS "decidedBy"
    FROM public.work_orders work
    JOIN public.vehicles vehicle ON vehicle.organisation_id=work.organisation_id AND vehicle.id=work.vehicle_id
    JOIN public.workshop_checklist_template_revisions template ON template.organisation_id=work.organisation_id
      AND template.site_id=work.site_id AND template.id=$4 AND template.kind='routine-maintenance'
      AND lower(trim(template.vehicle_make))=lower(trim(vehicle.make))
      AND lower(trim(template.vehicle_model))=lower(trim(vehicle.model))
      AND lower(trim(template.vehicle_variant))=lower(trim(vehicle.variant))
      AND lower(trim(template.powertrain))=lower(trim(vehicle.powertrain))
    JOIN LATERAL (
      SELECT decision.id,decision.decision,decision.grant_snapshot,decision.decided_by,
        decision.effective_from,decision.effective_until,decision.decided_at
      FROM public.workshop_checklist_template_decisions decision
      WHERE decision.organisation_id=template.organisation_id AND decision.site_id=template.site_id
        AND decision.template_revision_id=template.id
      ORDER BY decision.decided_at DESC,decision.id DESC LIMIT 1
    ) decision ON decision.decision='effective' AND decision.effective_from<=clock_timestamp()
      AND (decision.effective_until IS NULL OR decision.effective_until>clock_timestamp())
    WHERE work.organisation_id=$1 AND work.site_id=$2 AND work.id=$3
      AND NOT EXISTS (
        SELECT 1 FROM public.workshop_checklist_template_revisions newer
        JOIN LATERAL (
          SELECT d.decision,d.effective_from,d.effective_until FROM public.workshop_checklist_template_decisions d
          WHERE d.organisation_id=newer.organisation_id AND d.site_id=newer.site_id AND d.template_revision_id=newer.id
          ORDER BY d.decided_at DESC,d.id DESC LIMIT 1
        ) latest ON latest.decision='effective' AND latest.effective_from<=clock_timestamp()
          AND (latest.effective_until IS NULL OR latest.effective_until>clock_timestamp())
        WHERE newer.organisation_id=template.organisation_id AND newer.site_id=template.site_id
          AND newer.template_code=template.template_code AND newer.revision>template.revision
      )
      AND jsonb_typeof(decision.grant_snapshot)='object'
      AND decision.grant_snapshot->>'capability'='work-order.checklist-template.publish'
      AND EXISTS (
        SELECT 1 FROM public.staff_authority_grants publisher
        WHERE publisher.organisation_id=template.organisation_id AND publisher.site_id=template.site_id
          AND publisher.id::text=decision.grant_snapshot->>'id' AND publisher.staff_user_id=decision.decided_by
          AND publisher.capability='work-order.checklist-template.publish'
          AND publisher.grant_revision::text=decision.grant_snapshot->>'grant_revision'
          AND publisher.revoked_at IS NULL AND publisher.valid_from<=clock_timestamp()
          AND (publisher.valid_until IS NULL OR publisher.valid_until>clock_timestamp())
      )
      AND EXISTS (
        SELECT 1 FROM public.workshop_checklist_template_sources source
        JOIN public.controlled_document_revisions revision ON revision.organisation_id=source.organisation_id
          AND revision.site_id=source.site_id AND revision.id=source.source_revision_id
        JOIN public.controlled_documents document ON document.organisation_id=revision.organisation_id
          AND document.site_id=revision.site_id AND document.id=revision.document_id
        JOIN public.evidence_records evidence ON evidence.organisation_id=revision.organisation_id
          AND evidence.site_id=revision.site_id AND evidence.id=revision.evidence_id
        JOIN LATERAL (
          SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
          WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
            AND attempt.evidence_id=evidence.id ORDER BY attempt.attempt_no DESC LIMIT 1
        ) latest_scan ON true
        WHERE source.organisation_id=template.organisation_id AND source.site_id=template.site_id
          AND source.template_revision_id=template.id AND revision.status='effective'
          AND revision.effective_from<=clock_timestamp()
          AND (revision.effective_until IS NULL OR revision.effective_until>clock_timestamp())
          AND revision.distribution='all-site-staff' AND evidence.upload_intent_id IS NOT NULL
          AND evidence.purpose_kind='procedure-reference' AND evidence.target_id=document.id
          AND evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
          AND latest_scan.verdict='clean' AND latest_scan.scanned_sha256=evidence.sha256
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.workshop_checklist_template_sources source
        LEFT JOIN public.controlled_document_revisions revision ON revision.organisation_id=source.organisation_id
          AND revision.site_id=source.site_id AND revision.id=source.source_revision_id
        LEFT JOIN public.controlled_documents document ON document.organisation_id=revision.organisation_id
          AND document.site_id=revision.site_id AND document.id=revision.document_id
        LEFT JOIN public.evidence_records evidence ON evidence.organisation_id=revision.organisation_id
          AND evidence.site_id=revision.site_id AND evidence.id=revision.evidence_id
        LEFT JOIN LATERAL (
          SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
          WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
            AND attempt.evidence_id=evidence.id ORDER BY attempt.attempt_no DESC LIMIT 1
        ) latest_scan ON true
        WHERE source.organisation_id=template.organisation_id AND source.site_id=template.site_id
          AND source.template_revision_id=template.id
          AND (revision.id IS NULL OR revision.status<>'effective' OR revision.effective_from>clock_timestamp()
            OR (revision.effective_until IS NOT NULL AND revision.effective_until<=clock_timestamp())
            OR revision.distribution<>'all-site-staff' OR document.id IS NULL OR evidence.id IS NULL
            OR evidence.upload_intent_id IS NULL OR evidence.purpose_kind<>'procedure-reference'
            OR evidence.target_id IS DISTINCT FROM document.id OR evidence.scan_state<>'accepted'
            OR evidence.accepted_key IS NULL OR latest_scan.verdict IS DISTINCT FROM 'clean'
            OR latest_scan.scanned_sha256 IS DISTINCT FROM evidence.sha256)
      )
    `,[scope.organisationId,scope.siteId,workOrderId,templateRevisionId]);
  const row = result.rows[0] as Record<string,unknown>|undefined;
  if (!row) throw new ApiError(409,'CHECKLIST_SOURCE_NOT_EFFECTIVE','This exact-vehicle checklist or one of its approved sources is no longer effective. Refresh the job and ask the technical owner to review it.');
  const template = z.object({
    id:uuid,items:z.array(z.unknown()).min(1).max(200),templateCode:z.string(),revision:z.number().int().positive(),
    make:z.string(),model:z.string(),variant:z.string(),powertrain:z.string(),decisionId:uuid,
    grantSnapshot:z.record(z.string(),z.unknown()),decidedBy:uuid,
  }).parse(row);
  const items = template.items.map((raw,index)=>{
    const item = itemSchema.safeParse(raw);
    if (!item.success) throw new ApiError(409,'CHECKLIST_MODEL_RULES_INCOMPLETE',`Checklist item ${index+1} is missing an approved item identifier or qualification rule.`);
    return item.data;
  });
  if (new Set(items.map(item=>item.id)).size !== items.length) throw new ApiError(409,'CHECKLIST_TEMPLATE_INVALID','This approved checklist has repeated item identifiers and cannot be prepared.');
  return { ...template, items };
}

async function activePublisherGrant(client: PoolClient, template: Awaited<ReturnType<typeof exactEffectiveTemplate>>) {
  const snapshot = z.object({ id:uuid, capability:z.literal('work-order.checklist-template.publish'), grant_revision:z.union([z.number().int().positive(),z.string()]) }).passthrough().parse(template.grantSnapshot);
  const revision = String(snapshot.grant_revision);
  const current = await client.query('SELECT public.lock_work_order_checklist_publisher_grant($1,$2,$3) AS grant',
    [snapshot.id,template.decidedBy,Number(revision)]);
  if (!current.rows[0]?.grant) throw new ApiError(409,'CHECKLIST_PUBLISH_AUTHORITY_EXPIRED','The checklist publisher no longer has the authority recorded for this source. Ask the technical owner to review the template.');
  return { grantId:snapshot.id,grantRevision:revision,staffUserId:template.decidedBy };
}

async function currentOrder(client: PoolClient, scope: Scope, workOrderId: string, expectedVersion: number) {
  const found = await client.query(`SELECT work.version,work.odometer_km AS "odometerAtStartKm",
      vehicle.vin,vehicle.make,vehicle.model,vehicle.variant,vehicle.powertrain
    FROM public.work_orders work JOIN public.vehicles vehicle
      ON vehicle.organisation_id=work.organisation_id AND vehicle.id=work.vehicle_id
    WHERE work.organisation_id=$1 AND work.site_id=$2 AND work.id=$3`,
  [scope.organisationId,scope.siteId,workOrderId]);
  if (!found.rowCount) notFound();
  const order = z.object({version:z.number().int().positive(),odometerAtStartKm:z.number().int().nonnegative().nullable(),vin:z.string(),make:z.string(),model:z.string(),variant:z.string().nullable(),powertrain:z.string().nullable()}).parse(found.rows[0]);
  if (order.version !== expectedVersion) throw new ApiError(409,'STALE_VERSION','This job changed. Refresh it before preparing the checklist.',order.version);
  if (!order.variant || !order.powertrain) throw new ApiError(409,'EXACT_VEHICLE_MATCH_REQUIRED','Record the vehicle variant and powertrain before preparing its checklist.');
  return order;
}

async function authorizePreparation(client: PoolClient, scope: Scope, workOrderId: string, input: Input, membershipCanWrite: boolean) {
  if (!membershipCanWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit checklist changes.');
  const actorPlacementId = await activeAfterSalesPlacement(client,scope);
  const authority = await checklistPrepareGrant(client);
  const order = await currentOrder(client,scope,workOrderId,input.expectedWorkOrderVersion);
  if (!order.variant || !order.powertrain) throw new ApiError(409,'EXACT_VEHICLE_MATCH_REQUIRED','Record the vehicle variant and powertrain before preparing the checklist.');
  const template = await exactEffectiveTemplate(client,scope,workOrderId,input.templateRevisionId);
  if (template.make.trim().toLowerCase() !== order.make.trim().toLowerCase()
    || template.model.trim().toLowerCase() !== order.model.trim().toLowerCase()
    || template.variant.trim().toLowerCase() !== order.variant.trim().toLowerCase()
    || template.powertrain.trim().toLowerCase() !== order.powertrain.trim().toLowerCase()) {
    throw new ApiError(409,'EXACT_VEHICLE_MATCH_REQUIRED','The approved checklist does not match this vehicle make, model, variant and powertrain.');
  }
  const publisherAuthority=await activePublisherGrant(client,template);
  return { actorPlacementId, authority, order, template, publisherAuthority };
}

export async function prepareWorkOrderChecklistDraft(pool:Database,scope:Scope,commandId:string,workOrderId:string,rawInput:Input) {
  const input=inputSchema.parse(rawInput);
  return runStaffCommand(pool,{
    scope,commandId,operation:'work-order.checklist.draft-prepared',targetAggregateId:workOrderId,
    payload:{workOrderId,...input},responseSchema:resultSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,workOrderId),
    authorize:async(client,membership)=>{await authorizePreparation(client,scope,workOrderId,input,membership.canWrite);},
    apply:async client=>{
      const context=await authorizePreparation(client,scope,workOrderId,input,true);
      const duplicate=await client.query(`SELECT id FROM public.work_order_checklists
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND template_revision_id=$4 LIMIT 1`,
      [scope.organisationId,scope.siteId,workOrderId,context.template.id]);
      if(duplicate.rowCount)throw new ApiError(409,'CHECKLIST_ALREADY_PREPARED','A draft or active checklist already uses this exact approved revision. Open the existing checklist.');
      const checklistId=randomUUID();
      await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
        VALUES($1,$2,$3,'work-order-checklist')`,[checklistId,scope.organisationId,scope.siteId]);
      await client.query(`INSERT INTO public.work_order_checklists
        (id,organisation_id,site_id,work_order_id,template_revision_id,kind,state,version,schedule_basis,
         odometer_at_start_km,vehicle_snapshot,created_by,created_by_placement_id,preparation_authority_snapshot)
        VALUES($1,$2,$3,$4,$5,'routine-maintenance','draft',1,$6,$7,$8::jsonb,$9,$10,$11::jsonb)`,
      [checklistId,scope.organisationId,scope.siteId,workOrderId,context.template.id,input.scheduleBasis,
        context.order.odometerAtStartKm,JSON.stringify({vin:context.order.vin,make:context.order.make,model:context.order.model,variant:context.order.variant,powertrain:context.order.powertrain}),scope.actorId,
        context.actorPlacementId,JSON.stringify({capability:'work-order.checklist.prepare',grant:context.authority,
          publicationDecisionId:context.template.decisionId,publicationGrant:context.publisherAuthority,templateRevisionId:context.template.id})]);
      for(const [index,item] of context.template.items.entries()){
        const createdItem=await client.query(`INSERT INTO public.work_order_checklist_items
          (organisation_id,site_id,work_order_id,checklist_id,item_code,ordinal,definition_snapshot)
          VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
        [scope.organisationId,scope.siteId,workOrderId,checklistId,item.id,index+1,JSON.stringify(item)]);
        const checklistItemId=uuid.parse(createdItem.rows[0]?.id);
        await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
          VALUES($1,$2,$3,'work-order-checklist-item')`,[checklistItemId,scope.organisationId,scope.siteId]);
      }
      return {aggregateId:checklistId,aggregateType:'work-order-checklist',version:1,
        previous:{state:null},next:{state:'draft',templateRevisionId:context.template.id,scheduleBasis:input.scheduleBasis,itemCount:context.template.items.length},
        reason:'A source-backed maintenance checklist draft was prepared. This does not authorize inspection or repair work.'};
    },
    project:async client=>{
      const found=await client.query(`SELECT id,kind,state,version,schedule_basis AS "scheduleBasis",
          odometer_at_start_km AS "odometerAtStartKm",template_revision_id AS "templateRevisionId",created_at AS "createdAt"
        FROM public.work_order_checklists WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3
          AND template_revision_id=$4`,[scope.organisationId,scope.siteId,workOrderId,input.templateRevisionId]);
      const row=found.rows[0] as Record<string,unknown>|undefined;
      if(!row)throw new Error('Prepared maintenance checklist was not found in its committed projection.');
      const createdAt=row.createdAt instanceof Date?row.createdAt.toISOString():row.createdAt;
      return resultSchema.parse({workOrderId,checklist:{...row,createdAt}});
    },
  });
}
