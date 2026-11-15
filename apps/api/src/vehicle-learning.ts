import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockAdvisoryRoots, runStaffCommand } from './commands.js';
import { type Database, scoped, type Scope, uuid } from './db.js';
import { ApiError, notFound } from './errors.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';
import { afterSalesRoleCodes } from './staff-role-policy.js';
import {
  assessmentFromLegacy,
  projectAssessment,
  vehicleLearningAssessmentSchema,
} from './vehicle-learning-assessment.js';

export const learningEntryInputSchema = z.object({
  id: uuid.nullable().default(null),
  expectedVersion: z.number().int().positive().nullable().default(null),
  title: z.string().trim().min(1).max(160),
  makeModel: z.string().trim().min(1).max(180),
  assessment: vehicleLearningAssessmentSchema,
  status: z.enum(['draft', 'submitted']),
}).strict();

const entryRowSchema = z.object({
  id: uuid,
  title: z.string(),
  makeModel: z.string(),
  powertrain: z.string(),
  drivetrain: z.string(),
  systems: z.array(z.string()),
  evidence: z.string(),
  questions: z.string(),
  assessment: vehicleLearningAssessmentSchema.nullable(),
  status: z.enum(['draft', 'submitted']),
  reviewDecision: z.enum(['changes-requested', 'reviewed-learning-record']).nullable(),
  version: z.number().int().positive(),
  updatedAt: z.date(),
}).strict();

const entryResponseSchema = z.object({
  id: uuid,
  title: z.string(),
  makeModel: z.string(),
  powertrain: z.string(),
  drivetrain: z.string(),
  systems: z.array(z.string()),
  evidence: z.string(),
  questions: z.string(),
  assessment: vehicleLearningAssessmentSchema,
  status: z.enum(['draft', 'submitted']),
  reviewDecision: z.enum(['changes-requested', 'reviewed-learning-record']).nullable(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

function entryFromRow(value: unknown) {
  const row = entryRowSchema.parse(value);
  const assessment = row.assessment ?? assessmentFromLegacy(row);
  return entryResponseSchema.parse({ ...row, ...projectAssessment(assessment), assessment, updatedAt: row.updatedAt.toISOString() });
}

const revisionRowSchema = z.object({
  entryId: uuid,
  revisionNumber: z.number().int().positive(),
  title: z.string(),
  makeModel: z.string(),
  powertrain: z.string(),
  drivetrain: z.string(),
  systems: z.array(z.string()),
  evidence: z.string(),
  questions: z.string(),
  assessment: vehicleLearningAssessmentSchema.nullable(),
  status: z.enum(['draft', 'submitted']),
  savedAt: z.date(),
}).strict();

const commentInputSchema = z.object({
  revisionNumber: z.number().int().positive(),
  body: z.string().trim().min(1).max(3000),
}).strict();

const commentRowSchema = z.object({
  id: uuid,
  entryId: uuid,
  revisionNumber: z.number().int().positive(),
  commenterId: uuid,
  commenterName: z.string(),
  body: z.string(),
  createdAt: z.date(),
}).strict();

const commentResponseSchema = z.object({
  id: uuid,
  entryId: uuid,
  revisionNumber: z.number().int().positive(),
  commenterId: uuid,
  commenterName: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();

function commentFromRow(value: unknown) {
  const comment = commentRowSchema.parse(value);
  return commentResponseSchema.parse({ ...comment, createdAt: comment.createdAt.toISOString() });
}

const revisionResponseSchema = z.object({
  entryId: uuid,
  revisionNumber: z.number().int().positive(),
  title: z.string(),
  makeModel: z.string(),
  powertrain: z.string(),
  drivetrain: z.string(),
  systems: z.array(z.string()),
  evidence: z.string(),
  questions: z.string(),
  assessment: vehicleLearningAssessmentSchema,
  status: z.enum(['draft', 'submitted']),
  savedAt: z.iso.datetime({ offset: true }),
}).strict();

const learningActivitySchema = z.object({
  entryId: uuid,
  revisions: z.array(revisionResponseSchema),
  comments: z.array(commentResponseSchema),
  reviews: z.array(z.object({
    id: uuid,
    entryId: uuid,
    revisionNumber: z.number().int().positive(),
    reviewerId: uuid,
    reviewerName: z.string(),
    decision: z.enum(['changes-requested', 'reviewed-learning-record']),
    reason: z.string(),
    shareWithAfterSales: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
  }).strict()),
}).strict();

const learningReviewGrantSchema = z.object({ id: uuid, grantRevision: z.number().int().positive() }).strict();
const learningReviewDecisionInputSchema = z.object({
  expectedVersion: z.number().int().positive(),
  decision: z.enum(['changes-requested', 'reviewed-learning-record']),
  reason: z.string().trim().min(1).max(3000),
  shareWithAfterSales: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.decision === 'changes-requested' && value.shareWithAfterSales) {
    context.addIssue({ code: 'custom', path: ['shareWithAfterSales'], message: 'Only a reviewed learning note can be shared.' });
  }
});
const learningReviewRowSchema = z.object({
  id: uuid,
  entryId: uuid,
  revisionNumber: z.number().int().positive(),
  reviewerId: uuid,
  reviewerName: z.string(),
  decision: z.enum(['changes-requested', 'reviewed-learning-record']),
  reason: z.string(),
  shareWithAfterSales: z.boolean(),
  createdAt: z.date(),
}).strict();
const learningReviewResponseSchema = learningReviewRowSchema.extend({ createdAt: z.iso.datetime({ offset: true }) });
const learningReviewQueueItemSchema = z.object({
  id: uuid,
  title: z.string(),
  makeModel: z.string(),
  powertrain: z.string(),
  drivetrain: z.string(),
  authorName: z.string(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();
const learningReviewQueueSchema = z.object({ items: z.array(learningReviewQueueItemSchema) }).strict();
const learningLibraryQuerySchema = z.object({
  q: z.string().trim().max(120).default(''),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
const learningLibraryRowSchema = z.object({
  entryId: uuid,
  title: z.string(),
  makeModel: z.string(),
  powertrain: z.string(),
  drivetrain: z.string(),
  systems: z.array(z.string()),
  evidence: z.string(),
  questions: z.string(),
  assessment: vehicleLearningAssessmentSchema.nullable(),
  revisionNumber: z.number().int().positive(),
  reviewedAt: z.date(),
}).strict();
const learningLibrarySourceSchema = z.object({
  title: z.string(),
  makeModel: z.string(),
  powertrain: z.string(),
  drivetrain: z.string(),
  systems: z.array(z.string()),
  evidence: z.string(),
  questions: z.string(),
  assessment: vehicleLearningAssessmentSchema.nullable(),
}).strict();
const learningLibraryItemSchema = z.object({
  entryId: uuid,
  title: z.string(),
  makeModel: z.string(),
  assessment: vehicleLearningAssessmentSchema,
  revisionNumber: z.number().int().positive(),
  reviewedAt: z.iso.datetime({ offset: true }),
}).strict();
const learningLibraryResponseSchema = z.object({
  items: z.array(learningLibraryItemSchema),
  q: z.string(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  canManageSharing: z.boolean(),
}).strict();
const learningLibraryRevocationInputSchema = z.object({
  revisionNumber: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
const learningLibraryRevocationResponseSchema = z.object({
  id: uuid,
  entryId: uuid,
  revisionNumber: z.number().int().positive(),
  revokedAt: z.iso.datetime({ offset: true }),
}).strict();

async function requireAfterSalesRole(client: PoolClient, scope: Scope, lock = false) {
  const result = await client.query(`SELECT p.id FROM public.staff_role_placements p
    JOIN public.staff_role_profiles r ON r.code=p.role_code AND r.active
    JOIN public.staff_users u ON u.id=p.staff_user_id AND u.active
    JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id AND m.active
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3
      AND p.state='active' AND p.role_code=ANY($4::text[])
    ${lock ? 'FOR SHARE OF p' : ''}`,
  [scope.organisationId, scope.siteId, scope.actorId, afterSalesRoleCodes]);
  if (!result.rowCount) {
    throw new ApiError(403, 'AFTER_SALES_ROLE_REQUIRED', 'Vehicle learning is available to active after-sales staff only.');
  }
}

async function requireVehicleLearningReviewGrant(client: PoolClient, scope: Scope) {
  const result = await client.query(`SELECT g.id,g.grant_revision AS "grantRevision"
    FROM public.staff_authority_grants g
    WHERE g.organisation_id=$1 AND g.site_id=$2 AND g.staff_user_id=$3
      AND g.capability='vehicle-learning.review'
      AND g.revoked_at IS NULL AND g.valid_from<=clock_timestamp()
      AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_authority_grants newer
        WHERE newer.organisation_id=g.organisation_id AND newer.site_id=g.site_id
          AND newer.staff_user_id=g.staff_user_id AND newer.capability=g.capability
          AND newer.grant_revision>g.grant_revision
      )
    ORDER BY g.grant_revision DESC LIMIT 1`,
  [scope.organisationId, scope.siteId, scope.actorId]);
  const grant = result.rows[0];
  if (!grant) throw new ApiError(403, 'LEARNING_REVIEW_REQUIRED', 'You do not have permission to review learning notes at this site.');
  return learningReviewGrantSchema.parse(grant);
}

function learningRootLock(scope: Scope, entryId: string) {
  return `vehicle-learning:${scope.organisationId}:${scope.siteId}:${entryId}`;
}

function learningReviewGrantLock(scope: Scope) {
  return `vehicle-learning-review-grant:${scope.organisationId}:${scope.siteId}:${scope.actorId}`;
}

export async function listVehicleLearning(pool: Database, scope: Scope) {
  return scoped(pool, scope, async client => {
    await requireAfterSalesRole(client, scope);
    const result = await client.query(`SELECT e.id,e.title,e.make_model AS "makeModel",e.powertrain,e.drivetrain,
        e.systems,e.evidence,e.questions,e.assessment,e.status,e.version,
        (SELECT r.decision FROM public.vehicle_learning_reviews r
          WHERE r.organisation_id=e.organisation_id AND r.site_id=e.site_id
            AND r.entry_id=e.id AND r.revision_number=e.version) AS "reviewDecision",
        e.updated_at AS "updatedAt"
      FROM public.vehicle_learning_entries e
      WHERE e.organisation_id=$1 AND e.site_id=$2 AND e.author_id=$3
      ORDER BY e.updated_at DESC,e.id LIMIT 100`,
    [scope.organisationId, scope.siteId, scope.actorId]);
    return { items: result.rows.map(entryFromRow) };
  });
}

export async function listVehicleLearningLibrary(
  pool: Database,
  scope: Scope,
  requestId: string,
  rawQuery: unknown,
) {
  const input = learningLibraryQuerySchema.parse(rawQuery);
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    await requireAfterSalesRole(client, scope);
    const filter = input.q.toLowerCase();
    const count = await client.query(`SELECT count(*)::int AS total
      FROM public.vehicle_learning_library_entries
      WHERE organisation_id=$1 AND site_id=$2
        AND NOT EXISTS (SELECT 1 FROM public.vehicle_learning_library_revocations x
          WHERE x.organisation_id=vehicle_learning_library_entries.organisation_id
            AND x.site_id=vehicle_learning_library_entries.site_id
            AND x.entry_id=vehicle_learning_library_entries.entry_id
            AND x.revision_number=vehicle_learning_library_entries.revision_number)
        AND ($3='' OR position($3 in lower(title))>0 OR position($3 in lower(make_model))>0)`,
    [scope.organisationId, scope.siteId, filter]);
    const total = z.number().int().nonnegative().parse(count.rows[0]?.total ?? 0);
    const totalPages = Math.ceil(total / input.pageSize);
    const page = totalPages === 0 ? 1 : Math.min(input.page, totalPages);
    const result = await client.query(`SELECT entry_id AS "entryId",title,make_model AS "makeModel",
        powertrain,drivetrain,systems,evidence,questions,assessment,
        revision_number AS "revisionNumber",reviewed_at AS "reviewedAt"
      FROM public.vehicle_learning_library_entries
      WHERE organisation_id=$1 AND site_id=$2
        AND NOT EXISTS (SELECT 1 FROM public.vehicle_learning_library_revocations x
          WHERE x.organisation_id=vehicle_learning_library_entries.organisation_id
            AND x.site_id=vehicle_learning_library_entries.site_id
            AND x.entry_id=vehicle_learning_library_entries.entry_id
            AND x.revision_number=vehicle_learning_library_entries.revision_number)
        AND ($3='' OR position($3 in lower(title))>0 OR position($3 in lower(make_model))>0)
      ORDER BY lower(make_model),lower(title),entry_id,revision_number
      LIMIT $4 OFFSET $5`,
    [scope.organisationId, scope.siteId, filter, input.pageSize, (page - 1) * input.pageSize]);
    const items = result.rows.map(value => {
      const row = learningLibraryRowSchema.parse(value);
      const assessment = row.assessment ?? assessmentFromLegacy(row);
      return learningLibraryItemSchema.parse({
        entryId: row.entryId,
        title: row.title,
        makeModel: row.makeModel,
        assessment,
        revisionNumber: row.revisionNumber,
        reviewedAt: row.reviewedAt.toISOString(),
      });
    });
    await recordSensitiveRead(client, scope, 'vehicle-learning-library-read-prepared', items.length, requestId);
    let canManageSharing = false;
    try {
      await requireVehicleLearningReviewGrant(client, scope);
      canManageSharing = true;
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'LEARNING_REVIEW_REQUIRED')) throw error;
    }
    return learningLibraryResponseSchema.parse({ items, q: input.q, page, pageSize: input.pageSize, total, totalPages, canManageSharing });
  });
}

export async function revokeVehicleLearningShare(
  pool: Database,
  scope: Scope,
  commandId: string,
  entryId: string,
  raw: unknown,
) {
  const input = learningLibraryRevocationInputSchema.parse(raw);
  const revocationId = deterministicId(`${scope.organisationId}:${scope.siteId}:${scope.actorId}:${commandId}`);
  let revokerGrant: z.infer<typeof learningReviewGrantSchema> | null = null;
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'vehicle-learning.library-share-revoked',
    targetAggregateId: revocationId,
    payload: { entryId, ...input },
    responseSchema: learningLibraryRevocationResponseSchema,
    lockSerializationRoots: client => lockAdvisoryRoots(client, [learningRootLock(scope, entryId), learningReviewGrantLock(scope)]),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site membership does not permit changes.');
      await requireAfterSalesRole(client, scope, true);
      revokerGrant = await requireVehicleLearningReviewGrant(client, scope);
    },
    apply: async client => {
      const libraryEntry = await client.query(`SELECT entry_id AS "entryId",revision_number AS "revisionNumber"
        FROM public.vehicle_learning_library_entries
        WHERE organisation_id=$1 AND site_id=$2 AND entry_id=$3 AND revision_number=$4`,
      [scope.organisationId,scope.siteId,entryId,input.revisionNumber]);
      if (!libraryEntry.rowCount) notFound();
      const prior = await client.query(`SELECT 1 FROM public.vehicle_learning_library_revocations
        WHERE organisation_id=$1 AND site_id=$2 AND entry_id=$3 AND revision_number=$4`,
      [scope.organisationId,scope.siteId,entryId,input.revisionNumber]);
      if (prior.rowCount) throw new ApiError(409, 'LEARNING_SHARE_ALREADY_REVOKED', 'This shared note has already been removed from the library.');
      const grant = learningReviewGrantSchema.parse(revokerGrant);
      await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
        VALUES($1,$2,$3,'vehicle-learning-library-revocation')`, [revocationId,scope.organisationId,scope.siteId]);
      await client.query(`INSERT INTO public.vehicle_learning_library_revocations
        (id,organisation_id,site_id,entry_id,revision_number,revoker_id,revoker_grant_id,revoker_grant_revision,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [revocationId,scope.organisationId,scope.siteId,entryId,input.revisionNumber,scope.actorId,grant.id,grant.grantRevision,input.reason]);
      return {
        aggregateId: revocationId,
        aggregateType: 'vehicle-learning-library-revocation',
        version: 1,
        previous: { exists: false },
        next: { entryId, revisionNumber: input.revisionNumber, shared: false },
        reason: input.reason,
      };
    },
    project: async client => {
      const result = await client.query(`SELECT id,entry_id AS "entryId",revision_number AS "revisionNumber",revoked_at AS "revokedAt"
        FROM public.vehicle_learning_library_revocations
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3`, [scope.organisationId,scope.siteId,revocationId]);
      if (!result.rowCount) notFound();
      const row = z.object({ id: uuid, entryId: uuid, revisionNumber: z.number().int().positive(), revokedAt: z.date() }).strict().parse(result.rows[0]);
      return learningLibraryRevocationResponseSchema.parse({ ...row, revokedAt: row.revokedAt.toISOString() });
    },
  });
}

export async function readVehicleLearningActivity(
  pool: Database,
  scope: Scope,
  requestId: string,
  entryId: string,
) {
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    await requireAfterSalesRole(client, scope);
    const entry = await client.query(`SELECT id,author_id AS "authorId",status FROM public.vehicle_learning_entries
      WHERE organisation_id=$1 AND site_id=$2 AND id=$3`,
    [scope.organisationId, scope.siteId, entryId]);
    if (!entry.rowCount) notFound();
    const entryOwner = z.object({ authorId: uuid, status: z.enum(['draft', 'submitted']) }).parse(entry.rows[0]);
    if (entryOwner.authorId !== scope.actorId) {
      await requireVehicleLearningReviewGrant(client, scope);
      if (entryOwner.status !== 'submitted') notFound();
    }

    const revisions = await client.query(`SELECT entry_id AS "entryId",revision_number AS "revisionNumber",title,
        make_model AS "makeModel",powertrain,drivetrain,systems,evidence,questions,assessment,status,saved_at AS "savedAt"
      FROM public.vehicle_learning_entry_revisions
      WHERE organisation_id=$1 AND site_id=$2 AND entry_id=$3 AND author_id=$4
      ORDER BY revision_number`,
      [scope.organisationId, scope.siteId, entryId, entryOwner.authorId]);
    const comments = await client.query(`SELECT c.id,c.entry_id AS "entryId",c.revision_number AS "revisionNumber",
        c.commenter_id AS "commenterId",u.display_name AS "commenterName",c.body,c.created_at AS "createdAt"
      FROM public.vehicle_learning_comments c
      JOIN public.staff_users u ON u.id=c.commenter_id
      WHERE c.organisation_id=$1 AND c.site_id=$2 AND c.entry_id=$3 AND c.entry_author_id=$4
      ORDER BY c.created_at,c.id`,
      [scope.organisationId, scope.siteId, entryId, entryOwner.authorId]);
    const reviewRows = await client.query(`SELECT r.id,r.entry_id AS "entryId",r.revision_number AS "revisionNumber",
        r.reviewer_id AS "reviewerId",u.display_name AS "reviewerName",r.decision,r.reason,
        r.share_with_after_sales AS "shareWithAfterSales",r.created_at AS "createdAt"
      FROM public.vehicle_learning_reviews r JOIN public.staff_users u ON u.id=r.reviewer_id
      WHERE r.organisation_id=$1 AND r.site_id=$2 AND r.entry_id=$3 AND r.author_id=$4
      ORDER BY r.revision_number,r.created_at,r.id`,
    [scope.organisationId, scope.siteId, entryId, entryOwner.authorId]);
    const activity = learningActivitySchema.parse({
      entryId,
      revisions: revisions.rows.map(row => {
        const revision = revisionRowSchema.parse(row);
        const assessment = revision.assessment ?? assessmentFromLegacy(revision);
        return revisionResponseSchema.parse({ ...revision, ...projectAssessment(assessment), assessment, savedAt: revision.savedAt.toISOString() });
      }),
      comments: comments.rows.map(commentFromRow),
      reviews: reviewRows.rows.map(row => {
        const review = learningReviewRowSchema.parse(row);
        return learningReviewResponseSchema.parse({ ...review, createdAt: review.createdAt.toISOString() });
      }),
    });
    await recordSensitiveRead(client, scope, 'vehicle-learning-activity-read-prepared', 1, requestId);
    return activity;
  });
}

export async function listVehicleLearningReviewQueue(pool: Database, scope: Scope, requestId: string) {
  return scoped(pool, scope, async client => {
    await requireActiveReadMembership(client, scope);
    await requireAfterSalesRole(client, scope);
    await requireVehicleLearningReviewGrant(client, scope);
    const result = await client.query(`SELECT e.id,e.title,e.make_model AS "makeModel",e.powertrain,e.drivetrain,
        u.display_name AS "authorName",e.version,e.updated_at AS "updatedAt"
      FROM public.vehicle_learning_entries e
      JOIN public.staff_users u ON u.id=e.author_id AND u.active
      WHERE e.organisation_id=$1 AND e.site_id=$2 AND e.status='submitted'
        AND e.author_id<>$3
        AND NOT EXISTS (SELECT 1 FROM public.vehicle_learning_reviews r
          WHERE r.organisation_id=e.organisation_id AND r.site_id=e.site_id
            AND r.entry_id=e.id AND r.revision_number=e.version)
      ORDER BY e.updated_at,e.id LIMIT 100`,
    [scope.organisationId, scope.siteId, scope.actorId]);
    const items = result.rows.map(row => learningReviewQueueItemSchema.parse({
      ...row,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    }));
    await recordSensitiveRead(client, scope, 'vehicle-learning-review-queue-read-prepared', items.length, requestId);
    return learningReviewQueueSchema.parse({ items });
  });
}

export async function saveVehicleLearning(pool: Database, scope: Scope, commandId: string, raw: unknown) {
  const input = learningEntryInputSchema.parse(raw);
  const projection = projectAssessment(input.assessment);
  const entryId = input.id ?? deterministicId(`${scope.organisationId}:${scope.siteId}:${scope.actorId}:${commandId}`);
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: input.status === 'submitted' ? 'vehicle-learning.submitted' : 'vehicle-learning.saved',
    targetAggregateId: entryId,
    payload: input,
    responseSchema: entryResponseSchema,
    lockSerializationRoots: client => lockAdvisoryRoots(client, [learningRootLock(scope, entryId)]),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site membership does not permit changes.');
      await requireAfterSalesRole(client, scope, true);
    },
    apply: async client => {
      let savedRow: unknown;
      if (input.id) {
        const result = await client.query(`UPDATE public.vehicle_learning_entries e
          SET title=$1,make_model=$2,powertrain=$3,drivetrain=$4,systems=$5,evidence=$6,
            questions=$7,assessment=$8,status=$9,version=version+1,updated_at=clock_timestamp()
          WHERE e.id=$10 AND e.organisation_id=$11 AND e.site_id=$12 AND e.author_id=$13
            AND e.version=$14 AND (e.status='draft' OR EXISTS (
              SELECT 1 FROM public.vehicle_learning_reviews r
              WHERE r.organisation_id=e.organisation_id AND r.site_id=e.site_id
                AND r.entry_id=e.id AND r.revision_number=e.version AND r.decision='changes-requested'
            ))
          RETURNING id,title,make_model AS "makeModel",powertrain,drivetrain,systems,evidence,
            questions,assessment,status,version,updated_at AS "updatedAt",NULL::text AS "reviewDecision"`,
        [input.title,input.makeModel,projection.powertrain,projection.drivetrain,JSON.stringify(projection.systems),projection.evidence,
          projection.questions,JSON.stringify(input.assessment),input.status,input.id,scope.organisationId,scope.siteId,scope.actorId,input.expectedVersion]);
        if (!result.rowCount) {
          throw new ApiError(409, 'LEARNING_ENTRY_CHANGED', 'This draft changed or was submitted. Refresh your learning notes and try again.');
        }
        savedRow = result.rows[0];
      } else {
        if (input.expectedVersion !== null) throw new ApiError(400, 'INVALID_VERSION', 'A new learning note cannot have an existing version.');
        await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
          VALUES($1,$2,$3,'vehicle-learning-entry')`, [entryId,scope.organisationId,scope.siteId]);
        const result = await client.query(`INSERT INTO public.vehicle_learning_entries
          (id,organisation_id,site_id,author_id,title,make_model,powertrain,drivetrain,systems,evidence,questions,assessment,status,version)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1)
          RETURNING id,title,make_model AS "makeModel",powertrain,drivetrain,systems,evidence,
            questions,assessment,status,version,updated_at AS "updatedAt",NULL::text AS "reviewDecision"`,
        [entryId,scope.organisationId,scope.siteId,scope.actorId,input.title,input.makeModel,projection.powertrain,
          projection.drivetrain,JSON.stringify(projection.systems),projection.evidence,projection.questions,JSON.stringify(input.assessment),input.status]);
        savedRow = result.rows[0];
      }
      const entry = entryRowSchema.parse(savedRow);
      const revision = await client.query(`INSERT INTO public.vehicle_learning_entry_revisions
        (organisation_id,site_id,entry_id,author_id,revision_number,title,make_model,powertrain,
         drivetrain,systems,evidence,questions,assessment,status,saved_at)
        SELECT organisation_id,site_id,id,author_id,version,title,make_model,powertrain,
          drivetrain,systems,evidence,questions,assessment,status,updated_at
        FROM public.vehicle_learning_entries
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3 AND author_id=$4`,
      [scope.organisationId,scope.siteId,entry.id,scope.actorId]);
      if (revision.rowCount !== 1) throw new Error('Vehicle-learning revision was not recorded.');
      return {
        aggregateId: entry.id,
        aggregateType: 'vehicle-learning-entry',
        version: entry.version,
        previous: input.expectedVersion === null ? { exists: false } : { version: input.expectedVersion },
        next: { status: entry.status, version: entry.version },
        reason: entry.status === 'submitted'
          ? 'Staff member submitted a vehicle learning note for review.'
          : 'Staff member saved a vehicle learning draft.',
      };
    },
    project: async (client, mutation) => {
      const result = await client.query(`SELECT e.id,e.title,e.make_model AS "makeModel",e.powertrain,e.drivetrain,
          e.systems,e.evidence,e.questions,e.assessment,e.status,e.version,
          (SELECT r.decision FROM public.vehicle_learning_reviews r
            WHERE r.organisation_id=e.organisation_id AND r.site_id=e.site_id
              AND r.entry_id=e.id AND r.revision_number=e.version) AS "reviewDecision",
          e.updated_at AS "updatedAt"
        FROM public.vehicle_learning_entries e
        WHERE e.organisation_id=$1 AND e.site_id=$2 AND e.author_id=$3 AND e.id=$4`,
      [scope.organisationId,scope.siteId,scope.actorId,mutation.aggregateId]);
      if (!result.rowCount) notFound();
      return entryFromRow(result.rows[0]);
    },
  });
}

export async function addVehicleLearningComment(
  pool: Database,
  scope: Scope,
  commandId: string,
  entryId: string,
  raw: unknown,
) {
  const input = commentInputSchema.parse(raw);
  const commentId = deterministicId(`${scope.organisationId}:${scope.siteId}:${scope.actorId}:${commandId}`);
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'vehicle-learning.comment-added',
    targetAggregateId: commentId,
    payload: { entryId, ...input },
    responseSchema: commentResponseSchema,
    lockSerializationRoots: client => lockAdvisoryRoots(client, [learningRootLock(scope, entryId), learningReviewGrantLock(scope)]),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site membership does not permit changes.');
      await requireAfterSalesRole(client, scope, true);
    },
    apply: async client => {
      const entry = await client.query(`SELECT id,author_id AS "authorId",status,version FROM public.vehicle_learning_entries
        WHERE organisation_id=$1 AND site_id=$2 AND author_id=$3 AND id=$4`,
      [scope.organisationId,scope.siteId,scope.actorId,entryId]);
      let target: { id: string; authorId: string; status: 'draft' | 'submitted'; version: number };
      if (entry.rowCount) {
        target = z.object({ id: uuid, authorId: uuid, status: z.enum(['draft','submitted']), version: z.number().int().positive() }).parse(entry.rows[0]);
      } else {
        const reviewerEntry = await client.query(`SELECT id,author_id AS "authorId",status,version
          FROM public.vehicle_learning_entries WHERE organisation_id=$1 AND site_id=$2 AND id=$3`,
        [scope.organisationId,scope.siteId,entryId]);
        if (!reviewerEntry.rowCount) notFound();
        target = z.object({ id: uuid, authorId: uuid, status: z.enum(['draft','submitted']), version: z.number().int().positive() }).parse(reviewerEntry.rows[0]);
        await requireVehicleLearningReviewGrant(client, scope);
        if (target.authorId === scope.actorId || target.status !== 'submitted' || target.version !== input.revisionNumber) notFound();
        const priorReview = await client.query(`SELECT 1 FROM public.vehicle_learning_reviews
          WHERE organisation_id=$1 AND site_id=$2 AND entry_id=$3 AND revision_number=$4`,
        [scope.organisationId,scope.siteId,entryId,target.version]);
        if (priorReview.rowCount) throw new ApiError(409, 'LEARNING_ALREADY_REVIEWED', 'This version already has a review decision.');
      }
      const revision = await client.query(`SELECT revision_number FROM public.vehicle_learning_entry_revisions
        WHERE organisation_id=$1 AND site_id=$2 AND entry_id=$3 AND revision_number=$4
          AND author_id=$5 AND ($6::boolean OR status='submitted')`,
      [scope.organisationId,scope.siteId,entryId,input.revisionNumber,target.authorId,target.authorId===scope.actorId]);
      if (!revision.rowCount) throw new ApiError(404, 'LEARNING_REVISION_NOT_FOUND', 'That saved version is no longer available.');
      await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
        VALUES($1,$2,$3,'vehicle-learning-comment')`, [commentId,scope.organisationId,scope.siteId]);
      await client.query(`INSERT INTO public.vehicle_learning_comments
        (id,organisation_id,site_id,entry_id,revision_number,entry_author_id,commenter_id,body)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [commentId,scope.organisationId,scope.siteId,entryId,input.revisionNumber,target.authorId,scope.actorId,input.body]);
      return {
        aggregateId: commentId,
        aggregateType: 'vehicle-learning-comment',
        version: 1,
        previous: { exists: false },
        next: { entryId, revisionNumber: input.revisionNumber },
        reason: 'Staff member added a comment to a vehicle-learning revision.',
      };
    },
    project: async (client, mutation) => {
      const result = await client.query(`SELECT c.id,c.entry_id AS "entryId",c.revision_number AS "revisionNumber",
          c.commenter_id AS "commenterId",u.display_name AS "commenterName",c.body,c.created_at AS "createdAt"
        FROM public.vehicle_learning_comments c JOIN public.staff_users u ON u.id=c.commenter_id
        WHERE c.organisation_id=$1 AND c.site_id=$2 AND c.entry_id=$3 AND c.commenter_id=$4 AND c.id=$5`,
      [scope.organisationId,scope.siteId,entryId,scope.actorId,mutation.aggregateId]);
      if (!result.rowCount) throw new ApiError(404, 'LEARNING_COMMENT_NOT_FOUND', 'That comment is not available in this learning record.');
      return commentFromRow(result.rows[0]);
    },
  });
}

export async function reviewVehicleLearning(
  pool: Database,
  scope: Scope,
  commandId: string,
  entryId: string,
  raw: unknown,
) {
  const input = learningReviewDecisionInputSchema.parse(raw);
  const reviewId = deterministicId(`${scope.organisationId}:${scope.siteId}:${scope.actorId}:${commandId}`);
  let reviewerGrant: z.infer<typeof learningReviewGrantSchema> | null = null;
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'vehicle-learning.review-recorded',
    targetAggregateId: reviewId,
    payload: { entryId, ...input },
    responseSchema: learningReviewResponseSchema,
    lockSerializationRoots: client => lockAdvisoryRoots(client, [learningRootLock(scope, entryId), learningReviewGrantLock(scope)]),
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site membership does not permit changes.');
      await requireAfterSalesRole(client, scope, true);
      reviewerGrant = await requireVehicleLearningReviewGrant(client, scope);
    },
    apply: async client => {
      const current = await client.query(`SELECT id,author_id AS "authorId",version,status
        FROM public.vehicle_learning_entries
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3`,
      [scope.organisationId,scope.siteId,entryId]);
      if (!current.rowCount) notFound();
      const entry = z.object({ id: uuid, authorId: uuid, version: z.number().int().positive(), status: z.enum(['draft','submitted']) }).parse(current.rows[0]);
      if (entry.authorId === scope.actorId) throw new ApiError(403, 'LEARNING_SELF_REVIEW', 'You cannot review your own learning note.');
      if (entry.status !== 'submitted' || entry.version !== input.expectedVersion) {
        throw new ApiError(409, 'LEARNING_REVIEW_STALE', 'This learning note changed or has already been reviewed. Refresh the review queue.');
      }
      const grant = learningReviewGrantSchema.parse(reviewerGrant);
      const prior = await client.query(`SELECT 1 FROM public.vehicle_learning_reviews
        WHERE organisation_id=$1 AND site_id=$2 AND entry_id=$3 AND revision_number=$4`,
      [scope.organisationId,scope.siteId,entryId,entry.version]);
      if (prior.rowCount) throw new ApiError(409, 'LEARNING_ALREADY_REVIEWED', 'This version already has a review decision.');
      const revision = await client.query(`SELECT 1 FROM public.vehicle_learning_entry_revisions
        WHERE organisation_id=$1 AND site_id=$2 AND entry_id=$3 AND revision_number=$4 AND status='submitted'`,
      [scope.organisationId,scope.siteId,entryId,entry.version]);
      if (!revision.rowCount) throw new ApiError(409, 'LEARNING_REVIEW_STALE', 'The submitted version is no longer available.');
      const revisionSnapshot = await client.query(`SELECT title,make_model AS "makeModel",powertrain,drivetrain,
          systems,evidence,questions,assessment
        FROM public.vehicle_learning_entry_revisions
        WHERE organisation_id=$1 AND site_id=$2 AND entry_id=$3 AND revision_number=$4 AND status='submitted'`,
      [scope.organisationId,scope.siteId,entryId,entry.version]);
      const snapshot = learningLibrarySourceSchema.parse(revisionSnapshot.rows[0]);
      await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
        VALUES($1,$2,$3,'vehicle-learning-review')`, [reviewId,scope.organisationId,scope.siteId]);
      await client.query(`INSERT INTO public.vehicle_learning_reviews
        (id,organisation_id,site_id,entry_id,revision_number,author_id,reviewer_id,
         reviewer_grant_id,reviewer_grant_revision,decision,reason,share_with_after_sales)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [reviewId,scope.organisationId,scope.siteId,entryId,entry.version,entry.authorId,scope.actorId,
        grant.id,grant.grantRevision,input.decision,input.reason,input.shareWithAfterSales]);
      if (input.decision === 'reviewed-learning-record' && input.shareWithAfterSales) {
        await client.query(`INSERT INTO public.vehicle_learning_library_entries
          (organisation_id,site_id,entry_id,revision_number,review_id,title,make_model,powertrain,drivetrain,
           systems,evidence,questions,assessment)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [scope.organisationId,scope.siteId,entryId,entry.version,reviewId,snapshot.title,snapshot.makeModel,
          snapshot.powertrain,snapshot.drivetrain,JSON.stringify(snapshot.systems),snapshot.evidence,
          snapshot.questions,snapshot.assessment ? JSON.stringify(snapshot.assessment) : null]);
      }
      return {
        aggregateId: reviewId,
        aggregateType: 'vehicle-learning-review',
        version: 1,
        previous: { exists: false },
        next: { entryId, revisionNumber: entry.version, decision: input.decision },
        reason: input.decision === 'changes-requested'
          ? 'Reviewer requested changes to a vehicle-learning record.'
          : 'Reviewer marked the submitted vehicle-learning record as reviewed.',
      };
    },
    project: async client => {
      const result = await client.query(`SELECT r.id,r.entry_id AS "entryId",r.revision_number AS "revisionNumber",
          r.reviewer_id AS "reviewerId",u.display_name AS "reviewerName",r.decision,r.reason,
          r.share_with_after_sales AS "shareWithAfterSales",r.created_at AS "createdAt"
        FROM public.vehicle_learning_reviews r JOIN public.staff_users u ON u.id=r.reviewer_id
        WHERE r.organisation_id=$1 AND r.site_id=$2 AND r.entry_id=$3 AND r.reviewer_id=$4 AND r.id=$5`,
      [scope.organisationId,scope.siteId,entryId,scope.actorId,reviewId]);
      if (!result.rowCount) notFound();
      const review = learningReviewRowSchema.parse(result.rows[0]);
      return learningReviewResponseSchema.parse({ ...review, createdAt: review.createdAt.toISOString() });
    },
  });
}

function deterministicId(value: string) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
