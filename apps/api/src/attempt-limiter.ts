import { createHmac } from 'node:crypto';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { ApiError } from './errors.js';

const cleanupIntervalMs = 60 * 1000;
let lastCleanupAt = 0;

/** Persist a privacy-preserving, cross-instance attempt counter. */
export async function consumeAttempt(
  pool: Database,
  config: Config,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const bucket = createHmac('sha256', config.SESSION_SECRET).update(key).digest('hex');
  const result = await pool.query(
    `INSERT INTO login_attempts(bucket,failures,window_start) VALUES($1,1,now())
     ON CONFLICT(bucket) DO UPDATE SET
       failures=CASE WHEN login_attempts.window_start < now()-($2::int*interval '1 second') THEN 1 ELSE login_attempts.failures+1 END,
       window_start=CASE WHEN login_attempts.window_start < now()-($2::int*interval '1 second') THEN now() ELSE login_attempts.window_start END
     RETURNING failures`,
    [bucket, windowSeconds],
  );
  const failures = result.rows[0]?.failures;
  if (typeof failures !== 'number') throw new Error('Attempt counter did not return a count.');

  if (Date.now() - lastCleanupAt >= cleanupIntervalMs) {
    lastCleanupAt = Date.now();
    await pool.query(`DELETE FROM login_attempts WHERE bucket IN (
      SELECT bucket FROM login_attempts WHERE window_start < now()-interval '24 hours' ORDER BY window_start LIMIT 10000
    )`);
    await pool.query('SELECT public.cleanup_oidc_logout_state()');
  }

  if (failures > limit) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Wait before trying again.');
  }
}
