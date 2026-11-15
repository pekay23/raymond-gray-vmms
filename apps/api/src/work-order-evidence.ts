import { z } from 'zod';
import { type Database, scoped, type Scope, uuid } from './db.js';
import { ApiError, notFound } from './errors.js';
import { createEvidenceIntent, createEvidenceIntentSchema, type EvidenceServices } from './evidence.js';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { detailSchema, type WorkOrderDetail } from './schemas.js';
import { detail } from './workshop.js';

const workOrderEvidenceIntentInputSchema = createEvidenceIntentSchema
  .pick({ displayName: true, declaredMediaType: true, expectedBytes: true })
  .strict();
const attachWorkOrderEvidenceSchema = z.object({
  expectedVersion: z.number().int().positive(),
  evidenceId: uuid,
}).strict();

export async function createWorkOrderEvidenceIntent(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  input: z.infer<typeof workOrderEvidenceIntentInputSchema>,
  services: EvidenceServices,
) {
  await scoped(pool, scope, async (client) => {
    const found = await client.query('SELECT id FROM work_orders WHERE id=$1', [workOrderId]);
    if (!found.rowCount) notFound();
  });
  return createEvidenceIntent(
    pool,
    scope,
    commandId,
    { ...input, purpose: 'work-order', targetId: workOrderId },
    services,
  );
}

export async function attachWorkOrderEvidence(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  body: z.infer<typeof attachWorkOrderEvidenceSchema>,
): Promise<WorkOrderDetail> {
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'work-order.evidence-attached',
    targetAggregateId: workOrderId,
    payload: body,
    responseSchema: detailSchema,
    lockSerializationRoots: client => lockWorkOrderRoot(client, scope, workOrderId),
    authorize: async (_client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site membership does not permit changes.');
    },
    apply: async (client) => {
      const found = await client.query('SELECT version FROM work_orders WHERE id=$1 FOR UPDATE', [workOrderId]);
      if (!found.rowCount) notFound();
      const currentVersion = z.object({ version: z.number().int() }).parse(found.rows[0]).version;
      if (currentVersion !== body.expectedVersion) {
        throw new ApiError(409, 'STALE_VERSION', 'This work order changed. Refresh it and review the latest information before attaching evidence.', currentVersion);
      }

      const evidenceResult = await client.query(`
        SELECT e.purpose_kind AS purpose,e.target_id AS "targetId",e.scan_state AS state,e.sha256,e.accepted_key AS "acceptedKey",
               latest.verdict,latest.scanned_sha256 AS "scannedSha256"
        FROM evidence_records e
        LEFT JOIN LATERAL (
          SELECT a.verdict,a.scanned_sha256 FROM evidence_scan_attempts a
          WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
          ORDER BY a.attempt_no DESC LIMIT 1
        ) latest ON true
        WHERE e.id=$1 AND e.organisation_id=$2 AND e.site_id=$3 AND e.upload_intent_id IS NOT NULL`,
      [body.evidenceId, scope.organisationId, scope.siteId]);
      if (!evidenceResult.rowCount) notFound();
      const evidence = z.object({
        purpose: z.string(), targetId: uuid.nullable(), state: z.enum(['pending', 'quarantined', 'accepted', 'rejected']),
        sha256: z.string().regex(/^[0-9a-f]{64}$/), acceptedKey: z.string().nullable(),
        verdict: z.string().nullable(), scannedSha256: z.string().nullable(),
      }).parse(evidenceResult.rows[0]);
      if (evidence.purpose !== 'work-order' || evidence.targetId !== workOrderId) {
        throw new ApiError(409, 'EVIDENCE_TARGET_MISMATCH', 'This file was not uploaded for this work order.');
      }
      if (evidence.state !== 'accepted' || !evidence.acceptedKey || evidence.verdict !== 'clean' || evidence.scannedSha256 !== evidence.sha256) {
        throw new ApiError(409, 'EVIDENCE_NOT_ACCEPTED', 'This file is not ready to attach. Wait for the security check to finish or choose another file.');
      }
      const priorLink = await client.query(
        'SELECT id FROM work_order_evidence_links WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND evidence_id=$4',
        [scope.organisationId, scope.siteId, workOrderId, body.evidenceId],
      );
      if (priorLink.rowCount) throw new ApiError(409, 'EVIDENCE_ALREADY_ATTACHED', 'This file is already attached to the work order.');

      const version = currentVersion;
      await client.query('UPDATE work_orders SET version=version+1 WHERE id=$1', [workOrderId]);
      const linked = await client.query('SELECT public.attach_work_order_evidence($1,$2) AS id', [workOrderId, body.evidenceId]);
      const relationId = uuid.parse(linked.rows[0]?.id);
      return {
        aggregateId: workOrderId,
        aggregateType: 'work-order',
        version: version + 1,
        previous: { version },
        next: { version: version + 1, evidenceId: body.evidenceId, relationId },
        reason: 'Accepted evidence attached to the work order.',
      };
    },
    project: (client) => detail(client, workOrderId),
  });
}

export { attachWorkOrderEvidenceSchema, workOrderEvidenceIntentInputSchema };
