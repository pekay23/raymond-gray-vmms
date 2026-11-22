CREATE FUNCTION public.lock_work_order_checklist_qualification(requested_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_qualifications;
BEGIN
  IF requested_code !~ '^[A-Z0-9][A-Z0-9._-]{1,79}$' THEN
    RAISE EXCEPTION 'Unsupported checklist qualification code';
  END IF;
  SELECT qualification.* INTO selected FROM public.staff_qualifications qualification
  WHERE qualification.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND qualification.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND qualification.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND qualification.qualification_code=requested_code AND qualification.state='accepted'
    AND qualification.qualification_revision=(SELECT max(latest.qualification_revision)
      FROM public.staff_qualifications latest
      WHERE latest.organisation_id=qualification.organisation_id AND latest.site_id=qualification.site_id
        AND latest.staff_user_id=qualification.staff_user_id AND latest.qualification_code=qualification.qualification_code
        AND latest.state<>'pending')
    AND qualification.valid_from<=clock_timestamp()
    AND (qualification.valid_until IS NULL OR qualification.valid_until>clock_timestamp())
  FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END
$$;
REVOKE ALL ON FUNCTION public.lock_work_order_checklist_qualification(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_work_order_checklist_qualification(text) TO vmms_runtime;