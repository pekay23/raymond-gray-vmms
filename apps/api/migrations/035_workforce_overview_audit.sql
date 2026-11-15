ALTER TABLE public.sensitive_read_events
  DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events
  ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
    'work-order-queue-read-prepared',
    'vehicle-lookup-read-prepared',
    'client-lookup-read-prepared',
    'party-lookup-read-prepared',
    'workforce-organogram-read-prepared',
    'workforce-overview-read-prepared'
  ));
