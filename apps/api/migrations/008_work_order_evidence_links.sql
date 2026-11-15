CREATE TABLE work_order_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  attached_by uuid NOT NULL REFERENCES staff_users(id),
  attached_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id, site_id, work_order_id, evidence_id),
  UNIQUE (organisation_id, site_id, evidence_id),
  FOREIGN KEY (organisation_id, site_id, work_order_id)
    REFERENCES work_orders (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id, evidence_id)
    REFERENCES evidence_records (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id)
    REFERENCES sites (organisation_id, id)
);

CREATE INDEX work_order_evidence_links_order_idx
  ON work_order_evidence_links (organisation_id, site_id, work_order_id, attached_at, id);

ALTER TABLE work_order_evidence_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_evidence_links FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_evidence_link_site_scope ON work_order_evidence_links
  USING (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  )
  WITH CHECK (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  );

CREATE FUNCTION public.attach_work_order_evidence(p_work_order_id uuid, p_evidence_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  scoped_organisation_id uuid := nullif(current_setting('app.organisation_id', true), '')::uuid;
  scoped_site_id uuid := nullif(current_setting('app.site_id', true), '')::uuid;
  scoped_actor_id uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  relation_id uuid := gen_random_uuid();
BEGIN
  IF scoped_organisation_id IS NULL OR scoped_site_id IS NULL OR scoped_actor_id IS NULL THEN
    RAISE EXCEPTION 'work-order evidence scope is required' USING ERRCODE = '42501';
  END IF;
  IF public.lock_membership(scoped_actor_id, scoped_site_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'writable site membership is required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.work_orders w
    WHERE w.id = p_work_order_id
      AND w.organisation_id = scoped_organisation_id
      AND w.site_id = scoped_site_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order not found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
    FROM public.evidence_records e
    JOIN LATERAL (
      SELECT a.verdict, a.scanned_sha256
      FROM public.evidence_scan_attempts a
      WHERE a.organisation_id = e.organisation_id
        AND a.site_id = e.site_id
        AND a.evidence_id = e.id
      ORDER BY a.attempt_no DESC
      LIMIT 1
    ) latest ON true
    WHERE e.id = p_evidence_id
      AND e.organisation_id = scoped_organisation_id
      AND e.site_id = scoped_site_id
      AND e.purpose_kind = 'work-order'
      AND e.target_id = p_work_order_id
      AND e.scan_state = 'accepted'
      AND e.accepted_key IS NOT NULL
      AND latest.verdict = 'clean'
      AND latest.scanned_sha256 = e.sha256
    FOR UPDATE OF e;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence is not accepted for this work order' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.work_order_evidence_links (
    id, organisation_id, site_id, work_order_id, evidence_id, attached_by
  ) VALUES (
    relation_id, scoped_organisation_id, scoped_site_id, p_work_order_id, p_evidence_id, scoped_actor_id
  );
  RETURN relation_id;
END;
$$;
GRANT SELECT, UPDATE ON public.work_orders, public.evidence_records TO CURRENT_USER;
GRANT SELECT ON public.evidence_scan_attempts TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.attach_work_order_evidence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_work_order_evidence(uuid, uuid) TO vmms_runtime;

CREATE FUNCTION public.prevent_work_order_evidence_link_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'work-order evidence links are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER work_order_evidence_links_append_only
  BEFORE UPDATE OR DELETE ON work_order_evidence_links
  FOR EACH ROW EXECUTE FUNCTION public.prevent_work_order_evidence_link_change();

GRANT SELECT ON work_order_evidence_links TO vmms_runtime;
