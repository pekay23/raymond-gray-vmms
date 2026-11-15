CREATE TABLE public.work_order_task_labor_sessions (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  work_plan_revision_id uuid NOT NULL,
  assignment_revision integer NOT NULL CHECK (assignment_revision > 0),
  actor_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  actor_placement_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  stopped_at timestamptz,
  CHECK (stopped_at IS NULL OR stopped_at >= started_at),
  UNIQUE (organisation_id,site_id,work_order_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,work_plan_revision_id,task_id)
    REFERENCES public.work_order_work_plan_revision_tasks(organisation_id,site_id,work_order_id,work_plan_revision_id,task_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision)
    REFERENCES public.work_order_task_assignment_revisions(organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision),
  FOREIGN KEY (organisation_id,site_id,actor_placement_id,actor_user_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id,staff_user_id)
);

CREATE UNIQUE INDEX work_order_task_labor_one_open_per_actor_org
  ON public.work_order_task_labor_sessions(organisation_id,actor_user_id)
  WHERE stopped_at IS NULL;
CREATE INDEX work_order_task_labor_history
  ON public.work_order_task_labor_sessions(organisation_id,site_id,work_order_id,task_id,started_at,id);

ALTER TABLE public.work_order_task_labor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_task_labor_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_task_labor_sessions_scope ON public.work_order_task_labor_sessions
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

CREATE FUNCTION public.reject_work_order_task_labor_session_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE'
    AND OLD.stopped_at IS NULL
    AND NEW.stopped_at IS NOT NULL
    AND (to_jsonb(NEW)-'stopped_at')=(to_jsonb(OLD)-'stopped_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'work-order task labor sessions are immutable except for stopping once';
END $$;
REVOKE ALL ON FUNCTION public.reject_work_order_task_labor_session_rewrite() FROM PUBLIC;
CREATE TRIGGER work_order_task_labor_sessions_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_task_labor_sessions
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_task_labor_session_rewrite();

REVOKE ALL ON public.work_order_task_labor_sessions FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_task_labor_sessions TO vmms_runtime;
GRANT UPDATE (stopped_at) ON public.work_order_task_labor_sessions TO vmms_runtime;

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
  'work-order-task-labor-read-prepared'
));
