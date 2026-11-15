CREATE TABLE public.delivery_preparations (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  preparation_summary text NOT NULL CHECK (length(trim(preparation_summary)) BETWEEN 1 AND 4000),
  source_reference text NOT NULL CHECK (length(trim(source_reference)) BETWEEN 1 AND 500),
  recorded_by uuid NOT NULL REFERENCES public.staff_users(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id) REFERENCES public.sites(organisation_id,id),
  FOREIGN KEY (organisation_id,vehicle_id) REFERENCES public.vehicles(organisation_id,id)
);

CREATE INDEX delivery_preparations_vehicle_site
  ON public.delivery_preparations(organisation_id,site_id,vehicle_id,recorded_at DESC);

CREATE TABLE public.delivery_preparation_delivery_links (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  preparation_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  previous_version integer NOT NULL CHECK (previous_version=1),
  version integer NOT NULL CHECK (version=2),
  linked_by uuid NOT NULL REFERENCES public.staff_users(id),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,preparation_id),
  UNIQUE (organisation_id,site_id,delivery_id),
  FOREIGN KEY (organisation_id,site_id,preparation_id)
    REFERENCES public.delivery_preparations(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,delivery_id)
    REFERENCES public.sales_deliveries(organisation_id,site_id,id)
);

CREATE FUNCTION public.check_delivery_preparation_link_vehicle() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE preparation_vehicle uuid; delivery_vehicle uuid;
BEGIN
  SELECT vehicle_id INTO preparation_vehicle FROM public.delivery_preparations
    WHERE organisation_id=NEW.organisation_id AND site_id=NEW.site_id AND id=NEW.preparation_id;
  SELECT vehicle_id INTO delivery_vehicle FROM public.sales_deliveries
    WHERE organisation_id=NEW.organisation_id AND site_id=NEW.site_id AND id=NEW.delivery_id;
  IF preparation_vehicle IS NULL OR delivery_vehicle IS NULL OR preparation_vehicle<>delivery_vehicle THEN
    RAISE EXCEPTION 'delivery preparation and actual delivery must use the same vehicle and site';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_delivery_preparation_link_vehicle() FROM PUBLIC;
CREATE TRIGGER delivery_preparation_link_vehicle
  BEFORE INSERT ON public.delivery_preparation_delivery_links
  FOR EACH ROW EXECUTE FUNCTION public.check_delivery_preparation_link_vehicle();

ALTER TABLE public.delivery_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_preparations_site_scope ON public.delivery_preparations
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

ALTER TABLE public.delivery_preparation_delivery_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_preparation_delivery_links FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_preparation_links_site_scope ON public.delivery_preparation_delivery_links
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

REVOKE ALL ON public.delivery_preparations,public.delivery_preparation_delivery_links FROM PUBLIC;
GRANT SELECT,INSERT ON public.delivery_preparations,public.delivery_preparation_delivery_links TO vmms_runtime;
REVOKE UPDATE,DELETE ON public.delivery_preparations,public.delivery_preparation_delivery_links FROM vmms_runtime;

CREATE FUNCTION public.reject_delivery_preparation_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'delivery preparation history is append-only'; END $$;
REVOKE ALL ON FUNCTION public.reject_delivery_preparation_history_change() FROM PUBLIC;
CREATE TRIGGER delivery_preparations_immutable BEFORE UPDATE OR DELETE ON public.delivery_preparations
  FOR EACH ROW EXECUTE FUNCTION public.reject_delivery_preparation_history_change();
CREATE TRIGGER delivery_preparation_links_immutable BEFORE UPDATE OR DELETE ON public.delivery_preparation_delivery_links
  FOR EACH ROW EXECUTE FUNCTION public.reject_delivery_preparation_history_change();
