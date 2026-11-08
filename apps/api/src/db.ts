import pg from 'pg';
import type { PoolClient } from 'pg';
import { z } from 'zod';

export const uuid = z.uuid();
export const scopeSchema = z.object({ actorId: uuid, organisationId: uuid, siteId: uuid });
export type Scope = z.infer<typeof scopeSchema>;

export function makePool(connectionString: string) {
  return new pg.Pool({ connectionString, max: 12, connectionTimeoutMillis: 5000, statement_timeout: 10000, idle_in_transaction_session_timeout: 10000 });
}

export type Database = ReturnType<typeof makePool>;

export async function scoped<T>(pool: Database, scope: Scope, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.organisation_id',$1,true),set_config('app.site_id',$2,true),set_config('app.actor_id',$3,true)", [scope.organisationId, scope.siteId, scope.actorId]);
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
