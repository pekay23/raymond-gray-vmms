ALTER TABLE public.vehicles ALTER COLUMN registration DROP NOT NULL;

INSERT INTO public.staff_role_profiles(code,label,description,assignable_by_head) VALUES
  ('sales-representative','Sales Representative','Records vehicle delivery facts and their source. This role does not establish current ownership or payment responsibility.',true),
  ('pdi-observer','PDI Observer','Records factual PDI observations from a supplied source. This role cannot approve safety or vehicle release.',true);

CREATE TABLE public.sales_deliveries (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  delivered_on date NOT NULL,
  registration_at_delivery text,
  purchaser_at_delivery_claim text,
  purchaser_source text,
  source_reference text,
  recorded_by uuid NOT NULL REFERENCES public.staff_users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id) REFERENCES public.sites(organisation_id,id),
  FOREIGN KEY (organisation_id,vehicle_id) REFERENCES public.vehicles(organisation_id,id),
  CHECK ((purchaser_at_delivery_claim IS NULL) = (purchaser_source IS NULL)),
  CHECK (purchaser_at_delivery_claim IS NULL OR length(trim(purchaser_at_delivery_claim)) BETWEEN 1 AND 240),
  CHECK (purchaser_source IS NULL OR length(trim(purchaser_source)) BETWEEN 1 AND 500),
  CHECK (registration_at_delivery IS NULL OR length(trim(registration_at_delivery)) BETWEEN 1 AND 80),
  CHECK (source_reference IS NULL OR length(trim(source_reference)) BETWEEN 1 AND 500)
);

CREATE INDEX sales_deliveries_vehicle_site
  ON public.sales_deliveries(organisation_id,site_id,vehicle_id,delivered_on DESC);

CREATE TABLE public.pdi_observations (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  area text NOT NULL CHECK (length(trim(area)) BETWEEN 1 AND 160),
  observation text NOT NULL CHECK (length(trim(observation)) BETWEEN 1 AND 4000),
  source_reference text,
  corrects_observation_id uuid,
  correction_reason text,
  recorded_by uuid NOT NULL REFERENCES public.staff_users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,delivery_id)
    REFERENCES public.sales_deliveries(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,corrects_observation_id)
    REFERENCES public.pdi_observations(organisation_id,site_id,id),
  CHECK (source_reference IS NULL OR length(trim(source_reference)) BETWEEN 1 AND 500),
  CHECK ((corrects_observation_id IS NULL) = (correction_reason IS NULL)),
  CHECK (correction_reason IS NULL OR length(trim(correction_reason)) BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX pdi_observations_one_correction
  ON public.pdi_observations(organisation_id,site_id,corrects_observation_id)
  WHERE corrects_observation_id IS NOT NULL;

ALTER TABLE public.sales_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_deliveries_site_scope ON public.sales_deliveries
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

ALTER TABLE public.pdi_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdi_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY pdi_observations_site_scope ON public.pdi_observations
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

REVOKE ALL ON public.sales_deliveries,public.pdi_observations FROM PUBLIC;
GRANT SELECT,INSERT ON public.sales_deliveries,public.pdi_observations TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.sales_deliveries,public.pdi_observations FROM vmms_runtime;

CREATE FUNCTION public.reject_sales_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'sales and PDI history is append-only'; END $$;
REVOKE ALL ON FUNCTION public.reject_sales_history_change() FROM PUBLIC;
CREATE TRIGGER sales_deliveries_immutable BEFORE UPDATE OR DELETE ON public.sales_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.reject_sales_history_change();
CREATE TRIGGER pdi_observations_immutable BEFORE UPDATE OR DELETE ON public.pdi_observations
  FOR EACH ROW EXECUTE FUNCTION public.reject_sales_history_change();

ALTER TABLE public.sensitive_read_events DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
  'work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared',
  'party-lookup-read-prepared','workforce-organogram-read-prepared','workforce-overview-read-prepared',
  'staff-messages-read-prepared','staff-account-requests-read-prepared','service-request-read-prepared',
  'vehicle-sales-history-read-prepared'
));
