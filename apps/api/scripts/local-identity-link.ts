import { z } from 'zod';
import type { Database } from '../src/db.js';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const linkedIdentitySchema = z.object({ staff_user_id: z.uuid() }).strict();

export function localIdentityLinkTargets(input: {
  nodeEnv: string | undefined;
  issuer: string | undefined;
  databaseUrl: string | undefined;
}) {
  if (input.nodeEnv === 'production') {
    throw new Error('Synthetic local identity linking cannot run in production.');
  }
  const issuer = new URL(z.url().parse(input.issuer));
  const databaseUrl = new URL(z.url().parse(input.databaseUrl));
  if (issuer.protocol !== 'http:' || !loopbackHosts.has(issuer.hostname)
    || issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new Error('Synthetic identity linking requires a plain loopback OIDC issuer.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !loopbackHosts.has(databaseUrl.hostname)) {
    throw new Error('Synthetic identity linking requires a loopback PostgreSQL database.');
  }
  return {
    issuer: issuer.toString().replace(/\/$/, ''),
    databaseUrl,
  };
}

/** Link only when the issuer/subject has no owner; never move an existing identity between staff. */
export async function linkLocalStaffIdentity(
  pool: Database,
  input: { issuer: string; subject: string; staffUserId: string },
) {
  await pool.query(
    `INSERT INTO staff_identities(issuer,subject,staff_user_id)
      SELECT $1,$2,id FROM staff_users WHERE id=$3 AND active
      ON CONFLICT(issuer,subject) DO NOTHING`,
    [input.issuer, input.subject, input.staffUserId],
  );
  const linked = await pool.query(
    `SELECT i.staff_user_id
      FROM staff_identities i
      JOIN staff_users u ON u.id=i.staff_user_id AND u.active
      WHERE i.issuer=$1 AND i.subject=$2`,
    [input.issuer, input.subject],
  );
  const mapping = linkedIdentitySchema.safeParse(linked.rows[0]);
  if (!mapping.success || mapping.data.staff_user_id !== input.staffUserId) {
    throw new Error('The local OIDC identity is not linked to the expected active VMMS account. No existing identity was changed.');
  }
}
