CREATE TABLE public.controlled_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  reference text NOT NULL CHECK (length(trim(reference)) BETWEEN 1 AND 80),
  created_by uuid NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,reference),
  FOREIGN KEY (organisation_id,site_id) REFERENCES public.sites(organisation_id,id)
);
CREATE UNIQUE INDEX controlled_documents_reference_ci
  ON public.controlled_documents(organisation_id,site_id,lower(reference));

CREATE TABLE public.controlled_document_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  document_id uuid NOT NULL,
  revision text NOT NULL CHECK (length(trim(revision)) BETWEEN 1 AND 80),
  alias text CHECK (alias IS NULL OR length(trim(alias)) BETWEEN 1 AND 120),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  document_owner text NOT NULL CHECK (length(trim(document_owner)) BETWEEN 1 AND 160),
  status text NOT NULL CHECK (status IN ('draft','review','approved','effective','superseded')),
  effective_from timestamptz,
  effective_until timestamptz,
  review_due_at timestamptz,
  evidence_id uuid,
  distribution text NOT NULL DEFAULT 'all-site-staff' CHECK (distribution='all-site-staff'),
  created_by uuid NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,document_id,revision),
  FOREIGN KEY (organisation_id,site_id,document_id)
    REFERENCES public.controlled_documents(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,evidence_id)
    REFERENCES public.evidence_records(organisation_id,site_id,id),
  CHECK (effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until>effective_from)),
  CHECK (status NOT IN ('approved','effective') OR evidence_id IS NOT NULL),
  CHECK (status<>'effective' OR effective_from IS NOT NULL)
);
CREATE UNIQUE INDEX controlled_document_one_open_effective_revision
  ON public.controlled_document_revisions(organisation_id,site_id,document_id)
  WHERE status='effective' AND effective_until IS NULL;
CREATE INDEX controlled_document_effective_catalog
  ON public.controlled_document_revisions(organisation_id,site_id,status,effective_from,effective_until,document_id);

CREATE FUNCTION public.can_read_controlled_documents(requested_organisation uuid,requested_site uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT requested_organisation=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND requested_site=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      JOIN public.staff_users u ON u.id=m.user_id AND u.active
      JOIN public.sites s ON s.id=m.site_id AND s.organisation_id=requested_organisation
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
REVOKE ALL ON FUNCTION public.can_read_controlled_documents(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_controlled_documents(uuid,uuid) TO vmms_runtime;

ALTER TABLE public.controlled_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controlled_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY controlled_documents_staff_read ON public.controlled_documents
  FOR SELECT USING (public.can_read_controlled_documents(organisation_id,site_id));
ALTER TABLE public.controlled_document_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controlled_document_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY controlled_document_revisions_staff_read ON public.controlled_document_revisions
  FOR SELECT USING (public.can_read_controlled_documents(organisation_id,site_id));
REVOKE ALL ON public.controlled_documents,public.controlled_document_revisions FROM PUBLIC,vmms_runtime;
GRANT SELECT ON public.controlled_documents,public.controlled_document_revisions TO vmms_runtime;

CREATE TABLE public.controlled_document_read_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  document_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.staff_users(id),
  action text NOT NULL CHECK (action IN ('catalog-read','file-download')),
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organisation_id,site_id,document_id)
    REFERENCES public.controlled_documents(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,revision_id)
    REFERENCES public.controlled_document_revisions(organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,request_id,revision_id,action)
);
CREATE INDEX controlled_document_read_events_site_time
  ON public.controlled_document_read_events(organisation_id,site_id,created_at DESC);
ALTER TABLE public.controlled_document_read_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.controlled_document_read_events FORCE ROW LEVEL SECURITY;
CREATE POLICY controlled_document_read_events_staff_insert ON public.controlled_document_read_events
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND public.can_read_controlled_documents(organisation_id,site_id)
  );
REVOKE ALL ON public.controlled_document_read_events FROM PUBLIC,vmms_runtime;
GRANT INSERT (organisation_id,site_id,document_id,revision_id,actor_id,action,request_id)
  ON public.controlled_document_read_events TO vmms_runtime;

CREATE FUNCTION public.reject_controlled_document_read_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'controlled document read events are immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION public.reject_controlled_document_read_event_mutation() FROM PUBLIC;
CREATE TRIGGER controlled_document_read_events_immutable
  BEFORE UPDATE OR DELETE ON public.controlled_document_read_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_controlled_document_read_event_mutation();
