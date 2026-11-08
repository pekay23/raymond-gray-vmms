CREATE TABLE evidence_upload_intents (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES staff_users(id),
  command_id uuid NOT NULL,
  purpose_kind text NOT NULL CHECK (purpose_kind IN ('work-order','vehicle-owner-approval','diagnostic','test','procedure-reference','attachment')),
  target_id uuid,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 255),
  declared_media_type text NOT NULL CHECK (length(declared_media_type) BETWEEN 1 AND 160),
  expected_bytes bigint NOT NULL CHECK (expected_bytes > 0),
  state text NOT NULL DEFAULT 'issued' CHECK (state IN ('issued','completed','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, id),
  UNIQUE (organisation_id, site_id, created_by, command_id),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id),
  CHECK (expires_at > created_at)
);

ALTER TABLE evidence_records
  ADD COLUMN purpose_kind text,
  ADD COLUMN target_id uuid,
  ADD COLUMN display_name text,
  ADD COLUMN declared_media_type text,
  ADD COLUMN quarantine_key text,
  ADD COLUMN accepted_key text,
  ADD COLUMN upload_intent_id uuid;

ALTER TABLE evidence_records
  ADD CONSTRAINT evidence_records_purpose_kind_check CHECK (
    purpose_kind IS NULL OR purpose_kind IN ('legacy','work-order','vehicle-owner-approval','diagnostic','test','procedure-reference','attachment')
  ),
  ADD CONSTRAINT evidence_records_upload_intent_unique UNIQUE (organisation_id, site_id, upload_intent_id),
  ADD CONSTRAINT evidence_records_upload_intent_fk FOREIGN KEY (organisation_id, site_id, upload_intent_id)
    REFERENCES evidence_upload_intents (organisation_id, site_id, id),
  ADD CONSTRAINT evidence_records_key_pair_check CHECK (
    (quarantine_key IS NULL AND accepted_key IS NULL) OR quarantine_key IS NOT NULL
  ),
  ADD CONSTRAINT evidence_records_display_name_check CHECK (
    display_name IS NULL OR length(display_name) BETWEEN 1 AND 255
  ),
  ADD CONSTRAINT evidence_records_declared_media_type_check CHECK (
    declared_media_type IS NULL OR length(declared_media_type) BETWEEN 1 AND 160
  );

CREATE TABLE evidence_scan_attempts (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  verdict text NOT NULL CHECK (verdict IN ('clean','infected','unavailable','error','hash-mismatch')),
  scanned_sha256 text,
  engine text NOT NULL CHECK (length(engine) BETWEEN 1 AND 120),
  engine_version text NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 160),
  detail_code text NOT NULL CHECK (length(detail_code) BETWEEN 1 AND 160),
  scanned_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, evidence_id, attempt_no),
  UNIQUE (organisation_id, site_id, evidence_id, id),
  FOREIGN KEY (organisation_id, site_id, evidence_id)
    REFERENCES evidence_records (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id),
  CHECK (scanned_sha256 IS NULL OR scanned_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (verdict <> 'clean' OR scanned_sha256 IS NOT NULL)
);

CREATE TABLE evidence_scan_jobs (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, evidence_id),
  FOREIGN KEY (organisation_id, site_id, evidence_id)
    REFERENCES evidence_records (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id),
  CHECK ((state = 'leased') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);

CREATE INDEX evidence_scan_jobs_due_idx ON evidence_scan_jobs (available_at, created_at)
  WHERE state IN ('pending','leased');

CREATE TABLE evidence_access_events (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES staff_users(id),
  action text NOT NULL CHECK (action IN ('download-started')),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 120),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organisation_id, site_id, evidence_id)
    REFERENCES evidence_records (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id)
);

ALTER TABLE evidence_upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_upload_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_intent_site_scope ON evidence_upload_intents
  USING (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
    AND created_by = nullif(current_setting('app.actor_id', true), '')::uuid
  )
  WITH CHECK (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
    AND created_by = nullif(current_setting('app.actor_id', true), '')::uuid
  );

ALTER TABLE evidence_scan_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_scan_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_scan_site_scope ON evidence_scan_attempts
  USING (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  )
  WITH CHECK (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  );
CREATE POLICY evidence_scan_attempt_owner_access ON evidence_scan_attempts
  USING (current_user = 'vmms_owner')
  WITH CHECK (current_user = 'vmms_owner');

ALTER TABLE evidence_scan_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_scan_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_scan_job_owner_access ON evidence_scan_jobs
  USING (current_user = 'vmms_owner')
  WITH CHECK (current_user = 'vmms_owner');

ALTER TABLE evidence_access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_access_events FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_access_site_scope ON evidence_access_events
  USING (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  )
  WITH CHECK (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
    AND actor_id = nullif(current_setting('app.actor_id', true), '')::uuid
  );

CREATE FUNCTION public.finalize_evidence_upload(
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

  quarantine_key := 'quarantine/' || intent.organisation_id::text || '/' || intent.site_id::text || '/' || p_evidence_id::text;
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
REVOKE ALL ON FUNCTION public.finalize_evidence_upload(uuid,uuid,text,bigint,text) FROM PUBLIC;

CREATE FUNCTION public.claim_evidence_scan_job(p_lease_seconds integer)
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
         'accepted/' || e.organisation_id::text || '/' || e.site_id::text || '/' || e.id::text,
         e.media_type, e.size_bytes
  FROM leased l
  JOIN public.evidence_records e ON e.id = l.evidence_id
    AND e.organisation_id = l.organisation_id AND e.site_id = l.site_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_evidence_scan_job(integer) FROM PUBLIC;

CREATE FUNCTION public.complete_evidence_scan_job(
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
    accepted_key_value := 'accepted/' || evidence.organisation_id::text || '/' || evidence.site_id::text || '/' || evidence.id::text;
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
REVOKE ALL ON FUNCTION public.complete_evidence_scan_job(uuid,uuid,text,text,text,text,text,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.lock_accepted_owner_evidence(p_evidence_id uuid,p_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_site_id IS DISTINCT FROM nullif(current_setting('app.site_id',true),'')::uuid THEN
    RETURN false;
  END IF;
  PERFORM e.id
  FROM public.evidence_records e
  WHERE e.id = p_evidence_id
    AND e.organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
    AND e.site_id = p_site_id
    AND e.scan_state = 'accepted'
    AND e.accepted_key IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.evidence_scan_attempts a
      WHERE a.organisation_id = e.organisation_id
        AND a.site_id = e.site_id
        AND a.evidence_id = e.id
        AND a.verdict = 'clean'
        AND a.scanned_sha256 = e.sha256
        AND a.attempt_no = (SELECT max(latest.attempt_no)
          FROM public.evidence_scan_attempts latest
          WHERE latest.organisation_id = e.organisation_id
            AND latest.site_id = e.site_id
            AND latest.evidence_id = e.id)
    )
  FOR SHARE OF e;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_accepted_owner_evidence(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.prevent_evidence_metadata_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD.id, OLD.organisation_id, OLD.site_id, OLD.sha256, OLD.media_type, OLD.size_bytes,
    OLD.created_by, OLD.created_at, OLD.purpose_kind, OLD.target_id, OLD.display_name,
    OLD.declared_media_type, OLD.quarantine_key, OLD.upload_intent_id
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organisation_id, NEW.site_id, NEW.sha256, NEW.media_type, NEW.size_bytes,
    NEW.created_by, NEW.created_at, NEW.purpose_kind, NEW.target_id, NEW.display_name,
    NEW.declared_media_type, NEW.quarantine_key, NEW.upload_intent_id
  ) THEN
    RAISE EXCEPTION 'evidence metadata is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.accepted_key IS DISTINCT FROM OLD.accepted_key
     AND NOT (OLD.accepted_key IS NULL AND NEW.accepted_key IS NOT NULL AND NEW.scan_state = 'accepted') THEN
    RAISE EXCEPTION 'accepted evidence key is immutable after acceptance' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evidence_records_metadata_immutable
  BEFORE UPDATE ON evidence_records FOR EACH ROW EXECUTE FUNCTION public.prevent_evidence_metadata_change();

CREATE FUNCTION public.prevent_evidence_scan_attempt_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'evidence scan attempts are append-only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER evidence_scan_attempts_append_only
  BEFORE UPDATE OR DELETE ON evidence_scan_attempts FOR EACH ROW EXECUTE FUNCTION public.prevent_evidence_scan_attempt_change();

GRANT SELECT, INSERT ON evidence_upload_intents TO vmms_runtime;
GRANT SELECT ON evidence_records, evidence_scan_attempts TO vmms_runtime;
GRANT INSERT ON evidence_access_events TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.finalize_evidence_upload(uuid,uuid,text,bigint,text) TO vmms_runtime;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vmms_evidence_worker') THEN
    CREATE ROLE vmms_evidence_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END;
$$;
COMMENT ON ROLE vmms_evidence_worker IS 'NOLOGIN capability role; provision a dedicated LOGIN principal as a member for the isolated evidence scan worker only.';
GRANT USAGE ON SCHEMA public TO vmms_evidence_worker;
GRANT EXECUTE ON FUNCTION public.claim_evidence_scan_job(integer) TO vmms_evidence_worker;
GRANT EXECUTE ON FUNCTION public.complete_evidence_scan_job(uuid,uuid,text,text,text,text,text,timestamptz) TO vmms_evidence_worker;
GRANT EXECUTE ON FUNCTION public.lock_accepted_owner_evidence(uuid,uuid) TO vmms_runtime;
