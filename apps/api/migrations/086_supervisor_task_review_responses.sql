ALTER TABLE public.work_order_task_activity
  ADD COLUMN response_to_activity_id uuid,
  ADD COLUMN authority_snapshot jsonb,
  ADD CONSTRAINT work_order_task_activity_parent_identity
    UNIQUE (organisation_id,site_id,work_order_id,task_id,assignment_revision,id),
  ADD CONSTRAINT work_order_task_activity_actor_identity_fk
    FOREIGN KEY (organisation_id,site_id,actor_placement_id,actor_user_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id,staff_user_id),
  ADD CONSTRAINT work_order_task_activity_response_shape CHECK (
    (entry_type='review-response') = (response_to_activity_id IS NOT NULL)
    AND ((entry_type='review-response') = (authority_snapshot IS NOT NULL))
    AND (authority_snapshot IS NULL OR jsonb_typeof(authority_snapshot)='object')
    AND (entry_type<>'review-response' OR (progress_state IS NULL AND request_type IS NULL))
  ),
  ADD CONSTRAINT work_order_task_activity_response_parent_fk
    FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,assignment_revision,response_to_activity_id)
    REFERENCES public.work_order_task_activity
      (organisation_id,site_id,work_order_id,task_id,assignment_revision,id);

ALTER TABLE public.work_order_task_activity
  DROP CONSTRAINT work_order_task_activity_entry_type_check,
  ADD CONSTRAINT work_order_task_activity_entry_type_check
    CHECK (entry_type IN ('acknowledgement','progress','request','comment','review-response'));

CREATE UNIQUE INDEX work_order_task_activity_one_review_response
  ON public.work_order_task_activity(organisation_id,site_id,response_to_activity_id)
  WHERE entry_type='review-response';

CREATE FUNCTION public.check_work_order_task_review_response_parent()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE parent public.work_order_task_activity;
BEGIN
  IF NEW.entry_type<>'review-response' THEN RETURN NEW; END IF;
  SELECT activity.* INTO parent FROM public.work_order_task_activity activity
  WHERE activity.organisation_id=NEW.organisation_id AND activity.site_id=NEW.site_id
    AND activity.work_order_id=NEW.work_order_id AND activity.task_id=NEW.task_id
    AND activity.assignment_revision=NEW.assignment_revision AND activity.id=NEW.response_to_activity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review response request was not found' USING ERRCODE='23514';
  END IF;
  IF parent.entry_type<>'request' OR parent.request_type<>'supervisor-review' OR parent.actor_user_id=NEW.actor_user_id THEN
    RAISE EXCEPTION 'review response must refer to a current request from another worker'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_work_order_task_review_response_parent() FROM PUBLIC;
CREATE TRIGGER work_order_task_review_response_parent
  BEFORE INSERT ON public.work_order_task_activity
  FOR EACH ROW EXECUTE FUNCTION public.check_work_order_task_review_response_parent();

CREATE POLICY work_order_task_review_response_authority
  ON public.work_order_task_activity AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    entry_type<>'review-response'
    OR (
      actor_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
      AND EXISTS (
        SELECT 1 FROM public.staff_authority_grants grant_row
        WHERE grant_row.organisation_id=work_order_task_activity.organisation_id
          AND grant_row.site_id=work_order_task_activity.site_id
          AND grant_row.staff_user_id=work_order_task_activity.actor_user_id
          AND grant_row.id::text=work_order_task_activity.authority_snapshot->>'id'
          AND grant_row.grant_revision::text=work_order_task_activity.authority_snapshot->>'grant_revision'
          AND grant_row.capability='work-order.task.review-response'
          AND grant_row.revoked_at IS NULL AND grant_row.valid_from<=clock_timestamp()
          AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp())
      )
    )
  );

CREATE OR REPLACE FUNCTION public.lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN (
    'work-order.assign-lead',
    'work-order.handoff-supervisor',
    'work-order.operations-review',
    'work-order.prepare-work-plan',
    'work-order.prepare-scope-proposal',
    'work-order.checklist.prepare',
    'work-order.record-payer-scope-response',
    'work-order.task.review-response'
  ) THEN
    RAISE EXCEPTION 'Unsupported work-order capability';
  END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.lock_work_order_authority_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_work_order_authority_grant(text) TO vmms_runtime;

GRANT INSERT ON public.work_order_task_activity TO vmms_runtime;
