import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { lockAdvisoryRoots, lockWorkOrderRoot, runStaffCommand } from './commands.js';
import { type Database, scoped, type Scope, uuid } from './db.js';
import { ApiError } from './errors.js';
import { recordSensitiveRead, requireActiveReadMembership } from './sensitive-read-audit.js';

const recipientSchema = z.object({
  userId: uuid,
  displayName: z.string(),
  readAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export const staffMessageSchema = z.object({
  id: uuid,
  senderUserId: uuid,
  senderName: z.string(),
  recipients: z.array(recipientSchema),
  body: z.string(),
  workOrderId: uuid.nullable(),
  workOrderReference: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  readAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

const listSchema = z.object({
  canSend: z.boolean(),
  items: z.array(staffMessageSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalCount: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
}).strict();

const createSchema = z.object({
  recipientUserIds: z.array(uuid).min(1).max(50).refine(ids => new Set(ids).size === ids.length, 'Choose each recipient only once.'),
  workOrderId: uuid.nullable().default(null),
  body: z.string().trim().min(1).max(5000),
}).strict();

const createdSchema = z.object({ messageId: uuid, createdAt: z.iso.datetime({ offset: true }) }).strict();
const readReceiptSchema = z.object({ messageId: uuid, readAt: z.iso.datetime({ offset: true }) }).strict();

function messageIdForCommand(scope: Scope, commandId: string) {
  const bytes = createHash('sha256')
    .update(`${scope.organisationId}:${scope.siteId}:${scope.actorId}:${commandId}`)
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function isHead(client: PoolClient, scope: Scope, lock = false) {
  const result = await client.query(`SELECT 1
    FROM public.staff_role_placements p
    JOIN public.staff_role_profiles r ON r.code=p.role_code
    JOIN public.staff_users u ON u.id=p.staff_user_id
    JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id
    WHERE p.organisation_id=$1 AND p.site_id=$2 AND p.staff_user_id=$3
      AND p.state='active' AND r.code='head-service-centre' AND r.active AND u.active AND m.active
    ${lock ? 'FOR SHARE OF p' : ''}`,
  [scope.organisationId, scope.siteId, scope.actorId]);
  return Boolean(result.rowCount);
}

async function requireHead(client: PoolClient, scope: Scope) {
  if (!await isHead(client, scope, true)) {
    throw new ApiError(403, 'ROLE_REQUIRED', 'Only the Head of Service Centre can send a staff message.');
  }
}

async function messageItem(client: PoolClient, scope: Scope, id: string) {
  const result = await client.query(`SELECT
      m.id,m.sender_user_id AS "senderUserId",sender.display_name AS "senderName",
      COALESCE(jsonb_agg(jsonb_build_object(
        'userId',r.recipient_user_id,'displayName',recipient.display_name,'readAt',rr.read_at
      ) ORDER BY recipient.display_name,r.recipient_user_id) FILTER (WHERE r.recipient_user_id IS NOT NULL),'[]'::jsonb) AS recipients,
      m.body,m.work_order_id AS "workOrderId",w.reference AS "workOrderReference",m.created_at AS "createdAt",
      (SELECT own.read_at FROM public.staff_message_read_receipts own
        WHERE own.organisation_id=m.organisation_id AND own.site_id=m.site_id
          AND own.message_id=m.id AND own.reader_user_id=$4) AS "readAt"
    FROM public.staff_messages m
    JOIN public.staff_users sender ON sender.id=m.sender_user_id
    LEFT JOIN public.work_orders w ON w.organisation_id=m.organisation_id AND w.site_id=m.site_id AND w.id=m.work_order_id
    LEFT JOIN public.staff_message_recipients r ON r.organisation_id=m.organisation_id
      AND r.site_id=m.site_id AND r.message_id=m.id
    LEFT JOIN public.staff_users recipient ON recipient.id=r.recipient_user_id
    LEFT JOIN public.staff_message_read_receipts rr ON rr.organisation_id=r.organisation_id
      AND rr.site_id=r.site_id AND rr.message_id=r.message_id AND rr.reader_user_id=r.recipient_user_id
    WHERE m.organisation_id=$1 AND m.site_id=$2 AND m.id=$3
    GROUP BY m.id,sender.display_name,w.reference`,
  [scope.organisationId, scope.siteId, id, scope.actorId]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'This message is no longer available.');
  const asIso = (value: unknown) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
    return value;
  };
  const recipients = Array.isArray(row.recipients)
    ? row.recipients.map(value => {
      const person = value as Record<string, unknown>;
      return { ...person, readAt: asIso(person.readAt) };
    })
    : row.recipients;
  return staffMessageSchema.parse({ ...row, recipients, createdAt: asIso(row.createdAt), readAt: asIso(row.readAt) });
}

/** List only current-period messages sent by or addressed to this active site member. */
export async function listStaffMessages(
  pool: Database,
  scope: Scope,
  requestId: string,
  page = 1,
  pageSize = 25,
  enabled = false,
) {
  const pageNumber = z.number().int().min(1).max(10000).parse(page);
  const size = z.number().int().min(1).max(50).parse(pageSize);
  return scoped(pool, scope, async client => {
    const canWrite = await requireActiveReadMembership(client, scope);
    const canSend = enabled && canWrite && await isHead(client, scope);
    const count = await client.query(`SELECT count(*)::int AS count
      FROM public.staff_messages m
      WHERE m.organisation_id=$1 AND m.site_id=$2`, [scope.organisationId, scope.siteId]);
    const totalCount = z.number().int().nonnegative().parse(count.rows[0]?.count ?? 0);
    const result = await client.query(`SELECT m.id
      FROM public.staff_messages m
      WHERE m.organisation_id=$1 AND m.site_id=$2
      ORDER BY m.created_at DESC,m.id DESC
      LIMIT $3 OFFSET $4`, [scope.organisationId, scope.siteId, size, (pageNumber - 1) * size]);
    const items = [];
    for (const row of result.rows) {
      items.push(await messageItem(client, scope, uuid.parse(row.id)));
    }
    await recordSensitiveRead(client, scope, 'staff-messages-read-prepared', items.length, requestId);
    return listSchema.parse({
      canSend,
      items,
      page: pageNumber,
      pageSize: size,
      totalCount,
      totalPages: Math.ceil(totalCount / size),
    });
  });
}

/** Send an immutable, explicitly addressed in-app message through the command ledger. */
export async function sendStaffMessage(
  pool: Database,
  scope: Scope,
  commandId: string,
  input: unknown,
  enabled = false,
) {
  if (!enabled) throw new ApiError(503, 'MESSAGES_DISABLED', 'Staff messaging is not enabled for this environment.');
  const body = createSchema.parse(input);
  if (body.recipientUserIds.includes(scope.actorId)) {
    throw new ApiError(400, 'SELF_RECIPIENT', 'Choose another staff member as the recipient.');
  }
  await scoped(pool, scope, async client => {
    const canWrite = await requireActiveReadMembership(client, scope);
    if (!canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit sending messages.');
    await requireHead(client, scope);
  });
  const id = messageIdForCommand(scope, uuid.parse(commandId));
  const recipientIds = [...body.recipientUserIds].sort();
  const lockedRecipientEpochs = new Map<string, number>();
  return runStaffCommand(pool, {
    scope,
    commandId,
    operation: 'workforce.message-sent',
    targetAggregateId: id,
    payload: body,
    responseSchema: createdSchema,
    lockSerializationRoots: async client => {
      await lockAdvisoryRoots(client, [`staff-messages:${scope.organisationId}:${scope.siteId}`]);
      for (const recipientId of recipientIds) {
        const membership = await client.query('SELECT public.lock_staff_message_recipient($1) AS membership_epoch', [recipientId]);
        const epoch = membership.rows[0]?.membership_epoch;
        if (epoch === null || epoch === undefined) throw new ApiError(400, 'RECIPIENT_NOT_AVAILABLE', 'Choose active staff at this service centre.');
        lockedRecipientEpochs.set(recipientId, z.number().int().positive().parse(epoch));
      }
      if (body.workOrderId) await lockWorkOrderRoot(client, scope, body.workOrderId);
    },
    authorize: async (client, membership) => {
      if (!membership.canWrite) throw new ApiError(403, 'READ_ONLY', 'Your site access does not permit sending messages.');
      await requireHead(client, scope);
    },
    apply: async client => {
      const senderMembership = await client.query('SELECT public.lock_staff_message_sender_epoch() AS membership_epoch');
      const senderEpoch = senderMembership.rows[0]?.membership_epoch;
      if (senderEpoch === null || senderEpoch === undefined) throw new ApiError(403, 'ROLE_REQUIRED', 'Only the Head of Service Centre can send a staff message.');
      const parsedSenderEpoch = z.number().int().positive().parse(senderEpoch);
      const recipients = await client.query(`SELECT id AS user_id,display_name
        FROM public.staff_users WHERE id=ANY($1::uuid[]) AND active ORDER BY id`, [recipientIds]);
      if (recipients.rowCount !== recipientIds.length) {
        throw new ApiError(400, 'RECIPIENT_NOT_AVAILABLE', 'Choose active staff at this service centre.');
      }
      for (const recipientId of recipientIds) {
        const locked = await client.query('SELECT public.lock_staff_message_recipient($1) AS membership_epoch', [recipientId]);
        const epoch = locked.rows[0]?.membership_epoch;
        if (epoch === null || epoch === undefined || z.number().int().positive().parse(epoch) !== lockedRecipientEpochs.get(recipientId)) {
          throw new ApiError(400, 'RECIPIENT_NOT_AVAILABLE', 'Choose active staff at this service centre.');
        }
      }
      if (body.workOrderId) {
        const order = await client.query(`SELECT 1 FROM public.work_orders
          WHERE organisation_id=$1 AND site_id=$2 AND id=$3`, [scope.organisationId, scope.siteId, body.workOrderId]);
        if (!order.rowCount) throw new ApiError(404, 'WORK_ORDER_NOT_FOUND', 'This work item is not available at this service centre.');
      }
      await client.query(`INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
        VALUES($1,$2,$3,'staff-message')`, [id, scope.organisationId, scope.siteId]);
      await client.query(`INSERT INTO public.staff_messages
        (id,organisation_id,site_id,sender_user_id,sender_membership_epoch,work_order_id,body)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [id, scope.organisationId, scope.siteId, scope.actorId, parsedSenderEpoch, body.workOrderId, body.body]);
      for (const recipient of recipients.rows) {
        const parsed = z.object({ user_id: uuid }).parse(recipient);
        await client.query(`INSERT INTO public.staff_message_recipients
          (organisation_id,site_id,message_id,sender_user_id,sender_membership_epoch,recipient_user_id,recipient_membership_epoch)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [scope.organisationId, scope.siteId, id, scope.actorId, parsedSenderEpoch, parsed.user_id, lockedRecipientEpochs.get(parsed.user_id)]);
      }
      return {
        aggregateId: id,
        aggregateType: 'staff-message',
        version: 1,
        previous: null,
        next: {
          messageId: id,
          senderUserId: scope.actorId,
          recipientUserIds: recipientIds,
          workOrderId: body.workOrderId,
          bodySha256: createHash('sha256').update(body.body).digest('hex'),
        },
        reason: 'Head of Service Centre sent an internal staff message.',
      };
    },
    project: async client => {
      const result = await client.query(`SELECT created_at AS "createdAt" FROM public.staff_messages
        WHERE organisation_id=$1 AND site_id=$2 AND id=$3`, [scope.organisationId, scope.siteId, id]);
      const createdAt = result.rows[0]?.createdAt;
      if (!(createdAt instanceof Date)) throw new ApiError(500, 'MESSAGE_PROJECTION_FAILED', 'The message was saved but its receipt could not be created.');
      return createdSchema.parse({ messageId: id, createdAt: createdAt.toISOString() });
    },
  });
}

/** Record a recipient's first read as an immutable, idempotent aggregate event. */
export async function markStaffMessageRead(pool: Database, scope: Scope, commandId: string, messageId: string) {
  const command = uuid.parse(commandId);
  const id = uuid.parse(messageId);
  const commandFingerprint = fingerprint({ operation: 'workforce.message-read', messageId: id });
  return scoped(pool, scope, async client => {
    const membership = await client.query('SELECT public.lock_membership($1,$2) AS can_write', [scope.actorId, scope.siteId]);
    if (membership.rows[0]?.can_write === null || membership.rows[0]?.can_write === undefined) {
      throw new ApiError(403, 'SITE_FORBIDDEN', 'You do not have active access to this site.');
    }
    const message = await client.query(`SELECT id FROM public.staff_messages
      WHERE organisation_id=$1 AND site_id=$2 AND id=$3`, [scope.organisationId, scope.siteId, id]);
    if (!message.rowCount) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'This message is no longer available.');
    const recipient = await client.query(`SELECT r.recipient_membership_epoch
      FROM public.staff_message_recipients r
      WHERE r.organisation_id=$1 AND r.site_id=$2 AND r.message_id=$3
        AND r.recipient_user_id=$4`, [scope.organisationId, scope.siteId, id, scope.actorId]);
    if (!recipient.rowCount) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'This message is no longer available.');

    const previous = await client.query(`SELECT fingerprint,response FROM public.command_receipts
      WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND command_id=$4`,
    [scope.organisationId, scope.siteId, scope.actorId, command]);
    if (previous.rows.length) {
      const prior = previous.rows[0] as { fingerprint: string; response: unknown };
      if (prior.fingerprint !== commandFingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This command ID was already used for different content.');
      const saved = readReceiptSchema.parse(prior.response);
      return { ...saved, readAt: new Date(saved.readAt).toISOString() };
    }

    const recorded = await client.query(`SELECT read_at AS "readAt",version,changed,
        idempotency_conflict AS "idempotencyConflict"
      FROM public.record_staff_message_read($1,$2,$3,$4,$5)`,
    [id, command, commandFingerprint, randomUUID(), randomUUID()]);
    if (!recorded.rowCount) throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'This message is no longer available.');
    if (recorded.rows[0].idempotencyConflict) {
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This command ID was already used for different content.');
    }
    const readAt = z.date().parse(recorded.rows[0].readAt);
    return readReceiptSchema.parse({ messageId: id, readAt: readAt.toISOString() });
  });
}
