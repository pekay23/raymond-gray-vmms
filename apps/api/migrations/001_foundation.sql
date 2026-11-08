CREATE TABLE organisations (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE sites (id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations, code text NOT NULL, name text NOT NULL, UNIQUE (organisation_id,id), UNIQUE (organisation_id,code));
CREATE TABLE staff_users (id uuid PRIMARY KEY, username text NOT NULL UNIQUE, display_name text NOT NULL, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE memberships (user_id uuid NOT NULL REFERENCES staff_users, site_id uuid NOT NULL REFERENCES sites, can_write boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, PRIMARY KEY (user_id,site_id));
CREATE TABLE staff_sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES staff_users, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX staff_sessions_expiry ON staff_sessions(expires_at);
CREATE TABLE login_attempts (bucket text PRIMARY KEY, failures integer NOT NULL, window_start timestamptz NOT NULL);
CREATE TABLE customers (id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations, name text NOT NULL, phone text NOT NULL, email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organisation_id,id));
CREATE TABLE vehicles (id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES organisations, customer_id uuid NOT NULL, vin text NOT NULL CHECK(vin ~ '^[A-HJ-NPR-Z0-9]{17}$'), registration text NOT NULL, make text NOT NULL, model text NOT NULL, UNIQUE(organisation_id,id), UNIQUE(organisation_id,vin), FOREIGN KEY(organisation_id,customer_id) REFERENCES customers(organisation_id,id));
CREATE TABLE visits (id uuid PRIMARY KEY, organisation_id uuid NOT NULL, site_id uuid NOT NULL, vehicle_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organisation_id,site_id,id), FOREIGN KEY(organisation_id,site_id) REFERENCES sites(organisation_id,id), FOREIGN KEY(organisation_id,vehicle_id) REFERENCES vehicles(organisation_id,id));
CREATE SEQUENCE work_order_reference_seq;
CREATE TABLE work_orders (id uuid PRIMARY KEY, organisation_id uuid NOT NULL, site_id uuid NOT NULL, visit_id uuid NOT NULL UNIQUE, customer_id uuid NOT NULL, vehicle_id uuid NOT NULL, reference text NOT NULL UNIQUE, version integer NOT NULL DEFAULT 1 CHECK(version>0), odometer_km integer NOT NULL CHECK(odometer_km>=0), soc_percent integer CHECK(soc_percent BETWEEN 0 AND 100), status text NOT NULL DEFAULT 'intakeDraft' CHECK(status='intakeDraft'), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organisation_id,site_id,id), FOREIGN KEY(organisation_id,site_id,visit_id) REFERENCES visits(organisation_id,site_id,id), FOREIGN KEY(organisation_id,customer_id) REFERENCES customers(organisation_id,id), FOREIGN KEY(organisation_id,vehicle_id) REFERENCES vehicles(organisation_id,id));
CREATE INDEX work_order_site_created ON work_orders(site_id,created_at DESC);
CREATE TABLE complaints (id uuid PRIMARY KEY, organisation_id uuid NOT NULL, site_id uuid NOT NULL, work_order_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal>0), wording text NOT NULL CHECK(length(wording)>0), UNIQUE(work_order_id,ordinal), UNIQUE(organisation_id,site_id,work_order_id,id), FOREIGN KEY(organisation_id,site_id,work_order_id) REFERENCES work_orders(organisation_id,site_id,id));
CREATE TABLE tasks (id uuid PRIMARY KEY, organisation_id uuid NOT NULL, site_id uuid NOT NULL, work_order_id uuid NOT NULL, complaint_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal>0), title text NOT NULL CHECK(length(title)>0), state text NOT NULL DEFAULT 'planned' CHECK(state='planned'), UNIQUE(work_order_id,ordinal), UNIQUE(organisation_id,site_id,work_order_id,id), FOREIGN KEY(organisation_id,site_id,work_order_id) REFERENCES work_orders(organisation_id,site_id,id), FOREIGN KEY(organisation_id,site_id,work_order_id,complaint_id) REFERENCES complaints(organisation_id,site_id,work_order_id,id));
CREATE TABLE holds (id uuid PRIMARY KEY, organisation_id uuid NOT NULL, site_id uuid NOT NULL, work_order_id uuid NOT NULL, task_id uuid, category text NOT NULL CHECK(category IN ('safety','approval','parts','equipment','competency','other')), severity text NOT NULL CHECK(severity IN ('stop','warning')), reason text NOT NULL CHECK(length(reason)>0), source text NOT NULL CHECK(length(source)>0), owner_id uuid NOT NULL REFERENCES staff_users, opened_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organisation_id,site_id,work_order_id) REFERENCES work_orders(organisation_id,site_id,id), FOREIGN KEY(organisation_id,site_id,work_order_id,task_id) REFERENCES tasks(organisation_id,site_id,work_order_id,id));
CREATE TABLE audit_events (id uuid PRIMARY KEY, organisation_id uuid NOT NULL, site_id uuid NOT NULL, work_order_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES staff_users, action text NOT NULL, reason text NOT NULL, previous_state jsonb NOT NULL, new_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organisation_id,site_id,work_order_id) REFERENCES work_orders(organisation_id,site_id,id));
CREATE TABLE command_receipts (organisation_id uuid NOT NULL, site_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES staff_users, command_id uuid NOT NULL, fingerprint text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organisation_id,site_id,actor_id,command_id), FOREIGN KEY(organisation_id,site_id) REFERENCES sites(organisation_id,id));
CREATE TABLE outbox (id uuid PRIMARY KEY, organisation_id uuid NOT NULL, site_id uuid NOT NULL, work_order_id uuid NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organisation_id,site_id,work_order_id) REFERENCES work_orders(organisation_id,site_id,id));

DO $body$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['customers','vehicles'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY organisation_scope ON %I USING (organisation_id = nullif(current_setting(''app.organisation_id'',true),'''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.organisation_id'',true),'''')::uuid)',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['visits','work_orders','complaints','tasks','holds','audit_events','command_receipts','outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY site_scope ON %I USING (organisation_id = nullif(current_setting(''app.organisation_id'',true),'''')::uuid AND site_id = nullif(current_setting(''app.site_id'',true),'''')::uuid) WITH CHECK (organisation_id = nullif(current_setting(''app.organisation_id'',true),'''')::uuid AND site_id = nullif(current_setting(''app.site_id'',true),'''')::uuid)',table_name);
  END LOOP;
END $body$;

GRANT USAGE ON SCHEMA public TO vmms_runtime;
GRANT SELECT ON organisations,sites,staff_users,memberships TO vmms_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON staff_sessions,login_attempts TO vmms_runtime;
GRANT SELECT,INSERT ON customers,vehicles,visits,complaints,tasks,holds,audit_events,command_receipts,outbox TO vmms_runtime;
GRANT SELECT,INSERT,UPDATE ON work_orders TO vmms_runtime;
GRANT USAGE ON SEQUENCE work_order_reference_seq TO vmms_runtime;
