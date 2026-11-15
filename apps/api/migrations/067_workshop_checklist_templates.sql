CREATE TABLE public.workshop_checklist_template_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  template_code text NOT NULL CHECK (length(trim(template_code)) BETWEEN 1 AND 80),
  revision integer NOT NULL CHECK (revision > 0),
  kind text NOT NULL CHECK (kind IN ('pdi','routine-maintenance')),
  vehicle_make text NOT NULL CHECK (length(trim(vehicle_make)) BETWEEN 1 AND 100),
  vehicle_model text NOT NULL CHECK (length(trim(vehicle_model)) BETWEEN 1 AND 140),
  vehicle_variant text NOT NULL CHECK (length(trim(vehicle_variant)) BETWEEN 1 AND 140),
  powertrain text NOT NULL CHECK (length(trim(powertrain)) BETWEEN 1 AND 80),
  items jsonb NOT NULL CHECK (jsonb_typeof(items)='array' AND jsonb_array_length(items)>0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,template_code,revision),
  FOREIGN KEY (organisation_id,site_id) REFERENCES public.sites(organisation_id,id)
);

CREATE FUNCTION public.reject_workshop_checklist_template_revision_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'checklist template revisions are immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION public.reject_workshop_checklist_template_revision_mutation() FROM PUBLIC;
CREATE TRIGGER workshop_checklist_template_revision_immutable
  BEFORE UPDATE OR DELETE ON public.workshop_checklist_template_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_workshop_checklist_template_revision_mutation();

CREATE TABLE public.workshop_checklist_template_sources (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  template_revision_id uuid NOT NULL,
  source_revision_id uuid NOT NULL,
  PRIMARY KEY (organisation_id,site_id,template_revision_id,source_revision_id),
  FOREIGN KEY (organisation_id,site_id,template_revision_id)
    REFERENCES public.workshop_checklist_template_revisions(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,source_revision_id)
    REFERENCES public.controlled_document_revisions(organisation_id,site_id,id)
);

CREATE TABLE public.workshop_checklist_template_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  template_revision_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('sent-for-review','approved','effective','rejected','superseded')),
  decided_by uuid NOT NULL REFERENCES public.staff_users(id),
  grant_snapshot jsonb NOT NULL CHECK (jsonb_typeof(grant_snapshot)='object'),
  basis text NOT NULL CHECK (length(trim(basis)) BETWEEN 1 AND 1200),
  effective_from timestamptz,
  effective_until timestamptz,
  decided_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (organisation_id,site_id,template_revision_id)
    REFERENCES public.workshop_checklist_template_revisions(organisation_id,site_id,id),
  CHECK (effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until>effective_from)),
  CHECK (decision<>'effective' OR effective_from IS NOT NULL)
);

CREATE FUNCTION public.reject_workshop_checklist_template_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'checklist template provenance and decisions are immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION public.reject_workshop_checklist_template_history_mutation() FROM PUBLIC;
CREATE TRIGGER workshop_checklist_template_sources_immutable
  BEFORE UPDATE OR DELETE ON public.workshop_checklist_template_sources
  FOR EACH ROW EXECUTE FUNCTION public.reject_workshop_checklist_template_history_mutation();
CREATE TRIGGER workshop_checklist_template_decisions_immutable
  BEFORE UPDATE OR DELETE ON public.workshop_checklist_template_decisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_workshop_checklist_template_history_mutation();

CREATE FUNCTION public.guard_workshop_checklist_source_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.workshop_checklist_template_decisions d
    WHERE d.organisation_id=NEW.organisation_id AND d.site_id=NEW.site_id
      AND d.template_revision_id=NEW.template_revision_id
  ) THEN
    RAISE EXCEPTION 'checklist template sources are fixed when review begins' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.guard_workshop_checklist_source_insert() FROM PUBLIC;
CREATE TRIGGER workshop_checklist_template_source_review_guard
  BEFORE INSERT ON public.workshop_checklist_template_sources
  FOR EACH ROW EXECUTE FUNCTION public.guard_workshop_checklist_source_insert();

CREATE FUNCTION public.guard_effective_workshop_checklist_template()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.decision='effective' AND NOT EXISTS (
    SELECT 1
    FROM public.workshop_checklist_template_sources s
    JOIN public.controlled_document_revisions r
      ON r.organisation_id=s.organisation_id AND r.site_id=s.site_id AND r.id=s.source_revision_id
    WHERE s.organisation_id=NEW.organisation_id AND s.site_id=NEW.site_id
      AND s.template_revision_id=NEW.template_revision_id
      AND r.status='effective' AND r.effective_from<=NEW.effective_from
      AND (r.effective_until IS NULL OR r.effective_until>NEW.effective_from)
  ) THEN
    RAISE EXCEPTION 'effective checklist templates require a matching effective controlled source revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.guard_effective_workshop_checklist_template() FROM PUBLIC;
CREATE TRIGGER workshop_checklist_template_effective_source_guard
  BEFORE INSERT ON public.workshop_checklist_template_decisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_effective_workshop_checklist_template();

CREATE FUNCTION public.reject_effective_checklist_source_removal()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.workshop_checklist_template_decisions d
    WHERE d.organisation_id=OLD.organisation_id AND d.site_id=OLD.site_id
      AND d.template_revision_id=OLD.template_revision_id AND d.decision='effective'
      AND d.effective_from<=transaction_timestamp()
      AND (d.effective_until IS NULL OR d.effective_until>transaction_timestamp())
  ) THEN
    RAISE EXCEPTION 'source provenance for an effective checklist template cannot be removed' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END
$$;
REVOKE ALL ON FUNCTION public.reject_effective_checklist_source_removal() FROM PUBLIC;
CREATE TRIGGER workshop_checklist_template_source_effective_guard
  BEFORE DELETE ON public.workshop_checklist_template_sources
  FOR EACH ROW EXECUTE FUNCTION public.reject_effective_checklist_source_removal();

CREATE FUNCTION public.can_read_workshop_checklist_templates(requested_organisation uuid,requested_site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT requested_organisation=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND requested_site=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      JOIN public.staff_users u ON u.id=m.user_id AND u.active
      WHERE m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND m.site_id=requested_site AND m.active
    )
    AND EXISTS (
      SELECT 1 FROM public.staff_role_placements p
      JOIN public.staff_role_profiles r ON r.code=p.role_code AND r.active
      WHERE p.organisation_id=requested_organisation AND p.site_id=requested_site
        AND p.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND p.state='active'
    )
$$;
REVOKE ALL ON FUNCTION public.can_read_workshop_checklist_templates(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_workshop_checklist_templates(uuid,uuid) TO vmms_runtime;

ALTER TABLE public.workshop_checklist_template_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshop_checklist_template_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY workshop_checklist_template_staff_read ON public.workshop_checklist_template_revisions
  FOR SELECT USING (public.can_read_workshop_checklist_templates(organisation_id,site_id));
ALTER TABLE public.workshop_checklist_template_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshop_checklist_template_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY workshop_checklist_template_sources_staff_read ON public.workshop_checklist_template_sources
  FOR SELECT USING (public.can_read_workshop_checklist_templates(organisation_id,site_id));
ALTER TABLE public.workshop_checklist_template_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshop_checklist_template_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY workshop_checklist_template_decisions_staff_read ON public.workshop_checklist_template_decisions
  FOR SELECT USING (public.can_read_workshop_checklist_templates(organisation_id,site_id));
REVOKE ALL ON public.workshop_checklist_template_revisions,public.workshop_checklist_template_sources,public.workshop_checklist_template_decisions FROM PUBLIC,vmms_runtime;
GRANT SELECT ON public.workshop_checklist_template_revisions,public.workshop_checklist_template_sources,public.workshop_checklist_template_decisions TO vmms_runtime;
