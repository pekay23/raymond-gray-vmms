CREATE TABLE public.work_order_scope_revisions (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  requested_kind text NOT NULL CHECK (requested_kind IN ('diagnosis','repair')),
  rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 1000),
  scope_digest text NOT NULL CHECK (scope_digest ~ '^[0-9a-f]{64}$'),
  source_work_order_version integer NOT NULL CHECK (source_work_order_version > 0),
  supersedes_revision_id uuid,
  prepared_by uuid NOT NULL REFERENCES public.staff_users(id),
  authority_decision jsonb NOT NULL CHECK (jsonb_typeof(authority_decision)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,revision),
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,supersedes_revision_id)
    REFERENCES public.work_order_scope_revisions(organisation_id,site_id,work_order_id,id)
);

CREATE TABLE public.work_order_scope_revision_tasks (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  scope_revision_id uuid NOT NULL,
  task_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  PRIMARY KEY (organisation_id,site_id,scope_revision_id,task_id),
  UNIQUE (organisation_id,site_id,scope_revision_id,ordinal),
  FOREIGN KEY (organisation_id,site_id,work_order_id,scope_revision_id)
    REFERENCES public.work_order_scope_revisions(organisation_id,site_id,work_order_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id)
    REFERENCES public.tasks(organisation_id,site_id,work_order_id,id)
);

CREATE INDEX work_order_scope_revisions_latest
  ON public.work_order_scope_revisions(organisation_id,site_id,work_order_id,revision DESC);

CREATE FUNCTION public.reject_work_order_scope_revision_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'work-order scope proposals are immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION public.reject_work_order_scope_revision_mutation() FROM PUBLIC;
CREATE TRIGGER work_order_scope_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_scope_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_scope_revision_mutation();
CREATE TRIGGER work_order_scope_revision_tasks_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_scope_revision_tasks
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_scope_revision_mutation();

ALTER TABLE public.work_order_scope_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_scope_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_scope_revisions_site_scope ON public.work_order_scope_revisions
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
ALTER TABLE public.work_order_scope_revision_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_scope_revision_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_scope_revision_tasks_site_scope ON public.work_order_scope_revision_tasks
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

REVOKE ALL ON public.work_order_scope_revisions,public.work_order_scope_revision_tasks FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_scope_revisions,public.work_order_scope_revision_tasks TO vmms_runtime;

CREATE OR REPLACE FUNCTION public.lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN (
    'work-order.assign-lead',
    'work-order.handoff-supervisor',
    'work-order.operations-review',
    'work-order.prepare-work-plan',
    'work-order.prepare-scope-proposal'
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
REVOKE ALL ON FUNCTION public.lock_work_order_authority_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_work_order_authority_grant(text) TO vmms_runtime;

ALTER TABLE public.sensitive_read_events DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
  'work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared',
  'party-lookup-read-prepared','workforce-organogram-read-prepared','workforce-overview-read-prepared',
  'staff-messages-read-prepared','staff-account-requests-read-prepared','service-request-read-prepared',
  'vehicle-sales-history-read-prepared','work-order-task-activity-read-prepared',
  'work-order-task-work-entries-read-prepared','work-order-task-work-evidence-options-read-prepared',
  'work-order-service-report-read-prepared','work-order-source-reports-read-prepared',
  'vehicle-learning-activity-read-prepared','work-order-checklists-read-prepared',
  'vehicle-learning-review-queue-read-prepared','vehicle-learning-library-read-prepared',
  'finance-configuration-draft-read-prepared','work-order-task-labor-read-prepared',
  'work-order-checklist-outcomes-read-prepared','work-order-scope-proposals-read-prepared'
));
