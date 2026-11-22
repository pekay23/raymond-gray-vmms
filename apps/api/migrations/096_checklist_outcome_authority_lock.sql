CREATE OR REPLACE FUNCTION public.lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN (
    'work-order.assign-lead','work-order.handoff-supervisor','work-order.operations-review',
    'work-order.prepare-work-plan','work-order.prepare-scope-proposal','work-order.checklist.prepare',
    'work-order.record-payer-scope-response','work-order.task.review-response','work-order.hold.resolve',
    'work-order.checklist.item-review','work-order.checklist.item-outcome.record'
  ) THEN RAISE EXCEPTION 'Unsupported work-order capability'; END IF;
  SELECT grant_row.* INTO selected FROM public.staff_authority_grants grant_row
  WHERE grant_row.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND grant_row.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND grant_row.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND grant_row.capability=requested_capability AND grant_row.revoked_at IS NULL
    AND grant_row.valid_from<=clock_timestamp()
    AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp())
  ORDER BY grant_row.grant_revision DESC,grant_row.id LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END
$$;
REVOKE ALL ON FUNCTION public.lock_work_order_authority_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_work_order_authority_grant(text) TO vmms_runtime;