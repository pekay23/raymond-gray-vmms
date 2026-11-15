import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from './db.js';
import { ApiError } from './errors.js';
import { ownerSessionHash } from './owner-identity.js';

const ownerVehicleSchema = z.object({
  id: z.uuid(),
  registration: z.string(),
  make: z.string(),
  model: z.string(),
}).strict();

export const ownerVehicleListSchema = z.object({
  vehicles: z.array(ownerVehicleSchema),
}).strict();

const ownerVehicleRowSchema = z.object({
  session_valid: z.boolean(),
  vehicle_id: z.uuid().nullable(),
  registration: z.string().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
}).strict();

export async function listCurrentOwnerVehicles(pool: Database, request: FastifyRequest) {
  const sessionHash = ownerSessionHash(request);
  if (!sessionHash) {
    throw new ApiError(401, 'OWNER_SESSION_REQUIRED', 'Sign in to view vehicles linked to your account.');
  }

  const rows = await pool.query(
    'SELECT * FROM public.current_vehicle_owner_vehicles($1,$2)',
    [sessionHash, request.id],
  );
  const records = z.array(ownerVehicleRowSchema).parse(rows.rows);
  if (!records[0]?.session_valid) {
    throw new ApiError(401, 'OWNER_SESSION_REQUIRED', 'Your vehicle access is no longer available. Sign in again or contact your service centre.');
  }

  return ownerVehicleListSchema.parse({
    vehicles: records.flatMap((row) => row.vehicle_id && row.registration && row.make && row.model
      ? [{ id: row.vehicle_id, registration: row.registration, make: row.make, model: row.model }]
      : []),
  });
}
