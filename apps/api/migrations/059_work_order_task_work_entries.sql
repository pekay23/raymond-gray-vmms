ALTER TABLE public.staff_role_placements
  ADD CONSTRAINT staff_role_placements_actor_identity_key UNIQUE (organisation_id,site_id,id,staff_user_id);
ALTER TABLE public.work_order_task_assignment_revisions
  ADD CONSTRAINT work_order_task_assignment_plan_revision_key
  UNIQUE (organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision);

CREATE TABLE public.work_order_task_work_entries (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  work_plan_revision_id uuid NOT NULL,
  assignment_revision integer NOT NULL CHECK (assignment_revision > 0),
  actor_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  actor_placement_id uuid NOT NULL,
  entry_kind text NOT NULL CHECK (entry_kind IN ('finding','test','action','follow-up')),
  result text NOT NULL CHECK (result IN ('observed','reproduced','not-reproduced','inconclusive','done','partial','pending','blocked')),
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 160),
  detail text NOT NULL CHECK (length(btrim(detail)) BETWEEN 1 AND 4000),
  observed_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  supersedes_entry_id uuid,
  correction_reason text,
  CHECK (
    (entry_kind='finding' AND result IN ('observed','inconclusive')) OR
    (entry_kind='test' AND result IN ('reproduced','not-reproduced','inconclusive')) OR
    (entry_kind='action' AND result IN ('done','partial','blocked')) OR
    (entry_kind='follow-up' AND result IN ('pending','done','blocked'))
  ),
  CHECK ((supersedes_entry_id IS NULL) = (correction_reason IS NULL)),
  CHECK (correction_reason IS NULL OR length(btrim(correction_reason)) BETWEEN 1 AND 1000),
  UNIQUE (organisation_id,site_id,work_order_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,task_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision)
    REFERENCES public.work_order_task_assignment_revisions(organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision),
  FOREIGN KEY (organisation_id,site_id,work_order_id,work_plan_revision_id,task_id)
    REFERENCES public.work_order_work_plan_revision_tasks(organisation_id,site_id,work_order_id,work_plan_revision_id,task_id),
  FOREIGN KEY (organisation_id,site_id,actor_placement_id,actor_user_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id,staff_user_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,supersedes_entry_id)
    REFERENCES public.work_order_task_work_entries(organisation_id,site_id,work_order_id,task_id,id)
);

CREATE INDEX work_order_task_work_entries_history
  ON public.work_order_task_work_entries(organisation_id,site_id,work_order_id,recorded_at,id);
CREATE UNIQUE INDEX work_order_task_work_entries_one_correction
  ON public.work_order_task_work_entries(organisation_id,site_id,work_order_id,task_id,supersedes_entry_id)
  WHERE supersedes_entry_id IS NOT NULL;

CREATE TABLE public.work_order_task_work_entry_evidence (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  work_entry_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  PRIMARY KEY (organisation_id,site_id,work_entry_id,evidence_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,work_entry_id)
    REFERENCES public.work_order_task_work_entries(organisation_id,site_id,work_order_id,task_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,evidence_id)
    REFERENCES public.work_order_evidence_links(organisation_id,site_id,work_order_id,evidence_id)
);

ALTER TABLE public.work_order_task_work_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_task_work_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_task_work_entries_scope ON public.work_order_task_work_entries
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

ALTER TABLE public.work_order_task_work_entry_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_task_work_entry_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_task_work_entry_evidence_scope ON public.work_order_task_work_entry_evidence
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

CREATE FUNCTION public.reject_work_order_task_work_entry_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'work-order task work entries are immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_work_order_task_work_entry_change() FROM PUBLIC;
CREATE TRIGGER work_order_task_work_entries_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_task_work_entries
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_task_work_entry_change();
CREATE TRIGGER work_order_task_work_entry_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_task_work_entry_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_task_work_entry_change();

REVOKE ALL ON public.work_order_task_work_entries FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_task_work_entries TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.work_order_task_work_entries FROM vmms_runtime;
REVOKE ALL ON public.work_order_task_work_entry_evidence FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_task_work_entry_evidence TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.work_order_task_work_entry_evidence FROM vmms_runtime;

ALTER TABLE public.sensitive_read_events DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
  'work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared',
  'party-lookup-read-prepared','workforce-organogram-read-prepared','workforce-overview-read-prepared',
  'staff-messages-read-prepared','staff-account-requests-read-prepared','service-request-read-prepared',
  'vehicle-sales-history-read-prepared','work-order-task-activity-read-prepared','work-order-task-work-entries-read-prepared'
));
