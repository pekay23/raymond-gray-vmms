-- Authority validity must be measured when the grant/qualification is locked,
-- not at transaction start. Commands can wait on aggregate roots before these
-- functions run, so transaction_timestamp() can predate a committed expiry.
CREATE OR REPLACE FUNCTION lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
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
    AND g.valid_from<=clock_timestamp() AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
  ORDER BY g.grant_revision DESC,g.id LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END $$;

CREATE OR REPLACE FUNCTION lock_work_order_assignment_qualification(target_user_id uuid,requested_code text,powertrain text) RETURNS jsonb
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
    AND q.valid_from<=clock_timestamp() AND (q.valid_until IS NULL OR q.valid_until>clock_timestamp()) AND u.active AND m.active
  FOR SHARE OF q,u,m;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END $$;

REVOKE ALL ON FUNCTION lock_work_order_authority_grant(text),lock_work_order_assignment_qualification(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_work_order_authority_grant(text),lock_work_order_assignment_qualification(uuid,text,text) TO vmms_runtime;
