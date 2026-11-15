import { z } from 'zod';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { ApiError, notFound } from './errors.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { afterSalesRoleCodes } from './staff-role-policy.js';

const querySchema = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
}).strict();

const checklistSchema = z.object({
  id: uuid,
  kind: z.enum(['pdi','routine-maintenance']),
  state: z.enum(['draft','in-progress','submitted','returned','approved','closed']),
  version: z.number().int().positive(),
  scheduleBasis: z.enum(['verified-history','customer-request','delivery-inspection','unknown']),
  odometerAtStartKm: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();

const templateSchema = z.object({
  id: uuid,
  code: z.string(),
  revision: z.number().int().positive(),
  kind: z.enum(['pdi','routine-maintenance']),
  make: z.string(),
  model: z.string(),
  variant: z.string(),
  powertrain: z.string(),
  effectiveFrom: z.iso.datetime({ offset: true }),
}).strict();

export const workOrderChecklistsSchema = z.object({
  workOrderId: uuid,
  workOrderVersion: z.number().int().positive(),
  vehicle: z.object({
    make: z.string(),
    model: z.string(),
    variant: z.string().nullable(),
    powertrain: z.string().nullable(),
  }).strict(),
  checklists: z.array(checklistSchema),
  availableTemplates: z.array(templateSchema),
  unavailableReason: z.string().nullable(),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export async function readWorkOrderChecklists(
  pool: Database,
  scope: Scope,
  workOrderId: string,
  requestId: string,
  input: z.input<typeof querySchema>,
) {
  const page = querySchema.parse(input);
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    const role = await client.query(`SELECT 1
      FROM public.staff_role_placements placement
      JOIN public.staff_role_profiles profile ON profile.code=placement.role_code AND profile.active
      JOIN public.staff_users actor ON actor.id=placement.staff_user_id AND actor.active
      WHERE placement.organisation_id=$1 AND placement.site_id=$2 AND placement.staff_user_id=$3
        AND placement.state='active' AND placement.role_code=ANY($4::text[]) LIMIT 1`, [scope.organisationId,scope.siteId,scope.actorId,afterSalesRoleCodes]);
    if (!role.rowCount) throw new ApiError(403,'AFTER_SALES_ROLE_REQUIRED','Checklist information is available to active after-sales staff.');

    const order = await client.query(`SELECT w.id,w.version,v.make,v.model,v.variant,v.powertrain
      FROM public.work_orders w
      JOIN public.vehicles v ON v.organisation_id=w.organisation_id AND v.id=w.vehicle_id
      WHERE w.organisation_id=$1 AND w.site_id=$2 AND w.id=$3`,
    [scope.organisationId,scope.siteId,uuid.parse(workOrderId)]);
    if (!order.rowCount) notFound();
    const vehicleRow = z.object({
      id: uuid,
      version: z.number().int().positive(),
      make: z.string(),
      model: z.string(),
      variant: z.string().nullable(),
      powertrain: z.string().nullable(),
    }).parse(order.rows[0]);

    const count = await client.query(`SELECT count(*)::int AS total
      FROM public.work_order_checklists
      WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3`,
    [scope.organisationId,scope.siteId,vehicleRow.id]);
    const totalItems = z.object({ total:z.number().int().nonnegative() }).parse(count.rows[0]).total;
    const checklistRows = await client.query(`SELECT id,kind,state,version,schedule_basis AS "scheduleBasis",
        odometer_at_start_km AS "odometerAtStartKm",created_at AS "createdAt"
      FROM public.work_order_checklists
      WHERE organisation_id=$1 AND site_id=$2 AND work_order_id=$3
      ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
    [scope.organisationId,scope.siteId,vehicleRow.id,page.pageSize,(page.page-1)*page.pageSize]);

    const templateRows = vehicleRow.variant && vehicleRow.powertrain
      ? await client.query(`SELECT template.id,template.template_code AS code,template.revision,template.kind,
          template.vehicle_make AS make,template.vehicle_model AS model,template.vehicle_variant AS variant,
          template.powertrain AS powertrain,decision.effective_from AS "effectiveFrom"
        FROM public.workshop_checklist_template_revisions template
        JOIN LATERAL (
          SELECT d.decision,d.grant_snapshot,d.decided_by,d.effective_from,d.effective_until,d.decided_at
          FROM public.workshop_checklist_template_decisions d
          WHERE d.organisation_id=template.organisation_id AND d.site_id=template.site_id
            AND d.template_revision_id=template.id
          ORDER BY d.decided_at DESC,d.id DESC LIMIT 1
        ) decision ON decision.decision='effective'
          AND decision.effective_from<=clock_timestamp()
          AND (decision.effective_until IS NULL OR decision.effective_until>clock_timestamp())
        WHERE template.organisation_id=$1 AND template.site_id=$2
          AND lower(trim(template.vehicle_make))=lower(trim($3))
          AND lower(trim(template.vehicle_model))=lower(trim($4))
          AND lower(trim(template.vehicle_variant))=lower(trim($5))
          AND lower(trim(template.powertrain))=lower(trim($6))
          AND NOT EXISTS (
            SELECT 1 FROM public.workshop_checklist_template_revisions newer
            JOIN LATERAL (
              SELECT d.decision,d.effective_from,d.effective_until
              FROM public.workshop_checklist_template_decisions d
              WHERE d.organisation_id=newer.organisation_id AND d.site_id=newer.site_id
                AND d.template_revision_id=newer.id
              ORDER BY d.decided_at DESC,d.id DESC LIMIT 1
            ) newer_decision ON newer_decision.decision='effective'
              AND newer_decision.effective_from<=clock_timestamp()
              AND (newer_decision.effective_until IS NULL OR newer_decision.effective_until>clock_timestamp())
            WHERE newer.organisation_id=template.organisation_id AND newer.site_id=template.site_id
              AND newer.template_code=template.template_code AND newer.revision>template.revision
          )
          AND jsonb_typeof(decision.grant_snapshot)='object'
          AND decision.grant_snapshot->>'capability'='work-order.checklist-template.publish'
          AND EXISTS (
            SELECT 1 FROM public.staff_authority_grants grant_record
            WHERE grant_record.organisation_id=template.organisation_id AND grant_record.site_id=template.site_id
              AND grant_record.id::text=decision.grant_snapshot->>'id'
              AND grant_record.staff_user_id=decision.decided_by
              AND grant_record.capability='work-order.checklist-template.publish'
              AND grant_record.grant_revision::text=decision.grant_snapshot->>'grant_revision'
              AND grant_record.revoked_at IS NULL AND grant_record.valid_from<=clock_timestamp()
              AND (grant_record.valid_until IS NULL OR grant_record.valid_until>clock_timestamp())
          )
          AND EXISTS (
            SELECT 1 FROM public.workshop_checklist_template_sources source
            WHERE source.organisation_id=template.organisation_id AND source.site_id=template.site_id
              AND source.template_revision_id=template.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.workshop_checklist_template_sources source
            JOIN public.controlled_document_revisions revision
              ON revision.organisation_id=source.organisation_id AND revision.site_id=source.site_id
              AND revision.id=source.source_revision_id
            JOIN public.controlled_documents document
              ON document.organisation_id=revision.organisation_id AND document.site_id=revision.site_id
              AND document.id=revision.document_id
            LEFT JOIN public.evidence_records evidence
              ON evidence.organisation_id=revision.organisation_id AND evidence.site_id=revision.site_id
              AND evidence.id=revision.evidence_id
            LEFT JOIN LATERAL (
              SELECT attempt.verdict,attempt.scanned_sha256 FROM public.evidence_scan_attempts attempt
              WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
                AND attempt.evidence_id=evidence.id ORDER BY attempt.attempt_no DESC LIMIT 1
            ) latest ON true
            WHERE source.organisation_id=template.organisation_id AND source.site_id=template.site_id
              AND source.template_revision_id=template.id
              AND (revision.status<>'effective' OR revision.effective_from>clock_timestamp()
                OR (revision.effective_until IS NOT NULL AND revision.effective_until<=clock_timestamp())
                OR revision.distribution<>'all-site-staff'
                OR evidence.id IS NULL OR evidence.upload_intent_id IS NULL
                OR evidence.purpose_kind<>'procedure-reference' OR evidence.target_id IS DISTINCT FROM document.id
                OR evidence.scan_state<>'accepted' OR evidence.accepted_key IS NULL
                OR latest.verdict IS DISTINCT FROM 'clean' OR latest.scanned_sha256 IS DISTINCT FROM evidence.sha256)
          )
        ORDER BY template.kind,template.template_code,template.revision DESC LIMIT 100`,
      [scope.organisationId,scope.siteId,vehicleRow.make,vehicleRow.model,vehicleRow.variant,vehicleRow.powertrain])
      : { rows: [] };
    const availableTemplates = z.array(templateSchema).parse(templateRows.rows.map(row => ({
      ...row,
      effectiveFrom: row.effectiveFrom instanceof Date ? row.effectiveFrom.toISOString() : row.effectiveFrom,
    })));
    const checklists = z.array(checklistSchema).parse(checklistRows.rows.map(row => ({
      ...row,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    })));
    await recordSensitiveRead(client,scope,'work-order-checklists-read-prepared',Math.min(checklists.length+availableTemplates.length,100),requestId);
    return workOrderChecklistsSchema.parse({
      workOrderId:vehicleRow.id,
      workOrderVersion:vehicleRow.version,
      vehicle:{make:vehicleRow.make,model:vehicleRow.model,variant:vehicleRow.variant,powertrain:vehicleRow.powertrain},
      checklists,
      availableTemplates,
      unavailableReason:availableTemplates.length ? null : (!vehicleRow.variant || !vehicleRow.powertrain)
        ? 'The vehicle variant or powertrain is not recorded exactly. Confirm the vehicle details before looking for its checklist.'
        : 'No current approved checklist was found for this exact vehicle configuration. Do not use a generic checklist.',
      pagination:{page:page.page,pageSize:page.pageSize,totalItems,totalPages:totalItems?Math.ceil(totalItems/page.pageSize):0},
    });
  });
}
