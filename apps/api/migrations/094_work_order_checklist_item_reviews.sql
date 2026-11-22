CREATE TABLE public.work_order_checklist_item_reviews (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  checklist_id uuid NOT NULL,
  checklist_item_id uuid NOT NULL,
  outcome_revision_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  reviewer_placement_id uuid NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('record-confirmed','returned-for-correction')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1200),
  reviewed_at timestamptz NOT NULL,
  work_plan_revision_id uuid NOT NULL,
  assignment_revision integer NOT NULL CHECK (assignment_revision > 0),
  authority_snapshot jsonb NOT NULL CHECK (jsonb_typeof(authority_snapshot)='object'),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,outcome_revision_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,outcome_revision_id)
    REFERENCES public.work_order_checklist_item_revisions
      (organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,id),
  FOREIGN KEY (organisation_id,site_id,reviewer_placement_id,reviewer_user_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id,staff_user_id)
);

CREATE INDEX work_order_checklist_item_reviews_order_idx
  ON public.work_order_checklist_item_reviews(organisation_id,site_id,work_order_id,reviewed_at DESC,id DESC);

ALTER TABLE public.work_order_checklist_item_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_checklist_item_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_checklist_item_reviews_site_scope ON public.work_order_checklist_item_reviews
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON public.work_order_checklist_item_reviews FROM PUBLIC,vmms_runtime;
GRANT SELECT,INSERT ON public.work_order_checklist_item_reviews TO vmms_runtime;

CREATE OR REPLACE FUNCTION public.prevent_work_order_checklist_item_review_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'work-order checklist review decisions are append-only' USING ERRCODE='55000';
END
$$;
CREATE TRIGGER work_order_checklist_item_reviews_append_only
  BEFORE UPDATE OR DELETE ON public.work_order_checklist_item_reviews
  FOR EACH ROW EXECUTE FUNCTION public.prevent_work_order_checklist_item_review_change();

CREATE FUNCTION public.check_work_order_checklist_review_independence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE recorder uuid;
BEGIN
  SELECT outcome.actor_id INTO recorder FROM public.work_order_checklist_item_revisions outcome
  WHERE outcome.organisation_id=NEW.organisation_id AND outcome.site_id=NEW.site_id
    AND outcome.work_order_id=NEW.work_order_id AND outcome.checklist_id=NEW.checklist_id
    AND outcome.checklist_item_id=NEW.checklist_item_id AND outcome.id=NEW.outcome_revision_id;
  IF recorder IS NULL OR recorder=NEW.reviewer_user_id THEN
    RAISE EXCEPTION 'checklist review must be made by a different staff member' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.check_work_order_checklist_review_independence() FROM PUBLIC;
CREATE TRIGGER work_order_checklist_review_independence
  BEFORE INSERT ON public.work_order_checklist_item_reviews
  FOR EACH ROW EXECUTE FUNCTION public.check_work_order_checklist_review_independence();

CREATE OR REPLACE FUNCTION public.lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN (
    'work-order.assign-lead','work-order.handoff-supervisor','work-order.operations-review',
    'work-order.prepare-work-plan','work-order.prepare-scope-proposal','work-order.checklist.prepare',
    'work-order.record-payer-scope-response','work-order.task.review-response','work-order.hold.resolve',
    'work-order.checklist.item-review'
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

ALTER TABLE public.sensitive_read_events DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
  'work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared',
  'party-lookup-read-prepared','workforce-organogram-read-prepared','workforce-overview-read-prepared',
  'workforce-site-activity-read-prepared','staff-messages-read-prepared','staff-account-requests-read-prepared',
  'service-request-read-prepared','vehicle-sales-history-read-prepared','work-order-task-activity-read-prepared',
  'work-order-task-work-entries-read-prepared','work-order-task-work-evidence-options-read-prepared',
  'work-order-service-report-read-prepared','work-order-source-reports-read-prepared',
  'vehicle-learning-activity-read-prepared','vehicle-learning-review-queue-read-prepared',
  'vehicle-learning-library-read-prepared','finance-configuration-draft-read-prepared',
  'work-order-checklists-read-prepared','my-task-checklist-items-read',
  'work-order-checklist-outcomes-read-prepared','work-order-checklist-report-read-prepared',
  'work-order-scope-proposals-read-prepared','work-order-scope-payer-responses-read-prepared',
  'work-order-task-labor-read-prepared','work-order-task-review-queue-read-prepared',
  'work-order-diagnostic-review-queue-read-prepared','work-order-checklist-review-queue-read-prepared'
));
