ALTER TABLE public.service_request_contact_entries ADD COLUMN correction_reason text;
ALTER TABLE public.service_request_contact_entries ADD CONSTRAINT request_contact_correction_reason_check
  CHECK ((corrects_entry_id IS NULL AND correction_reason IS NULL) OR
    (corrects_entry_id IS NOT NULL AND correction_reason IS NOT NULL AND length(trim(correction_reason)) BETWEEN 1 AND 500));
CREATE UNIQUE INDEX request_contact_one_correction ON public.service_request_contact_entries
  (organisation_id,site_id,request_id,corrects_entry_id) WHERE corrects_entry_id IS NOT NULL;
