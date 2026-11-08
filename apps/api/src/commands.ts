import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ZodType } from 'zod';
import { ApiError } from './errors.js';
import { type Database, scoped, type Scope, uuid } from './db.js';

export type CommandMutation = {
  aggregateId: string;
  aggregateType: string;
  version: number;
  previous: unknown;
  next: unknown;
  reason: string;
};

export type StaffCommand<T> = {
  scope: Scope;
  commandId: string;
  operation: string;
  targetAggregateId: string;
  payload: unknown;
  responseSchema: ZodType<T>;
  authorize: (client: PoolClient, membership: {canWrite:boolean}) => Promise<void>;
  apply: (client: PoolClient) => Promise<CommandMutation>;
  project: (client: PoolClient, mutation: CommandMutation) => Promise<T>;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function runStaffCommand<T>(pool: Database, command: StaffCommand<T>): Promise<T> {
  const commandId = uuid.parse(command.commandId);
  return scoped(pool,command.scope,async client => {
    // Lock current membership and evaluate domain authority before any replay.
    const current = await client.query('SELECT public.lock_membership($1,$2) AS can_write',[command.scope.actorId,command.scope.siteId]);
    const membership = (current.rows[0] as {can_write:boolean|null}|undefined)?.can_write;
    if (membership === undefined || membership === null) throw new ApiError(403,'SITE_FORBIDDEN','You do not have active access to this site.');
    await command.authorize(client,{canWrite:membership});
    const fingerprint = createHash('sha256').update(canonical({operation:command.operation,target:command.targetAggregateId,payload:command.payload})).digest('hex');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${command.scope.organisationId}:${command.scope.siteId}:${command.scope.actorId}:${commandId}`]);
    const previous = await client.query('SELECT fingerprint,response FROM command_receipts WHERE organisation_id=$1 AND site_id=$2 AND actor_id=$3 AND command_id=$4',[command.scope.organisationId,command.scope.siteId,command.scope.actorId,commandId]);
    if (previous.rows.length) {
      const receipt = previous.rows[0] as {fingerprint:string;response:unknown};
      if (receipt.fingerprint !== fingerprint) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','This command ID was already used for different content.');
      return command.responseSchema.parse(receipt.response);
    }

    const mutation = await command.apply(client);
    const eventId = randomUUID();
    await client.query(
      'INSERT INTO domain_events(id,organisation_id,site_id,aggregate_id,aggregate_type,aggregate_version,actor_id,event_type,reason,previous_state,new_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [eventId,command.scope.organisationId,command.scope.siteId,mutation.aggregateId,mutation.aggregateType,mutation.version,command.scope.actorId,command.operation,mutation.reason,JSON.stringify(mutation.previous),JSON.stringify(mutation.next)],
    );
    const response = command.responseSchema.parse(await command.project(client,mutation));
    await client.query(
      'INSERT INTO command_receipts(organisation_id,site_id,actor_id,command_id,fingerprint,response) VALUES($1,$2,$3,$4,$5,$6)',
      [command.scope.organisationId,command.scope.siteId,command.scope.actorId,commandId,fingerprint,JSON.stringify(response)],
    );
    await client.query(
      'INSERT INTO outbox(id,organisation_id,site_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(),command.scope.organisationId,command.scope.siteId,eventId,JSON.stringify({eventId,aggregateId:mutation.aggregateId,aggregateType:mutation.aggregateType,version:mutation.version,eventType:command.operation})],
    );
    return response;
  });
}
