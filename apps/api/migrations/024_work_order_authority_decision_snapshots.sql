-- Historical rows retain unknown authority. New commands must save their decision.
ALTER TABLE work_order_lead_assignments ADD COLUMN authority_decision jsonb;
ALTER TABLE work_order_supervisor_handoffs ADD COLUMN authority_decision jsonb;
ALTER TABLE work_order_supervisor_handoffs ADD COLUMN lead_assignment_id uuid;
ALTER TABLE work_order_lead_assignments ADD UNIQUE (organisation_id,site_id,work_order_id,id);
ALTER TABLE work_order_supervisor_handoffs ADD FOREIGN KEY (organisation_id,site_id,work_order_id,lead_assignment_id)
  REFERENCES work_order_lead_assignments(organisation_id,site_id,work_order_id,id);

CREATE FUNCTION valid_assignment_authority_decision(decision jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT coalesce(jsonb_typeof(decision)='object'
    AND jsonb_typeof(decision->'grant'->'id')='string'
    AND jsonb_typeof(decision->'grant'->'grant_revision')='number'
    AND jsonb_typeof(decision->'qualification'->'id')='string'
    AND jsonb_typeof(decision->'qualification'->'qualification_revision')='number'
    AND jsonb_typeof(decision->'decidedAt')='string',false)
$$;
ALTER TABLE work_order_lead_assignments ADD CONSTRAINT lead_assignment_authority_decision
  CHECK (public.valid_assignment_authority_decision(authority_decision)) NOT VALID;
ALTER TABLE work_order_supervisor_handoffs ADD CONSTRAINT supervisor_handoff_authority_decision
  CHECK (lead_assignment_id IS NOT NULL AND public.valid_assignment_authority_decision(authority_decision)) NOT VALID;

-- Runtime cannot UPDATE the registries. These narrowly scoped functions acquire
-- share locks without granting it registry mutation privileges.
CREATE FUNCTION lock_work_order_assignment_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN ('work-order.assign-lead','work-order.handoff-supervisor') THEN
    RAISE EXCEPTION 'Unsupported assignment capability';
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

CREATE FUNCTION lock_work_order_assignment_qualification(target_user_id uuid,requested_code text,powertrain text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_qualifications;
BEGIN
  IF powertrain NOT IN ('EV','HYB','ICE') OR requested_code NOT IN (powertrain||'-TEAM-LEAD',powertrain||'-SUPERVISOR') THEN
    RAISE EXCEPTION 'Unsupported assignment qualification';
  END IF;
  SELECT q.* INTO selected FROM public.staff_qualifications q
  JOIN public.staff_users u ON u.id=q.staff_user_id
  JOIN public.memberships m ON m.user_id=u.id AND m.site_id=q.site_id
  WHERE q.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND q.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND q.staff_user_id=target_user_id AND q.qualification_code=requested_code
    AND q.state='accepted' AND q.powertrain_classes @> ARRAY[powertrain]::text[] AND q.restrictions='[]'::jsonb
    AND q.qualification_revision=(SELECT max(q2.qualification_revision) FROM public.staff_qualifications q2
      WHERE q2.organisation_id=q.organisation_id AND q2.site_id=q.site_id AND q2.staff_user_id=q.staff_user_id
        AND q2.qualification_code=q.qualification_code AND q2.state<>'pending')
    AND q.valid_from<=now() AND (q.valid_until IS NULL OR q.valid_until>now()) AND u.active AND m.active
  FOR SHARE OF q,u,m;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END $$;
REVOKE ALL ON FUNCTION lock_work_order_assignment_grant(text),lock_work_order_assignment_qualification(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_work_order_assignment_grant(text),lock_work_order_assignment_qualification(uuid,text,text) TO vmms_runtime;
