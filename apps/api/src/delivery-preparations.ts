import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, notFound } from './errors.js';
import { type Database, type Scope, uuid } from './db.js';
import { lockAdvisoryRoots, runStaffCommand } from './commands.js';

const optionalText=(max:number)=>z.string().trim().max(max).transform(value=>value||null).nullable().optional().default(null);

export const createDeliveryPreparationSchema=z.object({
  vehicle:z.discriminatedUnion('kind',[
    z.object({kind:z.literal('existing'),vehicleId:uuid}).strict(),
    z.object({kind:z.literal('new'),vin:z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/),registration:optionalText(80),make:z.string().trim().min(1).max(160),model:z.string().trim().min(1).max(160),variant:optionalText(160),powertrain:optionalText(160)}).strict(),
  ]),
  summary:z.string().trim().min(1).max(4000),
  sourceReference:z.string().trim().min(1).max(500),
}).strict();

export const linkDeliveryPreparationSchema=z.object({expectedVersion:z.number().int().positive().max(1_000_000),deliveryId:uuid}).strict();

const recordedAt=z.union([z.date(),z.iso.datetime({offset:true})]).transform(value=>value instanceof Date?value.toISOString():value);
const preparationSchema=z.object({
  id:uuid,vehicleId:uuid,vin:z.string(),make:z.string(),model:z.string(),variant:z.string().nullable(),powertrain:z.string().nullable(),
  summary:z.string(),sourceReference:z.string(),recordedBy:z.string(),recordedAt,version:z.union([z.literal(1),z.literal(2)]),
  linkedDeliveryId:uuid.nullable(),linkedAt:recordedAt.nullable(),
});
const linkSchema=z.object({
  id:uuid,preparationId:uuid,deliveryId:uuid,previousVersion:z.literal(1),version:z.literal(2),linkedBy:z.string(),linkedAt:recordedAt,
});

async function requireSalesRepresentative(client:PoolClient,scope:Scope){
  const found=await client.query(`SELECT 1 FROM public.staff_role_placements p
    JOIN public.staff_role_profiles r ON r.code=p.role_code AND r.active
    JOIN public.staff_users u ON u.id=p.staff_user_id AND u.active
    JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id AND m.active
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3 AND p.role_code='sales-representative' AND p.state='active'`,
  [scope.organisationId,scope.siteId,scope.actorId]);
  if(!found.rowCount) throw new ApiError(403,'ROLE_REQUIRED','A Sales Representative role is required to record delivery preparation.');
}

async function projectPreparation(client:PoolClient,scope:Scope,id:string){
  const found=await client.query(`SELECT p.id,p.vehicle_id AS "vehicleId",v.vin,v.make,v.model,v.variant,v.powertrain,
      p.preparation_summary AS summary,p.source_reference AS "sourceReference",u.display_name AS "recordedBy",p.recorded_at AS "recordedAt",
      CASE WHEN l.id IS NULL THEN 1 ELSE l.version END AS version,l.delivery_id AS "linkedDeliveryId",l.linked_at AS "linkedAt"
    FROM public.delivery_preparations p JOIN public.vehicles v ON v.organisation_id=p.organisation_id AND v.id=p.vehicle_id
    JOIN public.staff_users u ON u.id=p.recorded_by
    LEFT JOIN public.delivery_preparation_delivery_links l ON l.organisation_id=p.organisation_id AND l.site_id=p.site_id AND l.preparation_id=p.id
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.id=$3`,[scope.organisationId,scope.siteId,id]);
  if(!found.rowCount) notFound();
  return preparationSchema.parse(found.rows[0]);
}

export async function createDeliveryPreparation(pool:Database,scope:Scope,commandId:string,input:z.infer<typeof createDeliveryPreparationSchema>){
  const body=createDeliveryPreparationSchema.parse(input),preparationId=randomUUID();
  return runStaffCommand(pool,{
    scope,commandId,operation:'sales.delivery-preparation-recorded',
    targetAggregateId:body.vehicle.kind==='existing'?body.vehicle.vehicleId:commandId,payload:body,responseSchema:preparationSchema,
    lockSerializationRoots:async client=>{
      if(body.vehicle.kind==='new') await lockAdvisoryRoots(client,[`${scope.organisationId}:vehicle-vin:${body.vehicle.vin}`]);
      else await lockAdvisoryRoots(client,[`${scope.organisationId}:vehicle:${body.vehicle.vehicleId}`]);
    },
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      await requireSalesRepresentative(client,scope);
    },
    apply:async client=>{
      let vehicleId:string;
      if(body.vehicle.kind==='existing'){
        const vehicle=await client.query('SELECT id FROM public.vehicles WHERE organisation_id=$1 AND id=$2',[scope.organisationId,body.vehicle.vehicleId]);
        if(!vehicle.rowCount) notFound();
        const visible=await client.query(`SELECT 1 WHERE EXISTS(SELECT 1 FROM public.visits v WHERE v.organisation_id=$1 AND v.site_id=$2 AND v.vehicle_id=$3)
          OR EXISTS(SELECT 1 FROM public.sales_deliveries d WHERE d.organisation_id=$1 AND d.site_id=$2 AND d.vehicle_id=$3)
          OR EXISTS(SELECT 1 FROM public.delivery_preparations p WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.vehicle_id=$3)`,[scope.organisationId,scope.siteId,body.vehicle.vehicleId]);
        if(!visible.rowCount) throw new ApiError(404,'VEHICLE_NOT_FOUND_AT_SITE','Select a vehicle already recorded at this service centre.');
        const delivery=await client.query('SELECT 1 FROM public.sales_deliveries WHERE organisation_id=$1 AND site_id=$2 AND vehicle_id=$3 LIMIT 1',[scope.organisationId,scope.siteId,body.vehicle.vehicleId]);
        if(delivery.rowCount) throw new ApiError(409,'DELIVERY_ALREADY_RECORDED','A delivery already exists for this vehicle at this service centre.');
        vehicleId=body.vehicle.vehicleId;
      }else{
        const duplicate=await client.query('SELECT id FROM public.vehicles WHERE organisation_id=$1 AND vin=$2',[scope.organisationId,body.vehicle.vin]);
        if(duplicate.rowCount) throw new ApiError(409,'VEHICLE_RECORDED','This VIN is already recorded. Search for it and select the matching vehicle.');
        vehicleId=randomUUID();
        await client.query(`INSERT INTO public.vehicles(id,organisation_id,customer_id,vin,registration,make,model,variant,powertrain)
          VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$8)`,[vehicleId,scope.organisationId,body.vehicle.vin,body.vehicle.registration,body.vehicle.make,body.vehicle.model,body.vehicle.variant,body.vehicle.powertrain]);
      }
      await client.query("INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'delivery-preparation')",[preparationId,scope.organisationId,scope.siteId]);
      await client.query(`INSERT INTO public.delivery_preparations(id,organisation_id,site_id,vehicle_id,preparation_summary,source_reference,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[preparationId,scope.organisationId,scope.siteId,vehicleId,body.summary,body.sourceReference,scope.actorId]);
      return {aggregateId:preparationId,aggregateType:'delivery-preparation',version:1,previous:null,next:{vehicleId,sourceReference:body.sourceReference},reason:'Source-attributed delivery preparation recorded.'};
    },
    project:client=>projectPreparation(client,scope,preparationId),
  });
}

export async function linkDeliveryPreparation(pool:Database,scope:Scope,commandId:string,preparationId:string,input:z.infer<typeof linkDeliveryPreparationSchema>){
  const body=linkDeliveryPreparationSchema.parse(input),linkId=randomUUID();
  return runStaffCommand(pool,{
    scope,commandId,operation:'sales.delivery-preparation-linked',targetAggregateId:preparationId,payload:body,responseSchema:linkSchema,
    lockSerializationRoots:async client=>{
      const found=await client.query('SELECT vehicle_id FROM public.delivery_preparations WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,preparationId]);
      if(!found.rowCount) notFound();
      const vehicleId=uuid.parse(found.rows[0].vehicle_id);
      await lockAdvisoryRoots(client,[`${scope.organisationId}:delivery-preparation:${preparationId}`,`${scope.organisationId}:vehicle:${vehicleId}`]);
    },
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      await requireSalesRepresentative(client,scope);
    },
    apply:async client=>{
      const found=await client.query('SELECT vehicle_id FROM public.delivery_preparations WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,preparationId]);
      if(!found.rowCount) notFound();
      const prior=await client.query('SELECT id,version FROM public.delivery_preparation_delivery_links WHERE organisation_id=$1 AND site_id=$2 AND preparation_id=$3 ORDER BY version DESC LIMIT 1',[scope.organisationId,scope.siteId,preparationId]);
      const currentVersion=prior.rowCount?z.number().int().positive().parse(prior.rows[0].version):1;
      if(body.expectedVersion!==currentVersion) throw new ApiError(409,'STALE_DELIVERY_PREPARATION','This preparation changed. Refresh it before linking a delivery.');
      if(prior.rowCount) throw new ApiError(409,'PREPARATION_ALREADY_LINKED','This preparation already has an actual delivery link.');
      const delivery=await client.query('SELECT id FROM public.sales_deliveries WHERE organisation_id=$1 AND site_id=$2 AND vehicle_id=$3 AND id=$4',[scope.organisationId,scope.siteId,found.rows[0].vehicle_id,body.deliveryId]);
      if(!delivery.rowCount) throw new ApiError(409,'DELIVERY_REQUIRED','Record the actual dated delivery before linking this preparation.');
      const deliveryId=uuid.parse(delivery.rows[0].id);
      await client.query(`INSERT INTO public.delivery_preparation_delivery_links(id,organisation_id,site_id,preparation_id,delivery_id,previous_version,version,linked_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[linkId,scope.organisationId,scope.siteId,preparationId,deliveryId,currentVersion,currentVersion+1,scope.actorId]);
      return {aggregateId:preparationId,aggregateType:'delivery-preparation',version:currentVersion+1,previous:{version:currentVersion},next:{version:currentVersion+1,deliveryId},reason:'Actual delivery explicitly linked to preparation.'};
    },
    project:async client=>{
      const result=await client.query(`SELECT l.id,l.preparation_id AS "preparationId",l.delivery_id AS "deliveryId",l.previous_version AS "previousVersion",l.version,u.display_name AS "linkedBy",l.linked_at AS "linkedAt"
        FROM public.delivery_preparation_delivery_links l JOIN public.staff_users u ON u.id=l.linked_by
        WHERE l.organisation_id=$1 AND l.site_id=$2 AND l.id=$3`,[scope.organisationId,scope.siteId,linkId]);
      if(!result.rowCount) notFound();
      return linkSchema.parse(result.rows[0]);
    },
  });
}

export async function listDeliveryPreparations(client:PoolClient,scope:Scope,vehicleId:string){
  const result=await client.query(`SELECT p.id,p.vehicle_id AS "vehicleId",v.vin,v.make,v.model,v.variant,v.powertrain,
      p.preparation_summary AS summary,p.source_reference AS "sourceReference",u.display_name AS "recordedBy",p.recorded_at AS "recordedAt",
      CASE WHEN l.id IS NULL THEN 1 ELSE l.version END AS version,l.delivery_id AS "linkedDeliveryId",l.linked_at AS "linkedAt"
    FROM public.delivery_preparations p JOIN public.vehicles v ON v.organisation_id=p.organisation_id AND v.id=p.vehicle_id
    JOIN public.staff_users u ON u.id=p.recorded_by
    LEFT JOIN public.delivery_preparation_delivery_links l ON l.organisation_id=p.organisation_id AND l.site_id=p.site_id AND l.preparation_id=p.id
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.vehicle_id=$3 ORDER BY p.recorded_at DESC,p.id LIMIT 100`,
  [scope.organisationId,scope.siteId,vehicleId]);
  return z.array(preparationSchema).parse(result.rows);
}
