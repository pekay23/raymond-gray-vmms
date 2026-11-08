import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { after, before, test } from 'node:test';
import { z } from 'zod';

loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
const ownerUrl=z.url().parse(process.env.MIGRATION_DATABASE_URL);
const databaseName=`vmms_migration_${process.pid}_${randomBytes(4).toString('hex')}`;
const owner=new pg.Pool({connectionString:ownerUrl});
const databaseUrl=new URL(ownerUrl);databaseUrl.pathname=`/${databaseName}`;
const organisationId=randomUUID(),siteId=randomUUID(),staffId=randomUUID(),customerId=randomUUID(),vehicleId=randomUUID(),visitId=randomUUID(),workOrderId=randomUUID(),eventId=randomUUID(),outboxId=randomUUID();
let database:pg.Pool|undefined;

before(async()=>{
  await owner.query("DO $role$ BEGIN CREATE ROLE vmms_runtime LOGIN PASSWORD 'vmms_runtime_local_development_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $role$");
  await owner.query(`CREATE DATABASE ${databaseName}`);
  database=new pg.Pool({connectionString:databaseUrl.toString()});
  const migrations=new URL('../migrations/',import.meta.url);
  const files=(await readdir(migrations)).filter(file=>file.endsWith('.sql')).sort();
  for(const file of files.filter(file=>file<'005_aggregate_event_ledger.sql')) await database.query(await readFile(new URL(file,migrations),'utf8'));

  await database.query('INSERT INTO organisations(id,name) VALUES($1,$2)',[organisationId,'Synthetic migration organisation']);
  await database.query('INSERT INTO sites(id,organisation_id,code,name) VALUES($1,$2,$3,$4)',[siteId,organisationId,'MIG','Migration fixture']);
  await database.query('INSERT INTO staff_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[staffId,'migration-fixture','Migration Fixture','synthetic-password-hash']);
  await database.query('INSERT INTO customers(id,organisation_id,name,phone,email) VALUES($1,$2,$3,$4,$5)',[customerId,organisationId,'Synthetic legacy customer','+233200000000','']);
  await database.query('INSERT INTO vehicles(id,organisation_id,customer_id,vin,registration,make,model) VALUES($1,$2,$3,$4,$5,$6,$7)',[vehicleId,organisationId,customerId,'WVWZZZ1JZXW000006','MIG-006','Synthetic','Fixture']);
  await database.query('INSERT INTO visits(id,organisation_id,site_id,vehicle_id) VALUES($1,$2,$3,$4)',[visitId,organisationId,siteId,vehicleId]);
  await database.query('INSERT INTO work_orders(id,organisation_id,site_id,visit_id,customer_id,vehicle_id,reference,odometer_km) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[workOrderId,organisationId,siteId,visitId,customerId,vehicleId,'RG-MIG-000001',123]);
  await database.query('INSERT INTO audit_events(id,organisation_id,site_id,work_order_id,actor_id,action,reason,previous_state,new_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[eventId,organisationId,siteId,workOrderId,staffId,'reception.draft-created','Synthetic legacy event','{}',JSON.stringify({version:1})]);
  await database.query('INSERT INTO outbox(id,organisation_id,site_id,work_order_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6)',[outboxId,organisationId,siteId,workOrderId,'reception.draft-created',JSON.stringify({workOrderId,version:1})]);
  await database.query(await readFile(new URL('005_aggregate_event_ledger.sql',migrations),'utf8'));
});

after(async()=>{
  await database?.end();
  await owner.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  await owner.end();
});

test('migration preserves legacy work-order event and outbox history with typed scope',async()=>{
  assert.ok(database);
  const root=await database.query('SELECT id,organisation_id,site_id,aggregate_type FROM aggregate_roots WHERE id=$1',[workOrderId]);
  assert.deepEqual(root.rows[0],{id:workOrderId,organisation_id:organisationId,site_id:siteId,aggregate_type:'work-order'});
  const event=await database.query('SELECT id,aggregate_id,aggregate_type,aggregate_version,event_type,reason,previous_state,new_state FROM domain_events WHERE id=$1',[eventId]);
  assert.deepEqual(event.rows[0],{id:eventId,aggregate_id:workOrderId,aggregate_type:'work-order',aggregate_version:1,event_type:'reception.draft-created',reason:'Synthetic legacy event',previous_state:{},new_state:{version:1}});
  const outbox=await database.query('SELECT id,organisation_id,site_id,event_id,payload FROM outbox WHERE id=$1',[outboxId]);
  assert.deepEqual(outbox.rows[0],{id:outboxId,organisation_id:organisationId,site_id:siteId,event_id:eventId,payload:{workOrderId,version:1}});
  assert.equal((await database.query("SELECT to_regclass('public.audit_events') AS legacy_table")).rows[0].legacy_table,null);
});
