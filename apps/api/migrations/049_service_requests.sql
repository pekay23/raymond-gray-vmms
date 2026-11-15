-- Service enquiries are separate from visits and never imply repair authority.
CREATE TABLE public.service_requests (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  aggregate_type text NOT NULL DEFAULT 'service-request' CHECK (aggregate_type='service-request'),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','closed')),
  source_channel text NOT NULL CHECK (length(trim(source_channel)) BETWEEN 1 AND 80),
  concern text NOT NULL CHECK (length(trim(concern)) BETWEEN 1 AND 4000),
  reported_contact text CHECK (length(reported_contact) <= 500),
  reported_vehicle text CHECK (length(reported_vehicle) <= 500),
  reported_client text CHECK (length(reported_client) <= 500),
  next_action text CHECK (length(next_action) <= 1000),
  callback_due_at timestamptz,
  assigned_to uuid REFERENCES public.staff_users(id),
  created_by uuid NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,id,aggregate_type)
    REFERENCES public.aggregate_roots(organisation_id,site_id,id,aggregate_type)
);

CREATE TABLE public.service_request_contact_entries (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  request_id uuid NOT NULL,
  recorded_by uuid NOT NULL REFERENCES public.staff_users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  channel text NOT NULL CHECK (length(trim(channel)) BETWEEN 1 AND 80),
  outcome text NOT NULL CHECK (outcome IN ('reached','no-answer','callback-requested','other')),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  corrects_entry_id uuid,
  UNIQUE (organisation_id,site_id,request_id,id),
  FOREIGN KEY (organisation_id,site_id,request_id)
    REFERENCES public.service_requests(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,request_id,corrects_entry_id)
    REFERENCES public.service_request_contact_entries(organisation_id,site_id,request_id,id),
  CHECK (corrects_entry_id IS NULL OR corrects_entry_id <> id)
);

CREATE INDEX service_requests_follow_up ON public.service_requests
  (organisation_id,site_id,callback_due_at,id) WHERE status='open';
CREATE INDEX service_request_contact_history ON public.service_request_contact_entries
  (organisation_id,site_id,request_id,recorded_at,id);

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY service_requests_scope ON public.service_requests
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
ALTER TABLE public.service_request_contact_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request_contact_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY service_request_contact_scope ON public.service_request_contact_entries
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON public.service_requests,public.service_request_contact_entries FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.service_requests TO vmms_runtime;
GRANT SELECT,INSERT ON public.service_request_contact_entries TO vmms_runtime;
REVOKE DELETE ON public.service_requests FROM vmms_runtime;
REVOKE UPDATE,DELETE ON public.service_request_contact_entries FROM vmms_runtime;
CREATE FUNCTION public.reject_service_request_contact_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'service request contact history is immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_service_request_contact_change() FROM PUBLIC;
CREATE TRIGGER service_request_contact_immutable BEFORE UPDATE OR DELETE ON public.service_request_contact_entries
  FOR EACH ROW EXECUTE FUNCTION public.reject_service_request_contact_change();
