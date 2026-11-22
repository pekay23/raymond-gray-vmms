import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { ApiError, notFound } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { afterSalesRoleCodes } from './staff-role-policy.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';

const decisionSchema = z.enum(['approved','declined']);
const relationshipSchema = z.enum(['payer','authorised-representative']);
const expectedVersionSchema = z.number().int().positive();
const responseMethodSchema = z.enum(['phone','written']);

export const payerScopeResponseInputSchema = z.object({
  expectedWorkOrderVersion: expectedVersionSchema,
  scopeRevisionId: uuid,
  scopeDigest: z.string().regex(/^[0-9a-f]{64}$/),
  responseMethod: responseMethodSchema,
  evidenceIds: z.array(uuid).max(10),
  writtenEvidenceConfirmed: z.boolean(),
  decision: decisionSchema,
  respondentName: z.string().trim().min(1).max(180),
  respondentRelationship: relationshipSchema,
  authorityBasis: z.string().trim().min(1).max(1000),
  identityCheckSummary: z.string().trim().min(1).max(1000),
  scopeReadBack: z.literal(true),
  responseSummary: z.string().trim().min(1).max(1200),
}).strict().superRefine((input, context) => {
  if (input.responseMethod === 'written' && input.evidenceIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'Attach accepted written evidence for this response.' });
  }
  if (input.responseMethod === 'phone' && input.evidenceIds.length > 0) {
    context.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'Phone responses do not accept written evidence attachments.' });
  }
  if (input.responseMethod === 'written' && !input.writtenEvidenceConfirmed) {
    context.addIssue({ code: 'custom', path: ['writtenEvidenceConfirmed'], message: 'Confirm that the attached file contains the payer response to this exact scope.' });
  }
  if (input.responseMethod === 'phone' && input.writtenEvidenceConfirmed) {
    context.addIssue({ code: 'custom', path: ['writtenEvidenceConfirmed'], message: 'Written-evidence confirmation is only for written responses.' });
  }
  if (new Set(input.evidenceIds).size !== input.evidenceIds.length) {
    context.addIssue({ code: 'custom', path: ['evidenceIds'], message: 'Choose each evidence file once.' });
  }
});

export const payerScopeResponseSchema = z.object({
  id: uuid,
  decision: decisionSchema,
  responseMethod: responseMethodSchema,
  evidenceIds: z.array(uuid).max(10),
  writtenEvidenceConfirmed: z.boolean(),
  respondentName: z.string(),
  respondentRelationship: relationshipSchema,
  authorityBasis: z.string(),
  identityCheckSummary: z.string(),
  scopeReadBack: z.literal(true),
  responseSummary: z.string(),
  recordedBy: z.string(),
  recordedAt: z.union([z.date(),z.iso.datetime({offset:true})]).transform(value=>value instanceof Date?value.toISOString():value),
}).strict();

export const payerScopeResponseResultSchema = z.object({
  workOrderId: uuid,
  scopeRevisionId: uuid,
  scopeDigest: z.string().regex(/^[0-9a-f]{64}$/),
  workOrderVersion: expectedVersionSchema,
  response: payerScopeResponseSchema,
  authorizationState: z.literal('blocked'),
  authorizationReason: z.literal('technical-review-and-effective-policy-required'),
}).strict();

export const payerScopeResponsesSchema = z.object({
  workOrderId: uuid,
  workOrderVersion: expectedVersionSchema,
  canRecordResponse: z.boolean(),
  responseBlockReason: z.enum(['authority-required','read-only']).nullable(),
  responses: z.array(z.object({ scopeRevisionId:uuid, response:payerScopeResponseSchema }).strict()),
}).strict();

type Input = z.infer<typeof payerScopeResponseInputSchema>;

async function currentPayerResponseAuthority(client: import('pg').PoolClient,scope:Scope) {
  const grantResult=await client.query("SELECT public.lock_work_order_authority_grant('work-order.record-payer-scope-response') AS grant");
  if(!grantResult.rows[0]?.grant) throw new ApiError(403,'PAYER_SCOPE_RESPONSE_AUTHORITY_REQUIRED','A current after-sales permission is required to record a payer response. This record does not authorize work.');
  const result = await client.query(`SELECT p.id AS "placementId"
    FROM public.staff_role_placements p
    JOIN public.staff_role_profiles profile ON profile.code=p.role_code AND profile.active
    JOIN public.staff_users actor ON actor.id=p.staff_user_id AND actor.active
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3
      AND p.state='active' AND p.role_code=ANY($4::text[])
    ORDER BY p.id LIMIT 1`,
  [scope.organisationId,scope.siteId,scope.actorId,afterSalesRoleCodes]);
  if(!result.rowCount) throw new ApiError(403,'PAYER_SCOPE_RESPONSE_ROLE_REQUIRED','An active after-sales role is required to record a payer response.');
  const row=z.object({placementId:uuid}).parse(result.rows[0]);
  const grant=z.record(z.string(),z.unknown()).parse(grantResult.rows[0].grant);
  const grantId=uuid.parse(grant.id);
  const grantRevision=z.number().int().positive().parse(grant.grant_revision);
  const at=await client.query('SELECT clock_timestamp() AS at');
  return {placementId:row.placementId,grant,snapshot:{id:grantId,grant_revision:grantRevision,capability:'work-order.record-payer-scope-response',actorId:scope.actorId,decidedAt:z.date().parse(at.rows[0].at).toISOString()}};
}

async function lockCurrentScopeContext(client:import('pg').PoolClient,scope:Scope,workOrderId:string,input:Input) {
  const order=await client.query(`SELECT version,client_party_id AS "payerPartyId"
    FROM public.work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE`,
  [scope.organisationId,scope.siteId,workOrderId]);
  if(!order.rowCount) notFound();
  const current=z.object({version:expectedVersionSchema,payerPartyId:uuid.nullable()}).parse(order.rows[0]);
  if(!current.payerPartyId) throw new ApiError(409,'PAYER_NOT_CONFIRMED','Confirm the paying client on this work order before recording a payer response.');
  if(current.version!==input.expectedWorkOrderVersion) throw new ApiError(409,'STALE_VERSION','This work order changed. Refresh the current proposal before recording a payer response.',current.version);
  const revision=await client.query(`SELECT id,revision,requested_kind AS "requestedKind",rationale,scope_digest AS "scopeDigest",
      source_work_order_version AS "sourceWorkOrderVersion",estimate_minor_units::text AS "estimateMinorUnits"
    FROM public.work_order_scope_revisions WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND id=$4`,
  [scope.organisationId,scope.siteId,workOrderId,input.scopeRevisionId]);
  if(!revision.rowCount) notFound();
  const proposal=z.object({id:uuid,revision:z.number().int().positive(),requestedKind:z.enum(['diagnosis','repair']),rationale:z.string(),scopeDigest:z.string(),sourceWorkOrderVersion:expectedVersionSchema,estimateMinorUnits:z.string().nullable()}).parse(revision.rows[0]);
  if(proposal.requestedKind==='repair'&&proposal.estimateMinorUnits===null) throw new ApiError(409,'SCOPE_ESTIMATE_REQUIRED','Add a current estimate to a new repair proposal before recording payer approval.');
  if(proposal.scopeDigest!==input.scopeDigest) throw new ApiError(409,'SCOPE_DIGEST_CHANGED','The proposal content changed. Refresh it before recording a payer response.');
  const prior=await client.query(`SELECT id FROM public.work_order_scope_payer_responses
    WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND scope_revision_id=$4`,
  [scope.organisationId,scope.siteId,workOrderId,proposal.id]);
  if(prior.rowCount) throw new ApiError(409,'PAYER_SCOPE_RESPONSE_ALREADY_RECORDED','A payer response is already recorded for this scope. Prepare a new scope revision before recording a changed response.');
  if(proposal.sourceWorkOrderVersion!==current.version) throw new ApiError(409,'SCOPE_PROPOSAL_STALE','The work order changed after this proposal. Prepare and review a current scope before contacting the payer.',current.version);
  const latest=await client.query(`SELECT id FROM public.work_order_scope_revisions
    WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 ORDER BY revision DESC LIMIT 1`,
  [scope.organisationId,scope.siteId,workOrderId]);
  if(latest.rows[0]?.id!==proposal.id) throw new ApiError(409,'SCOPE_PROPOSAL_SUPERSEDED','This proposal has been replaced. Record a response against the current scope.');
  const taskIds=await client.query(`SELECT link.task_id AS id,task.state FROM public.work_order_scope_revision_tasks link
    JOIN public.tasks task ON task.organisation_id=link.organisation_id AND task.site_id=link.site_id
      AND task.work_order_id=link.work_order_id AND task.id=link.task_id
    WHERE link.organisation_id=$1 AND link.site_id=$2 AND link.work_order_id=$3 AND link.scope_revision_id=$4
    ORDER BY link.ordinal`,[scope.organisationId,scope.siteId,workOrderId,proposal.id]);
  if(!taskIds.rowCount||taskIds.rows.some(row=>row.state!=='planned')) throw new ApiError(409,'SCOPE_TASKS_CHANGED','The proposed tasks are no longer all planned. Refresh and prepare the current scope.');
  return {order:current,proposal};
}

export async function recordPayerScopeResponse(pool:Database,scope:Scope,commandId:string,workOrderId:string,input:Input) {
  return runStaffCommand(pool,{
    scope,commandId,operation:'work-order.payer-scope-response.recorded',targetAggregateId:workOrderId,
    payload:{workOrderId,...input},responseSchema:payerScopeResponseResultSchema,
    lockSerializationRoots:client=>lockWorkOrderRoot(client,scope,workOrderId),
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      await currentPayerResponseAuthority(client,scope);
    },
    apply:async client=>{
      const context=await lockCurrentScopeContext(client,scope,workOrderId,input);
      const authority=await currentPayerResponseAuthority(client,scope);
      if (input.evidenceIds.length) {
        const evidence = await client.query(`SELECT evidence.id
          FROM public.evidence_records evidence
          JOIN public.work_order_evidence_links link
            ON link.organisation_id=evidence.organisation_id AND link.site_id=evidence.site_id
            AND link.work_order_id=$3 AND link.evidence_id=evidence.id
          JOIN LATERAL (SELECT attempt.verdict,attempt.scanned_sha256
            FROM public.evidence_scan_attempts attempt
            WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
              AND attempt.evidence_id=evidence.id
            ORDER BY attempt.attempt_no DESC LIMIT 1) latest ON true
          WHERE evidence.organisation_id=$1 AND evidence.site_id=$2 AND evidence.id=ANY($4::uuid[])
            AND evidence.target_id=$3 AND evidence.purpose_kind='work-order' AND evidence.scan_state='accepted'
            AND evidence.accepted_key IS NOT NULL AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256
          `, [scope.organisationId,scope.siteId,workOrderId,input.evidenceIds]);
        if (evidence.rowCount !== input.evidenceIds.length) {
          throw new ApiError(409,'PAYER_RESPONSE_EVIDENCE_UNAVAILABLE','Every written response file must be accepted and attached to this work order.');
        }
      }
      const id=randomUUID();
      await client.query(`INSERT INTO public.work_order_scope_payer_responses
        (id,organisation_id,site_id,work_order_id,scope_revision_id,payer_party_id,scope_digest,decision,response_method,written_evidence_confirmed,
         respondent_name,respondent_relationship,authority_basis,identity_check_summary,scope_read_back,
         response_summary,actor_id,actor_placement_id,authority_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`,
      [id,scope.organisationId,scope.siteId,workOrderId,context.proposal.id,context.order.payerPartyId,input.scopeDigest,
        input.decision,input.responseMethod,input.writtenEvidenceConfirmed,input.respondentName,input.respondentRelationship,input.authorityBasis,input.identityCheckSummary,
        input.scopeReadBack,input.responseSummary,scope.actorId,authority.placementId,JSON.stringify(authority.snapshot)]);
      for (const evidenceId of input.evidenceIds) {
        await client.query(`INSERT INTO public.work_order_scope_payer_response_evidence
          (organisation_id,site_id,work_order_id,scope_revision_id,response_id,evidence_id)
          VALUES($1,$2,$3,$4,$5,$6)`, [scope.organisationId,scope.siteId,workOrderId,context.proposal.id,id,evidenceId]);
      }
      const version=context.order.version+1;
      await client.query('UPDATE public.work_orders SET version=$4 WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND version=$5',
        [scope.organisationId,scope.siteId,workOrderId,version,context.order.version]);
      return {aggregateId:workOrderId,aggregateType:'work-order',version,previous:{version:context.order.version},
        next:{version,scopeRevisionId:context.proposal.id,scopeDigest:input.scopeDigest,decision:input.decision,responseMethod:input.responseMethod,evidenceCount:input.evidenceIds.length},
        reason:'Payer response recorded. This does not authorize work or any charge.'};
    },
    project:async client=>{
      const response=await client.query(`SELECT response.id,response.decision,response.response_method AS "responseMethod",
          response.written_evidence_confirmed AS "writtenEvidenceConfirmed",response.respondent_name AS "respondentName",
          response.respondent_relationship AS "respondentRelationship",response.authority_basis AS "authorityBasis",
          response.identity_check_summary AS "identityCheckSummary",response.scope_read_back AS "scopeReadBack",
          response.response_summary AS "responseSummary",actor.display_name AS "recordedBy",response.created_at AS "recordedAt",
          response.scope_digest AS "scopeDigest",work.version AS "workOrderVersion",
          coalesce((SELECT jsonb_agg(link.evidence_id ORDER BY link.evidence_id)
            FROM public.work_order_scope_payer_response_evidence link
            WHERE link.organisation_id=response.organisation_id AND link.site_id=response.site_id
              AND link.response_id=response.id),'[]'::jsonb) AS "evidenceIds"
        FROM public.work_order_scope_payer_responses response
        JOIN public.staff_users actor ON actor.id=response.actor_id
        JOIN public.work_orders work ON work.organisation_id=response.organisation_id AND work.site_id=response.site_id AND work.id=response.work_order_id
        WHERE response.organisation_id=$1 AND response.site_id=$2 AND response.work_order_id=$3 AND response.scope_revision_id=$4`,
      [scope.organisationId,scope.siteId,workOrderId,input.scopeRevisionId]);
      if(!response.rowCount) notFound();
      const row=response.rows[0] as Record<string,unknown>;
      return payerScopeResponseResultSchema.parse({workOrderId,scopeRevisionId:input.scopeRevisionId,scopeDigest:row.scopeDigest,
        workOrderVersion:row.workOrderVersion,response:{id:row.id,decision:row.decision,responseMethod:row.responseMethod,evidenceIds:row.evidenceIds,writtenEvidenceConfirmed:row.writtenEvidenceConfirmed,respondentName:row.respondentName,
          respondentRelationship:row.respondentRelationship,authorityBasis:row.authorityBasis,identityCheckSummary:row.identityCheckSummary,
          scopeReadBack:row.scopeReadBack,responseSummary:row.responseSummary,recordedBy:row.recordedBy,recordedAt:row.recordedAt},
        authorizationState:'blocked',authorizationReason:'technical-review-and-effective-policy-required'});
    },
  });
}

export async function readPayerScopeResponses(pool:Database,scope:Scope,workOrderId:string,requestId:string) {
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    const role=await client.query(`SELECT 1 FROM public.staff_role_placements placement
      JOIN public.staff_role_profiles profile ON profile.code=placement.role_code AND profile.active
      JOIN public.staff_users actor ON actor.id=placement.staff_user_id AND actor.active
      WHERE placement.organisation_id=$1 AND placement.site_id=$2 AND placement.staff_user_id=$3
        AND placement.state='active' AND placement.role_code=ANY($4::text[]) LIMIT 1`,
    [scope.organisationId,scope.siteId,scope.actorId,afterSalesRoleCodes]);
    if(!role.rowCount) throw new ApiError(403,'AFTER_SALES_ROLE_REQUIRED','Payer responses are available to active after-sales staff.');
    const order=await client.query('SELECT version FROM public.work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,workOrderId]);
    if(!order.rowCount) notFound();
    const version=expectedVersionSchema.parse(order.rows[0].version);
    const writable=await client.query('SELECT public.lock_membership($1,$2) AS can_write',[scope.actorId,scope.siteId]);
    const canWrite=z.object({can_write:z.boolean()}).parse(writable.rows[0]).can_write;
    const grant=await client.query("SELECT public.lock_work_order_authority_grant('work-order.record-payer-scope-response') AS grant");
    const rows=await client.query(`SELECT response.scope_revision_id AS "scopeRevisionId",response.id,response.decision,
        response.response_method AS "responseMethod",
        response.written_evidence_confirmed AS "writtenEvidenceConfirmed",
        response.respondent_name AS "respondentName",response.respondent_relationship AS "respondentRelationship",
        response.authority_basis AS "authorityBasis",response.identity_check_summary AS "identityCheckSummary",
        response.scope_read_back AS "scopeReadBack",response.response_summary AS "responseSummary",
        actor.display_name AS "recordedBy",response.created_at AS "recordedAt",
        coalesce((SELECT jsonb_agg(link.evidence_id ORDER BY link.evidence_id)
          FROM public.work_order_scope_payer_response_evidence link
          WHERE link.organisation_id=response.organisation_id AND link.site_id=response.site_id
            AND link.response_id=response.id),'[]'::jsonb) AS "evidenceIds"
      FROM public.work_order_scope_payer_responses response JOIN public.staff_users actor ON actor.id=response.actor_id
      WHERE response.organisation_id=$1 AND response.site_id=$2 AND response.work_order_id=$3
      ORDER BY response.created_at DESC,response.id LIMIT 100`,[scope.organisationId,scope.siteId,workOrderId]);
    await recordSensitiveRead(client,scope,'work-order-scope-payer-responses-read-prepared',Math.min(rows.rowCount??0,100),requestId);
    return payerScopeResponsesSchema.parse({workOrderId,workOrderVersion:version,
      canRecordResponse:canWrite&&Boolean(grant.rows[0]?.grant),
      responseBlockReason:canWrite?(grant.rows[0]?.grant?null:'authority-required'):'read-only',
      responses:rows.rows.map(row=>({scopeRevisionId:row.scopeRevisionId,response:{...row}}))});
  });
}
