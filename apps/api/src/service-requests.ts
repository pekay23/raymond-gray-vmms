import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Database, type Scope, scoped, uuid } from './db.js';
import { lockAdvisoryRoots, runStaffCommand } from './commands.js';
import { ApiError } from './errors.js';
import { requireActiveReadMembership, recordSensitiveRead } from './sensitive-read-audit.js';

export const serviceRequestInputSchema=z.object({
  requestKind:z.enum(['repair-maintenance','routine-maintenance','psai','service-centre-pdi']).default('repair-maintenance'),
  vehicleSource:z.enum(['showroom-stock','partner-garage','other','unknown']).default('unknown'),
  shippingReference:z.string().trim().max(160).nullable().default(null),
  sourceChannel:z.string().trim().min(1).max(80), concern:z.string().trim().min(1).max(4000),
  reportedContact:z.string().trim().max(500).nullable().default(null),
  reportedContactName:z.string().trim().min(1).max(160).nullable().default(null),
  reportedContactPhone:z.string().trim().min(1).max(80).nullable().default(null),
  reportedContactRelationship:z.enum(['vehicle-owner','driver','client-contact','sales-contact','other','unknown']).default('unknown'),
  reportedVehicle:z.string().trim().max(500).nullable().default(null),
  reportedClient:z.string().trim().max(500).nullable().default(null),
  preferredDropoffWindow:z.string().trim().min(1).max(240).nullable().default(null),
  preferredCallbackWindow:z.string().trim().min(1).max(240).nullable().default(null),
  nextAction:z.string().trim().min(1).max(1000).nullable().default(null),
  callbackDueAt:z.iso.datetime({offset:true}).nullable().default(null),
}).strict().refine(value=>value.callbackDueAt===null||value.nextAction!==null,{message:'Add a next action for the callback.',path:['nextAction']});
const responseSchema=z.object({id:uuid,version:z.number().int().positive()});
const readSchema=z.object({id:uuid,version:z.number().int().positive(),status:z.enum(['open','converted','closed']),requestKind:z.enum(['repair-maintenance','routine-maintenance','psai','service-centre-pdi']),vehicleSource:z.enum(['showroom-stock','partner-garage','other','unknown']),shippingReference:z.string().nullable(),sourceChannel:z.string(),concern:z.string(),reportedContact:z.string().nullable(),reportedContactName:z.string().nullable(),reportedContactPhone:z.string().nullable(),reportedContactRelationship:z.enum(['vehicle-owner','driver','client-contact','sales-contact','other','unknown']),reportedVehicle:z.string().nullable(),reportedClient:z.string().nullable(),preferredDropoffWindow:z.string().nullable(),preferredCallbackWindow:z.string().nullable(),nextAction:z.string().nullable(),callbackDueAt:z.date().nullable(),assignedTo:uuid.nullable(),assignedToName:z.string().nullable(),workOrderId:uuid.nullable()});
export const claimRequestSchema=z.object({expectedVersion:z.number().int().positive()}).strict();
export const linkRequestSchema=z.object({expectedVersion:z.number().int().positive(),workOrderId:uuid,reason:z.string().trim().min(1).max(500)}).strict();
export const unlinkRequestSchema=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict();
export const closeRequestSchema=unlinkRequestSchema;
export const reopenRequestSchema=unlinkRequestSchema;
export const assignRequestSchema=z.object({expectedVersion:z.number().int().positive(),assigneeId:uuid.nullable(),reason:z.string().trim().min(1).max(500)}).strict();
export const contactAttemptSchema=z.object({
  expectedVersion:z.number().int().positive(),
  channel:z.string().trim().min(1).max(80),
  outcome:z.enum(['reached','no-answer','callback-requested','other']),
  notes:z.string().trim().max(4000).default(''),
  nextAction:z.string().trim().min(1).max(1000).nullable(),
  callbackDueAt:z.iso.datetime({offset:true}).nullable(),
}).strict().refine(value=>value.callbackDueAt===null||value.nextAction!==null,{message:'Add a next action for the callback.',path:['nextAction']});
export const correctContactSchema=z.object({expectedVersion:z.number().int().positive(),entryId:uuid,channel:z.string().trim().min(1).max(80),outcome:z.enum(['reached','no-answer','callback-requested','other']),notes:z.string().trim().max(4000),reason:z.string().trim().min(1).max(500)}).strict();

export async function createServiceRequest(pool:Database,scope:Scope,key:string,body:z.infer<typeof serviceRequestInputSchema>) {
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'service-request.created',targetAggregateId:'new',payload:body,responseSchema,
    lockSerializationRoots:client=>lockAdvisoryRoots(client,[`workforce:${scope.organisationId}:${scope.siteId}`]),
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      await rejectAccountOnlyOperator(client,scope);
    },
    apply:async client=>{
      const id=randomUUID();
      await client.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'service-request')",[id,scope.organisationId,scope.siteId]);
      await client.query(`INSERT INTO service_requests(id,organisation_id,site_id,version,request_kind,vehicle_source,shipping_reference,source_channel,concern,reported_contact,reported_contact_name,reported_contact_phone,reported_contact_relationship,reported_vehicle,reported_client,preferred_dropoff_window,preferred_callback_window,next_action,callback_due_at,assigned_to,created_by)
        VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,[id,scope.organisationId,scope.siteId,body.requestKind,body.vehicleSource,body.shippingReference,body.sourceChannel,body.concern,body.reportedContact,body.reportedContactName,body.reportedContactPhone,body.reportedContactRelationship,body.reportedVehicle,body.reportedClient,body.preferredDropoffWindow,body.preferredCallbackWindow,body.nextAction,body.callbackDueAt,body.nextAction?scope.actorId:null,scope.actorId]);
      return {aggregateId:id,aggregateType:'service-request',version:1,previous:{},next:{id,version:1,...body},reason:'Service request recorded.'};
    },
    project:async(_client,mutation)=>responseSchema.parse(mutation.next),
  });
}

async function rejectAccountOnlyOperator(client:import('pg').PoolClient,scope:Scope) {
  const result=await client.query(`SELECT EXISTS(SELECT 1 FROM staff_role_placements WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND state='active' AND role_code='vmms-operator')
    AND NOT EXISTS(SELECT 1 FROM staff_role_placements WHERE organisation_id=$1 AND site_id=$2 AND staff_user_id=$3 AND state='active' AND role_code<>'vmms-operator') AS denied`,[scope.organisationId,scope.siteId,scope.actorId]);
  if(z.object({denied:z.boolean()}).parse(result.rows[0]).denied) throw new ApiError(403,'WORK_ROLE_REQUIRED','The VMMS Operator account is limited to account administration.');
}

export async function requestAccess(client:import('pg').PoolClient,scope:Scope) {
  await lockAdvisoryRoots(client,[`workforce:${scope.organisationId}:${scope.siteId}`]);
  await rejectAccountOnlyOperator(client,scope);
  const roles=await client.query(`SELECT 1 FROM staff_role_placements p JOIN staff_role_profiles r ON r.code=p.role_code
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3 AND p.state='active' AND r.active
      AND p.role_code IN ('head-service-centre','service-advisor','warranty-customer-support') LIMIT 1`,[scope.organisationId,scope.siteId,scope.actorId]);
  return Boolean(roles.rowCount);
}

export async function readServiceRequest(pool:Database,scope:Scope,id:string,requestId:string) {
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    const shared=await requestAccess(client,scope);
    const result=await client.query(`SELECT r.id,r.version,r.status,r.source_channel AS "sourceChannel",r.concern,
      r.request_kind AS "requestKind",r.vehicle_source AS "vehicleSource",r.shipping_reference AS "shippingReference",r.reported_contact AS "reportedContact",r.reported_contact_name AS "reportedContactName",r.reported_contact_phone AS "reportedContactPhone",r.reported_contact_relationship AS "reportedContactRelationship",r.reported_vehicle AS "reportedVehicle",r.reported_client AS "reportedClient",
      r.preferred_dropoff_window AS "preferredDropoffWindow",r.preferred_callback_window AS "preferredCallbackWindow",r.next_action AS "nextAction",r.callback_due_at AS "callbackDueAt",r.assigned_to AS "assignedTo",u.display_name AS "assignedToName",r.work_order_id AS "workOrderId" FROM service_requests r
      LEFT JOIN staff_users u ON u.id=r.assigned_to
      WHERE r.organisation_id=$1 AND r.site_id=$2 AND r.id=$3 AND (r.created_by=$4 OR $5::boolean)`,[scope.organisationId,scope.siteId,id,scope.actorId,shared]);
    if(!result.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    const item=readSchema.parse(result.rows[0]);
    await recordSensitiveRead(client,scope,'service-request-read-prepared',1,requestId);
    return {...item,callbackDueAt:item.callbackDueAt?.toISOString()??null};
  });
}

export async function linkServiceRequestToWorkOrder(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof linkRequestSchema>) {
  let shared=false;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'service-request.linked-to-work-order',targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:async client=>{
      shared=await requestAccess(client,scope);
      const found=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,id]);
      if(!found.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    authorize:async(_client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      if(!shared) throw new ApiError(403,'ROLE_REQUIRED','Only customer care staff or the Head can link requests to jobs.');
    },
    apply:async client=>{
      const found=await client.query('SELECT version,status FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
      const current=z.object({version:z.number().int().positive(),status:z.string()}).parse(found.rows[0]);
      if(current.version!==body.expectedVersion) throw new ApiError(409,'STALE_VERSION','This request changed. Refresh and try again.',current.version);
      if(current.status!=='open') throw new ApiError(409,'REQUEST_NOT_OPEN','This request is already linked or closed.');
      const order=await client.query('SELECT id FROM work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,body.workOrderId]);
      if(!order.rowCount) throw new ApiError(404,'NOT_FOUND','The selected job was not found at this service centre.');
      await client.query("UPDATE service_requests SET version=$4,status='converted',work_order_id=$5 WHERE organisation_id=$1 AND site_id=$2 AND id=$3",[scope.organisationId,scope.siteId,id,current.version+1,body.workOrderId]);
      return {aggregateId:id,aggregateType:'service-request',version:current.version+1,previous:{version:current.version,status:current.status,workOrderId:null},next:{id,version:current.version+1,status:'converted',workOrderId:body.workOrderId},reason:body.reason};
    },
    project:async(_client,mutation)=>responseSchema.parse(mutation.next),
  });
}

export async function unlinkServiceRequest(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof unlinkRequestSchema>) {
  let shared=false;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'service-request.link-corrected',targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:async client=>{
      shared=await requestAccess(client,scope);
      const found=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,id]);
      if(!found.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    authorize:async(_client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      if(!shared) throw new ApiError(403,'ROLE_REQUIRED','Only customer care staff or the Head can correct request links.');
    },
    apply:async client=>{
      const found=await client.query('SELECT version,status,work_order_id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
      const current=z.object({version:z.number().int().positive(),status:z.string(),work_order_id:uuid.nullable()}).parse(found.rows[0]);
      if(current.version!==body.expectedVersion) throw new ApiError(409,'STALE_VERSION','This request changed. Refresh and try again.',current.version);
      if(current.status!=='converted'||!current.work_order_id) throw new ApiError(409,'REQUEST_NOT_LINKED','This request is not linked to a job.');
      await client.query("UPDATE service_requests SET version=$4,status='open',work_order_id=NULL WHERE organisation_id=$1 AND site_id=$2 AND id=$3",[scope.organisationId,scope.siteId,id,current.version+1]);
      return {aggregateId:id,aggregateType:'service-request',version:current.version+1,previous:{version:current.version,status:'converted',workOrderId:current.work_order_id},next:{id,version:current.version+1,status:'open',workOrderId:null},reason:body.reason};
    },
    project:async(_client,mutation)=>responseSchema.parse(mutation.next),
  });
}

export async function claimServiceRequest(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof claimRequestSchema>) {
  let shared=false;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'service-request.claimed',targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:async client=>{
      shared=await requestAccess(client,scope);
      const found=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,id]);
      if(!found.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      const allowed=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND (created_by=$4 OR $5::boolean)',[scope.organisationId,scope.siteId,id,scope.actorId,shared]);
      if(!allowed.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    apply:async client=>{
      const found=await client.query('SELECT version,status,assigned_to FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
      const current=z.object({version:z.number().int().positive(),status:z.string(),assigned_to:uuid.nullable()}).parse(found.rows[0]);
      if(current.version!==body.expectedVersion) throw new ApiError(409,'STALE_VERSION','This request changed. Refresh and try again.',current.version);
      if(current.status!=='open') throw new ApiError(409,'REQUEST_NOT_OPEN','This request is not open for updates.');
      if(current.assigned_to) throw new ApiError(409,'REQUEST_ALREADY_ASSIGNED','This request already has someone responsible.');
      await client.query('UPDATE service_requests SET version=$4,assigned_to=$5 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id,current.version+1,scope.actorId]);
      return {aggregateId:id,aggregateType:'service-request',version:current.version+1,previous:{version:current.version,assignedTo:null},next:{id,version:current.version+1,assignedTo:scope.actorId},reason:'Follow-up responsibility accepted.'};
    },
    project:async(_client,mutation)=>responseSchema.parse(mutation.next),
  });
}

export async function assignServiceRequest(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof assignRequestSchema>) {
  let shared=false;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'service-request.assigned',targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:async client=>{
      shared=await requestAccess(client,scope);
      const found=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,id]);
      if(!found.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    authorize:async(_client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      if(!shared) throw new ApiError(403,'ROLE_REQUIRED','Only customer care staff or the Head can assign requests.');
    },
    apply:async client=>{
      const found=await client.query('SELECT version,status,assigned_to,created_by FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
      const current=z.object({version:z.number().int().positive(),status:z.string(),assigned_to:uuid.nullable(),created_by:uuid}).parse(found.rows[0]);
      if(current.version!==body.expectedVersion) throw new ApiError(409,'STALE_VERSION','This request changed. Refresh and try again.',current.version);
      if(current.status!=='open') throw new ApiError(409,'REQUEST_NOT_OPEN','This request is not open for updates.');
      if(current.assigned_to===body.assigneeId) throw new ApiError(409,'ASSIGNMENT_UNCHANGED','The responsible person has not changed.');
      if(body.assigneeId){
        let target;
        try {target=await client.query('SELECT public.lock_request_assignee($1) AS writable',[body.assigneeId]);}
        catch(error){if(typeof error==='object'&&error!==null&&'code' in error&&error.code==='55P03')throw new ApiError(409,'ASSIGNEE_BUSY','The selected person is being updated. Try again.');throw error;}
        if(target.rows[0]?.writable!==true) throw new ApiError(409,'ASSIGNEE_UNAVAILABLE','Choose a person with active writable access at this site.');
        const roles=await client.query(`SELECT EXISTS(SELECT 1 FROM staff_role_placements p JOIN staff_role_profiles rp ON rp.code=p.role_code AND rp.active
          WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3 AND p.state='active' AND p.role_code IN ('head-service-centre','service-advisor','warranty-customer-support')) AS shared,
          EXISTS(SELECT 1 FROM staff_role_placements p WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3 AND p.state='active' AND p.role_code='vmms-operator') AS operator,
          EXISTS(SELECT 1 FROM staff_role_placements p WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3 AND p.state='active' AND p.role_code<>'vmms-operator') AS work`,[scope.organisationId,scope.siteId,body.assigneeId]);
        const role=z.object({shared:z.boolean(),operator:z.boolean(),work:z.boolean()}).parse(roles.rows[0]);
        if((role.operator&&!role.work)||(!role.shared&&body.assigneeId!==current.created_by)) throw new ApiError(409,'ASSIGNEE_UNAVAILABLE','Choose a person who can access this request.');
      }
      await client.query('UPDATE service_requests SET version=$4,assigned_to=$5 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id,current.version+1,body.assigneeId]);
      return {aggregateId:id,aggregateType:'service-request',version:current.version+1,previous:{version:current.version,assignedTo:current.assigned_to},next:{id,version:current.version+1,assignedTo:body.assigneeId},reason:body.reason};
    },
    project:async(_client,mutation)=>responseSchema.parse(mutation.next),
  });
}

export async function readServiceRequestContacts(pool:Database,scope:Scope,id:string,requestId:string,page=1,pageSize=25) {
  const number=z.number().int().min(1).max(10000).parse(page);
  const size=z.number().int().min(1).max(50).parse(pageSize);
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    const shared=await requestAccess(client,scope);
    const request=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND (created_by=$4 OR $5::boolean)',[scope.organisationId,scope.siteId,id,scope.actorId,shared]);
    if(!request.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    const count=await client.query('SELECT count(*)::int AS total FROM service_request_contact_entries WHERE organisation_id=$1 AND site_id=$2 AND request_id=$3',[scope.organisationId,scope.siteId,id]);
    const total=z.object({total:z.number().int().nonnegative()}).parse(count.rows[0]).total;
    const found=await client.query(`SELECT e.id,e.recorded_by AS "recordedBy",u.display_name AS "recordedByName",e.recorded_at AS "recordedAt",e.channel,e.outcome,e.notes,e.corrects_entry_id AS "correctsEntryId",original.recorded_at AS "correctsRecordedAt",e.correction_reason AS "correctionReason",
      EXISTS(SELECT 1 FROM service_request_contact_entries child WHERE child.organisation_id=e.organisation_id AND child.site_id=e.site_id AND child.request_id=e.request_id AND child.corrects_entry_id=e.id) AS "isCorrected"
      FROM service_request_contact_entries e LEFT JOIN staff_users u ON u.id=e.recorded_by LEFT JOIN service_request_contact_entries original ON original.organisation_id=e.organisation_id AND original.site_id=e.site_id AND original.request_id=e.request_id AND original.id=e.corrects_entry_id WHERE e.organisation_id=$1 AND e.site_id=$2 AND e.request_id=$3
      ORDER BY e.recorded_at DESC,e.id DESC LIMIT $4 OFFSET $5`,[scope.organisationId,scope.siteId,id,size,(number-1)*size]);
    const schema=z.array(z.object({id:uuid,recordedBy:uuid,recordedByName:z.string().nullable(),recordedAt:z.date(),channel:z.string(),outcome:z.enum(['reached','no-answer','callback-requested','other']),notes:z.string(),correctsEntryId:uuid.nullable(),correctsRecordedAt:z.date().nullable(),correctionReason:z.string().nullable(),isCorrected:z.boolean()}));
    const items=schema.parse(found.rows).map(item=>({...item,recordedAt:item.recordedAt.toISOString(),correctsRecordedAt:item.correctsRecordedAt?.toISOString()??null}));
    await recordSensitiveRead(client,scope,'service-request-read-prepared',items.length,requestId);
    return {items,page:number,pageSize:size,totalCount:total,totalPages:Math.ceil(total/size)};
  });
}

export async function correctServiceRequestContact(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof correctContactSchema>) {
  let shared=false;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'service-request.contact-corrected',targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:async client=>{
      shared=await requestAccess(client,scope);
      const result=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,id]);
      if(!result.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    authorize:async(client,membership)=>{
      if(!membership.canWrite)throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      const allowed=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND (created_by=$4 OR $5::boolean)',[scope.organisationId,scope.siteId,id,scope.actorId,shared]);
      if(!allowed.rowCount)throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    apply:async client=>{
      const result=await client.query('SELECT version,status FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
      const current=z.object({version:z.number().int().positive(),status:z.string()}).parse(result.rows[0]);
      if(current.version!==body.expectedVersion)throw new ApiError(409,'STALE_VERSION','This request changed. Refresh and try again.',current.version);
      if(current.status==='closed')throw new ApiError(409,'REQUEST_NOT_OPEN','This request is closed.');
      const prior=await client.query(`SELECT e.id,EXISTS(SELECT 1 FROM service_request_contact_entries child WHERE child.organisation_id=e.organisation_id AND child.site_id=e.site_id AND child.request_id=e.request_id AND child.corrects_entry_id=e.id) AS corrected
        FROM service_request_contact_entries e WHERE e.organisation_id=$1 AND e.site_id=$2 AND e.request_id=$3 AND e.id=$4`,[scope.organisationId,scope.siteId,id,body.entryId]);
      if(!prior.rowCount)throw new ApiError(404,'NOT_FOUND','The contact entry was not found.');
      if(z.object({corrected:z.boolean()}).parse(prior.rows[0]).corrected)throw new ApiError(409,'ALREADY_CORRECTED','This entry has already been corrected. Refresh the history.');
      const entryId=randomUUID();
      await client.query(`INSERT INTO service_request_contact_entries(id,organisation_id,site_id,request_id,recorded_by,channel,outcome,notes,corrects_entry_id,correction_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[entryId,scope.organisationId,scope.siteId,id,scope.actorId,body.channel,body.outcome,body.notes,body.entryId,body.reason]);
      await client.query('UPDATE service_requests SET version=$4 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id,current.version+1]);
      return {aggregateId:id,aggregateType:'service-request',version:current.version+1,previous:{version:current.version,entryId:body.entryId},next:{id,version:current.version+1,entryId,correctsEntryId:body.entryId},reason:body.reason};
    },project:async(_client,mutation)=>responseSchema.parse(mutation.next),
  });
}

export async function listWorkOrderRequests(pool:Database,scope:Scope,workOrderId:string,requestId:string,page=1,pageSize=25) {
  const number=z.number().int().min(1).max(10000).parse(page),size=z.number().int().min(1).max(50).parse(pageSize);
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    const shared=await requestAccess(client,scope);
    const job=await client.query('SELECT id FROM work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR SHARE',[scope.organisationId,scope.siteId,workOrderId]);
    if(!job.rowCount) throw new ApiError(404,'NOT_FOUND','The requested job was not found.');
    const values=[scope.organisationId,scope.siteId,workOrderId,scope.actorId,shared];
    const where="organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND status='converted' AND (created_by=$4 OR $5::boolean)";
    const count=await client.query(`SELECT count(*)::int AS total FROM service_requests WHERE ${where}`,values);
    const total=z.object({total:z.number().int().nonnegative()}).parse(count.rows[0]).total;
    const found=await client.query(`SELECT id,concern,source_channel AS "sourceChannel",created_at AS "createdAt" FROM service_requests WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $6 OFFSET $7`,[...values,size,(number-1)*size]);
    const items=z.array(z.object({id:uuid,concern:z.string(),sourceChannel:z.string(),createdAt:z.date()})).parse(found.rows).map(row=>({...row,createdAt:row.createdAt.toISOString()}));
    await recordSensitiveRead(client,scope,'service-request-read-prepared',items.length,requestId);
    return {items,page:number,pageSize:size,totalCount:total,totalPages:Math.ceil(total/size)};
  });
}

export async function listRequestAssignees(pool:Database,scope:Scope,id:string,requestId:string,page=1,pageSize=25) {
  const number=z.number().int().min(1).max(10000).parse(page), size=z.number().int().min(1).max(50).parse(pageSize);
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    if(!await requestAccess(client,scope)) throw new ApiError(403,'ROLE_REQUIRED','Only customer care staff or the Head can assign requests.');
    const found=await client.query('SELECT created_by FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
    if(!found.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    const creator=z.object({created_by:uuid}).parse(found.rows[0]).created_by;
    const where=`m.site_id=$1 AND m.active AND m.can_write AND u.active AND (u.id=$3 OR EXISTS(SELECT 1 FROM staff_role_placements p JOIN staff_role_profiles rp ON rp.code=p.role_code AND rp.active WHERE p.organisation_id=$2 AND p.site_id=$1 AND p.staff_user_id=u.id AND p.state='active' AND p.role_code IN ('head-service-centre','service-advisor','warranty-customer-support'))) AND NOT (EXISTS(SELECT 1 FROM staff_role_placements p WHERE p.organisation_id=$2 AND p.site_id=$1 AND p.staff_user_id=u.id AND p.state='active' AND p.role_code='vmms-operator') AND NOT EXISTS(SELECT 1 FROM staff_role_placements p WHERE p.organisation_id=$2 AND p.site_id=$1 AND p.staff_user_id=u.id AND p.state='active' AND p.role_code<>'vmms-operator'))`;
    const values=[scope.siteId,scope.organisationId,creator];
    const count=await client.query(`SELECT count(*)::int AS total FROM memberships m JOIN staff_users u ON u.id=m.user_id WHERE ${where}`,values);
    const total=z.object({total:z.number().int().nonnegative()}).parse(count.rows[0]).total;
    const rows=await client.query(`SELECT u.id,u.display_name AS name FROM memberships m JOIN staff_users u ON u.id=m.user_id WHERE ${where} ORDER BY u.display_name,u.id LIMIT $4 OFFSET $5`,[...values,size,(number-1)*size]);
    const items=z.array(z.object({id:uuid,name:z.string()})).parse(rows.rows);
    await recordSensitiveRead(client,scope,'service-request-read-prepared',items.length,requestId);
    return {items,page:number,pageSize:size,totalCount:total,totalPages:Math.ceil(total/size)};
  });
}

export async function listServiceRequests(pool:Database,scope:Scope,requestId:string,filter:'all'|'mine'|'overdue'|'due-today'|'unscheduled'|'linked'|'closed'='all',page=1,pageSize=25) {
  const selected=z.enum(['all','mine','overdue','due-today','unscheduled','linked','closed']).parse(filter);
  const number=z.number().int().min(1).max(10000).parse(page);
  const size=z.number().int().min(1).max(50).parse(pageSize);
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    const shared=await requestAccess(client,scope);
    const where=`r.organisation_id=$1 AND r.site_id=$2 AND (($5='linked' AND r.status='converted') OR ($5='closed' AND r.status='closed') OR ($5 NOT IN ('linked','closed') AND r.status='open')) AND (r.created_by=$3 OR $4::boolean)
      AND ($5 IN ('all','linked','closed') OR ($5='mine' AND r.assigned_to=$3) OR ($5='unscheduled' AND r.callback_due_at IS NULL)
        OR ($5='overdue' AND r.callback_due_at < transaction_timestamp())
        OR ($5='due-today' AND r.callback_due_at >= transaction_timestamp()
          AND (r.callback_due_at AT TIME ZONE public.current_scoped_site_timezone())::date=(transaction_timestamp() AT TIME ZONE public.current_scoped_site_timezone())::date))`;
    const values=[scope.organisationId,scope.siteId,scope.actorId,shared,selected];
    const count=await client.query(`SELECT count(*)::int AS total FROM service_requests r WHERE ${where}`,values);
    const total=z.object({total:z.number().int().nonnegative()}).parse(count.rows[0]).total;
    const found=await client.query(`SELECT r.id,r.version,r.request_kind AS "requestKind",r.vehicle_source AS "vehicleSource",r.shipping_reference AS "shippingReference",r.concern,r.reported_contact AS "reportedContact",r.reported_contact_name AS "reportedContactName",r.reported_contact_phone AS "reportedContactPhone",r.reported_contact_relationship AS "reportedContactRelationship",r.reported_vehicle AS "reportedVehicle",
      r.reported_client AS "reportedClient",r.preferred_dropoff_window AS "preferredDropoffWindow",r.preferred_callback_window AS "preferredCallbackWindow",r.next_action AS "nextAction",r.callback_due_at AS "callbackDueAt",r.assigned_to AS "assignedTo",
      u.display_name AS "assignedToName",CASE WHEN r.assigned_to IS NULL THEN NULL ELSE (coalesce(u.active,false) AND EXISTS
        (SELECT 1 FROM memberships m WHERE m.site_id=r.site_id AND m.user_id=r.assigned_to AND m.active AND m.can_write)
        AND (r.created_by=r.assigned_to OR EXISTS(SELECT 1 FROM staff_role_placements p JOIN staff_role_profiles rp ON rp.code=p.role_code AND rp.active
          WHERE p.organisation_id=r.organisation_id AND p.site_id=r.site_id AND p.staff_user_id=r.assigned_to AND p.state='active'
            AND p.role_code IN ('head-service-centre','service-advisor','warranty-customer-support')))
        AND NOT (EXISTS(SELECT 1 FROM staff_role_placements p WHERE p.organisation_id=r.organisation_id AND p.site_id=r.site_id AND p.staff_user_id=r.assigned_to AND p.state='active' AND p.role_code='vmms-operator')
          AND NOT EXISTS(SELECT 1 FROM staff_role_placements p WHERE p.organisation_id=r.organisation_id AND p.site_id=r.site_id AND p.staff_user_id=r.assigned_to AND p.state='active' AND p.role_code<>'vmms-operator'))) END AS "assigneeActive"
      FROM service_requests r LEFT JOIN staff_users u ON u.id=r.assigned_to WHERE ${where}
      ORDER BY r.callback_due_at ASC NULLS LAST,r.id ASC LIMIT $6 OFFSET $7`,[...values,size,(number-1)*size]);
    const row=z.object({id:uuid,version:z.number().int().positive(),requestKind:z.enum(['repair-maintenance','routine-maintenance','psai','service-centre-pdi']),vehicleSource:z.enum(['showroom-stock','partner-garage','other','unknown']),shippingReference:z.string().nullable(),concern:z.string(),reportedContact:z.string().nullable(),reportedContactName:z.string().nullable(),reportedContactPhone:z.string().nullable(),reportedContactRelationship:z.enum(['vehicle-owner','driver','client-contact','sales-contact','other','unknown']),reportedVehicle:z.string().nullable(),reportedClient:z.string().nullable(),preferredDropoffWindow:z.string().nullable(),preferredCallbackWindow:z.string().nullable(),nextAction:z.string().nullable(),callbackDueAt:z.date().nullable(),assignedTo:uuid.nullable(),assignedToName:z.string().nullable(),assigneeActive:z.boolean().nullable()});
    const items=z.array(row).parse(found.rows).map(item=>({...item,callbackDueAt:item.callbackDueAt?.toISOString()??null}));
    await recordSensitiveRead(client,scope,'service-request-read-prepared',items.length,requestId);
    return {items,page:number,pageSize:size,totalCount:total,totalPages:Math.ceil(total/size)};
  });
}

async function changeServiceRequestStatus(pool:Database,scope:Scope,key:string,id:string,body:{expectedVersion:number;reason:string},transition:{from:'open'|'closed';to:'open'|'closed';operation:string;notAllowedCode:string;notAllowedMessage:string}) {
  let shared=false;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:transition.operation,targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:async client=>{
      shared=await requestAccess(client,scope);
      const found=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,id]);
      if(!found.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      const allowed=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND (created_by=$4 OR $5::boolean)',[scope.organisationId,scope.siteId,id,scope.actorId,shared]);
      if(!allowed.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    apply:async client=>{
      const found=await client.query('SELECT version,status,work_order_id AS "workOrderId" FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
      const current=z.object({version:z.number().int().positive(),status:z.enum(['open','converted','closed']),workOrderId:uuid.nullable()}).parse(found.rows[0]);
      if(current.version!==body.expectedVersion) throw new ApiError(409,'STALE_VERSION','This request changed. Refresh and try again.',current.version);
      if(current.status!==transition.from || current.workOrderId!==null) throw new ApiError(409,transition.notAllowedCode,transition.notAllowedMessage,current.version);
      const version=current.version+1;
      await client.query('UPDATE service_requests SET version=$4,status=$5 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id,version,transition.to]);
      await client.query(`INSERT INTO service_request_status_history(id,organisation_id,site_id,request_id,version,previous_status,next_status,reason,changed_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[randomUUID(),scope.organisationId,scope.siteId,id,version,current.status,transition.to,body.reason,scope.actorId]);
      return {aggregateId:id,aggregateType:'service-request',version,previous:{version:current.version,status:current.status},next:{id,version,status:transition.to,reason:body.reason},reason:body.reason};
    },
    project:async(_client,mutation)=>responseSchema.parse(mutation.next),
  });
}

export function closeServiceRequest(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof closeRequestSchema>) {
  return changeServiceRequestStatus(pool,scope,key,id,body,{from:'open',to:'closed',operation:'service-request.closed',notAllowedCode:'REQUEST_NOT_OPEN',notAllowedMessage:'Only an open request that is not linked to a job can be closed.'});
}

export function reopenServiceRequest(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof reopenRequestSchema>) {
  return changeServiceRequestStatus(pool,scope,key,id,body,{from:'closed',to:'open',operation:'service-request.reopened',notAllowedCode:'REQUEST_NOT_CLOSED',notAllowedMessage:'Only a closed request that is not linked to a job can be reopened.'});
}

export async function readServiceRequestStatusHistory(pool:Database,scope:Scope,id:string,requestId:string,page=1,pageSize=25) {
  const number=z.number().int().min(1).max(10000).parse(page),size=z.number().int().min(1).max(50).parse(pageSize);
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    const shared=await requestAccess(client,scope);
    const request=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND (created_by=$4 OR $5::boolean)',[scope.organisationId,scope.siteId,id,scope.actorId,shared]);
    if(!request.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    const values=[scope.organisationId,scope.siteId,id];
    const count=await client.query('SELECT count(*)::int AS total FROM service_request_status_history WHERE organisation_id=$1 AND site_id=$2 AND request_id=$3',values);
    const total=z.object({total:z.number().int().nonnegative()}).parse(count.rows[0]).total;
    const found=await client.query(`SELECT h.id,h.version,h.previous_status AS "previousStatus",h.next_status AS "nextStatus",h.reason,h.changed_at AS "changedAt",u.display_name AS "changedByName"
      FROM service_request_status_history h LEFT JOIN staff_users u ON u.id=h.changed_by WHERE h.organisation_id=$1 AND h.site_id=$2 AND h.request_id=$3
      ORDER BY h.version DESC,h.id DESC LIMIT $4 OFFSET $5`,[...values,size,(number-1)*size]);
    const item=z.object({id:uuid,version:z.number().int().positive(),previousStatus:z.enum(['open','closed']),nextStatus:z.enum(['open','closed']),reason:z.string(),changedAt:z.date(),changedByName:z.string().nullable()});
    const items=z.array(item).parse(found.rows).map(row=>({...row,changedAt:row.changedAt.toISOString()}));
    await recordSensitiveRead(client,scope,'service-request-read-prepared',items.length,requestId);
    return {items,page:number,pageSize:size,totalCount:total,totalPages:Math.ceil(total/size)};
  });
}

export async function recordServiceRequestContact(pool:Database,scope:Scope,key:string,id:string,body:z.infer<typeof contactAttemptSchema>) {
  let shared=false;
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'service-request.contact-recorded',targetAggregateId:id,payload:body,responseSchema,
    lockSerializationRoots:async client=>{
      shared=await requestAccess(client,scope);
      const found=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,id]);
      if(!found.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      const allowed=await client.query('SELECT id FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND (created_by=$4 OR $5::boolean)',[scope.organisationId,scope.siteId,id,scope.actorId,shared]);
      if(!allowed.rowCount) throw new ApiError(404,'NOT_FOUND','The requested record was not found.');
    },
    apply:async client=>{
      const found=await client.query('SELECT version,status,next_action,callback_due_at FROM service_requests WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id]);
      const current=z.object({version:z.number().int().positive(),status:z.string(),next_action:z.string().nullable(),callback_due_at:z.date().nullable()}).parse(found.rows[0]);
      if(current.version!==body.expectedVersion) throw new ApiError(409,'STALE_VERSION','This request changed. Refresh and try again.',current.version);
      if(current.status==='closed') throw new ApiError(409,'REQUEST_NOT_OPEN','This request is closed.');
      const entryId=randomUUID();
      await client.query(`INSERT INTO service_request_contact_entries(id,organisation_id,site_id,request_id,recorded_by,channel,outcome,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[entryId,scope.organisationId,scope.siteId,id,scope.actorId,body.channel,body.outcome,body.notes]);
      await client.query('UPDATE service_requests SET version=$4,next_action=$5,callback_due_at=$6 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,id,current.version+1,body.nextAction,body.callbackDueAt]);
      return {aggregateId:id,aggregateType:'service-request',version:current.version+1,previous:{version:current.version,nextAction:current.next_action,callbackDueAt:current.callback_due_at},next:{id,version:current.version+1,entryId,...body},reason:'Contact attempt recorded.'};
    },
    project:async(_client,mutation)=>responseSchema.parse(mutation.next),
  });
}
