import { fileURLToPath } from 'node:url';
import { readFile,readdir } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';

loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
if (process.env.NODE_ENV==='production') throw new Error('Production migration requires a reviewed deployment procedure.');
const url=z.url().parse(process.env.MIGRATION_DATABASE_URL);
const pool=new pg.Pool({connectionString:url});
const client=await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtextextended('vmms-schema-migration',0))");
  const existing=await client.query("SELECT 1 FROM pg_roles WHERE rolname='vmms_runtime'");
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
