ALTER TABLE public.service_requests
  ADD COLUMN preferred_dropoff_window text,
  ADD COLUMN preferred_callback_window text,
  ADD CONSTRAINT service_requests_preferred_dropoff_window_length
    CHECK (preferred_dropoff_window IS NULL OR length(btrim(preferred_dropoff_window)) BETWEEN 1 AND 240),
  ADD CONSTRAINT service_requests_preferred_callback_window_length
    CHECK (preferred_callback_window IS NULL OR length(btrim(preferred_callback_window)) BETWEEN 1 AND 240);

COMMENT ON COLUMN public.service_requests.preferred_dropoff_window IS
  'Caller-reported preferred vehicle drop-off window. This is not a confirmed appointment.';
COMMENT ON COLUMN public.service_requests.preferred_callback_window IS
  'Caller-reported time when a callback is convenient. This is not a scheduled callback or staff due time.';
