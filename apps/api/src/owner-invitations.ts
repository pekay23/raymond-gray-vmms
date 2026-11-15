import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockAdvisoryRoots, runStaffCommand } from './commands.js';
import type { Database, Scope } from './db.js';
import { uuid } from './db.js';
import { ApiError, notFound } from './errors.js';
import type { Config } from './config.js';
import { consumeAttempt } from './attempt-limiter.js';

const reason = z.string().trim().min(1).max(1000);
const expectedVersion = z.number().int().positive();
const invitationId = uuid;
function invitationIdForCommand(scope: Scope, commandId: string) {
  const bytes = createHash('sha256')
    .update(`${scope.organisationId}:${scope.siteId}:${scope.actorId}:${commandId}`)
    .digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export const issueOwnerInvitationSchema = z.object({
  ownerAccountId: uuid,
  evidenceRecordId: uuid,
  reason,
  expiresInHours: z.number().int().min(1).max(168).default(72),
}).strict();

export const revokeOwnerInvitationSchema = z.object({
  expectedVersion,
  evidenceRecordId: uuid,
  reason,
}).strict();

const issuedSchema = z.object({
  invitationId,
  ownerAccountId: uuid,
  status: z.literal('issued'),
  expiresAt: z.iso.datetime({ offset: true }),
});

const revokedSchema = z.object({
  invitationId,
  ownerAccountId: uuid,
  status: z.literal('revoked'),
  version: z.number().int().positive(),
});

export type OwnerInvitationIssue = z.infer<typeof issuedSchema> & { claimToken?: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function requireAuthority(client: PoolClient, scope: Scope) {
  const found = await client.query(
    'SELECT public.lock_vehicle_owner_access_authority($1,$2) AS allowed',
    [scope.actorId, scope.siteId],
  );
  if (!z.object({ allowed: z.boolean() }).parse(found.rows[0]).allowed) {
    throw new ApiError(403, 'OWNER_ACCESS_APPROVER_REQUIRED', 'A current vehicle-owner access approval grant is required.');
  }
}

async function requireAcceptedEvidence(client: PoolClient, scope: Scope, evidenceRecordId: string) {
  const found = await client.query(
    'SELECT public.lock_accepted_owner_evidence($1,$2) AS accepted',
    [evidenceRecordId, scope.siteId],
  );
  if (!z.object({ accepted: z.boolean() }).parse(found.rows[0]).accepted) {
    throw new ApiError(422, 'EVIDENCE_NOT_ACCEPTED', 'Reference accepted evidence in this site.');
  }
}

async function requireActiveRelationship(client: PoolClient, scope: Scope, ownerAccountId: string) {
  const found = await client.query(
    'SELECT public.lock_current_vehicle_owner_relationship($1,$2) AS allowed',
    [ownerAccountId, scope.siteId],
  );
  if (!z.object({ allowed: z.boolean() }).parse(found.rows[0]).allowed) {
    throw new ApiError(409, 'OWNER_RELATIONSHIP_REQUIRED', 'Approve a current vehicle access relationship before issuing an invitation.');
  }
}

export async function issueOwnerInvitation(
  pool: Database,
  config: Config,
  scope: Scope,
  commandId: string,
  body: z.infer<typeof issueOwnerInvitationSchema>,
): Promise<OwnerInvitationIssue> {
  const id = invitationIdForCommand(scope, commandId);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = digest(token);
  let createdInThisRequest = false;

  const result = await runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'owner.invitation-issued',
    targetAggregateId: id,
    payload: body,
    responseSchema: issuedSchema,
    lockSerializationRoots: async client => {
      await lockAdvisoryRoots(client,[`vehicle-owner-invitation:${scope.organisationId}:${scope.siteId}:${body.ownerAccountId}`]);
      await client.query(`SELECT id FROM vehicle_owner_invitations
        WHERE organisation_id=$1 AND site_id=$2 AND owner_account_id=$3
          AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at>transaction_timestamp()
        ORDER BY id FOR UPDATE`,[scope.organisationId,scope.siteId,body.ownerAccountId]);
    },
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site membership does not permit changes.');
      await requireAuthority(client, scope);
      await requireAcceptedEvidence(client, scope, body.evidenceRecordId);
    },
    beforeApply: async () => {
      await consumeAttempt(pool,config,`owner-invitation-actor:${scope.organisationId}:${scope.siteId}:${scope.actorId}`,30,60*60);
      await consumeAttempt(pool,config,`owner-invitation-target:${scope.organisationId}:${scope.siteId}:${scope.actorId}:${body.ownerAccountId}`,5,60*60);
    },
    apply: async client => {
      const active = await client.query('SELECT public.lock_active_vehicle_owner_account($1) AS active', [body.ownerAccountId]);
      if (!z.object({ active: z.boolean() }).parse(active.rows[0]).active) {
        throw new ApiError(422, 'OWNER_ACCOUNT_NOT_APPROVED', 'The specified owner identity is not active in this organisation.');
      }
      await requireActiveRelationship(client, scope, body.ownerAccountId);
      const existing = await client.query(`SELECT id FROM vehicle_owner_invitations
        WHERE organisation_id=$1 AND site_id=$2 AND owner_account_id=$3
          AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at>transaction_timestamp()
        LIMIT 1 FOR UPDATE`, [scope.organisationId, scope.siteId, body.ownerAccountId]);
      if (existing.rowCount) {
        throw new ApiError(409, 'INVITATION_ALREADY_ISSUED', 'An active invitation already exists for this owner. Revoke it before issuing another.');
      }
      await client.query("INSERT INTO aggregate_roots(id,organisation_id,site_id,aggregate_type) VALUES($1,$2,$3,'vehicle-owner-invitation')", [id, scope.organisationId, scope.siteId]);
      const inserted = await client.query(`INSERT INTO vehicle_owner_invitations(
        id,organisation_id,site_id,owner_account_id,token_hash,evidence_record_id,issued_by,reason,expires_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,transaction_timestamp()+($9::text||' hours')::interval)
      RETURNING expires_at AS "expiresAt"`,
      [id, scope.organisationId, scope.siteId, body.ownerAccountId, tokenHash, body.evidenceRecordId, scope.actorId, body.reason, body.expiresInHours]);
      const expiresAtValue = z.object({ expiresAt: z.union([z.date(), z.iso.datetime({ offset: true })]) })
        .parse(inserted.rows[0]).expiresAt;
      const expiresAt = expiresAtValue instanceof Date ? expiresAtValue.toISOString() : expiresAtValue;
      createdInThisRequest = true;
      return {
        aggregateId: id,
        aggregateType: 'vehicle-owner-invitation',
        version: 1,
        previous: { status: 'absent' },
        next: { invitationId: id, ownerAccountId: body.ownerAccountId, status: 'issued', expiresAt },
        reason: body.reason,
      };
    },
    project: async (_client, mutation) => issuedSchema.parse(mutation.next),
  });

  return createdInThisRequest ? { ...result, claimToken: token } : result;
}

export async function revokeOwnerInvitation(
  pool: Database,
  scope: Scope,
  commandId: string,
  id: string,
  body: z.infer<typeof revokeOwnerInvitationSchema>,
) {
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'owner.invitation-revoked',
    targetAggregateId: id,
    payload: body,
    responseSchema: revokedSchema,
    lockSerializationRoots: async client => {
      const reference=await client.query('SELECT owner_account_id AS "ownerAccountId" FROM vehicle_owner_invitations WHERE organisation_id=$1 AND site_id=$2 AND id=$3',[scope.organisationId,scope.siteId,invitationId.parse(id)]);
      if (!reference.rowCount) notFound();
      const ownerAccountId=z.object({ownerAccountId:uuid}).parse(reference.rows[0]).ownerAccountId;
      await lockAdvisoryRoots(client,[`vehicle-owner-invitation:${scope.organisationId}:${scope.siteId}:${ownerAccountId}`]);
      await client.query('SELECT id FROM vehicle_owner_invitations WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE',[scope.organisationId,scope.siteId,id]);
    },
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site membership does not permit changes.');
      await requireAuthority(client, scope);
      await requireAcceptedEvidence(client, scope, body.evidenceRecordId);
    },
    apply: async client => {
      const current = await client.query(`SELECT owner_account_id AS "ownerAccountId",claimed_at AS "claimedAt",revoked_at AS "revokedAt",expires_at AS "expiresAt",
          expires_at>transaction_timestamp() AS "notExpired"
        FROM vehicle_owner_invitations WHERE organisation_id=$1 AND site_id=$2 AND id=$3 FOR UPDATE`,
      [scope.organisationId, scope.siteId, invitationId.parse(id)]);
      if (!current.rowCount) notFound();
      const invitation = z.object({ ownerAccountId: uuid, claimedAt: z.date().nullable(), revokedAt: z.date().nullable(), notExpired: z.boolean() }).parse(current.rows[0]);
      if (body.expectedVersion !== 1) throw new ApiError(409, 'STALE_VERSION', 'This invitation is no longer active.', 2);
      if (invitation.claimedAt || invitation.revokedAt || !invitation.notExpired) {
        throw new ApiError(409, 'INVITATION_NOT_ACTIVE', 'This invitation is no longer active.');
      }
      await client.query('UPDATE vehicle_owner_invitations SET revoked_at=transaction_timestamp() WHERE organisation_id=$1 AND site_id=$2 AND id=$3',
        [scope.organisationId, scope.siteId, id]);
      return {
        aggregateId: id,
        aggregateType: 'vehicle-owner-invitation',
        version: 2,
        previous: { status: 'issued' },
        next: { invitationId: id, ownerAccountId: invitation.ownerAccountId, status: 'revoked', version: 2 },
        reason: body.reason,
      };
    },
    project: async (_client, mutation) => revokedSchema.parse(mutation.next),
  });
}
