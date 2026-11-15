import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { ApiError, notFound } from './errors.js';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';

const shortText = z.string().trim().min(1).max(160);
const reportDetail = z.string().trim().max(4000).default('');
const dateOnly = z.iso.date();

const sourceReportItemInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('concern'),
    summary: shortText,
    detail: reportDetail,
    existingComplaintId: uuid.nullable(),
  }).strict(),
  z.object({
    kind: z.literal('finding'),
    result: z.enum(['observed', 'inconclusive']),
    summary: shortText,
    detail: reportDetail,
    sourceOccurrenceDate: dateOnly.nullable(),
    relatedConcernOrdinal: z.number().int().positive().nullable(),
  }).strict(),
  z.object({
    kind: z.literal('test'),
    result: z.enum(['reproduced', 'not-reproduced', 'inconclusive']),
    summary: shortText,
    detail: reportDetail,
    sourceOccurrenceDate: dateOnly.nullable(),
    relatedConcernOrdinal: z.number().int().positive().nullable(),
  }).strict(),
  z.object({
    kind: z.literal('action'),
    result: z.enum(['done', 'partial', 'blocked']),
    summary: shortText,
    detail: reportDetail,
    sourceOccurrenceDate: dateOnly.nullable(),
    relatedConcernOrdinal: z.number().int().positive().nullable(),
  }).strict(),
  z.object({
    kind: z.literal('follow-up'),
    result: z.enum(['pending', 'done', 'blocked']),
    summary: shortText,
    detail: reportDetail,
    sourceOccurrenceDate: dateOnly.nullable(),
    relatedConcernOrdinal: z.number().int().positive().nullable(),
  }).strict(),
]);

export const sourceReportInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  sourceKind: z.enum(['client-report', 'workshop-report', 'external-record', 'other']),
  title: shortText,
  sourceDate: dateOnly,
  sourceEvidenceId: uuid.nullable(),
  items: z.array(sourceReportItemInputSchema).min(1).max(50),
  supersedesReportId: uuid.nullable(),
  correctionReason: z.string().trim().min(1).max(1000).nullable(),
}).strict().superRefine((value, context) => {
  const concernCount = value.items.filter(item => item.kind === 'concern').length;
  value.items.forEach((item, index) => {
    if (item.kind !== 'concern' && item.relatedConcernOrdinal !== null && item.relatedConcernOrdinal > concernCount) {
      context.addIssue({ code: 'custom', path: ['items', index, 'relatedConcernOrdinal'], message: 'Choose a concern listed in this source report.' });
    }
  });
  if ((value.supersedesReportId === null) !== (value.correctionReason === null)) {
    context.addIssue({ code: 'custom', path: ['correctionReason'], message: 'Give a reason when correcting an earlier transcription.' });
  }
  const linkedConcerns = value.items.flatMap(item => item.kind === 'concern' && item.existingComplaintId ? [item.existingComplaintId] : []);
  if (new Set(linkedConcerns).size !== linkedConcerns.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Link each existing concern at most once.' });
  }
});

const sourceReportItemSchema = z.object({
  id: uuid,
  ordinal: z.number().int().positive(),
  kind: z.enum(['concern', 'finding', 'test', 'action', 'follow-up']),
  result: z.enum(['reported', 'observed', 'reproduced', 'not-reproduced', 'inconclusive', 'done', 'partial', 'pending', 'blocked']),
  summary: z.string(),
  detail: z.string(),
  sourceOccurrenceDate: dateOnly.nullable(),
  complaintId: uuid.nullable(),
  complaintReference: z.string().nullable(),
}).strict();

const sourceReportRevisionSchema = z.object({
  id: uuid,
  sourceDocumentId: uuid,
  sourceKind: z.enum(['client-report', 'workshop-report', 'external-record', 'other']),
  title: z.string(),
  sourceDate: dateOnly,
  sourceEvidenceId: uuid.nullable(),
  sourceFile: z.object({ displayName: z.string(), mediaType: z.string() }).strict().nullable(),
  revision: z.number().int().positive(),
  recordedBy: z.string(),
  recordedAt: z.union([z.date(), z.iso.datetime({ offset: true })])
    .transform(value => value instanceof Date ? value.toISOString() : value),
  supersedesReportId: uuid.nullable(),
  correctionReason: z.string().nullable(),
  items: z.array(sourceReportItemSchema),
}).strict();

export const sourceReportHistorySchema = z.object({
  workOrderId: uuid,
  workOrderVersion: z.number().int().positive(),
  reports: z.array(sourceReportRevisionSchema),
}).strict();

type SourceReportInput = z.infer<typeof sourceReportInputSchema>;

async function currentSourceRecorder(client: PoolClient, scope: Scope) {
  const result = await client.query(`
    SELECT p.id AS "placementId"
    FROM public.staff_role_placements p
    JOIN public.staff_role_profiles profile ON profile.code=p.role_code
    JOIN public.staff_users u ON u.id=p.staff_user_id
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3
      AND p.state='active' AND profile.active AND u.active
      AND p.role_code IN ('service-advisor','head-service-centre')
    ORDER BY CASE p.role_code WHEN 'service-advisor' THEN 0 ELSE 1 END,p.id
    LIMIT 1`, [scope.organisationId, scope.siteId, scope.actorId]);
  const placementId = result.rows[0]?.placementId;
  if (!placementId) throw new ApiError(403, 'SOURCE_REPORT_ROLE_REQUIRED', 'Only a Service Advisor or Head of Service Centre can record an earlier source report.');
  return uuid.parse(placementId);
}

async function assertSourceReportWindow(client: PoolClient, scope: Scope, workOrderId: string) {
  const facts = await client.query(`SELECT
      EXISTS(SELECT 1 FROM public.work_order_operations_reviews r
        WHERE r.organisation_id=$1 AND r.site_id=$2 AND r.work_order_id=$3) AS reviewed,
      EXISTS(SELECT 1 FROM public.work_order_work_plan_revisions p
        WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.work_order_id=$3) AS planned`,
  [scope.organisationId, scope.siteId, workOrderId]);
  const state = z.object({ reviewed: z.boolean(), planned: z.boolean() }).parse(facts.rows[0]);
  if (state.reviewed || state.planned) {
    throw new ApiError(409, 'SOURCE_REPORT_WINDOW_CLOSED', 'Earlier reports can only be recorded before Operations review and work planning. Use the assigned task work history for later updates.');
  }
}

async function assertAcceptedSourceFile(client: PoolClient, scope: Scope, workOrderId: string, evidenceId: string | null) {
  if (!evidenceId) return;
  const result = await client.query(`SELECT evidence.id
    FROM public.work_order_evidence_links link
    JOIN public.evidence_records evidence ON evidence.organisation_id=link.organisation_id
      AND evidence.site_id=link.site_id AND evidence.id=link.evidence_id
    JOIN LATERAL (
      SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
      WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
        AND attempt.evidence_id=evidence.id
      ORDER BY attempt.attempt_no DESC LIMIT 1
    ) latest ON true
    WHERE link.organisation_id=$1 AND link.site_id=$2 AND link.work_order_id=$3 AND link.evidence_id=$4
      AND evidence.scan_state='accepted' AND evidence.accepted_key IS NOT NULL
      AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256`,
  [scope.organisationId, scope.siteId, workOrderId, evidenceId]);
  if (!result.rowCount) throw new ApiError(409, 'SOURCE_FILE_NOT_AVAILABLE', 'Choose an accepted source file attached to this work order.');
}

async function readSourceReportRows(client: PoolClient, scope: Scope, workOrderId: string) {
  const headers = await client.query(`SELECT report.id,report.source_document_id AS "sourceDocumentId",
      report.source_kind AS "sourceKind",report.title,report.source_date::text AS "sourceDate",
      report.source_file_evidence_id AS "sourceEvidenceId",report.revision,
      recorder.display_name AS "recordedBy",report.recorded_at AS "recordedAt",
      report.supersedes_report_id AS "supersedesReportId",report.correction_reason AS "correctionReason",
      CASE WHEN evidence.id IS NULL OR evidence.scan_state<>'accepted' OR evidence.accepted_key IS NULL
        OR latest.verdict IS DISTINCT FROM 'clean' OR latest.scanned_sha256 IS DISTINCT FROM evidence.sha256 THEN NULL
        ELSE jsonb_build_object('displayName',evidence.display_name,'mediaType',evidence.media_type) END AS "sourceFile"
    FROM public.work_order_source_reports report
    JOIN public.staff_users recorder ON recorder.id=report.recorded_by_user_id
    LEFT JOIN public.evidence_records evidence ON evidence.organisation_id=report.organisation_id
      AND evidence.site_id=report.site_id AND evidence.id=report.source_file_evidence_id
    LEFT JOIN LATERAL (
      SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
      WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
        AND attempt.evidence_id=evidence.id ORDER BY attempt.attempt_no DESC LIMIT 1
    ) latest ON true
    WHERE report.organisation_id=$1 AND report.site_id=$2 AND report.work_order_id=$3
    ORDER BY report.source_document_id,report.revision`,
  [scope.organisationId, scope.siteId, workOrderId]);
  const items = await client.query(`SELECT item.id,item.source_report_id AS "sourceReportId",item.ordinal,
      item.item_kind AS kind,item.result,item.summary,item.detail,
      item.source_occurrence_date::text AS "sourceOccurrenceDate",item.complaint_id AS "complaintId",
      CASE WHEN complaint.id IS NULL THEN NULL ELSE 'C'||lpad(complaint.ordinal::text,2,'0') END AS "complaintReference"
    FROM public.work_order_source_report_items item
    LEFT JOIN public.complaints complaint ON complaint.organisation_id=item.organisation_id
      AND complaint.site_id=item.site_id AND complaint.work_order_id=item.work_order_id AND complaint.id=item.complaint_id
    WHERE item.organisation_id=$1 AND item.site_id=$2 AND item.work_order_id=$3
    ORDER BY item.source_report_id,item.ordinal,item.id`,
  [scope.organisationId, scope.siteId, workOrderId]);
  const itemsByReport = new Map<string, z.infer<typeof sourceReportItemSchema>[]>();
  for (const row of items.rows) {
    const sourceReportId = uuid.parse((row as { sourceReportId: unknown }).sourceReportId);
    const item = sourceReportItemSchema.parse({
      id: row.id,
      ordinal: row.ordinal,
      kind: row.kind,
      result: row.result,
      summary: row.summary,
      detail: row.detail,
      sourceOccurrenceDate: row.sourceOccurrenceDate,
      complaintId: row.complaintId,
      complaintReference: row.complaintReference,
    });
    const current = itemsByReport.get(sourceReportId) ?? [];
    current.push(item);
    itemsByReport.set(sourceReportId, current);
  }
  return headers.rows.map(row => {
    const header = sourceReportRevisionSchema.parse({
      ...row,
      items: itemsByReport.get(uuid.parse(row.id)) ?? [],
    });
    return header;
  });
}

export async function readWorkOrderSourceReports(
  pool: Database,
  scope: Scope,
  workOrderId: string,
  requestId: string,
) {
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const order = await client.query(`SELECT version FROM public.work_orders
      WHERE organisation_id=$1 AND site_id=$2 AND id=$3`, [scope.organisationId, scope.siteId, workOrderId]);
    if (!order.rowCount) notFound();
    const workOrderVersion = z.number().int().positive().parse(order.rows[0]?.version);
    const reports = await readSourceReportRows(client, scope, workOrderId);
    const itemCount = reports.reduce((total, report) => total + report.items.length, 0);
    await recordSensitiveRead(client, scope, 'work-order-source-reports-read-prepared', Math.min(itemCount, 100), requestId);
    return sourceReportHistorySchema.parse({ workOrderId, workOrderVersion, reports });
  });
}

export async function recordWorkOrderSourceReport(
  pool: Database,
  scope: Scope,
  commandId: string,
  workOrderId: string,
  body: SourceReportInput,
) {
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: body.supersedesReportId ? 'work-order.source-report-corrected' : 'work-order.source-report-recorded',
    targetAggregateId: workOrderId,
    payload: { workOrderId, ...body },
    responseSchema: sourceReportHistorySchema,
    lockSerializationRoots: client => lockWorkOrderRoot(client, scope, workOrderId),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit source report entry.');
      await currentSourceRecorder(client, scope);
      await assertSourceReportWindow(client, scope, workOrderId);
      await assertAcceptedSourceFile(client, scope, workOrderId, body.sourceEvidenceId);
    },
    apply: async client => {
      const order = await client.query(`SELECT version FROM public.work_orders
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE`,
      [scope.organisationId, scope.siteId, workOrderId]);
      if (!order.rowCount) notFound();
      const currentVersion = z.number().int().positive().parse(order.rows[0]?.version);
      if (currentVersion !== body.expectedVersion) {
        throw new ApiError(409, 'STALE_VERSION', 'This job changed. Refresh it before recording the source report.', currentVersion);
      }
      await assertSourceReportWindow(client, scope, workOrderId);
      await assertAcceptedSourceFile(client, scope, workOrderId, body.sourceEvidenceId);
      const recorderPlacementId = await currentSourceRecorder(client, scope);

      let sourceDocumentId: string = randomUUID();
      let revision = 1;
      let predecessorConcernIds: string[] = [];
      if (body.supersedesReportId) {
        const predecessor = await client.query(`SELECT report.source_document_id AS "sourceDocumentId",report.revision
          FROM public.work_order_source_reports report
          WHERE report.organisation_id=$1 AND report.site_id=$2 AND report.work_order_id=$3
            AND report.id=$4
            AND NOT EXISTS (SELECT 1 FROM public.work_order_source_reports successor
              WHERE successor.organisation_id=report.organisation_id AND successor.site_id=report.site_id
                AND successor.work_order_id=report.work_order_id AND successor.supersedes_report_id=report.id)`,
        [scope.organisationId, scope.siteId, workOrderId, body.supersedesReportId]);
        if (!predecessor.rowCount) throw new ApiError(409, 'SOURCE_REPORT_REVISION_UNAVAILABLE', 'That report can no longer be corrected. Refresh the job and try again.');
        const prior = z.object({ sourceDocumentId: uuid, revision: z.number().int().positive() }).parse(predecessor.rows[0]);
        sourceDocumentId = prior.sourceDocumentId;
        revision = prior.revision + 1;
        const previousConcerns = await client.query(`SELECT complaint_id AS "complaintId"
          FROM public.work_order_source_report_items
          WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND source_report_id=$4
            AND item_kind='concern' ORDER BY ordinal`,
        [scope.organisationId, scope.siteId, workOrderId, body.supersedesReportId]);
        predecessorConcernIds = previousConcerns.rows.map(row => uuid.parse(row.complaintId));
      }

      const concernIds: string[] = [];
      let concernInputIndex = 0;
      for (const item of body.items) {
        if (item.kind !== 'concern') continue;
        const preservedConcernId = predecessorConcernIds[concernInputIndex];
        concernInputIndex += 1;
        if (item.existingComplaintId) {
          const found = await client.query(`SELECT id FROM public.complaints
            WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3 AND id=$4`,
          [scope.organisationId, scope.siteId, workOrderId, item.existingComplaintId]);
          if (!found.rowCount) notFound();
          concernIds.push(item.existingComplaintId);
        } else if (preservedConcernId) {
          concernIds.push(preservedConcernId);
        } else {
          const complaintId = randomUUID();
          await client.query(`INSERT INTO public.complaints(id,organisation_id,site_id,work_order_id,ordinal,wording)
            SELECT $1,$2,$3,$4,coalesce(max(ordinal),0)+1,$5 FROM public.complaints WHERE work_order_id=$4`,
          [complaintId, scope.organisationId, scope.siteId, workOrderId, item.summary]);
          concernIds.push(complaintId);
        }
      }

      const reportId = randomUUID();
      await client.query(`INSERT INTO public.work_order_source_reports
        (id,organisation_id,site_id,work_order_id,source_document_id,source_kind,title,source_date,
         source_file_evidence_id,revision,recorded_by_user_id,recorded_by_placement_id,supersedes_report_id,correction_reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [reportId, scope.organisationId, scope.siteId, workOrderId, sourceDocumentId, body.sourceKind,
        body.title, body.sourceDate, body.sourceEvidenceId, revision, scope.actorId,
        recorderPlacementId, body.supersedesReportId, body.correctionReason]);

      let concernIndex = 0;
      for (const [index, item] of body.items.entries()) {
        let complaintId: string | null = null;
        let result: string;
        let occurredOn: string | null = null;
        if (item.kind === 'concern') {
          complaintId = concernIds[concernIndex] ?? null;
          concernIndex += 1;
          if (!complaintId) {
            const newComplaintId = randomUUID();
            await client.query(`INSERT INTO public.complaints(id,organisation_id,site_id,work_order_id,ordinal,wording)
              SELECT $1,$2,$3,$4,coalesce(max(ordinal),0)+1,$5 FROM public.complaints WHERE work_order_id=$4`,
            [newComplaintId, scope.organisationId, scope.siteId, workOrderId, item.summary]);
            complaintId = newComplaintId;
          }
          result = 'reported';
        } else {
          complaintId = item.relatedConcernOrdinal === null ? null : concernIds[item.relatedConcernOrdinal - 1] ?? null;
          result = item.result;
          occurredOn = item.sourceOccurrenceDate;
        }
        await client.query(`INSERT INTO public.work_order_source_report_items
          (id,organisation_id,site_id,work_order_id,source_report_id,ordinal,item_kind,result,summary,detail,source_occurrence_date,complaint_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [randomUUID(), scope.organisationId, scope.siteId, workOrderId, reportId, index + 1,
          item.kind, result, item.summary, item.detail || '', occurredOn, complaintId]);
      }

      const nextVersion = currentVersion + 1;
      await client.query('UPDATE public.work_orders SET version=$4 WHERE organisation_id=$1 AND site_id=$2 AND id=$3',
        [scope.organisationId, scope.siteId, workOrderId, nextVersion]);
      return {
        aggregateId: workOrderId,
        aggregateType: 'work-order',
        version: nextVersion,
        previous: { version: currentVersion, supersedesReportId: body.supersedesReportId },
        next: { version: nextVersion, sourceReportId: reportId, sourceDocumentId, revision },
        reason: body.supersedesReportId
          ? 'A source report transcription was corrected before Operations review; the prior version remains preserved.'
          : 'A source report was transcribed before Operations review; the recorded staff member is the transcriber, not the performer.',
      };
    },
    project: async (client) => {
      const version = await client.query(`SELECT version FROM public.work_orders
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3`, [scope.organisationId, scope.siteId, workOrderId]);
      const workOrderVersion = z.number().int().positive().parse(version.rows[0]?.version);
      const reports = await readSourceReportRows(client, scope, workOrderId);
      return sourceReportHistorySchema.parse({ workOrderId, workOrderVersion, reports });
    },
  });
}
