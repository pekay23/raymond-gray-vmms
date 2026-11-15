import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockAdvisoryRoots, runStaffCommand } from './commands.js';
import { type Database, scoped, type Scope, uuid } from './db.js';
import { ApiError, notFound } from './errors.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';

const secretLikeReference = /(?:[?&](?:token|key|secret|password|access[_-]?token|refresh[_-]?token)=)|(?:\b(?:password|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret)\b\s*[:=])|(?:\bbearer\s+[A-Za-z0-9._~-]{12,})|(?::\/\/[^/\s:@]+:[^/\s@]+@)/i;
const referenceValue = z.string().trim().min(1).max(240).refine(value => !secretLikeReference.test(value), 'Enter a reference only; credentials must stay in the secret store.');
const reference = referenceValue.nullable();
const proposedText = z.string().trim().min(1).max(240).nullable();

/** Collected proposal fields only. These values never configure operational finance. */
export const financeConfigurationDraftContentSchema = z.object({
  schemaVersion: z.literal(1),
  legalEntity: z.object({
    proposedName: proposedText,
    registrationReference: reference,
    businessAddress: z.string().trim().min(1).max(500).nullable(),
    businessContactReference: reference,
  }).strict(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  rateScheduleReference: reference,
  taxTreatmentReference: reference,
  invoiceNumberingRuleReference: reference,
  receiptNumberingRuleReference: reference,
  paymentTermsReference: reference,
  paymentVerificationSourceReference: reference,
  paymentEvidencePolicyReference: reference,
  showroomGuaranteeAuthorityReference: reference,
  invoiceTemplateReference: reference,
  receiptTemplateReference: reference,
  emailSenderConfigurationReference: reference,
  verifiedClientEmailPolicyReference: reference,
  correctionPolicyReference: reference,
  retentionPolicyReference: reference,
  sourceReferences: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    reference: referenceValue,
  }).strict()).max(30),
}).strict();

const draftCommandSchema = z.object({
  draftId: uuid,
  expectedRevision: z.number().int().min(0),
  revisionNote: z.string().trim().min(1).max(500),
  content: financeConfigurationDraftContentSchema,
}).strict();

const grantSchema = z.object({ id: uuid, grantRevision: z.number().int().positive(), capability: z.string() }).strict();
const draftResponseSchema = z.object({
  draftId: uuid,
  revisionId: uuid,
  revision: z.number().int().positive(),
  previousRevision: z.number().int().positive().nullable(),
  revisionNote: z.string(),
  content: financeConfigurationDraftContentSchema,
  state: z.literal('draft-only'),
  operationallyEffective: z.literal(false),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();
const listItemResponseSchema = draftResponseSchema.extend({ isCurrent: z.boolean() });

const listInputSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

const listResponseSchema = z.object({
  items: z.array(listItemResponseSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  canManage: z.boolean(),
}).strict();

type FinanceCapability = 'finance.configuration-draft.read' | 'finance.configuration-draft.manage';

async function lockFinanceCapability(
  client: PoolClient,
  scope: Scope,
  allowed: FinanceCapability[],
): Promise<z.infer<typeof grantSchema>> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [grantLock(scope)]);
  const result = await client.query(`SELECT g.id,g.grant_revision AS "grantRevision",g.capability
    FROM public.staff_authority_grants g
    WHERE g.organisation_id=$1 AND g.site_id=$2 AND g.staff_user_id=$3
      AND g.capability=ANY($4::text[])
      AND g.revoked_at IS NULL AND g.valid_from<=clock_timestamp()
      AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_authority_grants newer
        WHERE newer.organisation_id=g.organisation_id AND newer.site_id=g.site_id
          AND newer.staff_user_id=g.staff_user_id AND newer.capability=g.capability
          AND newer.grant_revision>g.grant_revision
      )
    ORDER BY CASE g.capability WHEN 'finance.configuration-draft.manage' THEN 0 ELSE 1 END,
      g.grant_revision DESC
    LIMIT 1`,
  [scope.organisationId,scope.siteId,scope.actorId,allowed]);
  const grant = result.rows[0];
  if (!grant) throw new ApiError(403,'FINANCE_CONFIGURATION_GRANT_REQUIRED','A current Finance configuration grant is required for this action.');
  return grantSchema.parse(grant);
}

function draftLock(scope: Scope, draftId: string) {
  return `finance-configuration-draft:${scope.organisationId}:${scope.siteId}:${draftId}`;
}

function grantLock(scope: Scope) {
  return `finance-configuration-draft-grant:${scope.organisationId}:${scope.siteId}:${scope.actorId}`;
}

export async function saveFinanceConfigurationDraft(
  pool: Database,
  scope: Scope,
  commandId: string,
  raw: unknown,
) {
  const input = draftCommandSchema.parse(raw);
  const revisionId = randomUUID();
  let authorGrant: z.infer<typeof grantSchema> | null = null;
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'finance.configuration-draft.saved',
    targetAggregateId: input.draftId,
    payload: input,
    responseSchema: draftResponseSchema,
    lockSerializationRoots: client => lockAdvisoryRoots(client, [draftLock(scope,input.draftId),grantLock(scope)]),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403,'READ_ONLY','Your site membership does not permit changes.');
      authorGrant = await lockFinanceCapability(client,scope,['finance.configuration-draft.manage']);
    },
    apply: async client => {
      const current = await client.query(`SELECT revision_number AS revision
        FROM public.finance_configuration_draft_revisions
        WHERE organisation_id=$1 AND site_id=$2 AND draft_id=$3
        ORDER BY revision_number DESC LIMIT 1`,
      [scope.organisationId,scope.siteId,input.draftId]);
      const currentRevision = current.rowCount ? z.object({revision:z.number().int().positive()}).parse(current.rows[0]).revision : 0;
      if (currentRevision !== input.expectedRevision) {
        throw new ApiError(409,'STALE_FINANCE_DRAFT','This Finance draft changed. Reload it before saving another revision.');
      }
      if (currentRevision === 0) {
        await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
          VALUES($1,$2,$3,'finance-configuration-draft')`,
        [input.draftId,scope.organisationId,scope.siteId]);
      } else {
        const root = await client.query(`SELECT id FROM public.aggregate_roots
          WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND aggregate_type='finance-configuration-draft'`,
        [scope.organisationId,scope.siteId,input.draftId]);
        if (!root.rowCount) notFound();
      }
      const revision = currentRevision + 1;
      const grant = grantSchema.parse(authorGrant);
      await client.query(`INSERT INTO public.finance_configuration_draft_revisions
        (id,organisation_id,site_id,draft_id,revision_number,previous_revision_number,content,
          revision_note,author_id,author_grant_id,author_grant_revision,command_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [revisionId,scope.organisationId,scope.siteId,input.draftId,revision,
        currentRevision || null,JSON.stringify(input.content),input.revisionNote,scope.actorId,
        grant.id,grant.grantRevision,commandId]);
      return {
        aggregateId: input.draftId,
        aggregateType: 'finance-configuration-draft',
        version: revision,
        previous: { revision: currentRevision || null },
        next: { revision, state: 'draft-only', operationallyEffective: false },
        reason: input.revisionNote,
      };
    },
    project: async client => {
      const result = await client.query(`SELECT draft_id AS "draftId",id AS "revisionId",
          revision_number AS revision,previous_revision_number AS "previousRevision",
          revision_note AS "revisionNote",content,created_at AS "createdAt"
        FROM public.finance_configuration_draft_revisions
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3`,
      [scope.organisationId,scope.siteId,revisionId]);
      if (!result.rowCount) notFound();
      const row = z.object({
        draftId:uuid,revisionId:uuid,revision:z.number().int().positive(),
        previousRevision:z.number().int().positive().nullable(),revisionNote:z.string(),
        content:financeConfigurationDraftContentSchema,createdAt:z.date(),
      }).strict().parse(result.rows[0]);
      return draftResponseSchema.parse({...row,state:'draft-only',operationallyEffective:false,createdAt:row.createdAt.toISOString()});
    },
  });
}

export async function listFinanceConfigurationDrafts(
  pool: Database,
  scope: Scope,
  requestId: string,
  rawQuery: unknown,
) {
  const query = listInputSchema.parse(rawQuery);
  return scoped(pool,scope,async client => {
    await requireActiveReadMembership(client,scope);
    const accessGrant = await lockFinanceCapability(client,scope,[
      'finance.configuration-draft.read','finance.configuration-draft.manage',
    ]);
    const count = await client.query(`SELECT count(*)::int AS total
      FROM public.finance_configuration_draft_revisions
      WHERE organisation_id=$1 AND site_id=$2`,[scope.organisationId,scope.siteId]);
    const totalItems = z.object({total:z.number().int().nonnegative()}).parse(count.rows[0]).total;
    const found = await client.query(`SELECT draft_revision.draft_id AS "draftId",draft_revision.id AS "revisionId",
        draft_revision.revision_number AS revision,draft_revision.previous_revision_number AS "previousRevision",
        draft_revision.revision_note AS "revisionNote",draft_revision.content,draft_revision.created_at AS "createdAt",
        NOT EXISTS (SELECT 1 FROM public.finance_configuration_draft_revisions newer
          WHERE newer.organisation_id=draft_revision.organisation_id AND newer.site_id=draft_revision.site_id
            AND newer.draft_id=draft_revision.draft_id AND newer.revision_number>draft_revision.revision_number) AS "isCurrent"
      FROM public.finance_configuration_draft_revisions draft_revision
      WHERE draft_revision.organisation_id=$1 AND draft_revision.site_id=$2
      ORDER BY draft_revision.created_at DESC,draft_revision.id DESC LIMIT $3 OFFSET $4`,
    [scope.organisationId,scope.siteId,query.pageSize,(query.page-1)*query.pageSize]);
    const items = z.array(z.object({
      draftId:uuid,revisionId:uuid,revision:z.number().int().positive(),
      previousRevision:z.number().int().positive().nullable(),revisionNote:z.string(),
      content:financeConfigurationDraftContentSchema,createdAt:z.date(),isCurrent:z.boolean(),
    }).strict()).parse(found.rows).map(row => listItemResponseSchema.parse({
      ...row,state:'draft-only',operationallyEffective:false,createdAt:row.createdAt.toISOString(),
    }));
    await recordSensitiveRead(client,scope,'finance-configuration-draft-read-prepared',items.length,requestId);
    return listResponseSchema.parse({items:items.map(item => listItemResponseSchema.parse(item)),page:query.page,pageSize:query.pageSize,
      totalItems,totalPages:Math.ceil(totalItems/query.pageSize),
      canManage:accessGrant.capability==='finance.configuration-draft.manage'});
  });
}
