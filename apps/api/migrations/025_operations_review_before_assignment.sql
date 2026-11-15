CREATE TABLE work_order_operations_reviews (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  reviewed_by uuid NOT NULL REFERENCES staff_users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  reviewed_work_order_version integer NOT NULL CHECK (reviewed_work_order_version > 0),
  authority_decision jsonb NOT NULL,
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES work_orders(organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,reviewed_work_order_version)
);
CREATE INDEX work_order_operations_reviews_latest
  ON work_order_operations_reviews (organisation_id,site_id,work_order_id,reviewed_work_order_version DESC,id DESC);
ALTER TABLE work_order_operations_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_operations_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_operations_reviews_scope ON work_order_operations_reviews
  USING (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id = nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id = nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON work_order_operations_reviews FROM PUBLIC;
GRANT SELECT, INSERT ON work_order_operations_reviews TO vmms_runtime;
REVOKE UPDATE, DELETE ON work_order_operations_reviews FROM vmms_runtime;

CREATE FUNCTION valid_operations_review_authority_decision(decision jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT coalesce(jsonb_typeof(decision)='object'
    AND jsonb_typeof(decision->'grant'->'id')='string'
    AND jsonb_typeof(decision->'grant'->'grant_revision')='number'
    AND jsonb_typeof(decision->'decidedAt')='string',false)
$$;
ALTER TABLE work_order_operations_reviews ADD CONSTRAINT operations_review_authority_decision
  CHECK (public.valid_operations_review_authority_decision(authority_decision));

-- This shared lock only returns an active, site-scoped, named grant. It does
-- not mint or change grants and serializes the decision against revocation.
CREATE FUNCTION lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN (
    'work-order.assign-lead',
    'work-order.handoff-supervisor',
    'work-order.operations-review'
  ) THEN
    RAISE EXCEPTION 'Unsupported work-order capability';
  END IF;
  SELECT g.* INTO selected FROM public.staff_authority_grants g
  WHERE g.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND g.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND g.capability=requested_capability AND g.revoked_at IS NULL
    AND g.valid_from<=now() AND (g.valid_until IS NULL OR g.valid_until>now())
  ORDER BY g.grant_revision DESC,g.id LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END $$;
REVOKE ALL ON FUNCTION lock_work_order_authority_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_work_order_authority_grant(text) TO vmms_runtime;
DROP FUNCTION lock_work_order_assignment_grant(text);

ALTER TABLE work_order_lead_assignments ADD COLUMN operations_review_id uuid;
ALTER TABLE work_order_lead_assignments
  ADD CONSTRAINT lead_assignment_operations_review_fk
  FOREIGN KEY (organisation_id,site_id,work_order_id,operations_review_id)
  REFERENCES work_order_operations_reviews(organisation_id,site_id,work_order_id,id);
ALTER TABLE work_order_lead_assignments
  ADD CONSTRAINT new_lead_assignments_require_operations_review
  CHECK (operations_review_id IS NOT NULL) NOT VALID;
