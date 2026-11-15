ALTER TABLE public.service_requests
  ADD COLUMN reported_contact_name text,
  ADD COLUMN reported_contact_phone text,
  ADD COLUMN reported_contact_relationship text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.service_requests
  ADD CONSTRAINT service_request_contact_name_length CHECK (reported_contact_name IS NULL OR length(trim(reported_contact_name)) BETWEEN 1 AND 160),
  ADD CONSTRAINT service_request_contact_phone_length CHECK (reported_contact_phone IS NULL OR length(trim(reported_contact_phone)) BETWEEN 1 AND 80),
  ADD CONSTRAINT service_request_contact_relationship_valid CHECK (reported_contact_relationship IN ('vehicle-owner','driver','client-contact','sales-contact','other','unknown'));
