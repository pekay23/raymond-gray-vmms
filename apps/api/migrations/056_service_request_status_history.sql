CREATE TABLE public.service_request_status_history (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  request_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  previous_status text NOT NULL CHECK (previous_status IN ('open','closed')),
  next_status text NOT NULL CHECK (next_status IN ('open','closed')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  changed_by uuid NOT NULL REFERENCES public.staff_users(id),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,request_id,version),
  FOREIGN KEY (organisation_id,site_id,request_id)
    REFERENCES public.service_requests(organisation_id,site_id,id),
  CHECK (previous_status <> next_status)
);

ALTER TABLE public.service_request_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY service_request_status_history_scope ON public.service_request_status_history
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
REVOKE ALL ON public.service_request_status_history FROM PUBLIC;
GRANT SELECT,INSERT ON public.service_request_status_history TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.service_request_status_history FROM vmms_runtime;

CREATE FUNCTION public.reject_service_request_status_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'service request status history is immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_service_request_status_history_change() FROM PUBLIC;
CREATE TRIGGER service_request_status_history_immutable BEFORE UPDATE OR DELETE ON public.service_request_status_history
  FOR EACH ROW EXECUTE FUNCTION public.reject_service_request_status_history_change();
