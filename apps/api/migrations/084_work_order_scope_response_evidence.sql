-- Written payer responses retain accepted evidence linked to the same work order.
ALTER TABLE public.work_order_scope_payer_responses
  ADD COLUMN response_method text NOT NULL DEFAULT 'phone'
    CHECK (response_method IN ('phone','written'));
ALTER TABLE public.work_order_scope_payer_responses
  ADD COLUMN written_evidence_confirmed boolean NOT NULL DEFAULT false
    CHECK ((response_method='written' AND written_evidence_confirmed) OR (response_method='phone' AND NOT written_evidence_confirmed));
ALTER TABLE public.work_order_scope_payer_responses
  ADD CONSTRAINT work_order_scope_payer_responses_evidence_binding_key
  UNIQUE (organisation_id,site_id,work_order_id,scope_revision_id,id);

CREATE TABLE public.work_order_scope_payer_response_evidence (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  scope_revision_id uuid NOT NULL,
  response_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  PRIMARY KEY (organisation_id,site_id,response_id,evidence_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,scope_revision_id)
    REFERENCES public.work_order_scope_revisions(organisation_id,site_id,work_order_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,scope_revision_id,response_id)
    REFERENCES public.work_order_scope_payer_responses(organisation_id,site_id,work_order_id,scope_revision_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,evidence_id)
    REFERENCES public.work_order_evidence_links(organisation_id,site_id,work_order_id,evidence_id)
);

ALTER TABLE public.work_order_scope_payer_response_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_scope_payer_response_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_scope_payer_response_evidence_site_scope
  ON public.work_order_scope_payer_response_evidence
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

CREATE FUNCTION public.reject_work_order_scope_payer_response_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'payer response evidence links are immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION public.reject_work_order_scope_payer_response_evidence_mutation() FROM PUBLIC;
CREATE TRIGGER work_order_scope_payer_response_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_scope_payer_response_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_scope_payer_response_evidence_mutation();

CREATE FUNCTION public.validate_work_order_scope_response_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE response_method text;
BEGIN
  SELECT payer_response.response_method INTO response_method
  FROM public.work_order_scope_payer_responses payer_response
  WHERE payer_response.organisation_id=NEW.organisation_id AND payer_response.site_id=NEW.site_id
    AND payer_response.work_order_id=NEW.work_order_id AND payer_response.scope_revision_id=NEW.scope_revision_id
    AND payer_response.id=NEW.response_id;
  IF response_method IS DISTINCT FROM 'written' THEN
    RAISE EXCEPTION 'only written payer responses may link written evidence' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.evidence_records evidence
    JOIN public.work_order_evidence_links evidence_link
      ON evidence_link.organisation_id=evidence.organisation_id AND evidence_link.site_id=evidence.site_id
      AND evidence_link.work_order_id=NEW.work_order_id AND evidence_link.evidence_id=evidence.id
    JOIN LATERAL (SELECT attempt.verdict,attempt.scanned_sha256
      FROM public.evidence_scan_attempts attempt
      WHERE attempt.organisation_id=evidence.organisation_id AND attempt.site_id=evidence.site_id
        AND attempt.evidence_id=evidence.id
      ORDER BY attempt.attempt_no DESC LIMIT 1) latest ON true
    WHERE evidence.organisation_id=NEW.organisation_id AND evidence.site_id=NEW.site_id
      AND evidence.id=NEW.evidence_id AND evidence.target_id=NEW.work_order_id
      AND evidence.purpose_kind='work-order' AND evidence.scan_state='accepted'
      AND evidence.accepted_key IS NOT NULL AND latest.verdict='clean' AND latest.scanned_sha256=evidence.sha256
  ) THEN
    RAISE EXCEPTION 'payer response evidence must be accepted and linked to the work order' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.validate_work_order_scope_response_evidence() FROM PUBLIC;
CREATE TRIGGER work_order_scope_payer_response_evidence_validate
  BEFORE INSERT ON public.work_order_scope_payer_response_evidence
  FOR EACH ROW EXECUTE FUNCTION public.validate_work_order_scope_response_evidence();

CREATE FUNCTION public.require_work_order_scope_response_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.response_method='written' AND NOT EXISTS (
    SELECT 1 FROM public.work_order_scope_payer_response_evidence evidence_link
    WHERE evidence_link.organisation_id=NEW.organisation_id AND evidence_link.site_id=NEW.site_id
      AND evidence_link.work_order_id=NEW.work_order_id AND evidence_link.scope_revision_id=NEW.scope_revision_id
      AND evidence_link.response_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'written payer responses require accepted evidence' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.require_work_order_scope_response_evidence() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER work_order_scope_payer_response_evidence_required
  AFTER INSERT ON public.work_order_scope_payer_responses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.require_work_order_scope_response_evidence();

REVOKE ALL ON public.work_order_scope_payer_response_evidence FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_scope_payer_response_evidence TO vmms_runtime;
GRANT SELECT ON public.evidence_records,public.evidence_scan_attempts TO vmms_runtime;
