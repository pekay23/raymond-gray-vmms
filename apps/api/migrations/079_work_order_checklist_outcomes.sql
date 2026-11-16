-- Checklist outcomes are operational records only when bound to the current
-- source, work-plan task, assignment and configured technical authority.
ALTER TABLE public.work_order_checklist_item_revisions
  ADD COLUMN task_id uuid,
  ADD COLUMN work_plan_revision_id uuid,
  ADD COLUMN assignment_revision integer,
  ADD COLUMN assignee_user_id uuid REFERENCES public.staff_users(id),
  ADD COLUMN assignee_placement_id uuid,
  ADD COLUMN applicability_reason text,
  ADD COLUMN supersedes_revision_id uuid,
  ADD COLUMN correction_reason text,
  ADD COLUMN authority_snapshot jsonb,
  ADD COLUMN qualification_snapshots jsonb;

CREATE UNIQUE INDEX work_order_checklist_item_revision_identity
  ON public.work_order_checklist_item_revisions(organisation_id,site_id,checklist_item_id,id);
CREATE UNIQUE INDEX work_order_checklist_outcome_parent_identity
  ON public.work_order_checklist_item_revisions(organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,id);

ALTER TABLE public.work_order_checklist_item_revisions
  ADD CONSTRAINT work_order_checklist_outcome_assignment_required CHECK (
    task_id IS NOT NULL AND work_plan_revision_id IS NOT NULL AND assignment_revision > 0
    AND assignee_user_id IS NOT NULL AND assignee_placement_id IS NOT NULL
    AND authority_snapshot IS NOT NULL AND jsonb_typeof(authority_snapshot)='object'
    AND qualification_snapshots IS NOT NULL AND jsonb_typeof(qualification_snapshots)='array'
  ) NOT VALID,
  ADD CONSTRAINT work_order_checklist_outcome_applicability_reason CHECK (
    (result='not-applicable' AND applicability_reason IS NOT NULL
      AND length(btrim(applicability_reason)) BETWEEN 1 AND 1200)
    OR (result<>'not-applicable' AND applicability_reason IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT work_order_checklist_outcome_correction CHECK (
    (supersedes_revision_id IS NULL AND correction_reason IS NULL)
    OR (supersedes_revision_id IS NOT NULL AND correction_reason IS NOT NULL
      AND length(btrim(correction_reason)) BETWEEN 1 AND 1200)
  ),
  ADD CONSTRAINT work_order_checklist_outcome_actor_identity_fk
    FOREIGN KEY (organisation_id,site_id,actor_placement_id,actor_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id,staff_user_id) NOT VALID,
  ADD CONSTRAINT work_order_checklist_outcome_assignee_placement_fk
    FOREIGN KEY (organisation_id,site_id,assignee_placement_id,assignee_user_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id,staff_user_id),
  ADD CONSTRAINT work_order_checklist_outcome_assignment_fk
    FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision)
    REFERENCES public.work_order_task_assignment_revisions(organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision),
  ADD CONSTRAINT work_order_checklist_outcome_plan_task_fk
    FOREIGN KEY (organisation_id,site_id,work_order_id,work_plan_revision_id,task_id)
    REFERENCES public.work_order_work_plan_revision_tasks(organisation_id,site_id,work_order_id,work_plan_revision_id,task_id),
  ADD CONSTRAINT work_order_checklist_outcome_supersedes_fk
    FOREIGN KEY (organisation_id,site_id,checklist_item_id,supersedes_revision_id)
    REFERENCES public.work_order_checklist_item_revisions(organisation_id,site_id,checklist_item_id,id);

ALTER TABLE public.work_order_task_assignment_revisions
  ADD CONSTRAINT work_order_task_assignment_actor_snapshot_key
  UNIQUE (organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,assignee_user_id,assignee_placement_id);
ALTER TABLE public.work_order_checklist_item_revisions
  ADD CONSTRAINT work_order_checklist_outcome_assignee_assignment_fk
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,assignee_user_id,assignee_placement_id)
  REFERENCES public.work_order_task_assignment_revisions
    (organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,assignee_user_id,assignee_placement_id);

CREATE UNIQUE INDEX work_order_checklist_item_one_correction
  ON public.work_order_checklist_item_revisions(organisation_id,site_id,checklist_item_id,supersedes_revision_id)
  WHERE supersedes_revision_id IS NOT NULL;

CREATE TABLE public.work_order_checklist_item_revision_evidence (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  checklist_id uuid NOT NULL,
  checklist_item_id uuid NOT NULL,
  outcome_revision_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  PRIMARY KEY (organisation_id,site_id,outcome_revision_id,evidence_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,outcome_revision_id)
    REFERENCES public.work_order_checklist_item_revisions
      (organisation_id,site_id,work_order_id,checklist_id,checklist_item_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,evidence_id)
    REFERENCES public.work_order_evidence_links(organisation_id,site_id,work_order_id,evidence_id)
);

ALTER TABLE public.work_order_checklist_item_revision_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_checklist_item_revision_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_checklist_item_revision_evidence_scope ON public.work_order_checklist_item_revision_evidence
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

CREATE OR REPLACE FUNCTION public.reject_work_order_checklist_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'checklist item snapshots and outcome history are immutable' USING ERRCODE='55000';
END
$$;

REVOKE ALL ON public.work_order_checklist_item_revision_evidence FROM PUBLIC,vmms_runtime;
GRANT SELECT,INSERT ON public.work_order_checklist_item_revision_evidence TO vmms_runtime;
GRANT INSERT ON public.work_order_checklist_item_revisions TO vmms_runtime;
GRANT UPDATE(version,updated_at) ON public.work_order_checklists TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.work_order_checklist_item_revisions,public.work_order_checklist_item_revision_evidence FROM vmms_runtime;

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
  'finance-configuration-draft-read-prepared',
  'work-order-task-labor-read-prepared','work-order-checklist-outcomes-read-prepared'
));
