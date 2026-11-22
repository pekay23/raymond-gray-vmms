import { z } from 'zod';
import { scoped, type Database, type Scope, uuid } from './db.js';
import { ApiError } from './errors.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';

const serviceHistoryRoles = [
  'head-service-centre',
  'service-advisor',
  'ev-team-lead',
  'ice-team-lead',
  'supervisor',
  'technician-engineer-trainee',
] as const;

const dateValue = z.union([z.date(), z.iso.datetime({ offset: true })])
  .transform(value => value instanceof Date ? value.toISOString() : value);

export const vehicleServiceHistorySchema = z.object({
  vehicle: z.object({
    id: uuid,
    vin: z.string(),
    registration: z.string().nullable(),
    make: z.string(),
    model: z.string(),
    variant: z.string().nullable(),
    powertrain: z.string().nullable(),
  }).strict().nullable(),
  items: z.array(z.object({
    workOrderId: uuid,
    reference: z.string(),
    openedAt: dateValue,
    odometerKm: z.number().int().nonnegative(),
    complaints: z.array(z.string()),
    workEntries: z.array(z.object({
      id: uuid,
      taskReference: z.string(),
      taskTitle: z.string(),
      kind: z.enum(['finding', 'test', 'action', 'follow-up']),
      result: z.enum(['observed', 'reproduced', 'not-reproduced', 'inconclusive', 'done', 'partial', 'pending', 'blocked']),
      summary: z.string(),
      detail: z.string(),
      actorName: z.string(),
      recordedAt: dateValue,
      supersedesEntryId: uuid.nullable(),
      correctionReason: z.string().nullable(),
    }).strict()),
  }).strict()),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export async function readVehicleServiceHistory(
  pool: Database,
  scope: Scope,
  vinInput: string,
  requestId: string,
  requestedPage = 1,
  requestedPageSize = 10,
) {
  const vin = z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/).parse(vinInput);
  const page = z.number().int().min(1).max(10000).parse(requestedPage);
  const pageSize = z.number().int().min(1).max(50).parse(requestedPageSize);

  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const role = await client.query(`SELECT 1
      FROM public.staff_role_placements placement
      JOIN public.staff_role_profiles profile ON profile.code=placement.role_code AND profile.active
      JOIN public.staff_users actor ON actor.id=placement.staff_user_id AND actor.active
      WHERE placement.organisation_id=$1 AND placement.site_id=$2 AND placement.staff_user_id=$3
        AND placement.role_code=ANY($4::text[]) AND placement.state='active'
      LIMIT 1`, [scope.organisationId, scope.siteId, scope.actorId, serviceHistoryRoles]);
    if (!role.rowCount) {
      throw new ApiError(403, 'SERVICE_HISTORY_ROLE_REQUIRED', 'An active workshop role is required to view service history.');
    }

    const vehicleResult = await client.query(`SELECT vehicle.id,vehicle.vin,vehicle.registration,vehicle.make,
        vehicle.model,vehicle.variant,vehicle.powertrain
      FROM public.vehicles vehicle
      WHERE vehicle.organisation_id=$1 AND vehicle.vin=$2
        AND EXISTS (SELECT 1 FROM public.visits visit
          WHERE visit.organisation_id=vehicle.organisation_id AND visit.site_id=$3 AND visit.vehicle_id=vehicle.id)
      LIMIT 1`, [scope.organisationId, vin, scope.siteId]);
    const vehicle = vehicleResult.rows[0] ?? null;
    if (!vehicle) {
      await recordSensitiveRead(client, scope, 'vehicle-service-history-read-prepared', 0, requestId);
      return vehicleServiceHistorySchema.parse({
        vehicle: null,
        items: [],
        pagination: { page: 1, pageSize, totalItems: 0, totalPages: 0 },
      });
    }

    const count = await client.query<{ total: number }>(`SELECT count(*)::int AS total
      FROM public.visits visit
      JOIN public.work_orders order_record ON order_record.organisation_id=visit.organisation_id
        AND order_record.site_id=visit.site_id AND order_record.visit_id=visit.id
        AND order_record.vehicle_id=visit.vehicle_id
      WHERE visit.organisation_id=$1 AND visit.site_id=$2 AND visit.vehicle_id=$3`,
    [scope.organisationId, scope.siteId, vehicle.id]);
    const totalItems = z.number().int().nonnegative().parse(count.rows[0]?.total ?? 0);
    const totalPages = Math.ceil(totalItems / pageSize);
    const effectivePage = Math.min(page, Math.max(totalPages, 1));
    const orders = await client.query(`SELECT order_record.id AS "workOrderId",order_record.reference,
        order_record.created_at AS "openedAt",order_record.odometer_km AS "odometerKm",
        coalesce(complaints.items,'[]'::jsonb) AS complaints
      FROM public.visits visit
      JOIN public.work_orders order_record ON order_record.organisation_id=visit.organisation_id
        AND order_record.site_id=visit.site_id AND order_record.visit_id=visit.id
        AND order_record.vehicle_id=visit.vehicle_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(complaint.wording ORDER BY complaint.ordinal) AS items
        FROM public.complaints complaint
        WHERE complaint.organisation_id=order_record.organisation_id AND complaint.site_id=order_record.site_id
          AND complaint.work_order_id=order_record.id
      ) complaints ON true
      WHERE visit.organisation_id=$1 AND visit.site_id=$2 AND visit.vehicle_id=$3
      ORDER BY order_record.created_at DESC,order_record.id DESC
      LIMIT $4 OFFSET $5`, [scope.organisationId, scope.siteId, vehicle.id, pageSize, (effectivePage - 1) * pageSize]);
    const workOrderIds = orders.rows.map(row => uuid.parse(row.workOrderId));
    const workEntries = workOrderIds.length ? await client.query(`SELECT entry.id,entry.work_order_id AS "workOrderId",
        'T'||lpad(task.ordinal::text,2,'0') AS "taskReference",task.title AS "taskTitle",entry.entry_kind AS kind,
        entry.result,entry.summary,entry.detail,actor.display_name AS "actorName",entry.recorded_at AS "recordedAt",
        entry.supersedes_entry_id AS "supersedesEntryId",entry.correction_reason AS "correctionReason"
      FROM public.work_order_task_work_entries entry
      JOIN public.tasks task ON task.organisation_id=entry.organisation_id AND task.site_id=entry.site_id
        AND task.work_order_id=entry.work_order_id AND task.id=entry.task_id
      JOIN public.staff_users actor ON actor.id=entry.actor_user_id
      WHERE entry.organisation_id=$1 AND entry.site_id=$2 AND entry.work_order_id=ANY($3::uuid[])
      ORDER BY entry.recorded_at,entry.id`, [scope.organisationId, scope.siteId, workOrderIds]) : { rows: [] };
    const entriesByOrder = new Map<string, unknown[]>();
    for (const row of workEntries.rows) {
      const item = z.object({ workOrderId: uuid }).passthrough().parse(row);
      const list = entriesByOrder.get(item.workOrderId) ?? [];
      list.push(row);
      entriesByOrder.set(item.workOrderId, list);
    }
    const items = orders.rows.map(row => ({
      ...row,
      workEntries: entriesByOrder.get(uuid.parse(row.workOrderId)) ?? [],
    }));
    const result = vehicleServiceHistorySchema.parse({
      vehicle,
      items,
      pagination: { page: effectivePage, pageSize, totalItems, totalPages },
    });
    const entryCount = result.items.reduce((total, item) => total + item.workEntries.length, 0);
    await recordSensitiveRead(client, scope, 'vehicle-service-history-read-prepared', Math.min(result.items.length + entryCount, 100), requestId);
    return result;
  });
}
