-- A work-order lead or supervisor must have active, write-enabled membership
-- at the target site. Keep the locked command check aligned with eligibility
-- projections so a read-only member cannot be offered or committed.
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
    AND q.valid_from<=clock_timestamp() AND (q.valid_until IS NULL OR q.valid_until>clock_timestamp())
    AND u.active AND m.active AND m.can_write
  FOR SHARE OF q,u,m;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END $$;

REVOKE ALL ON FUNCTION lock_work_order_assignment_qualification(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_work_order_assignment_qualification(uuid,text,text) TO vmms_runtime;
