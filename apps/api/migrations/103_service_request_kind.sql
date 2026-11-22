ALTER TABLE public.service_requests
  ADD COLUMN request_kind text NOT NULL DEFAULT 'repair-maintenance'
  CHECK (request_kind IN ('repair-maintenance','routine-maintenance','psai','service-centre-pdi'));

COMMENT ON COLUMN public.service_requests.request_kind IS
  'Requested service category; this is a reported request and does not authorize inspection or repair.';
