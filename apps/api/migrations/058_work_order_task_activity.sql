CREATE TABLE public.work_order_task_activity (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  work_plan_revision_id uuid NOT NULL,
  assignment_revision integer NOT NULL CHECK (assignment_revision > 0),
  actor_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  actor_placement_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('acknowledgement','progress','request','comment')),
  progress_state text CHECK (progress_state IS NULL OR progress_state IN ('working','waiting','blocked')),
  request_type text CHECK (request_type IS NULL OR request_type IN ('help','parts','information','access','evidence')),
  note text NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 1500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((entry_type='request') = (request_type IS NOT NULL)),
  CHECK ((entry_type='progress') = (progress_state IS NOT NULL)),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,assignment_revision)
    REFERENCES public.work_order_task_assignment_revisions(organisation_id,site_id,work_order_id,task_id,assignment_revision),
  FOREIGN KEY (organisation_id,site_id,work_order_id,work_plan_revision_id,task_id)
    REFERENCES public.work_order_work_plan_revision_tasks(organisation_id,site_id,work_order_id,work_plan_revision_id,task_id),
  FOREIGN KEY (organisation_id,site_id,actor_placement_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id)
);

CREATE INDEX work_order_task_activity_history
  ON public.work_order_task_activity(organisation_id,site_id,work_order_id,task_id,created_at,id);
CREATE UNIQUE INDEX work_order_task_activity_ack_once
  ON public.work_order_task_activity(organisation_id,site_id,work_order_id,task_id,assignment_revision)
  WHERE entry_type='acknowledgement';

ALTER TABLE public.work_order_task_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_task_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_task_activity_scope
  ON public.work_order_task_activity
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON public.work_order_task_activity FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_task_activity TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.work_order_task_activity FROM vmms_runtime;

CREATE FUNCTION public.reject_work_order_task_activity_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'work-order task activity is immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_work_order_task_activity_change() FROM PUBLIC;
CREATE TRIGGER work_order_task_activity_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_task_activity
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_task_activity_change();

ALTER TABLE public.sensitive_read_events DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
  'work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared',
  'party-lookup-read-prepared','workforce-organogram-read-prepared','workforce-overview-read-prepared',
  'staff-messages-read-prepared','staff-account-requests-read-prepared','service-request-read-prepared',
  'vehicle-sales-history-read-prepared','work-order-task-activity-read-prepared'
));
