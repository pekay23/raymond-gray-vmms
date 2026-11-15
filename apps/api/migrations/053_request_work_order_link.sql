ALTER TABLE public.service_requests ADD COLUMN work_order_id uuid;
ALTER TABLE public.service_requests ADD CONSTRAINT service_request_work_order_scope_fk
  FOREIGN KEY (organisation_id,site_id,work_order_id) REFERENCES public.work_orders(organisation_id,site_id,id);
ALTER TABLE public.service_requests ADD CONSTRAINT service_request_converted_link_check
  CHECK ((status='converted')=(work_order_id IS NOT NULL));
CREATE INDEX service_requests_work_order ON public.service_requests(organisation_id,site_id,work_order_id) WHERE work_order_id IS NOT NULL;
