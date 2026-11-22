import { fileURLToPath } from 'node:url';
import { readFile,readdir } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';

loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
const migrationTarget=process.env.VMMS_MIGRATION_TARGET??'non-production';
if (process.env.NODE_ENV==='production' && migrationTarget!=='production') throw new Error('Production migration requires VMMS_MIGRATION_TARGET=production after review.');
if (migrationTarget==='production' && process.env.NODE_ENV!=='production') throw new Error('Production migrations require NODE_ENV=production.');
if (!['non-production','production'].includes(migrationTarget)) throw new Error('VMMS_MIGRATION_TARGET must be non-production or production.');
const url=z.url().parse(process.env.MIGRATION_DATABASE_URL);
if (migrationTarget==='production') {
  const target=new URL(url);
  if (target.hostname.includes('-pooler') || !target.hostname.endsWith('.neon.tech')) throw new Error('Production migrations require a direct Neon connection.');
  if (decodeURIComponent(target.pathname.slice(1))!=='raymond_gray_vmms') throw new Error('Production migrations must target the raymond_gray_vmms database.');
  if (process.env.VMMS_MIGRATION_BRANCH_ID!=='br-ancient-fire-bjnkcr4r') throw new Error('Production migrations must target the reviewed VMMS Production branch.');
}
const pool=new pg.Pool({connectionString:url});
const client=await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtextextended('vmms-schema-migration',0))");
  const existing=await client.query("SELECT rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname='vmms_runtime'");
  if (!existing.rows.length && migrationTarget==='production') throw new Error('Provision the least-privilege vmms_runtime role before production migrations.');
  if (existing.rows.length && (existing.rows[0].rolsuper || existing.rows[0].rolbypassrls || !existing.rows[0].rolcanlogin)) throw new Error('vmms_runtime must be a login role without superuser or row-level-security bypass privileges.');
  if (!existing.rows.length) await client.query("CREATE ROLE vmms_runtime LOGIN PASSWORD 'vmms_runtime_local_development_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
  const directory=new URL('../migrations/',import.meta.url);
  for (const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()) {
    if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rows.length) continue;
    const sql=await readFile(new URL(name,directory),'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
      await client.query('COMMIT');
      process.stdout.write(`Applied ${name}\n`);
    } catch(error) {await client.query('ROLLBACK');throw error;}
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtextextended('vmms-schema-migration',0))");
  client.release();await pool.end();
}
