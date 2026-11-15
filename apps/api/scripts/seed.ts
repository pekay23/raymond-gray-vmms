import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';

loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
if (process.env.NODE_ENV==='production') throw new Error('Synthetic development seed cannot run in production.');
const migrationUrl=new URL(z.url().parse(process.env.MIGRATION_DATABASE_URL));
if (!['localhost','127.0.0.1','::1'].includes(migrationUrl.hostname)) throw new Error('Synthetic development seed requires a loopback-only migration database.');
const pool=new pg.Pool({connectionString:migrationUrl.toString()});
try {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO organisations(id,name) VALUES('10000000-0000-4000-8000-000000000001','Raymond Gray development') ON CONFLICT(id) DO NOTHING");
    await client.query("INSERT INTO sites(id,organisation_id,code,name) VALUES('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','DEV','Development service centre') ON CONFLICT(id) DO NOTHING");
    await client.query("INSERT INTO sites(id,organisation_id,code,name) VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','QA','Synthetic QA centre') ON CONFLICT(id) DO NOTHING");
    await client.query("INSERT INTO staff_users(id,username,display_name,password_hash) VALUES('10000000-0000-4000-8000-000000000003','advisor','Development advisor',NULL) ON CONFLICT(id) DO NOTHING");
    await client.query("INSERT INTO memberships(user_id,site_id,can_write) VALUES('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',true) ON CONFLICT(user_id,site_id) DO NOTHING");
    await client.query("INSERT INTO memberships(user_id,site_id,can_write) VALUES('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',true) ON CONFLICT(user_id,site_id) DO NOTHING");
    for (const siteId of ['10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004']) {
      await client.query(`WITH placement AS (
        INSERT INTO public.staff_role_placements(organisation_id,site_id,staff_user_id,role_code,created_by,updated_by)
        VALUES('10000000-0000-4000-8000-000000000001',$1,'10000000-0000-4000-8000-000000000003','service-advisor','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003')
        ON CONFLICT(organisation_id,site_id,staff_user_id,role_code) WHERE state='active' DO NOTHING
        RETURNING id,organisation_id,site_id,staff_user_id,role_code,revision,state,created_by,created_at
      )
      INSERT INTO public.staff_role_placement_history(organisation_id,site_id,placement_id,revision,staff_user_id,role_code,state,changed_by,changed_at)
      SELECT organisation_id,site_id,id,revision,staff_user_id,role_code,state,created_by,created_at FROM placement`, [siteId]);
    }
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  process.stdout.write('Synthetic development staff account and sites DEV/QA are ready for an explicitly linked OIDC identity. No technical or financial grants were created.\n');
} finally {await pool.end();}
