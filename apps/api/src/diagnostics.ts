import { z } from 'zod';
import { type Database, type Scope, uuid } from './db.js';
import { ApiError, notFound } from './errors.js';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { detailSchema, diagnosticFindingInputSchema, type WorkOrderDetail } from './schemas.js';
import { detail } from './workshop.js';

type DiagnosticFindingInput = z.infer<typeof diagnosticFindingInputSchema>;

export async function recordDiagnosticFinding(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  input: DiagnosticFindingInput,
): Promise<WorkOrderDetail> {
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'diagnostic.finding-recorded',
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
        throw new ApiError(409, 'STALE_VERSION', 'This work order changed. Refresh it and review the latest information before recording a finding.', currentVersion);
      }

      const complaint = await client.query(
        'SELECT id FROM complaints WHERE id=$1 AND work_order_id=$2',
        [input.complaintId, workOrderId],
      );
      if (!complaint.rowCount) notFound();

      if (input.taskId) {
        const task = await client.query(
          'SELECT id FROM tasks WHERE id=$1 AND work_order_id=$2 AND complaint_id=$3',
          [input.taskId, workOrderId, input.complaintId],
        );
        if (!task.rowCount) throw new ApiError(409, 'DIAGNOSTIC_SCOPE_MISMATCH', 'Choose a task under the selected customer concern.');
      }

      if (input.supersedesFindingId) {
        const prior = await client.query(`
          SELECT id FROM diagnostic_findings
          WHERE id=$1 AND work_order_id=$2 AND complaint_id=$3
            AND task_id IS NOT DISTINCT FROM $4`,
        [input.supersedesFindingId, workOrderId, input.complaintId, input.taskId ?? null]);
        if (!prior.rowCount) throw new ApiError(409, 'DIAGNOSTIC_SCOPE_MISMATCH', 'Only a finding in the same concern and task can be superseded.');
      }

      if (input.evidenceIds.length) {
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
        [workOrderId, scope.organisationId, scope.siteId, input.evidenceIds]);
        if (evidence.rowCount !== input.evidenceIds.length) {
          throw new ApiError(409, 'DIAGNOSTIC_EVIDENCE_NOT_ACCEPTED', 'Select only clean evidence already attached to this work order.');
        }
      }

      const inserted = await client.query(`
        SELECT * FROM public.record_diagnostic_finding(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::uuid[]
        )`, [
        workOrderId,
        input.expectedVersion,
        input.complaintId,
        input.taskId ?? null,
        input.supersedesFindingId ?? null,
        input.observedAt,
        input.summary,
        input.certainty.state,
        input.certainty.explanation,
        input.residualRisk,
        input.restrictions ?? null,
        JSON.stringify(input.observations),
        input.evidenceIds,
      ]);
      const result = z.object({ finding_id: uuid, new_version: z.number().int() }).parse(inserted.rows[0]);
      return {
        aggregateId: workOrderId,
        aggregateType: 'work-order',
        version: result.new_version,
        previous: { version: currentVersion },
        next: {
          version: result.new_version,
          findingId: result.finding_id,
          complaintId: input.complaintId,
          taskId: input.taskId ?? null,
          certainty: input.certainty.state,
          supersedesFindingId: input.supersedesFindingId ?? null,
        },
        reason: 'Diagnostic finding recorded; no repair, dispatch, cost, inspection, or release authority granted.',
      };
    },
    project: (client) => detail(client, workOrderId),
  });
}
