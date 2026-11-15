CREATE TABLE work_order_work_plan_revisions (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  lead_assignment_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  created_work_order_version integer NOT NULL CHECK (created_work_order_version > 0),
  planned_by uuid NOT NULL REFERENCES staff_users(id),
  rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 1000),
  authority_decision jsonb NOT NULL CHECK (public.valid_assignment_authority_decision(authority_decision)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organisation_id,site_id,work_order_id) REFERENCES work_orders(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,lead_assignment_id)
    REFERENCES work_order_lead_assignments(organisation_id,site_id,work_order_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,revision_number),
  UNIQUE (organisation_id,site_id,work_order_id,id)
);

CREATE INDEX work_order_work_plan_revisions_latest
  ON work_order_work_plan_revisions (organisation_id,site_id,work_order_id,revision_number DESC);

ALTER TABLE work_order_work_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_work_plan_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_work_plan_revisions_scope ON work_order_work_plan_revisions
  USING (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id = nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id = nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON work_order_work_plan_revisions FROM PUBLIC;
GRANT SELECT, INSERT ON work_order_work_plan_revisions TO vmms_runtime;
REVOKE UPDATE, DELETE ON work_order_work_plan_revisions FROM vmms_runtime;

CREATE TABLE work_order_work_plan_revision_tasks (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  work_plan_revision_id uuid NOT NULL,
  task_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  PRIMARY KEY (organisation_id,site_id,work_order_id,work_plan_revision_id,line_number),
  UNIQUE (organisation_id,site_id,work_order_id,work_plan_revision_id,task_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,work_plan_revision_id)
    REFERENCES work_order_work_plan_revisions(organisation_id,site_id,work_order_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id)
    REFERENCES tasks(organisation_id,site_id,work_order_id,id)
);

ALTER TABLE work_order_work_plan_revision_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_work_plan_revision_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_work_plan_revision_tasks_scope ON work_order_work_plan_revision_tasks
  USING (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id = nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id = nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON work_order_work_plan_revision_tasks FROM PUBLIC;
GRANT SELECT, INSERT ON work_order_work_plan_revision_tasks TO vmms_runtime;
REVOKE UPDATE, DELETE ON work_order_work_plan_revision_tasks FROM vmms_runtime;

ALTER TABLE work_order_supervisor_handoffs
  ADD COLUMN work_plan_revision_id uuid,
  ADD COLUMN work_order_version integer;
ALTER TABLE work_order_supervisor_handoffs
  ADD FOREIGN KEY (organisation_id,site_id,work_order_id,work_plan_revision_id)
  REFERENCES work_order_work_plan_revisions(organisation_id,site_id,work_order_id,id);
ALTER TABLE work_order_supervisor_handoffs
  ADD CONSTRAINT supervisor_handoff_plan_required
  CHECK (work_plan_revision_id IS NOT NULL AND work_order_version IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN (
    'work-order.assign-lead',
    'work-order.handoff-supervisor',
    'work-order.operations-review',
    'work-order.prepare-work-plan'
  ) THEN
    RAISE EXCEPTION 'Unsupported work-order capability';
  END IF;
  SELECT g.* INTO selected FROM public.staff_authority_grants g
  WHERE g.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND g.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND g.capability=requested_capability AND g.revoked_at IS NULL
    AND g.valid_from<=clock_timestamp() AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
  ORDER BY g.grant_revision DESC,g.id LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END $$;
