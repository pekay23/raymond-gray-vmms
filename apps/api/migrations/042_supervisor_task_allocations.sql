CREATE TABLE public.work_order_task_assignment_revisions (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  work_plan_revision_id uuid NOT NULL,
  assignment_revision integer NOT NULL CHECK (assignment_revision > 0),
  supervisor_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  supervisor_placement_id uuid NOT NULL,
  assignee_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  assignee_placement_id uuid NOT NULL,
  assigned_by uuid NOT NULL REFERENCES public.staff_users(id),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organisation_id,site_id,work_order_id,work_plan_revision_id,task_id)
    REFERENCES public.work_order_work_plan_revision_tasks(organisation_id,site_id,work_order_id,work_plan_revision_id,task_id),
  FOREIGN KEY (organisation_id,site_id,supervisor_placement_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,assignee_placement_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,task_id,assignment_revision),
  UNIQUE (organisation_id,site_id,work_order_id,id)
);

CREATE INDEX work_order_task_assignment_revisions_latest
  ON public.work_order_task_assignment_revisions
    (organisation_id,site_id,work_order_id,work_plan_revision_id,task_id,assignment_revision DESC);

ALTER TABLE public.work_order_task_assignment_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_task_assignment_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_task_assignment_revisions_scope
  ON public.work_order_task_assignment_revisions
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON public.work_order_task_assignment_revisions FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_task_assignment_revisions TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.work_order_task_assignment_revisions FROM vmms_runtime;

CREATE FUNCTION public.reject_work_order_task_assignment_revision_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'work-order task allocation history is immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_work_order_task_assignment_revision_change() FROM PUBLIC;
CREATE TRIGGER work_order_task_assignment_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_task_assignment_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_task_assignment_revision_change();
