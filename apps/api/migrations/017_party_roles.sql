-- A party is an organisation or person recorded in an explicit business role.
-- This registry does not imply that a payer, vehicle owner, and visit contact
-- are the same person or organisation.
CREATE TABLE parties (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations,
  party_kind text NOT NULL CHECK (party_kind IN ('person','organisation','unknown-legacy')),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,id)
);

ALTER TABLE visits ADD COLUMN visit_contact_party_id uuid;
ALTER TABLE visits ADD CONSTRAINT visits_contact_party_fk
  FOREIGN KEY (organisation_id,visit_contact_party_id)
  REFERENCES parties(organisation_id,id);

ALTER TABLE work_orders ADD COLUMN client_party_id uuid;
-- customer_id is a legacy catch-all field. New records use explicit party roles.
ALTER TABLE work_orders ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_client_party_fk
  FOREIGN KEY (organisation_id,client_party_id)
  REFERENCES parties(organisation_id,id);

-- An owner entered at intake is a reported identity, not verified ownership
-- and never grants owner-portal access. Later corrections are append-only.
CREATE TABLE vehicle_owner_observations (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  party_id uuid NOT NULL,
  assertion_state text NOT NULL DEFAULT 'reported' CHECK (assertion_state IN ('reported','verified','rejected','superseded')),
  supersedes_observation_id uuid,
  recorded_by uuid NOT NULL REFERENCES staff_users,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id) REFERENCES work_orders(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,vehicle_id) REFERENCES vehicles(organisation_id,id),
  FOREIGN KEY (organisation_id,party_id) REFERENCES parties(organisation_id,id),
  FOREIGN KEY (organisation_id,site_id,supersedes_observation_id)
    REFERENCES vehicle_owner_observations(organisation_id,site_id,id)
);

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_scope ON parties
  USING (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid);

ALTER TABLE vehicle_owner_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_owner_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY site_scope ON vehicle_owner_observations
  USING (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id = nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id = nullif(current_setting('app.site_id',true),'')::uuid);

GRANT SELECT,INSERT ON parties TO vmms_runtime;
GRANT SELECT,INSERT ON vehicle_owner_observations TO vmms_runtime;
