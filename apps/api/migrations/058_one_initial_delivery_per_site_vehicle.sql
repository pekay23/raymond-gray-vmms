CREATE UNIQUE INDEX sales_deliveries_one_initial_per_site_vehicle
  ON public.sales_deliveries(organisation_id,site_id,vehicle_id);
