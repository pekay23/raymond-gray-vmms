-- Fix the evidence-link variable/column ambiguity in diagnostic finding persistence.
CREATE OR REPLACE FUNCTION public.record_diagnostic_finding(
  p_work_order_id uuid,
  p_expected_version integer,
  p_complaint_id uuid,
  p_task_id uuid,
  p_supersedes_finding_id uuid,
  p_observed_at timestamptz,
  p_summary text,
  p_certainty_state text,
  p_certainty_explanation text,
  p_residual_risk text,
  p_restrictions text,
  p_observations jsonb,
  p_evidence_ids uuid[]
)
RETURNS TABLE(finding_id uuid, new_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  scoped_organisation_id uuid := nullif(current_setting('app.organisation_id', true), '')::uuid;
  scoped_site_id uuid := nullif(current_setting('app.site_id', true), '')::uuid;
  scoped_actor_id uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  current_version integer;
  new_finding_id uuid := gen_random_uuid();
  loop_evidence_id uuid;
  evidence_row record;
BEGIN
  IF scoped_organisation_id IS NULL OR scoped_site_id IS NULL OR scoped_actor_id IS NULL THEN
    RAISE EXCEPTION 'diagnostic finding scope is required' USING ERRCODE = '42501';
  END IF;
  IF public.lock_membership(scoped_actor_id, scoped_site_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'writable site membership is required' USING ERRCODE = '42501';
  END IF;
  IF p_certainty_state NOT IN ('stated', 'inconclusive')
    OR p_observations IS NULL OR jsonb_typeof(p_observations) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_observations) NOT BETWEEN 1 AND 50
    OR cardinality(p_evidence_ids) > 50 THEN
    RAISE EXCEPTION 'diagnostic finding data is invalid' USING ERRCODE = '23514';
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

  PERFORM 1 FROM public.complaints c
  WHERE c.id = p_complaint_id
    AND c.organisation_id = scoped_organisation_id
    AND c.site_id = scoped_site_id
    AND c.work_order_id = p_work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'complaint is not part of this work order' USING ERRCODE = '23503';
  END IF;
  IF p_task_id IS NOT NULL THEN
    PERFORM 1 FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.organisation_id = scoped_organisation_id
      AND t.site_id = scoped_site_id
      AND t.work_order_id = p_work_order_id
      AND t.complaint_id = p_complaint_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'task is not part of this complaint and work order' USING ERRCODE = '23503';
    END IF;
  END IF;
  IF p_supersedes_finding_id IS NOT NULL THEN
    PERFORM 1 FROM public.diagnostic_findings d
    WHERE d.id = p_supersedes_finding_id
      AND d.organisation_id = scoped_organisation_id
      AND d.site_id = scoped_site_id
      AND d.work_order_id = p_work_order_id
      AND d.complaint_id = p_complaint_id
      AND d.task_id IS NOT DISTINCT FROM p_task_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'superseded finding is not in this diagnostic scope' USING ERRCODE = '23503';
    END IF;
  END IF;

  IF cardinality(p_evidence_ids) <> (SELECT count(DISTINCT item) FROM unnest(p_evidence_ids) AS item) THEN
    RAISE EXCEPTION 'diagnostic evidence references must be unique' USING ERRCODE = '23514';
  END IF;
  FOREACH loop_evidence_id IN ARRAY p_evidence_ids LOOP
    SELECT e.scan_state, e.sha256, e.accepted_key, latest.verdict, latest.scanned_sha256
      INTO evidence_row
    FROM public.evidence_records e
    JOIN public.work_order_evidence_links l
      ON l.organisation_id = e.organisation_id
      AND l.site_id = e.site_id
      AND l.work_order_id = p_work_order_id
      AND l.evidence_id = e.id
    JOIN LATERAL (
      SELECT a.verdict, a.scanned_sha256
      FROM public.evidence_scan_attempts a
      WHERE a.organisation_id = e.organisation_id
        AND a.site_id = e.site_id
        AND a.evidence_id = e.id
      ORDER BY a.attempt_no DESC
      LIMIT 1
    ) latest ON true
    WHERE e.id = loop_evidence_id
      AND e.organisation_id = scoped_organisation_id
      AND e.site_id = scoped_site_id
      AND e.purpose_kind = 'work-order'
      AND e.target_id = p_work_order_id
      AND e.scan_state = 'accepted'
      AND e.accepted_key IS NOT NULL
      AND latest.verdict = 'clean'
      AND latest.scanned_sha256 = e.sha256;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'diagnostic evidence must be clean and attached to this work order' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  INSERT INTO public.diagnostic_findings (
    id, organisation_id, site_id, work_order_id, complaint_id, task_id, supersedes_finding_id,
    recorded_by, observed_at, summary, certainty_state, certainty_explanation,
    residual_risk, restrictions, observations
  ) VALUES (
    new_finding_id, scoped_organisation_id, scoped_site_id, p_work_order_id, p_complaint_id,
    p_task_id, p_supersedes_finding_id, scoped_actor_id, p_observed_at, p_summary,
    p_certainty_state, p_certainty_explanation, p_residual_risk, p_restrictions, p_observations
  );
  FOREACH loop_evidence_id IN ARRAY p_evidence_ids LOOP
    INSERT INTO public.diagnostic_finding_evidence (
      organisation_id, site_id, work_order_id, finding_id, evidence_id
    ) VALUES (scoped_organisation_id, scoped_site_id, p_work_order_id, new_finding_id, loop_evidence_id);
  END LOOP;
  UPDATE public.work_orders SET version = version + 1 WHERE id = p_work_order_id;
  RETURN QUERY SELECT new_finding_id, current_version + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.record_diagnostic_finding(uuid,integer,uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_diagnostic_finding(uuid,integer,uuid,uuid,uuid,timestamptz,text,text,text,text,text,jsonb,uuid[]) TO vmms_runtime;
