import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { type Database, type Scope, scoped } from './db.js';
import { ApiError, notFound } from './errors.js';
import { complaintSchema, detailSchema, holdSchema, intakeSchema, summarySchema, taskSchema, type WorkOrderDetail } from './schemas.js';
import { runStaffCommand } from './commands.js';

const summarySql = `SELECT w.id,w.reference,w.version,w.created_at AS "createdAt",c.name AS "customerName",concat(v.make,' ',v.model) AS "vehicleLabel",v.vin,v.registration,w.status,
(SELECT count(*)::int FROM complaints x WHERE x.work_order_id=w.id) AS "complaintCount",
(SELECT count(*)::int FROM holds x WHERE x.work_order_id=w.id) AS "openHoldCount"
FROM work_orders w JOIN customers c ON c.id=w.customer_id JOIN vehicles v ON v.id=w.vehicle_id`;

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
  const extraResult = await client.query(`SELECT jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'email',c.email) AS customer,
    jsonb_build_object('id',v.id,'vin',v.vin,'registration',v.registration,'make',v.make,'model',v.model) AS vehicle,
    w.odometer_km AS "odometerKm",w.soc_percent AS "socPercent" FROM work_orders w JOIN customers c ON c.id=w.customer_id JOIN vehicles v ON v.id=w.vehicle_id WHERE w.id=$1`,[id]);
  const extra = z.object({customer:detailSchema.shape.customer,vehicle:detailSchema.shape.vehicle,odometerKm:z.number(),socPercent:z.number().nullable()}).parse(extraResult.rows[0]);
  const complaints = await client.query(`SELECT id,'C'||lpad(ordinal::text,2,'0') AS reference,wording FROM complaints WHERE work_order_id=$1 ORDER BY ordinal`,[id]);
  const tasks = await client.query(`SELECT id,'T'||lpad(ordinal::text,2,'0') AS reference,title,complaint_id AS "complaintId",state FROM tasks WHERE work_order_id=$1 ORDER BY ordinal`,[id]);
  const holds = await client.query(`SELECT h.id,h.category,h.severity,h.reason,h.source,h.task_id AS "taskId",h.opened_at AS "openedAt",u.display_name AS "openedBy" FROM holds h JOIN staff_users u ON u.id=h.owner_id WHERE h.work_order_id=$1 ORDER BY h.opened_at,h.id`,[id]);
  const history = await client.query(`SELECT a.id,a.event_type AS action,a.created_at AS at,u.display_name AS actor,a.reason FROM domain_events a JOIN staff_users u ON u.id=a.actor_id WHERE a.aggregate_id=$1 AND a.aggregate_type='work-order' ORDER BY a.aggregate_version,a.id`,[id]);
  return detailSchema.parse({...summary,...extra,complaints:complaints.rows,tasks:tasks.rows,holds:holds.rows,history:history.rows,gates});
}

export async function listWorkOrders(pool: Database, scope: Scope, q: string) {
  return scoped(pool,scope,async client => {
    const found = await client.query(`${summarySql} WHERE ($1='' OR w.reference ILIKE $2 OR v.vin ILIKE $2 OR v.registration ILIKE $2 OR c.name ILIKE $2) ORDER BY w.created_at DESC,w.id LIMIT 100`,[q,`%${q.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')}%`]);
    const counts = await client.query(`SELECT count(*)::int AS open,count(*) FILTER (WHERE EXISTS(SELECT 1 FROM holds h WHERE h.work_order_id=w.id))::int AS held,count(*)::int AS "intakeDrafts" FROM work_orders w`);
    return {items:z.array(summarySchema).parse(found.rows),totals:z.object({open:z.number(),held:z.number(),intakeDrafts:z.number()}).parse(counts.rows[0]),asOf:new Date().toISOString()};
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

export async function createIntake(pool: Database, scope: Scope, key: string, body: z.infer<typeof intakeSchema>) {
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'reception.draft-created',targetAggregateId:'new',payload:body,responseSchema:detailSchema,
    authorize:async(_client,membership)=>requireSiteWrite(membership.canWrite),
    apply:async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`vin:${scope.organisationId}:${body.vehicle.vin}`]);
    const duplicate = await client.query('SELECT id FROM vehicles WHERE vin=$1',[body.vehicle.vin]);
    if (duplicate.rows.length) throw new ApiError(409,'DUPLICATE_VIN','This VIN already exists. Keep this draft and select the existing vehicle when that workflow is available.');
    const customerId=randomUUID(),vehicleId=randomUUID(),visitId=randomUUID(),workOrderId=randomUUID(),complaintId=randomUUID();
    await client.query('INSERT INTO customers(id,organisation_id,name,phone,email) VALUES($1,$2,$3,$4,$5)',[customerId,scope.organisationId,body.customer.name,body.customer.phone,body.customer.email]);
    await client.query('INSERT INTO vehicles(id,organisation_id,customer_id,vin,registration,make,model) VALUES($1,$2,$3,$4,$5,$6,$7)',[vehicleId,scope.organisationId,customerId,body.vehicle.vin,body.vehicle.registration,body.vehicle.make,body.vehicle.model]);
    await client.query('INSERT INTO visits(id,organisation_id,site_id,vehicle_id) VALUES($1,$2,$3,$4)',[visitId,scope.organisationId,scope.siteId,vehicleId]);
    await client.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'work-order')",[workOrderId,scope.organisationId,scope.siteId]);
    await client.query(`INSERT INTO work_orders(id,organisation_id,site_id,visit_id,customer_id,vehicle_id,reference,odometer_km,soc_percent) VALUES($1,$2,$3,$4,$5,$6,'RG-'||extract(year from now())::text||'-'||lpad(nextval('work_order_reference_seq')::text,6,'0'),$7,$8)`,[workOrderId,scope.organisationId,scope.siteId,visitId,customerId,vehicleId,body.odometerKm,body.socPercent]);
    await client.query('INSERT INTO complaints(id,organisation_id,site_id,work_order_id,ordinal,wording) VALUES($1,$2,$3,$4,1,$5)',[complaintId,scope.organisationId,scope.siteId,workOrderId,body.complaint]);
    return {aggregateId:workOrderId,aggregateType:'work-order',version:1,previous:{},next:{version:1,customerId,vehicleId,visitId,complaintId},reason:'Reception draft saved; intake gate remains pending.'};
    },
    project:(client,mutation)=>detail(client,mutation.aggregateId),
  });
}

export async function addComplaint(pool: Database, scope: Scope, key: string, id: string, body: z.infer<typeof complaintSchema>) {
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'workshop.complaint-added',targetAggregateId:id,payload:body,responseSchema:detailSchema,
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

export async function openHold(pool: Database, scope: Scope, key: string, id: string, body: z.infer<typeof holdSchema>) {
  return runStaffCommand(pool,{
    scope,commandId:key,operation:'safety.hold-opened',targetAggregateId:id,payload:body,responseSchema:detailSchema,
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
