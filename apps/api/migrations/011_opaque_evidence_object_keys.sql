-- New objects use an internal random UUID only; tenant/site identifiers are not embedded in object keys.

CREATE OR REPLACE FUNCTION public.finalize_evidence_upload(
  p_intent_id uuid,
  p_evidence_id uuid,
  p_detected_media_type text,
  p_size_bytes bigint,
  p_sha256 text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  intent public.evidence_upload_intents%ROWTYPE;
  quarantine_key text;
BEGIN
  SELECT * INTO intent
  FROM public.evidence_upload_intents i
  WHERE i.id = p_intent_id
    AND i.organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND i.site_id = nullif(current_setting('app.site_id', true), '')::uuid
    AND i.created_by = nullif(current_setting('app.actor_id', true), '')::uuid
  FOR UPDATE;
  IF NOT FOUND OR intent.state <> 'issued' OR intent.expires_at <= transaction_timestamp() THEN
    RAISE EXCEPTION 'evidence upload intent is unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF intent.expected_bytes <> p_size_bytes OR p_size_bytes <= 0 OR p_sha256 !~ '^[0-9a-f]{64}$'
     OR p_detected_media_type !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' THEN
    RAISE EXCEPTION 'evidence metadata failed validation' USING ERRCODE = '22023';
  END IF;

  quarantine_key := 'quarantine/' || p_evidence_id::text;
  INSERT INTO public.evidence_records (
    id, organisation_id, site_id, scan_state, sha256, media_type, size_bytes, created_by,
    purpose_kind, target_id, display_name, declared_media_type, quarantine_key, accepted_key, upload_intent_id
  ) VALUES (
    p_evidence_id, intent.organisation_id, intent.site_id, 'pending', p_sha256, p_detected_media_type,
    p_size_bytes, intent.created_by, intent.purpose_kind, intent.target_id, intent.display_name,
    intent.declared_media_type, quarantine_key, NULL, intent.id
  );
  INSERT INTO public.evidence_scan_jobs (id, organisation_id, site_id, evidence_id)
    VALUES (gen_random_uuid(), intent.organisation_id, intent.site_id, p_evidence_id);
  UPDATE public.evidence_upload_intents SET state = 'completed' WHERE id = intent.id;
  RETURN p_evidence_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_evidence_scan_job(p_lease_seconds integer)
RETURNS TABLE (
  job_id uuid,
  evidence_id uuid,
  organisation_id uuid,
  site_id uuid,
  lease_token uuid,
  attempt_no integer,
  expected_sha256 text,
  quarantine_key text,
  accepted_key text,
  media_type text,
  size_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_lease_seconds < 10 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'lease duration outside allowed bounds' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
    FROM public.evidence_scan_jobs j
    WHERE (j.state = 'pending' AND j.available_at <= transaction_timestamp())
       OR (j.state = 'leased' AND j.lease_until <= transaction_timestamp())
    ORDER BY j.available_at, j.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), leased AS (
    UPDATE public.evidence_scan_jobs j
    SET state = 'leased', attempts = j.attempts + 1,
        lease_token = gen_random_uuid(),
        lease_until = transaction_timestamp() + make_interval(secs => p_lease_seconds),
        updated_at = transaction_timestamp()
    FROM candidate c
    WHERE j.id = c.id
    RETURNING j.id, j.organisation_id, j.site_id, j.evidence_id, j.lease_token, j.attempts
  )
  SELECT l.id, e.id, l.organisation_id, l.site_id, l.lease_token, l.attempts,
         e.sha256, e.quarantine_key,
         'accepted/' || e.id::text,
         e.media_type, e.size_bytes
  FROM leased l
  JOIN public.evidence_records e ON e.id = l.evidence_id
    AND e.organisation_id = l.organisation_id AND e.site_id = l.site_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_evidence_scan_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_verdict text,
  p_scanned_sha256 text,
  p_engine text,
  p_engine_version text,
  p_detail_code text,
  p_scanned_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  job public.evidence_scan_jobs%ROWTYPE;
  evidence public.evidence_records%ROWTYPE;
  final_state text;
  retryable boolean;
  accepted_key_value text;
BEGIN
  SELECT * INTO job FROM public.evidence_scan_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF job.state = 'completed' AND job.lease_token = p_lease_token THEN RETURN true; END IF;
  IF job.state <> 'leased' OR job.lease_token IS DISTINCT FROM p_lease_token
     OR job.lease_until <= transaction_timestamp() THEN RETURN false; END IF;
  IF p_verdict NOT IN ('clean','infected','unavailable','error','hash-mismatch')
     OR p_engine IS NULL OR length(p_engine) NOT BETWEEN 1 AND 120
     OR p_engine_version IS NULL OR length(p_engine_version) NOT BETWEEN 1 AND 160
     OR p_detail_code IS NULL OR length(p_detail_code) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'invalid evidence scan result' USING ERRCODE = '22023';
  END IF;
  IF p_scanned_sha256 IS NOT NULL AND p_scanned_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid evidence scan hash' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.organisation_id', job.organisation_id::text, true);
  PERFORM set_config('app.site_id', job.site_id::text, true);
  SELECT * INTO evidence FROM public.evidence_records e
    WHERE e.id = job.evidence_id AND e.organisation_id = job.organisation_id AND e.site_id = job.site_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'evidence record missing for scan job' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.evidence_scan_attempts (
    id, organisation_id, site_id, evidence_id, attempt_no, verdict,
    scanned_sha256, engine, engine_version, detail_code, scanned_at
  ) VALUES (
    gen_random_uuid(), job.organisation_id, job.site_id, job.evidence_id, job.attempts,
    p_verdict, p_scanned_sha256, p_engine, p_engine_version, p_detail_code,
    COALESCE(p_scanned_at, transaction_timestamp())
  );

  IF p_verdict = 'clean' THEN
    IF p_scanned_sha256 IS DISTINCT FROM evidence.sha256 THEN
      RAISE EXCEPTION 'clean scan hash does not match immutable evidence hash' USING ERRCODE = '22023';
    END IF;
    accepted_key_value := 'accepted/' || evidence.id::text;
    UPDATE public.evidence_records SET scan_state = 'accepted', accepted_key = accepted_key_value WHERE id = evidence.id;
    UPDATE public.evidence_scan_jobs SET state = 'completed', lease_until = NULL, updated_at = transaction_timestamp()
      WHERE id = job.id;
    RETURN true;
  END IF;

  IF p_verdict = 'infected' THEN
    final_state := 'rejected';
    retryable := false;
  ELSIF p_verdict = 'hash-mismatch' THEN
    final_state := 'quarantined';
    retryable := false;
  ELSE
    final_state := 'quarantined';
    retryable := job.attempts < 5;
  END IF;
  UPDATE public.evidence_records SET scan_state = final_state WHERE id = evidence.id;
  UPDATE public.evidence_scan_jobs
    SET state = CASE WHEN retryable THEN 'pending' ELSE 'failed' END,
        available_at = CASE WHEN retryable THEN transaction_timestamp() + make_interval(secs => LEAST(300, 2 ^ job.attempts)) ELSE available_at END,
        lease_token = NULL, lease_until = NULL, updated_at = transaction_timestamp()
  WHERE id = job.id;
  RETURN true;
END;
$$;
