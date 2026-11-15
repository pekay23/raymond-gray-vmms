import type { PoolClient } from 'pg';
import { z } from 'zod';
import { scoped, uuid, type Database, type Scope } from './db.js';
import { ApiError } from './errors.js';
import { requireActiveReadMembership } from './sensitive-read-audit.js';

const documentListQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  page: z.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
}).strict();

export const controlledDocumentListSchema = z.object({
  documents: z.array(z.object({
    documentId: uuid,
    reference: z.string(),
    alias: z.string().nullable(),
    title: z.string(),
    ownerName: z.string(),
    revision: z.string(),
    effectiveFrom: z.iso.datetime({ offset: true }),
    reviewDueAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict()),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type ControlledDocumentList = z.infer<typeof controlledDocumentListSchema>;

async function requireActiveWorkspaceRole(client: PoolClient, scope: Scope) {
  const found = await client.query(`SELECT EXISTS (
    SELECT 1 FROM public.staff_role_placements p
    JOIN public.staff_role_profiles r ON r.code=p.role_code AND r.active
    JOIN public.staff_users u ON u.id=p.staff_user_id AND u.active
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3 AND p.state='active'
  ) AS allowed`, [scope.organisationId, scope.siteId, scope.actorId]);
  if (!z.object({ allowed: z.boolean() }).parse(found.rows[0]).allowed) {
    throw new ApiError(403, 'WORK_ROLE_REQUIRED', 'An active service-centre role is required to open staff documents.');
  }
}

const eligibleRevisionPredicate = `
  d.organisation_id=$1 AND d.site_id=$2
  AND r.organisation_id=d.organisation_id AND r.site_id=d.site_id AND r.document_id=d.id
  AND r.status='effective' AND r.effective_from<=transaction_timestamp()
  AND (r.effective_until IS NULL OR transaction_timestamp()<r.effective_until)
  AND r.distribution='all-site-staff'
  AND e.id=r.evidence_id AND e.organisation_id=d.organisation_id AND e.site_id=d.site_id
  AND e.upload_intent_id IS NOT NULL AND e.purpose_kind='procedure-reference' AND e.target_id=d.id
  AND e.scan_state='accepted' AND e.accepted_key IS NOT NULL
  AND latest.verdict='clean' AND latest.scanned_sha256=e.sha256
`;

async function recordDocumentReads(
  client: PoolClient,
  scope: Scope,
  requestId: string,
  action: 'catalog-read' | 'file-download',
  rows: Array<{ documentId: string; revisionId: string }>,
) {
  const safeRequestId = uuid.parse(requestId);
  for (const row of rows) {
    await client.query(`INSERT INTO public.controlled_document_read_events
      (organisation_id,site_id,document_id,revision_id,actor_id,action,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [scope.organisationId, scope.siteId, row.documentId, row.revisionId, scope.actorId, action, safeRequestId]);
  }
}

export async function listControlledDocuments(
  pool: Database,
  scope: Scope,
  requestId: string,
  input: z.input<typeof documentListQuerySchema>,
): Promise<ControlledDocumentList> {
  const query = documentListQuerySchema.parse(input);
  return scoped(pool, scope, async (client) => {
    await requireActiveReadMembership(client, scope);
    await requireActiveWorkspaceRole(client, scope);
    const search = query.q.toLocaleLowerCase('en');
    const count = await client.query(`
      SELECT count(*)::int AS total
      FROM public.controlled_documents d
      JOIN public.controlled_document_revisions r ON r.document_id=d.id
      JOIN public.evidence_records e ON e.id=r.evidence_id
      LEFT JOIN LATERAL (
        SELECT a.verdict,a.scanned_sha256 FROM public.evidence_scan_attempts a
        WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
        ORDER BY a.attempt_no DESC LIMIT 1
      ) latest ON true
      WHERE ${eligibleRevisionPredicate}
        AND ($3='' OR position($3 in lower(concat_ws(' ',d.reference,r.alias,r.title,r.document_owner)))>0)
    `, [scope.organisationId, scope.siteId, search]);
    const totalItems = z.object({ total: z.number().int().nonnegative() }).parse(count.rows[0]).total;
    const result = await client.query(`
      SELECT d.id AS "documentId",r.id AS "revisionId",d.reference,r.alias,r.title,
        r.document_owner AS "ownerName",r.revision,
        r.effective_from AS "effectiveFrom",r.review_due_at AS "reviewDueAt"
      FROM public.controlled_documents d
      JOIN public.controlled_document_revisions r ON r.document_id=d.id
      JOIN public.evidence_records e ON e.id=r.evidence_id
      LEFT JOIN LATERAL (
        SELECT a.verdict,a.scanned_sha256 FROM public.evidence_scan_attempts a
        WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
        ORDER BY a.attempt_no DESC LIMIT 1
      ) latest ON true
      WHERE ${eligibleRevisionPredicate}
        AND ($3='' OR position($3 in lower(concat_ws(' ',d.reference,r.alias,r.title,r.document_owner)))>0)
      ORDER BY lower(r.title),d.id
      LIMIT $4 OFFSET $5
    `, [scope.organisationId, scope.siteId, search, query.pageSize, (query.page - 1) * query.pageSize]);
    const documents = z.array(z.object({
      documentId: uuid,
      revisionId: uuid,
      reference: z.string(),
      alias: z.string().nullable(),
      title: z.string(),
      ownerName: z.string(),
      revision: z.string(),
      effectiveFrom: z.union([z.date(), z.iso.datetime({ offset: true })]),
      reviewDueAt: z.union([z.date(), z.iso.datetime({ offset: true })]).nullable(),
    }).strict()).parse(result.rows);
    const timestamps = documents.map((document) => ({
      ...document,
      effectiveFrom: document.effectiveFrom instanceof Date ? document.effectiveFrom.toISOString() : document.effectiveFrom,
      reviewDueAt: document.reviewDueAt instanceof Date ? document.reviewDueAt.toISOString() : document.reviewDueAt,
    }));
    await recordDocumentReads(client, scope, requestId, 'catalog-read', documents);
    return controlledDocumentListSchema.parse({
      documents: timestamps.map(({ revisionId: _revisionId, ...document }) => document),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: totalItems ? Math.ceil(totalItems / query.pageSize) : 0,
      },
    });
  });
}

export async function prepareControlledDocumentDownload(
  pool: Database,
  scope: Scope,
  documentId: string,
  requestId: string,
): Promise<{ displayName: string; mediaType: string; acceptedKey: string }> {
  return scoped(pool, scope, async (client) => {
    await requireActiveReadMembership(client, scope);
    await requireActiveWorkspaceRole(client, scope);
    const safeRequestId = uuid.parse(requestId);
    const found = await client.query(`
      SELECT d.id AS "documentId",r.id AS "revisionId",r.title,e.id AS "evidenceId",
        e.display_name AS "displayName",e.media_type AS "mediaType",e.accepted_key AS "acceptedKey"
      FROM public.controlled_documents d
      JOIN public.controlled_document_revisions r ON r.document_id=d.id
      JOIN public.evidence_records e ON e.id=r.evidence_id
      LEFT JOIN LATERAL (
        SELECT a.verdict,a.scanned_sha256 FROM public.evidence_scan_attempts a
        WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
        ORDER BY a.attempt_no DESC LIMIT 1
      ) latest ON true
      WHERE ${eligibleRevisionPredicate} AND d.id=$3
      LIMIT 1
    `, [scope.organisationId, scope.siteId, uuid.parse(documentId)]);
    if (!found.rowCount) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'The current effective document was not found.');
    const item = z.object({
      documentId: uuid,
      revisionId: uuid,
      title: z.string(),
      evidenceId: uuid,
      displayName: z.string(),
      mediaType: z.string(),
      acceptedKey: z.string().min(1),
    }).parse(found.rows[0]);
    await recordDocumentReads(client, scope, uuid.parse(requestId), 'file-download', [item]);
    await client.query(`INSERT INTO public.evidence_access_events
      (id,organisation_id,site_id,evidence_id,actor_id,action,request_id)
      VALUES(gen_random_uuid(),$1,$2,$3,$4,'download-started',$5)`,
    [scope.organisationId, scope.siteId, item.evidenceId, scope.actorId, safeRequestId]);
    const extension = item.displayName.toLowerCase().endsWith('.pdf') ? '.pdf' : '';
    return { displayName: `${item.title}${extension}`, mediaType: item.mediaType, acceptedKey: item.acceptedKey };
  });
}
