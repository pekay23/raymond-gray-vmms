import type { PoolClient } from 'pg';
import { ApiError } from './errors.js';
import { uuid, type Scope } from './db.js';

export type SensitiveReadAction =
  | 'work-order-queue-read-prepared'
  | 'vehicle-lookup-read-prepared'
  | 'client-lookup-read-prepared'
  | 'party-lookup-read-prepared'
  | 'workforce-organogram-read-prepared'
  | 'workforce-overview-read-prepared'
  | 'staff-messages-read-prepared'
  | 'staff-account-requests-read-prepared'
  | 'service-request-read-prepared'
  | 'vehicle-sales-history-read-prepared'
  | 'work-order-task-activity-read-prepared'
  | 'work-order-task-work-entries-read-prepared'
  | 'work-order-task-work-evidence-options-read-prepared'
  | 'work-order-service-report-read-prepared'
  | 'work-order-source-reports-read-prepared'
  | 'vehicle-learning-activity-read-prepared'
  | 'vehicle-learning-review-queue-read-prepared'
  | 'vehicle-learning-library-read-prepared'
  | 'finance-configuration-draft-read-prepared'
  | 'work-order-checklists-read-prepared'
  | 'work-order-checklist-outcomes-read-prepared'
  | 'work-order-task-labor-read-prepared';

/** Hold current membership through the read and its committed audit event. */
export async function requireActiveReadMembership(client: PoolClient, scope: Scope): Promise<boolean> {
  const membership = await client.query<{ can_write: boolean | null }>(
    'SELECT public.lock_membership($1,$2) AS can_write',
    [scope.actorId, scope.siteId],
  );
  if (membership.rows[0]?.can_write == null) {
    throw new ApiError(403, 'SITE_FORBIDDEN', 'You do not have active access to this site.');
  }
  return membership.rows[0].can_write;
}

/** Record only bounded metadata for a successfully prepared sensitive projection. */
export async function recordSensitiveRead(
  client: PoolClient,
  scope: Scope,
  action: SensitiveReadAction,
  resultCount: number,
  requestId: string,
): Promise<void> {
  if (!Number.isInteger(resultCount) || resultCount < 0 || resultCount > 100) {
    throw new Error('Sensitive read result count is outside the supported range.');
  }
  await client.query(`INSERT INTO public.sensitive_read_events
    (organisation_id,site_id,actor_id,action,projection_revision,result_count,request_id)
    VALUES($1,$2,$3,$4,1,$5,$6)`,
  [scope.organisationId, scope.siteId, scope.actorId, action, resultCount, uuid.parse(requestId)]);
}
