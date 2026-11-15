CREATE TABLE work_order_lead_assignments (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  lead_user_id uuid NOT NULL REFERENCES staff_users(id),
  powertrain_class text NOT NULL CHECK (powertrain_class IN ('EV','HYB','ICE')),
  assigned_by uuid NOT NULL REFERENCES staff_users(id),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organisation_id,site_id,work_order_id) REFERENCES work_orders(organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,id)
);
CREATE INDEX work_order_lead_assignments_latest
  ON work_order_lead_assignments (organisation_id,site_id,work_order_id,created_at DESC,id DESC);
ALTER TABLE work_order_lead_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_lead_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_lead_assignments_scope ON work_order_lead_assignments
  USING (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id = nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id = nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON work_order_lead_assignments FROM PUBLIC;
GRANT SELECT, INSERT ON work_order_lead_assignments TO vmms_runtime;
REVOKE UPDATE, DELETE ON work_order_lead_assignments FROM vmms_runtime;
