CREATE TABLE public.work_order_read_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.staff_users(id),
  action text NOT NULL CHECK (action = 'detail-read-prepared'),
  projection_revision smallint NOT NULL CHECK (projection_revision = 1),
  work_order_version integer NOT NULL CHECK (work_order_version > 0),
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organisation_id,site_id) REFERENCES public.sites(organisation_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id) REFERENCES public.work_orders(organisation_id,site_id,id)
);
CREATE INDEX work_order_read_events_site_time ON public.work_order_read_events(organisation_id,site_id,created_at DESC);
ALTER TABLE public.work_order_read_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_read_events FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_insert ON public.work_order_read_events FOR INSERT WITH CHECK (
  organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
  AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
  AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid
);
REVOKE ALL ON public.work_order_read_events FROM PUBLIC;
GRANT INSERT ON public.work_order_read_events TO vmms_runtime;

CREATE FUNCTION public.reject_work_order_read_event_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'work-order read audit events are immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_work_order_read_event_change() FROM PUBLIC;
CREATE TRIGGER work_order_read_events_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_read_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_read_event_change();
