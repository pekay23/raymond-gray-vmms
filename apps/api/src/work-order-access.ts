import { ApiError } from './errors.js';
import { type Database, scoped, type Scope } from './db.js';

const workOrderReadRoles = [
  'head-service-centre',
  'ev-team-lead',
  'ice-team-lead',
  'supervisor',
  'technician-engineer-trainee',
  'service-advisor',
  'quality-inspector',
  'parts-inventory',
  'warranty-customer-support',
] as const;

export async function requireWorkOrderReadAccess(pool: Database, scope: Scope): Promise<void> {
  await scoped(pool, scope, async client => {
    const result = await client.query(`SELECT EXISTS (
      SELECT 1
      FROM public.staff_role_placements placement
      JOIN public.staff_role_profiles profile ON profile.code=placement.role_code AND profile.active
      WHERE placement.organisation_id=$1 AND placement.site_id=$2 AND placement.staff_user_id=$3
        AND placement.state='active' AND placement.role_code=ANY($4::text[])
    ) AS allowed`, [scope.organisationId, scope.siteId, scope.actorId, workOrderReadRoles]);
    if (result.rows[0]?.allowed !== true) {
      throw new ApiError(403, 'WORK_ORDER_ROLE_REQUIRED', 'Your work role does not include access to work orders.');
    }
  });
}
