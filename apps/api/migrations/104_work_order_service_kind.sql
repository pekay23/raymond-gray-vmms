ALTER TABLE public.work_orders
  ADD COLUMN service_kind text NOT NULL DEFAULT 'repair-maintenance'
  CHECK (service_kind IN ('repair-maintenance','routine-maintenance','psai','service-centre-pdi'));

COMMENT ON COLUMN public.work_orders.service_kind IS
  'Requested service category carried from intake; it does not authorize inspection or repair.';
