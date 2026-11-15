CREATE TABLE public.sensitive_read_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.staff_users(id),
  action text NOT NULL CHECK (action IN (
    'work-order-queue-read-prepared',
    'vehicle-lookup-read-prepared',
    'client-lookup-read-prepared',
    'party-lookup-read-prepared'
  )),
  projection_revision smallint NOT NULL CHECK (projection_revision = 1),
  result_count smallint NOT NULL CHECK (result_count BETWEEN 0 AND 100),
  request_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organisation_id,site_id) REFERENCES public.sites(organisation_id,id)
);

CREATE INDEX sensitive_read_events_site_time
  ON public.sensitive_read_events(organisation_id,site_id,created_at DESC);

ALTER TABLE public.sensitive_read_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensitive_read_events FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_insert ON public.sensitive_read_events FOR INSERT WITH CHECK (
  organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
  AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
  AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid
);

REVOKE ALL ON public.sensitive_read_events FROM PUBLIC;
GRANT INSERT (organisation_id,site_id,actor_id,action,projection_revision,result_count,request_id)
  ON public.sensitive_read_events TO vmms_runtime;

CREATE FUNCTION public.reject_sensitive_read_event_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'sensitive read audit events are immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_sensitive_read_event_change() FROM PUBLIC;
CREATE TRIGGER sensitive_read_events_immutable
  BEFORE UPDATE OR DELETE ON public.sensitive_read_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_sensitive_read_event_change();
