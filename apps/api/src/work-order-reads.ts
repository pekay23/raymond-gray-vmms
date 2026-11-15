import { ApiError, notFound } from './errors.js';
import type { Database, Scope } from './db.js';
import { scoped } from './db.js';
import { detail } from './workshop.js';
import type { WorkOrderDetail } from './schemas.js';

/** Prepare a scoped detail projection and its metadata-only audit event atomically. */
export async function readWorkOrderDetail(pool: Database, scope: Scope, workOrderId: string, requestId: string): Promise<WorkOrderDetail> {
  return scoped(pool, scope, async client => {
    const membership = await client.query<{ can_write: boolean }>('SELECT public.lock_membership($1,$2) AS can_write', [scope.actorId, scope.siteId]);
    if (membership.rows[0]?.can_write == null) throw new ApiError(403, 'SITE_FORBIDDEN', 'You do not have active access to this site.');

    const root = await client.query<{ version: number }>(
      'SELECT version FROM public.work_orders WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR SHARE',
      [scope.organisationId, scope.siteId, workOrderId],
    );
    const version = root.rows[0]?.version;
    if (version === undefined) notFound();

    const projection = await detail(client, workOrderId);
    if (projection.version !== version) throw new Error('Work-order version changed while preparing the detail projection.');
    await client.query(`INSERT INTO public.work_order_read_events
      (id,organisation_id,site_id,work_order_id,actor_id,action,projection_revision,work_order_version,request_id)
      VALUES(gen_random_uuid(),$1,$2,$3,$4,'detail-read-prepared',1,$5,$6)`,
    [scope.organisationId, scope.siteId, workOrderId, scope.actorId, version, requestId]);
    return projection;
  });
}
