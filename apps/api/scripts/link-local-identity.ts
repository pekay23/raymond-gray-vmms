import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';

loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
if (process.env.NODE_ENV==='production') throw new Error('Synthetic local identity linking cannot run in production.');
const issuer=z.url().parse(process.env.OIDC_ISSUER);
const subject=z.string().min(1).max(255).parse(process.env.OIDC_DEV_TEST_SUBJECT);
const databaseUrl=z.url().parse(process.env.MIGRATION_DATABASE_URL);
const pool=new pg.Pool({connectionString:databaseUrl});
try {
  await pool.query(
    'INSERT INTO staff_identities(issuer,subject,staff_user_id) SELECT $1,$2,id FROM staff_users WHERE id=$3 AND active ON CONFLICT(issuer,subject) DO UPDATE SET staff_user_id=excluded.staff_user_id',
    [issuer,subject,'10000000-0000-4000-8000-000000000003'],
  );
  const linked=await pool.query('SELECT 1 FROM staff_identities WHERE issuer=$1 AND subject=$2 AND staff_user_id=$3',[issuer,subject,'10000000-0000-4000-8000-000000000003']);
  if (!linked.rows.length) throw new Error('The synthetic VMMS staff account is missing or inactive. Run the development seed first.');
  process.stdout.write('Linked the synthetic shared identity to the development staff account.\n');
} finally {
  await pool.end();
}
