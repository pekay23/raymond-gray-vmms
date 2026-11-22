CREATE INDEX domain_events_site_activity
  ON public.domain_events(organisation_id,site_id,created_at DESC,id DESC);
