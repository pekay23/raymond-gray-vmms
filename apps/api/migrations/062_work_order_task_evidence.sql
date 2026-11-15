CREATE TABLE public.work_order_task_evidence_intents (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  upload_intent_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  work_plan_revision_id uuid NOT NULL,
  assignment_revision integer NOT NULL CHECK (assignment_revision > 0),
  created_by uuid NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organisation_id,site_id,upload_intent_id),
  UNIQUE (organisation_id,site_id,upload_intent_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,created_by),
  FOREIGN KEY (organisation_id,site_id,upload_intent_id)
    REFERENCES public.evidence_upload_intents(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision)
    REFERENCES public.work_order_task_assignment_revisions(organisation_id,site_id,work_order_id,task_id,work_plan_revision_id,assignment_revision),
  FOREIGN KEY (organisation_id,site_id,work_order_id,work_plan_revision_id,task_id)
    REFERENCES public.work_order_work_plan_revision_tasks(organisation_id,site_id,work_order_id,work_plan_revision_id,task_id)
);

CREATE TABLE public.work_order_task_evidence_links (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  upload_intent_id uuid NOT NULL,
  work_plan_revision_id uuid NOT NULL,
  assignment_revision integer NOT NULL CHECK (assignment_revision > 0),
  attached_by uuid NOT NULL REFERENCES public.staff_users(id),
  attached_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organisation_id,site_id,evidence_id),
  UNIQUE (organisation_id,site_id,work_order_id,task_id,evidence_id),
  FOREIGN KEY (organisation_id,site_id,evidence_id)
    REFERENCES public.evidence_records(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,upload_intent_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,attached_by)
    REFERENCES public.work_order_task_evidence_intents(organisation_id,site_id,upload_intent_id,work_order_id,task_id,work_plan_revision_id,assignment_revision,created_by),
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id)
);

CREATE TABLE public.work_order_task_work_entry_task_evidence (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  task_id uuid NOT NULL,
  work_entry_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  PRIMARY KEY (organisation_id,site_id,work_entry_id,evidence_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,work_entry_id)
    REFERENCES public.work_order_task_work_entries(organisation_id,site_id,work_order_id,task_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,task_id,evidence_id)
    REFERENCES public.work_order_task_evidence_links(organisation_id,site_id,work_order_id,task_id,evidence_id)
);

CREATE INDEX work_order_task_evidence_links_task_idx
  ON public.work_order_task_evidence_links(organisation_id,site_id,work_order_id,task_id,attached_at,evidence_id);

ALTER TABLE public.work_order_task_evidence_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_task_evidence_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_task_evidence_intents_scope ON public.work_order_task_evidence_intents
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
     AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
          AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid);

ALTER TABLE public.work_order_task_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_task_evidence_links FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_task_evidence_links_scope ON public.work_order_task_evidence_links
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

ALTER TABLE public.work_order_task_work_entry_task_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_task_work_entry_task_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_task_work_entry_task_evidence_scope ON public.work_order_task_work_entry_task_evidence
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

REVOKE ALL ON public.work_order_task_evidence_intents FROM PUBLIC;
GRANT SELECT ON public.work_order_task_evidence_intents TO vmms_runtime;
REVOKE ALL ON public.work_order_task_evidence_links FROM PUBLIC;
GRANT SELECT ON public.work_order_task_evidence_links TO vmms_runtime;
REVOKE ALL ON public.work_order_task_work_entry_task_evidence FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_task_work_entry_task_evidence TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.work_order_task_work_entry_task_evidence FROM vmms_runtime;

CREATE TRIGGER work_order_task_evidence_intents_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_task_evidence_intents
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_task_work_entry_change();
CREATE TRIGGER work_order_task_evidence_links_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_task_evidence_links
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_task_work_entry_change();
CREATE TRIGGER work_order_task_work_entry_task_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_task_work_entry_task_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_task_work_entry_change();

CREATE FUNCTION public.assert_current_task_evidence_assignment(
  p_work_order_id uuid,
  p_task_id uuid,
  p_work_plan_revision_id uuid,
  p_assignment_revision integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  scoped_organisation_id uuid := nullif(current_setting('app.organisation_id', true), '')::uuid;
  scoped_site_id uuid := nullif(current_setting('app.site_id', true), '')::uuid;
  scoped_actor_id uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
BEGIN
  IF scoped_organisation_id IS NULL OR scoped_site_id IS NULL OR scoped_actor_id IS NULL THEN
    RAISE EXCEPTION 'task evidence scope is required' USING ERRCODE = '42501';
  END IF;
  IF public.lock_membership(scoped_actor_id, scoped_site_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'writable site membership is required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.work_orders w
    WHERE w.organisation_id=scoped_organisation_id AND w.site_id=scoped_site_id AND w.id=p_work_order_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.work_orders w
  JOIN LATERAL (
    SELECT r.id FROM public.work_order_operations_reviews r
    WHERE r.organisation_id=w.organisation_id AND r.site_id=w.site_id AND r.work_order_id=w.id
    ORDER BY r.reviewed_work_order_version DESC,r.id DESC LIMIT 1
  ) review ON true
  JOIN LATERAL (
    SELECT a.id,a.operations_review_id FROM public.work_order_lead_assignments a
    WHERE a.organisation_id=w.organisation_id AND a.site_id=w.site_id AND a.work_order_id=w.id
    ORDER BY a.created_at DESC,a.id DESC LIMIT 1
  ) lead ON lead.operations_review_id=review.id
  JOIN LATERAL (
    SELECT p.id FROM public.work_order_work_plan_revisions p
    WHERE p.organisation_id=w.organisation_id AND p.site_id=w.site_id
      AND p.work_order_id=w.id AND p.lead_assignment_id=lead.id
    ORDER BY p.revision_number DESC,p.id DESC LIMIT 1
  ) plan ON plan.id=p_work_plan_revision_id
  JOIN LATERAL (
    SELECT h.work_plan_revision_id,h.work_order_version,h.supervisor_user_id
    FROM public.work_order_supervisor_handoffs h
    WHERE h.organisation_id=w.organisation_id AND h.site_id=w.site_id AND h.work_order_id=w.id
      AND h.lead_assignment_id=lead.id AND h.work_plan_revision_id=plan.id AND h.work_order_version<=w.version
      AND NOT EXISTS (
        SELECT 1 FROM public.domain_events event
        WHERE event.organisation_id=w.organisation_id AND event.site_id=w.site_id
          AND event.aggregate_id=w.id AND event.aggregate_version>h.work_order_version
          AND event.event_type<>'work-order.tasks-assigned'
      )
    ORDER BY h.created_at DESC,h.id DESC LIMIT 1
  ) handoff ON true
  JOIN LATERAL (
    SELECT revision.assignment_revision,revision.assignee_user_id,revision.assignee_placement_id
    FROM public.work_order_task_assignment_revisions revision
    WHERE revision.organisation_id=w.organisation_id AND revision.site_id=w.site_id
      AND revision.work_order_id=w.id AND revision.work_plan_revision_id=plan.id AND revision.task_id=p_task_id
    ORDER BY revision.assignment_revision DESC,revision.id DESC LIMIT 1
  ) assignment ON assignment.assignee_user_id=scoped_actor_id AND assignment.assignment_revision=p_assignment_revision
  JOIN public.staff_role_placements placement ON placement.organisation_id=w.organisation_id
    AND placement.site_id=w.site_id AND placement.id=assignment.assignee_placement_id
    AND placement.staff_user_id=assignment.assignee_user_id
    AND placement.role_code='technician-engineer-trainee' AND placement.state='active'
  JOIN public.staff_users actor ON actor.id=assignment.assignee_user_id AND actor.active
  JOIN public.memberships membership ON membership.user_id=actor.id AND membership.site_id=w.site_id
    AND membership.active AND membership.can_write
  WHERE w.organisation_id=scoped_organisation_id AND w.site_id=scoped_site_id
    AND w.id=p_work_order_id AND handoff.work_plan_revision_id=p_work_plan_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'current task assignment is unavailable' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION public.bind_work_order_task_evidence_intent(
  p_upload_intent_id uuid,
  p_work_order_id uuid,
  p_task_id uuid,
  p_work_plan_revision_id uuid,
  p_assignment_revision integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  scoped_organisation_id uuid := nullif(current_setting('app.organisation_id', true), '')::uuid;
  scoped_site_id uuid := nullif(current_setting('app.site_id', true), '')::uuid;
  scoped_actor_id uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  intent public.evidence_upload_intents%ROWTYPE;
BEGIN
  PERFORM public.assert_current_task_evidence_assignment(
    p_work_order_id,p_task_id,p_work_plan_revision_id,p_assignment_revision
  );
  SELECT * INTO intent FROM public.evidence_upload_intents i
    WHERE i.organisation_id=scoped_organisation_id AND i.site_id=scoped_site_id
      AND i.id=p_upload_intent_id AND i.created_by=scoped_actor_id
      AND i.purpose_kind='work-order' AND i.target_id=p_work_order_id
      AND i.state='issued' AND i.created_at=transaction_timestamp()
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'new task upload intent is unavailable' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.work_order_task_evidence_intents (
    organisation_id,site_id,upload_intent_id,work_order_id,task_id,work_plan_revision_id,
    assignment_revision,created_by
  ) VALUES (
    scoped_organisation_id,scoped_site_id,p_upload_intent_id,p_work_order_id,p_task_id,
    p_work_plan_revision_id,p_assignment_revision,scoped_actor_id
  );
END;
$$;

CREATE FUNCTION public.attach_work_order_task_evidence(
  p_work_order_id uuid,
  p_task_id uuid,
  p_work_plan_revision_id uuid,
  p_assignment_revision integer,
  p_evidence_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  scoped_organisation_id uuid := nullif(current_setting('app.organisation_id', true), '')::uuid;
  scoped_site_id uuid := nullif(current_setting('app.site_id', true), '')::uuid;
  scoped_actor_id uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  bound_intent_id uuid;
BEGIN
  PERFORM public.assert_current_task_evidence_assignment(
    p_work_order_id,p_task_id,p_work_plan_revision_id,p_assignment_revision
  );
  SELECT binding.upload_intent_id INTO bound_intent_id
  FROM public.evidence_records e
  JOIN public.work_order_task_evidence_intents binding
    ON binding.organisation_id=e.organisation_id AND binding.site_id=e.site_id
    AND binding.upload_intent_id=e.upload_intent_id AND binding.work_order_id=p_work_order_id
    AND binding.task_id=p_task_id AND binding.work_plan_revision_id=p_work_plan_revision_id
    AND binding.assignment_revision=p_assignment_revision AND binding.created_by=scoped_actor_id
  JOIN LATERAL (
    SELECT a.verdict,a.scanned_sha256 FROM public.evidence_scan_attempts a
    WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
    ORDER BY a.attempt_no DESC LIMIT 1
  ) latest ON true
  WHERE e.organisation_id=scoped_organisation_id AND e.site_id=scoped_site_id AND e.id=p_evidence_id
    AND e.purpose_kind='work-order' AND e.target_id=p_work_order_id AND e.created_by=scoped_actor_id
    AND e.scan_state='accepted' AND e.accepted_key IS NOT NULL
    AND latest.verdict='clean' AND latest.scanned_sha256=e.sha256
  FOR UPDATE OF e,binding;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accepted task evidence is unavailable for the current assignment' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.work_order_task_evidence_links (
    organisation_id,site_id,work_order_id,task_id,evidence_id,upload_intent_id,
    work_plan_revision_id,assignment_revision,attached_by
  ) VALUES (
    scoped_organisation_id,scoped_site_id,p_work_order_id,p_task_id,p_evidence_id,
    bound_intent_id,p_work_plan_revision_id,p_assignment_revision,scoped_actor_id
  );
END;
$$;

GRANT SELECT ON public.evidence_upload_intents,public.evidence_scan_attempts,
  public.evidence_records,public.work_orders,public.work_order_task_evidence_intents,
  public.work_order_operations_reviews,public.work_order_lead_assignments,
  public.work_order_work_plan_revisions,public.work_order_supervisor_handoffs,
  public.work_order_task_assignment_revisions,public.staff_role_placements,
  public.staff_users,public.memberships,public.domain_events TO CURRENT_USER;
GRANT UPDATE ON public.work_orders TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.assert_current_task_evidence_assignment(uuid,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bind_work_order_task_evidence_intent(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_work_order_task_evidence(uuid,uuid,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_work_order_task_evidence_intent(uuid,uuid,uuid,uuid,integer) TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.attach_work_order_task_evidence(uuid,uuid,uuid,integer,uuid) TO vmms_runtime;
