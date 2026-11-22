ALTER TABLE public.holds
  ADD CONSTRAINT holds_scope_work_order_id_unique UNIQUE (organisation_id,site_id,work_order_id,id);

CREATE TABLE public.work_order_hold_resolutions (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  hold_id uuid NOT NULL,
  resolved_by uuid NOT NULL REFERENCES public.staff_users(id),
  resolved_at timestamptz NOT NULL,
  resolution text NOT NULL CHECK (length(trim(resolution)) BETWEEN 1 AND 4000),
  authority_decision jsonb NOT NULL,
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,hold_id)
    REFERENCES public.holds(organisation_id,site_id,work_order_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,hold_id),
  UNIQUE (organisation_id,site_id,id),
  CHECK (jsonb_typeof(authority_decision->'grant')='object'
     AND jsonb_typeof(authority_decision->'qualification')='object'
     AND jsonb_typeof(authority_decision->'assignment')='object'
     AND jsonb_typeof(authority_decision->'decidedAt')='string')
);

CREATE INDEX work_order_hold_resolutions_order_idx
  ON public.work_order_hold_resolutions(organisation_id,site_id,work_order_id,resolved_at,id);
ALTER TABLE public.work_order_hold_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_hold_resolutions FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_hold_resolutions_site_scope ON public.work_order_hold_resolutions
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON public.work_order_hold_resolutions FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_hold_resolutions TO vmms_runtime;

CREATE TABLE public.work_order_hold_resolution_evidence (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  resolution_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  PRIMARY KEY (organisation_id,site_id,resolution_id,evidence_id),
  FOREIGN KEY (organisation_id,site_id,resolution_id)
    REFERENCES public.work_order_hold_resolutions(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,evidence_id)
    REFERENCES public.work_order_evidence_links(organisation_id,site_id,work_order_id,evidence_id)
);
ALTER TABLE public.work_order_hold_resolution_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_hold_resolution_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_hold_resolution_evidence_site_scope ON public.work_order_hold_resolution_evidence
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON public.work_order_hold_resolution_evidence FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_hold_resolution_evidence TO vmms_runtime;

CREATE FUNCTION public.prevent_work_order_hold_resolution_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'work-order hold resolutions are append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER work_order_hold_resolutions_append_only
  BEFORE UPDATE OR DELETE ON public.work_order_hold_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_work_order_hold_resolution_change();
CREATE TRIGGER work_order_hold_resolution_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.work_order_hold_resolution_evidence
  FOR EACH ROW EXECUTE FUNCTION public.prevent_work_order_hold_resolution_change();

CREATE OR REPLACE FUNCTION public.lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN (
    'work-order.assign-lead','work-order.handoff-supervisor','work-order.operations-review',
    'work-order.prepare-work-plan','work-order.prepare-scope-proposal','work-order.checklist.prepare',
    'work-order.record-payer-scope-response','work-order.task.review-response','work-order.hold.resolve'
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
END $$;
REVOKE ALL ON FUNCTION public.lock_work_order_authority_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_work_order_authority_grant(text) TO vmms_runtime;
