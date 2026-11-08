import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';

loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
if (process.env.NODE_ENV==='production') throw new Error('Synthetic development seed cannot run in production.');
const pool=new pg.Pool({connectionString:z.url().parse(process.env.MIGRATION_DATABASE_URL)});
try {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO organisations(id,name) VALUES('10000000-0000-4000-8000-000000000001','Raymond Gray development') ON CONFLICT(id) DO NOTHING");
    await client.query("INSERT INTO sites(id,organisation_id,code,name) VALUES('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','DEV','Development service centre') ON CONFLICT(id) DO NOTHING");
    await client.query("INSERT INTO staff_users(id,username,display_name,password_hash) VALUES('10000000-0000-4000-8000-000000000003','advisor','Development advisor',NULL) ON CONFLICT(id) DO NOTHING");
    await client.query("INSERT INTO memberships(user_id,site_id,can_write) VALUES('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',true) ON CONFLICT(user_id,site_id) DO NOTHING");
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  process.stdout.write('Synthetic development staff account and site DEV are ready for an explicitly linked OIDC identity. No technical or financial grants were created.\n');
} finally {await pool.end();}
