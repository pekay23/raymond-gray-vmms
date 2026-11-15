import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { ApiError, notFound } from './errors.js';
import { scoped, type Database, type Scope, uuid } from './db.js';
import { lockAdvisoryRoots, runStaffCommand } from './commands.js';
import { requireActiveReadMembership, recordSensitiveRead } from './sensitive-read-audit.js';
import { listDeliveryPreparations } from './delivery-preparations.js';

const optionalText=(max:number)=>z.string().trim().max(max).transform(value=>value||null).nullable().optional().default(null);
export const recordSalesDeliverySchema=z.object({
  vehicle:z.discriminatedUnion('kind',[
    z.object({kind:z.literal('existing'),vehicleId:uuid}).strict(),
    z.object({kind:z.literal('new'),vin:z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/),registration:optionalText(80),make:z.string().trim().min(1).max(160),model:z.string().trim().min(1).max(160),variant:optionalText(160),powertrain:optionalText(160)}).strict(),
  ]),
  deliveredOn:z.iso.date(),
  registrationAtDelivery:optionalText(80),
  purchaserAtDeliveryClaim:optionalText(240),
  purchaserSource:optionalText(500),
  sourceReference:optionalText(500),
}).strict().superRefine((value,context)=>{
  if(Boolean(value.purchaserAtDeliveryClaim)!==Boolean(value.purchaserSource)) context.addIssue({code:'custom',path:['purchaserSource'],message:'Add the source when recording a purchaser name.'});
});

export const addPdiObservationSchema=z.object({
  area:z.string().trim().min(1).max(160),
  observation:z.string().trim().min(1).max(4000),
  sourceReference:optionalText(500),
  correctsObservationId:uuid.nullable().optional().default(null),
  correctionReason:optionalText(500),
}).strict().superRefine((value,context)=>{
  if(Boolean(value.correctsObservationId)!==Boolean(value.correctionReason)) context.addIssue({code:'custom',path:['correctionReason'],message:'Give a reason when correcting an earlier observation.'});
});

const recordedAt=z.union([z.date(),z.iso.datetime({offset:true})]).transform(value=>value instanceof Date?value.toISOString():value);
const deliverySchema=z.object({id:uuid,vehicleId:uuid,vin:z.string(),registrationAtDelivery:z.string().nullable(),make:z.string(),model:z.string(),variant:z.string().nullable(),powertrain:z.string().nullable(),deliveredOn:z.iso.date(),purchaserAtDeliveryClaim:z.string().nullable(),purchaserSource:z.string().nullable(),sourceReference:z.string().nullable(),recordedBy:z.string(),recordedAt});
const pdiSchema=z.object({id:uuid,deliveryId:uuid,area:z.string(),observation:z.string(),sourceReference:z.string().nullable(),correctsObservationId:uuid.nullable(),correctionReason:z.string().nullable(),recordedBy:z.string(),recordedAt});

async function requireRole(client:PoolClient,scope:Scope,roleCode:string) {
  const found=await client.query(`SELECT 1 FROM public.staff_role_placements p
    JOIN public.staff_role_profiles r ON r.code=p.role_code AND r.active
    JOIN public.staff_users u ON u.id=p.staff_user_id AND u.active
    JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id AND m.active
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3 AND p.role_code=$4 AND p.state='active'`,
  [scope.organisationId,scope.siteId,scope.actorId,roleCode]);
  if(!found.rowCount) throw new ApiError(403,'ROLE_REQUIRED',roleCode==='sales-representative'?'A Sales Representative role is required to record vehicle delivery.':'A PDI Observer role is required to add PDI observations.');
}

async function requireVehicleHistoryRole(client:PoolClient,scope:Scope) {
  const found=await client.query(`SELECT 1 FROM public.staff_role_placements p
    JOIN public.staff_users u ON u.id=p.staff_user_id AND u.active
    JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id AND m.active
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3
      AND p.role_code=ANY($4::text[]) AND p.state='active' LIMIT 1`,
  [scope.organisationId,scope.siteId,scope.actorId,['head-service-centre','sales-representative','pdi-observer']]);
  if(!found.rowCount) throw new ApiError(403,'ROLE_REQUIRED','A Head of Service Centre, Sales Representative or PDI Observer role is required to view sales and PDI history.');
}

async function projectDelivery(client:PoolClient,scope:Scope,id:string) {
  const found=await client.query(`SELECT d.id,d.vehicle_id AS "vehicleId",v.vin,d.registration_at_delivery AS "registrationAtDelivery",v.make,v.model,v.variant,v.powertrain,d.delivered_on::text AS "deliveredOn",d.purchaser_at_delivery_claim AS "purchaserAtDeliveryClaim",d.purchaser_source AS "purchaserSource",d.source_reference AS "sourceReference",u.display_name AS "recordedBy",d.recorded_at AS "recordedAt"
    FROM public.sales_deliveries d JOIN public.vehicles v ON v.organisation_id=d.organisation_id AND v.id=d.vehicle_id
    JOIN public.staff_users u ON u.id=d.recorded_by WHERE d.organisation_id=$1 AND d.site_id=$2 AND d.id=$3`,[scope.organisationId,scope.siteId,id]);
  if(!found.rowCount) notFound();
  return deliverySchema.parse(found.rows[0]);
}

export async function recordSalesDelivery(pool:Database,scope:Scope,commandId:string,input:z.infer<typeof recordSalesDeliverySchema>) {
  const body=recordSalesDeliverySchema.parse(input),deliveryId=randomUUID();
  return runStaffCommand(pool,{
    scope,commandId,operation:'sales.delivery-recorded',targetAggregateId:body.vehicle.kind==='existing'?body.vehicle.vehicleId:commandId,payload:body,responseSchema:deliverySchema,
    lockSerializationRoots:async client=>{
      if(body.vehicle.kind==='new') await lockAdvisoryRoots(client,[`${scope.organisationId}:vehicle-vin:${body.vehicle.vin}`]);
      else await lockAdvisoryRoots(client,[`${scope.organisationId}:vehicle:${body.vehicle.vehicleId}`]);
    },
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      await requireRole(client,scope,'sales-representative');
    },
    apply:async client=>{
      let vehicleId:string;
      if(body.vehicle.kind==='existing') {
        const found=await client.query('SELECT id FROM public.vehicles WHERE organisation_id=$1 AND id=$2',[scope.organisationId,body.vehicle.vehicleId]);
        if(!found.rowCount) notFound();
        const visible=await client.query(`SELECT 1 WHERE EXISTS(SELECT 1 FROM public.visits v WHERE v.organisation_id=$1 AND v.site_id=$2 AND v.vehicle_id=$3)
          OR EXISTS(SELECT 1 FROM public.sales_deliveries d WHERE d.organisation_id=$1 AND d.site_id=$2 AND d.vehicle_id=$3)
          OR EXISTS(SELECT 1 FROM public.delivery_preparations p WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.vehicle_id=$3)`,[scope.organisationId,scope.siteId,body.vehicle.vehicleId]);
        if(!visible.rowCount) throw new ApiError(404,'VEHICLE_NOT_FOUND_AT_SITE','Select a vehicle already recorded at this service centre.');
        vehicleId=body.vehicle.vehicleId;
      } else {
        const duplicate=await client.query('SELECT id FROM public.vehicles WHERE organisation_id=$1 AND vin=$2',[scope.organisationId,body.vehicle.vin]);
        if(duplicate.rowCount) throw new ApiError(409,'VEHICLE_RECORDED','This VIN is already recorded. Search for it and select the matching vehicle.');
        vehicleId=randomUUID();
        await client.query(`INSERT INTO public.vehicles(id,organisation_id,customer_id,vin,registration,make,model,variant,powertrain)
          VALUES($1,$2,NULL,$3,$4,$5,$6,$7,$8)`,[vehicleId,scope.organisationId,body.vehicle.vin,body.vehicle.registration,body.vehicle.make,body.vehicle.model,body.vehicle.variant,body.vehicle.powertrain]);
      }
      const recordedDelivery=await client.query('SELECT id FROM public.sales_deliveries WHERE organisation_id=$1 AND site_id=$2 AND vehicle_id=$3 LIMIT 1',[scope.organisationId,scope.siteId,vehicleId]);
      if(recordedDelivery.rowCount) throw new ApiError(409,'DELIVERY_ALREADY_RECORDED','A delivery is already recorded for this vehicle at this service centre. Select its delivery record to add PDI observations.');
      await client.query("INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'sales-delivery')",[deliveryId,scope.organisationId,scope.siteId]);
      await client.query(`INSERT INTO public.sales_deliveries(id,organisation_id,site_id,vehicle_id,delivered_on,registration_at_delivery,purchaser_at_delivery_claim,purchaser_source,source_reference,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[deliveryId,scope.organisationId,scope.siteId,vehicleId,body.deliveredOn,body.registrationAtDelivery,body.purchaserAtDeliveryClaim,body.purchaserSource,body.sourceReference,scope.actorId]);
      return {aggregateId:deliveryId,aggregateType:'sales-delivery',version:1,previous:{exists:false},next:{vehicleId,deliveryId},reason:'Vehicle delivery recorded.'};
    },
    project:client=>projectDelivery(client,scope,deliveryId),
  });
}

export async function addPdiObservation(pool:Database,scope:Scope,commandId:string,deliveryId:string,input:z.infer<typeof addPdiObservationSchema>) {
  const body=addPdiObservationSchema.parse(input),observationId=randomUUID();
  return runStaffCommand(pool,{
    scope,commandId,operation:'sales.pdi-observation-added',targetAggregateId:deliveryId,payload:body,responseSchema:pdiSchema,
    lockSerializationRoots:async client=>{
      await lockAdvisoryRoots(client,[`${scope.organisationId}:${scope.siteId}:sales-delivery:${deliveryId}`]);
      const delivery=await client.query('SELECT id FROM public.sales_deliveries WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,deliveryId]);
      if(!delivery.rowCount) notFound();
    },
    authorize:async(client,membership)=>{
      if(!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site access does not permit changes.');
      await requireRole(client,scope,'pdi-observer');
      if(body.correctsObservationId){
        const prior=await client.query('SELECT id FROM public.pdi_observations WHERE organisation_id=$1 AND site_id=$2 AND delivery_id=$3 AND id=$4',[scope.organisationId,scope.siteId,deliveryId,body.correctsObservationId]);
        if(!prior.rowCount) throw new ApiError(404,'PDI_OBSERVATION_NOT_FOUND','The earlier PDI note was not found at this service centre.');
      }
    },
    apply:async client=>{
      const current=await client.query('SELECT count(*)::int AS count FROM public.pdi_observations WHERE organisation_id=$1 AND site_id=$2 AND delivery_id=$3',[scope.organisationId,scope.siteId,deliveryId]);
      const version=2+z.object({count:z.number().int().nonnegative()}).parse(current.rows[0]).count;
      await client.query(`INSERT INTO public.pdi_observations(id,organisation_id,site_id,delivery_id,area,observation,source_reference,corrects_observation_id,correction_reason,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[observationId,scope.organisationId,scope.siteId,deliveryId,body.area,body.observation,body.sourceReference,body.correctsObservationId,body.correctionReason,scope.actorId]);
      return {aggregateId:deliveryId,aggregateType:'sales-delivery',version,previous:{observationCount:version-2},next:{observationId,observationCount:version-1},reason:body.correctsObservationId?'PDI observation correction appended.':'PDI observation appended.'};
    },
    project:async client=>{
      const found=await client.query(`SELECT o.id,o.delivery_id AS "deliveryId",o.area,o.observation,o.source_reference AS "sourceReference",o.corrects_observation_id AS "correctsObservationId",o.correction_reason AS "correctionReason",u.display_name AS "recordedBy",o.recorded_at AS "recordedAt"
        FROM public.pdi_observations o JOIN public.staff_users u ON u.id=o.recorded_by WHERE o.organisation_id=$1 AND o.site_id=$2 AND o.id=$3`,[scope.organisationId,scope.siteId,observationId]);
      return pdiSchema.parse(found.rows[0]);
    },
  });
}

export async function readVehicleSalesHistory(pool:Database,scope:Scope,vehicleId:string,requestId:string) {
  return scoped(pool,scope,async client=>{
    await requireActiveReadMembership(client,scope);
    await requireVehicleHistoryRole(client,scope);
    const vehicle=await client.query(`SELECT v.id FROM public.vehicles v WHERE v.organisation_id=$1 AND v.id=$2 AND (
      EXISTS(SELECT 1 FROM public.visits x WHERE x.organisation_id=v.organisation_id AND x.site_id=$3 AND x.vehicle_id=v.id)
      OR EXISTS(SELECT 1 FROM public.sales_deliveries d WHERE d.organisation_id=v.organisation_id AND d.site_id=$3 AND d.vehicle_id=v.id)
      OR EXISTS(SELECT 1 FROM public.delivery_preparations p WHERE p.organisation_id=v.organisation_id AND p.site_id=$3 AND p.vehicle_id=v.id))`,[scope.organisationId,uuid.parse(vehicleId),scope.siteId]);
    if(!vehicle.rowCount) notFound();
    const deliveries=await client.query(`SELECT d.id,d.vehicle_id AS "vehicleId",v.vin,d.registration_at_delivery AS "registrationAtDelivery",v.make,v.model,v.variant,v.powertrain,d.delivered_on::text AS "deliveredOn",d.purchaser_at_delivery_claim AS "purchaserAtDeliveryClaim",d.purchaser_source AS "purchaserSource",d.source_reference AS "sourceReference",u.display_name AS "recordedBy",d.recorded_at AS "recordedAt"
      FROM public.sales_deliveries d JOIN public.vehicles v ON v.organisation_id=d.organisation_id AND v.id=d.vehicle_id JOIN public.staff_users u ON u.id=d.recorded_by
      WHERE d.organisation_id=$1 AND d.site_id=$2 AND d.vehicle_id=$3 ORDER BY d.delivered_on DESC,d.recorded_at DESC LIMIT 100`,[scope.organisationId,scope.siteId,vehicleId]);
    const items=await Promise.all(deliveries.rows.map(async row=>{
      const delivery=deliverySchema.parse(row);
      const notes=await client.query(`SELECT o.id,o.delivery_id AS "deliveryId",o.area,o.observation,o.source_reference AS "sourceReference",o.corrects_observation_id AS "correctsObservationId",o.correction_reason AS "correctionReason",u.display_name AS "recordedBy",o.recorded_at AS "recordedAt"
        FROM public.pdi_observations o JOIN public.staff_users u ON u.id=o.recorded_by WHERE o.organisation_id=$1 AND o.site_id=$2 AND o.delivery_id=$3 ORDER BY o.recorded_at,o.id LIMIT 200`,[scope.organisationId,scope.siteId,delivery.id]);
      return {...delivery,pdiObservations:z.array(pdiSchema).parse(notes.rows)};
    }));
    const preparations=await listDeliveryPreparations(client,scope,vehicleId);
    await recordSensitiveRead(client,scope,'vehicle-sales-history-read-prepared',Math.min(items.length+preparations.length,100),requestId);
    return {items,preparations};
  });
}
