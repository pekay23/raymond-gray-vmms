import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { ApiError, notFound } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { afterSalesRoleCodes } from './staff-role-policy.js';
import { payerScopeResponseSchema } from './work-order-scope-responses.js';
import { moneyInputSchema, serializeMoney } from './commercial-money.js';

const expectedVersion = z.number().int().positive();
const booleanSchema=z.boolean();
export const scopeProposalInputSchema = z.object({
  expectedVersion,
  requestedKind: z.enum(['diagnosis','repair']),
  taskIds: z.array(uuid).min(1).max(50).refine(ids => new Set(ids).size === ids.length,'Choose each task once.'),
  rationale: z.string().trim().min(1).max(1000),
  estimate: moneyInputSchema.nullable(),
}).strict().superRefine((input,context)=>{
  if(input.requestedKind==='repair'&&(!input.estimate||input.estimate.minorUnits<=0n)) {
    context.addIssue({code:'custom',path:['estimate'],message:'A repair proposal needs a positive estimate in a stated currency.'});
  }
});

const scopeTaskSchema = z.object({ id:uuid,reference:z.string(),title:z.string() }).strict();
const scopeRevisionSchema = z.object({
  id:uuid,
  revision: z.number().int().positive(),
  requestedKind:z.enum(['diagnosis','repair']),
  rationale:z.string(),
  estimate:z.object({minorUnits:z.string().regex(/^(0|[1-9][0-9]{0,37})$/),currency:z.string().regex(/^[A-Z]{3}$/)}).strict().nullable(),
  scopeDigest:z.string().regex(/^[0-9a-f]{64}$/),
  sourceWorkOrderVersion:z.number().int().positive(),
  supersedesRevisionId:uuid.nullable(),
  preparedBy:z.string(),
  preparedAt:z.union([z.date(),z.iso.datetime({offset:true})]).transform(value=>value instanceof Date?value.toISOString():value),
  tasks:z.array(scopeTaskSchema),
  payerResponse:payerScopeResponseSchema.nullable(),
}).strict();
const scopeProposalViewSchema=scopeRevisionSchema.extend({canRespond:z.boolean()}).strict();

export const scopeProposalPageSchema = z.object({
  workOrderId:uuid,
  workOrderVersion:expectedVersion,
  canPrepare:booleanSchema,
  blockReason:z.enum(['authority-required','read-only']).nullable(),
  canRecordPayerResponse:booleanSchema,
  payerResponseBlockReason:z.enum(['authority-required','read-only']).nullable(),
  proposals:z.array(scopeProposalViewSchema),
  plannedTasks:z.array(scopeTaskSchema),
}).strict();

const scopeProposalResultSchema=z.object({workOrderId:uuid,proposal:scopeRevisionSchema,version:expectedVersion}).strict();

function canonical(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value!==null&&typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}

export async function readWorkOrderScopeProposals(pool:Database,scope:Scope,workOrderId:string,requestId:string) {
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    const role=await client.query(`SELECT 1 FROM public.staff_role_placements placement
      JOIN public.staff_role_profiles profile ON profile.code=placement.role_code AND profile.active
      JOIN public.staff_users actor ON actor.id=placement.staff_user_id AND actor.active
      WHERE placement.organisation_id=$1 AND placement.site_id=$2 AND placement.staff_user_id=$3
        AND placement.state='active' AND placement.role_code=ANY($4::text[]) LIMIT 1`,
    [scope.organisationId,scope.siteId,scope.actorId,afterSalesRoleCodes]);
    if(!role.rowCount) throw new ApiError(403,'AFTER_SALES_ROLE_REQUIRED','Scope proposals are available to active after-sales staff.');
    const order=await client.query('SELECT version FROM public.work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,uuid.parse(workOrderId)]);
    if(!order.rowCount) notFound();
    const workOrderVersion=expectedVersion.parse(order.rows[0].version);
    const grant=await client.query("SELECT public.lock_work_order_authority_grant('work-order.prepare-scope-proposal') AS grant");
    const writable=await client.query('SELECT public.lock_membership($1,$2) AS can_write',[scope.actorId,scope.siteId]);
    const canWrite=z.object({can_write:z.boolean()}).parse(writable.rows[0]).can_write;
    const canPrepare=canWrite&&Boolean(grant.rows[0]?.grant);
    const responseGrant=await client.query("SELECT public.lock_work_order_authority_grant('work-order.record-payer-scope-response') AS grant");
    const canRecordPayerResponse=canWrite&&Boolean(responseGrant.rows[0]?.grant);
    const taskRows=await client.query(`SELECT id,'T'||lpad(ordinal::text,2,'0') AS reference,title FROM public.tasks
      WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND state='planned' ORDER BY ordinal,id`,
    [scope.organisationId,scope.siteId,workOrderId]);
    const revisionRows=await client.query(`SELECT revision.id,revision.revision,revision.requested_kind AS "requestedKind",
        revision.rationale,revision.estimate_minor_units::text AS "estimateMinorUnits",revision.estimate_currency AS "estimateCurrency",
        revision.scope_digest AS "scopeDigest",revision.source_work_order_version AS "sourceWorkOrderVersion",
        revision.supersedes_revision_id AS "supersedesRevisionId",author.display_name AS "preparedBy",revision.created_at AS "preparedAt",
        response.id AS "responseId",response.decision AS "responseDecision",response.response_method AS "responseMethod",
        response.written_evidence_confirmed AS "writtenEvidenceConfirmed",
        response.respondent_name AS "respondentName",
        response.respondent_relationship AS "respondentRelationship",response.authority_basis AS "authorityBasis",
        response.identity_check_summary AS "identityCheckSummary",response.scope_read_back AS "scopeReadBack",
        response.response_summary AS "responseSummary",response.created_at AS "responseRecordedAt",responseRecorder.display_name AS "responseRecordedBy",
        coalesce((SELECT jsonb_agg(evidence_link.evidence_id ORDER BY evidence_link.evidence_id)
          FROM public.work_order_scope_payer_response_evidence evidence_link
          WHERE evidence_link.organisation_id=revision.organisation_id AND evidence_link.site_id=revision.site_id
            AND evidence_link.scope_revision_id=revision.id AND evidence_link.response_id=response.id),'[]'::jsonb) AS "responseEvidenceIds",
        coalesce(jsonb_agg(jsonb_build_object('id',task.id,'reference','T'||lpad(task.ordinal::text,2,'0'),'title',task.title)
          ORDER BY link.ordinal) FILTER (WHERE task.id IS NOT NULL),'[]'::jsonb) AS tasks
      FROM public.work_order_scope_revisions revision
      JOIN public.staff_users author ON author.id=revision.prepared_by
      LEFT JOIN public.work_order_scope_payer_responses response ON response.organisation_id=revision.organisation_id
        AND response.site_id=revision.site_id AND response.work_order_id=revision.work_order_id AND response.scope_revision_id=revision.id
      LEFT JOIN public.staff_users responseRecorder ON responseRecorder.id=response.actor_id
      LEFT JOIN public.work_order_scope_revision_tasks link ON link.organisation_id=revision.organisation_id AND link.site_id=revision.site_id
        AND link.work_order_id=revision.work_order_id AND link.scope_revision_id=revision.id
      LEFT JOIN public.tasks task ON task.organisation_id=link.organisation_id AND task.site_id=link.site_id
        AND task.work_order_id=link.work_order_id AND task.id=link.task_id
      WHERE revision.organisation_id=$1 AND revision.site_id=$2 AND revision.work_order_id=$3
      GROUP BY revision.id,author.display_name,response.id,responseRecorder.display_name ORDER BY revision.revision DESC LIMIT 50`,
    [scope.organisationId,scope.siteId,workOrderId]);
    await recordSensitiveRead(client,scope,'work-order-scope-proposals-read-prepared',Math.min(revisionRows.rowCount??0,50),requestId);
    return scopeProposalPageSchema.parse({
      workOrderId,workOrderVersion,canPrepare,
      blockReason:canPrepare?null:canWrite?'authority-required':'read-only',
      canRecordPayerResponse,
      payerResponseBlockReason:canRecordPayerResponse?null:canWrite?'authority-required':'read-only',
      proposals:revisionRows.rows.map((row,index)=>{
        const item=row as Record<string,unknown>;
        const {responseId,responseDecision,responseMethod,writtenEvidenceConfirmed,responseEvidenceIds,respondentName,respondentRelationship,authorityBasis,
          estimateMinorUnits,estimateCurrency,
          identityCheckSummary,scopeReadBack,responseSummary,responseRecordedAt,responseRecordedBy,...proposal}=item;
        const payerResponse=responseId?{
          id:responseId,decision:responseDecision,responseMethod,evidenceIds:responseEvidenceIds,writtenEvidenceConfirmed,respondentName,
          respondentRelationship,authorityBasis,identityCheckSummary,scopeReadBack,
          responseSummary,recordedAt:responseRecordedAt,recordedBy:responseRecordedBy,
        }:null;
        const sourceVersion=expectedVersion.parse(item.sourceWorkOrderVersion);
        const canRespond=canRecordPayerResponse&&index===0&&!responseId&&sourceVersion===workOrderVersion;
        const estimate=estimateMinorUnits===null?null:{minorUnits:estimateMinorUnits,currency:estimateCurrency};
        return {...proposal,estimate,payerResponse,canRespond};
      }),plannedTasks:taskRows.rows,
    });
  });
}

export async function createWorkOrderScopeProposal(pool:Database,scope:Scope,commandId:string,workOrderId:string,input:z.infer<typeof scopeProposalInputSchema>) {
  let created:unknown;
  return runStaffCommand(pool,{
    scope,commandId,operation:'work-order.scope-proposal-created',targetAggregateId:workOrderId,
    payload:{...input,estimate:input.estimate?serializeMoney(input.estimate):null},
    responseSchema:scopeProposalResultSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,workOrderId),
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      const role=await client.query(`SELECT 1 FROM public.staff_role_placements placement
        JOIN public.staff_role_profiles profile ON profile.code=placement.role_code AND profile.active
        JOIN public.staff_users actor ON actor.id=placement.staff_user_id AND actor.active
        WHERE placement.organisation_id=$1 AND placement.site_id=$2 AND placement.staff_user_id=$3
          AND placement.state='active' AND placement.role_code=ANY($4::text[]) LIMIT 1`,
      [scope.organisationId,scope.siteId,scope.actorId,afterSalesRoleCodes]);
      if(!role.rowCount) throw new ApiError(403,'AFTER_SALES_ROLE_REQUIRED','Scope proposals are available to active after-sales staff.');
      const grant=await client.query("SELECT public.lock_work_order_authority_grant('work-order.prepare-scope-proposal') AS grant");
      if(!grant.rows[0]?.grant) throw new ApiError(403,'SCOPE_PROPOSAL_AUTHORITY_REQUIRED','A current scope-proposal permission is required. This permission does not authorize repair work.');
      created=grant.rows[0].grant;
    },
    apply:async client=>{
      const current=await client.query('SELECT version FROM public.work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,workOrderId]);
      if(!current.rowCount) notFound();
      const version=expectedVersion.parse(current.rows[0].version);
      if(version!==input.expectedVersion) throw new ApiError(409,'STALE_VERSION','This work order changed. Refresh and review its current tasks before preparing a proposal.',version);
      const valid=await client.query(`SELECT id FROM public.tasks WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3
        AND id=ANY($4::uuid[]) AND state='planned'`,[scope.organisationId,scope.siteId,workOrderId,input.taskIds]);
      if(valid.rowCount!==input.taskIds.length) throw new ApiError(409,'SCOPE_TASKS_CHANGED','Choose current planned tasks from this work order and try again.');
      const latest=await client.query('SELECT id,revision FROM public.work_order_scope_revisions WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 ORDER BY revision DESC LIMIT 1',[scope.organisationId,scope.siteId,workOrderId]);
      const prior=latest.rows[0] as {id:string;revision:number}|undefined;
      const revision=(prior?.revision??0)+1;
      const proposalId=randomUUID();
      const sourceWorkOrderVersion=version+1;
      const estimate=input.estimate?serializeMoney(input.estimate):null;
      const digest=createHash('sha256').update(canonical({requestedKind:input.requestedKind,taskIds:input.taskIds,rationale:input.rationale,estimate})).digest('hex');
      const grant=z.record(z.string(),z.unknown()).parse(created);
      const authorityClock=await client.query('SELECT clock_timestamp() AS at');
      const authorityDecision={capability:'work-order.prepare-scope-proposal',grantId:grant.id,grantRevision:grant.grant_revision,actorId:scope.actorId,decidedAt:z.date().parse(authorityClock.rows[0].at).toISOString()};
      await client.query('UPDATE public.work_orders SET version=version+1 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,workOrderId]);
      await client.query(`INSERT INTO public.work_order_scope_revisions
        (id,organisation_id,site_id,work_order_id,revision,requested_kind,rationale,estimate_minor_units,estimate_currency,scope_digest,source_work_order_version,supersedes_revision_id,prepared_by,authority_decision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [proposalId,scope.organisationId,scope.siteId,workOrderId,revision,input.requestedKind,input.rationale,estimate?.minorUnits.toString()??null,estimate?.currency??null,digest,sourceWorkOrderVersion,prior?.id??null,scope.actorId,JSON.stringify(authorityDecision)]);
      for(let index=0;index<input.taskIds.length;index++) await client.query(`INSERT INTO public.work_order_scope_revision_tasks
        (organisation_id,site_id,work_order_id,scope_revision_id,task_id,ordinal) VALUES($1,$2,$3,$4,$5,$6)`,
      [scope.organisationId,scope.siteId,workOrderId,proposalId,input.taskIds[index],index+1]);
      const projection=await client.query(`SELECT id,'T'||lpad(ordinal::text,2,'0') AS reference,title FROM public.tasks
        WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND id=ANY($4::uuid[])`,
      [scope.organisationId,scope.siteId,workOrderId,input.taskIds]);
      const taskMap=new Map(projection.rows.map(row=>[row.id,row]));
      const tasks=input.taskIds.map(id=>taskMap.get(id)).filter(Boolean);
      if(tasks.length!==input.taskIds.length) throw new ApiError(409,'SCOPE_TASKS_CHANGED','Refresh this work order and choose its current tasks.');
      return {aggregateId:workOrderId,aggregateType:'work-order',version:sourceWorkOrderVersion,previous:{version},next:{version:sourceWorkOrderVersion,scopeProposalId:proposalId,revision,estimate},reason:'A non-authorizing scope proposal and any stated estimate were recorded for review.'};
    },
    project:async(client)=>{
      const row=await client.query(`SELECT proposal.revision,proposal.id,proposal.requested_kind AS "requestedKind",proposal.rationale,
          proposal.estimate_minor_units::text AS "estimateMinorUnits",proposal.estimate_currency AS "estimateCurrency",proposal.scope_digest AS "scopeDigest",
          source_work_order_version AS "sourceWorkOrderVersion",supersedes_revision_id AS "supersedesRevisionId",
          author.display_name AS "preparedBy",created_at AS "preparedAt"
        FROM public.work_order_scope_revisions proposal JOIN public.staff_users author ON author.id=proposal.prepared_by
        WHERE proposal.organisation_id=$1 AND proposal.site_id=$2 AND proposal.work_order_id=$3
          AND proposal.prepared_by=$4 ORDER BY revision DESC LIMIT 1`,[scope.organisationId,scope.siteId,workOrderId,scope.actorId]);
      if(!row.rowCount) notFound();
      const taskRows=await client.query(`SELECT task.id,'T'||lpad(task.ordinal::text,2,'0') AS reference,task.title
        FROM public.work_order_scope_revision_tasks link JOIN public.tasks task
          ON task.organisation_id=link.organisation_id AND task.site_id=link.site_id AND task.work_order_id=link.work_order_id AND task.id=link.task_id
        WHERE link.organisation_id=$1 AND link.site_id=$2 AND link.work_order_id=$3 AND link.scope_revision_id=$4 ORDER BY link.ordinal`,
      [scope.organisationId,scope.siteId,workOrderId,row.rows[0].id]);
      const {estimateMinorUnits,estimateCurrency,...proposal}=row.rows[0]!;
      const estimate=estimateMinorUnits===null?null:{minorUnits:estimateMinorUnits,currency:estimateCurrency};
      const parsed=scopeRevisionSchema.parse({...proposal,estimate,tasks:taskRows.rows,payerResponse:null});
      return scopeProposalResultSchema.parse({workOrderId,proposal:parsed,version:parsed.sourceWorkOrderVersion});
    },
  });
}
