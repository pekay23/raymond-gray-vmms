ALTER TABLE public.service_requests
  ADD COLUMN vehicle_source text NOT NULL DEFAULT 'unknown'
    CHECK (vehicle_source IN ('showroom-stock','partner-garage','other','unknown')),
  ADD COLUMN shipping_reference text
    CHECK (shipping_reference IS NULL OR length(trim(shipping_reference)) <= 160);

ALTER TABLE public.work_orders
  ADD COLUMN service_source text NOT NULL DEFAULT 'unknown'
    CHECK (service_source IN ('showroom-stock','partner-garage','other','unknown')),
  ADD COLUMN shipping_reference text
    CHECK (shipping_reference IS NULL OR length(trim(shipping_reference)) <= 160);

COMMENT ON COLUMN public.service_requests.vehicle_source IS
  'Requester-reported origin; it is not an independently verified vehicle source.';
COMMENT ON COLUMN public.work_orders.service_source IS
  'Requester-reported origin carried from service request; it is not an independently verified vehicle source.';
