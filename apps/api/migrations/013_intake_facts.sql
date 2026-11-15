CREATE TABLE intake_facts (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  supersedes_fact_id uuid,
  recorded_by uuid NOT NULL REFERENCES staff_users(id),
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  correction_reason text CHECK (correction_reason IS NULL OR length(btrim(correction_reason)) BETWEEN 1 AND 2000),
  fact jsonb NOT NULL CHECK (
    jsonb_typeof(fact) = 'object'
    AND fact->>'kind' IN (
      'condition-observation','damage-observation','accessory-observation','key-observation',
      'fuel-reading','custody-observation','safety-observation'
    )
    AND jsonb_typeof(fact->'evidenceIds') = 'array'
  ),
  UNIQUE (organisation_id, site_id, work_order_id, id),
  FOREIGN KEY (organisation_id, site_id, work_order_id)
    REFERENCES work_orders (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id, work_order_id, supersedes_fact_id)
    REFERENCES intake_facts (organisation_id, site_id, work_order_id, id),
  CHECK ((supersedes_fact_id IS NULL) = (correction_reason IS NULL))
);

CREATE INDEX intake_facts_work_order_idx
  ON intake_facts (organisation_id, site_id, work_order_id, recorded_at, id);

CREATE TABLE intake_fact_evidence (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  fact_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  PRIMARY KEY (organisation_id, site_id, fact_id, evidence_id),
  FOREIGN KEY (organisation_id, site_id, work_order_id, fact_id)
    REFERENCES intake_facts (organisation_id, site_id, work_order_id, id),
  FOREIGN KEY (organisation_id, site_id, work_order_id, evidence_id)
    REFERENCES work_order_evidence_links (organisation_id, site_id, work_order_id, evidence_id)
);

ALTER TABLE intake_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_fact_site_scope ON intake_facts
  USING (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  )
  WITH CHECK (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  );

ALTER TABLE intake_fact_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_fact_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_fact_evidence_site_scope ON intake_fact_evidence
  USING (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  )
  WITH CHECK (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  );

CREATE FUNCTION public.prevent_intake_fact_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'intake facts and evidence links are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER intake_facts_append_only
  BEFORE UPDATE OR DELETE ON intake_facts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_intake_fact_change();
CREATE TRIGGER intake_fact_evidence_append_only
  BEFORE UPDATE OR DELETE ON intake_fact_evidence
  FOR EACH ROW EXECUTE FUNCTION public.prevent_intake_fact_change();

CREATE FUNCTION public.record_intake_fact(
  p_work_order_id uuid,
  p_expected_version integer,
  p_fact jsonb,
  p_supersedes_fact_id uuid,
  p_correction_reason text
)
RETURNS TABLE(fact_id uuid, new_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  scoped_organisation_id uuid := nullif(current_setting('app.organisation_id', true), '')::uuid;
  scoped_site_id uuid := nullif(current_setting('app.site_id', true), '')::uuid;
  scoped_actor_id uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  current_version integer;
  new_fact_id uuid := gen_random_uuid();
  evidence_id uuid;
  evidence_row record;
  distinct_evidence_count integer;
  evidence_count integer;
BEGIN
  IF scoped_organisation_id IS NULL OR scoped_site_id IS NULL OR scoped_actor_id IS NULL THEN
    RAISE EXCEPTION 'request scope is required' USING ERRCODE = '42501';
  END IF;
  IF public.lock_membership(scoped_actor_id, scoped_site_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'writable site membership is required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_fact) IS DISTINCT FROM 'object'
    OR (p_fact->>'kind') IS NULL OR p_fact->>'kind' NOT IN (
      'condition-observation','damage-observation','accessory-observation','key-observation',
      'fuel-reading','custody-observation','safety-observation'
    )
    OR jsonb_typeof(p_fact->'evidenceIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_fact->'evidenceIds') > 50
    OR (p_supersedes_fact_id IS NULL) <> (p_correction_reason IS NULL)
    OR (p_correction_reason IS NOT NULL AND length(btrim(p_correction_reason)) NOT BETWEEN 1 AND 2000) THEN
    RAISE EXCEPTION 'intake fact data is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT w.version INTO current_version
  FROM public.work_orders w
  WHERE w.id = p_work_order_id
    AND w.organisation_id = scoped_organisation_id
    AND w.site_id = scoped_site_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order not found' USING ERRCODE = 'P0002';
  END IF;
  IF current_version <> p_expected_version THEN
    RAISE EXCEPTION 'work order version is stale' USING ERRCODE = '40001';
  END IF;

  IF p_supersedes_fact_id IS NOT NULL THEN
    PERFORM 1 FROM public.intake_facts f
    WHERE f.id = p_supersedes_fact_id
      AND f.organisation_id = scoped_organisation_id
      AND f.site_id = scoped_site_id
      AND f.work_order_id = p_work_order_id
      AND f.fact->>'kind' = p_fact->>'kind';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'superseded fact must be in the same work order and category' USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT count(*)::integer, count(DISTINCT value)::integer
    INTO evidence_count, distinct_evidence_count
  FROM jsonb_array_elements_text(p_fact->'evidenceIds') AS items(value);
  IF evidence_count <> distinct_evidence_count THEN
    RAISE EXCEPTION 'intake evidence references must be unique' USING ERRCODE = '23514';
  END IF;
  FOR evidence_id IN SELECT value::uuid FROM jsonb_array_elements_text(p_fact->'evidenceIds') AS items(value) LOOP
    SELECT e.scan_state, e.sha256, e.accepted_key, latest.verdict, latest.scanned_sha256
      INTO evidence_row
    FROM public.evidence_records e
    JOIN public.work_order_evidence_links l
      ON l.organisation_id=e.organisation_id AND l.site_id=e.site_id
      AND l.work_order_id=p_work_order_id AND l.evidence_id=e.id
    JOIN LATERAL (
      SELECT a.verdict, a.scanned_sha256 FROM public.evidence_scan_attempts a
      WHERE a.organisation_id=e.organisation_id AND a.site_id=e.site_id AND a.evidence_id=e.id
      ORDER BY a.attempt_no DESC LIMIT 1
    ) latest ON true
    WHERE e.id=evidence_id AND e.organisation_id=scoped_organisation_id AND e.site_id=scoped_site_id
      AND e.purpose_kind='work-order' AND e.target_id=p_work_order_id
      AND e.scan_state='accepted' AND e.accepted_key IS NOT NULL
      AND latest.verdict='clean' AND latest.scanned_sha256=e.sha256;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'intake evidence must be clean and attached to this work order' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  INSERT INTO public.intake_facts (
    id, organisation_id, site_id, work_order_id, supersedes_fact_id,
    recorded_by, correction_reason, fact
  ) VALUES (
    new_fact_id, scoped_organisation_id, scoped_site_id, p_work_order_id, p_supersedes_fact_id,
    scoped_actor_id, p_correction_reason, p_fact
  );
  FOR evidence_id IN SELECT value::uuid FROM jsonb_array_elements_text(p_fact->'evidenceIds') AS items(value) LOOP
    INSERT INTO public.intake_fact_evidence (
      organisation_id, site_id, work_order_id, fact_id, evidence_id
    ) VALUES (scoped_organisation_id, scoped_site_id, p_work_order_id, new_fact_id, evidence_id);
  END LOOP;
  UPDATE public.work_orders SET version = version + 1 WHERE id = p_work_order_id;
  RETURN QUERY SELECT new_fact_id, current_version + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.record_intake_fact(uuid,integer,jsonb,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_intake_fact(uuid,integer,jsonb,uuid,text) TO vmms_runtime;
GRANT SELECT ON intake_facts, intake_fact_evidence TO vmms_runtime;
