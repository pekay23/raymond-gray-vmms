import { z } from 'zod';
import { type Database, type Scope, uuid } from './db.js';
import { ApiError, notFound } from './errors.js';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { detailSchema, intakeFactCommandSchema, type WorkOrderDetail } from './schemas.js';
import { detail } from './workshop.js';

type IntakeFactCommand = z.infer<typeof intakeFactCommandSchema>;

export async function recordIntakeFact(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  input: IntakeFactCommand,
): Promise<WorkOrderDetail> {
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'intake.fact-recorded',
    targetAggregateId: workOrderId,
    payload: input,
    responseSchema: detailSchema,
    lockSerializationRoots: client => lockWorkOrderRoot(client, scope, workOrderId),
    authorize: async (_client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site membership does not permit changes.');
    },
    apply: async (client) => {
      const locked = await client.query(
        'SELECT version FROM work_orders WHERE id=$1 AND organisation_id=$2 AND site_id=$3 FOR UPDATE',
        [workOrderId, scope.organisationId, scope.siteId],
      );
      if (!locked.rowCount) notFound();
      const currentVersion = z.object({ version: z.number().int() }).parse(locked.rows[0]).version;
      if (currentVersion !== input.expectedVersion) {
        throw new ApiError(409, 'STALE_VERSION', 'This work order changed. Refresh it and review the latest information before recording an intake observation.', currentVersion);
      }

      if (input.supersedesFactId) {
        const previous = await client.query(`
          SELECT f.fact->>'kind' AS kind,
            EXISTS(SELECT 1 FROM intake_facts successor WHERE successor.supersedes_fact_id=f.id) AS already_corrected
          FROM intake_facts f
          WHERE f.id=$1 AND f.organisation_id=$2 AND f.site_id=$3 AND f.work_order_id=$4`,
        [input.supersedesFactId, scope.organisationId, scope.siteId, workOrderId]);
        if (!previous.rowCount) notFound();
        const prior = z.object({ kind: z.string(), already_corrected: z.boolean() }).parse(previous.rows[0]);
        if (prior.kind !== input.fact.kind) {
          throw new ApiError(409, 'INTAKE_FACT_SCOPE_MISMATCH', 'A correction must replace an observation of the same kind on this work order.');
        }
        if (prior.already_corrected) throw new ApiError(409, 'INTAKE_FACT_ALREADY_CORRECTED', 'Refresh the work order and correct the latest entry in this observation history.');
      }

      if (input.fact.evidenceIds.length) {
        const evidence = await client.query(`
          SELECT e.id
          FROM evidence_records e
          JOIN work_order_evidence_links l
            ON l.organisation_id=e.organisation_id AND l.site_id=e.site_id
            AND l.work_order_id=$1 AND l.evidence_id=e.id
          JOIN LATERAL (
            SELECT a.verdict,a.scanned_sha256 FROM evidence_scan_attempts a
            WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
            ORDER BY a.attempt_no DESC LIMIT 1
          ) latest ON true
          WHERE e.organisation_id=$2 AND e.site_id=$3 AND e.id=ANY($4::uuid[])
            AND e.purpose_kind='work-order' AND e.target_id=$1
            AND e.scan_state='accepted' AND e.accepted_key IS NOT NULL
            AND latest.verdict='clean' AND latest.scanned_sha256=e.sha256`,
        [workOrderId, scope.organisationId, scope.siteId, input.fact.evidenceIds]);
        if (evidence.rowCount !== input.fact.evidenceIds.length) {
          throw new ApiError(409, 'INTAKE_EVIDENCE_NOT_ACCEPTED', 'Select only clean evidence already attached to this work order.');
        }
      }

      const stored = await client.query(`
        SELECT * FROM public.record_intake_fact($1,$2,$3::jsonb,$4,$5)`, [
        workOrderId,
        input.expectedVersion,
        JSON.stringify(input.fact),
        input.supersedesFactId ?? null,
        input.correctionReason ?? null,
      ]);
      const result = z.object({ fact_id: uuid, new_version: z.number().int() }).parse(stored.rows[0]);
      return {
        aggregateId: workOrderId,
        aggregateType: 'work-order',
        version: result.new_version,
        previous: { version: currentVersion },
        next: {
          version: result.new_version,
          factId: result.fact_id,
          factKind: input.fact.kind,
          supersedesFactId: input.supersedesFactId ?? null,
        },
        reason: 'Intake observation recorded; this does not establish custody, ownership verification, safety clearance, or G1 acceptance.',
      };
    },
    project: (client) => detail(client, workOrderId),
  });
}
