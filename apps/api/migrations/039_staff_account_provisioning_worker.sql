ALTER TABLE public.staff_account_provisioning_requests
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN retry_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN provider_reference text;

ALTER TABLE public.staff_account_provisioning_requests
  ADD CONSTRAINT staff_account_provisioning_lease_state_check CHECK (
    (state='provisioning' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'provisioning' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT staff_account_provisioning_provider_reference_check CHECK (
    provider_reference IS NULL OR provider_reference ~ '^[A-Za-z0-9._:-]{1,200}$'
  );

CREATE INDEX staff_account_provisioning_ready
  ON public.staff_account_provisioning_requests(retry_at,created_at,id)
  WHERE state IN ('queued','provisioning');

CREATE TABLE public.staff_account_provisioning_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  request_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  worker_principal text NOT NULL CHECK (length(worker_principal) BETWEEN 1 AND 128),
  phase text NOT NULL CHECK (phase IN ('claimed','invitation-issued','retryable-failure','permanent-failure')),
  previous_state text NOT NULL CHECK (previous_state IN ('queued','provisioning','invitation-issued','active','suspended','failed')),
  next_state text NOT NULL CHECK (next_state IN ('queued','provisioning','invitation-issued','active','suspended','failed')),
  provider_reference text CHECK (provider_reference IS NULL OR provider_reference ~ '^[A-Za-z0-9._:-]{1,200}$'),
  error_code text CHECK (error_code IS NULL OR error_code IN ('provider-unavailable','identity-already-exists','provider-rejected','invalid-request')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organisation_id,site_id,request_id)
    REFERENCES public.staff_account_provisioning_requests(organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,request_id,attempt_no,phase),
  CHECK ((phase='claimed' AND provider_reference IS NULL AND error_code IS NULL)
      OR (phase='invitation-issued' AND provider_reference IS NOT NULL AND error_code IS NULL)
      OR (phase IN ('retryable-failure','permanent-failure') AND provider_reference IS NULL AND error_code IS NOT NULL)),
  CHECK ((phase='claimed' AND previous_state IN ('queued','provisioning') AND next_state='provisioning')
      OR (phase='invitation-issued' AND previous_state='provisioning' AND next_state='invitation-issued')
      OR (phase='retryable-failure' AND previous_state='provisioning' AND next_state='queued')
      OR (phase='permanent-failure' AND previous_state='provisioning' AND next_state='failed'))
);

ALTER TABLE public.staff_account_provisioning_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_account_provisioning_activity_site_scope
  ON public.staff_account_provisioning_activity
  USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
  );

REVOKE ALL ON public.staff_account_provisioning_activity FROM PUBLIC,vmms_runtime;
REVOKE UPDATE,DELETE ON public.staff_account_provisioning_requests FROM PUBLIC,vmms_runtime;
REVOKE INSERT ON public.staff_account_provisioning_requests FROM PUBLIC,vmms_runtime;
GRANT INSERT (id,organisation_id,site_id,email,display_name,site_access,requested_by)
  ON public.staff_account_provisioning_requests TO vmms_runtime;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vmms_staff_account_worker') THEN
    CREATE ROLE vmms_staff_account_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vmms_staff_account_function_owner') THEN
    CREATE ROLE vmms_staff_account_function_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$roles$;

COMMENT ON ROLE vmms_staff_account_worker IS 'NOLOGIN capability role; provision a dedicated database login for the isolated account-provisioning worker only.';
COMMENT ON ROLE vmms_staff_account_function_owner IS 'NOLOGIN, non-superuser owner of narrowly scoped account-worker functions; subject to the worker session RLS policy.';

GRANT USAGE ON SCHEMA public TO vmms_staff_account_function_owner;
GRANT SELECT,UPDATE ON public.staff_account_provisioning_requests TO vmms_staff_account_function_owner;
GRANT INSERT ON public.staff_account_provisioning_activity TO vmms_staff_account_function_owner;

CREATE POLICY staff_account_provisioning_worker_scope
  ON public.staff_account_provisioning_requests
  USING (pg_has_role(session_user,'vmms_staff_account_worker','member'))
  WITH CHECK (pg_has_role(session_user,'vmms_staff_account_worker','member'));
CREATE POLICY staff_account_provisioning_activity_worker_scope
  ON public.staff_account_provisioning_activity
  USING (pg_has_role(session_user,'vmms_staff_account_worker','member'))
  WITH CHECK (pg_has_role(session_user,'vmms_staff_account_worker','member'));

CREATE FUNCTION public.claim_staff_account_provisioning_request(p_lease_seconds integer)
RETURNS TABLE (
  request_id uuid,
  operation_id uuid,
  organisation_id uuid,
  site_id uuid,
  email text,
  display_name text,
  attempt_no integer,
  lease_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE
  v_request public.staff_account_provisioning_requests%ROWTYPE;
  v_previous_state text;
BEGIN
  IF p_lease_seconds < 10 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'invalid lease duration' USING ERRCODE='22023';
  END IF;

  SELECT r.* INTO v_request
  FROM public.staff_account_provisioning_requests r
  WHERE (r.state='queued' AND r.retry_at <= clock_timestamp())
     OR (r.state='provisioning' AND r.lease_expires_at <= clock_timestamp())
  ORDER BY r.retry_at,r.created_at,r.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  v_previous_state:=v_request.state;

  UPDATE public.staff_account_provisioning_requests r
  SET state='provisioning',
      attempt_count=r.attempt_count+1,
      revision=r.revision+1,
      retry_at=clock_timestamp(),
      lease_token=gen_random_uuid(),
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
      updated_at=clock_timestamp()
  WHERE r.id=v_request.id
  RETURNING r.* INTO v_request;

  INSERT INTO public.staff_account_provisioning_activity
    (organisation_id,site_id,request_id,attempt_no,worker_principal,phase,previous_state,next_state)
  VALUES (v_request.organisation_id,v_request.site_id,v_request.id,v_request.attempt_count,session_user::text,
    'claimed',v_previous_state,'provisioning');

  RETURN QUERY SELECT v_request.id,v_request.id,v_request.organisation_id,v_request.site_id,
    v_request.email,v_request.display_name,v_request.attempt_count,v_request.lease_token;
END
$function$;

CREATE FUNCTION public.complete_staff_account_provisioning_request(
  p_request_id uuid,
  p_lease_token uuid,
  p_result text,
  p_provider_reference text,
  p_error_code text,
  p_retry_delay_seconds integer DEFAULT 30,
  p_max_attempts integer DEFAULT 8
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE
  v_request public.staff_account_provisioning_requests%ROWTYPE;
  v_phase text;
  v_state text;
BEGIN
  IF p_result IS NULL OR p_result NOT IN ('invitation-issued','retryable-failure','permanent-failure')
     OR p_retry_delay_seconds IS NULL OR p_retry_delay_seconds < 1 OR p_retry_delay_seconds > 3600
     OR p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 20
     OR (p_result='invitation-issued' AND (p_provider_reference IS NULL OR p_provider_reference !~ '^[A-Za-z0-9._:-]{1,200}$' OR p_error_code IS NOT NULL))
     OR (p_result<>'invitation-issued' AND (p_provider_reference IS NOT NULL OR p_error_code IS NULL OR p_error_code NOT IN ('provider-unavailable','identity-already-exists','provider-rejected','invalid-request'))) THEN
    RAISE EXCEPTION 'invalid provisioning result' USING ERRCODE='22023';
  END IF;

  SELECT r.* INTO v_request
  FROM public.staff_account_provisioning_requests r
  WHERE r.id=p_request_id AND r.state='provisioning' AND r.lease_token=p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_phase:=p_result;
  IF p_result='invitation-issued' THEN
    v_state:='invitation-issued';
  ELSIF p_result='permanent-failure' OR v_request.attempt_count >= p_max_attempts THEN
    v_phase:='permanent-failure';
    v_state:='failed';
  ELSE
    v_phase:='retryable-failure';
    v_state:='queued';
  END IF;

  UPDATE public.staff_account_provisioning_requests r
  SET state=v_state,
      revision=r.revision+1,
      provider_reference=CASE WHEN v_state='invitation-issued' THEN p_provider_reference ELSE NULL END,
      retry_at=CASE WHEN v_state='queued' THEN clock_timestamp()+make_interval(secs=>p_retry_delay_seconds) ELSE clock_timestamp() END,
      lease_token=NULL,
      lease_expires_at=NULL,
      updated_at=clock_timestamp()
  WHERE r.id=v_request.id;

  INSERT INTO public.staff_account_provisioning_activity
    (organisation_id,site_id,request_id,attempt_no,worker_principal,phase,previous_state,next_state,provider_reference,error_code)
  VALUES (v_request.organisation_id,v_request.site_id,v_request.id,v_request.attempt_count,session_user::text,v_phase,
    v_request.state,v_state,
    CASE WHEN v_phase='invitation-issued' THEN p_provider_reference ELSE NULL END,
    CASE WHEN v_phase='invitation-issued' THEN NULL ELSE p_error_code END);
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.claim_staff_account_provisioning_request(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_staff_account_provisioning_request(uuid,uuid,text,text,text,integer,integer) FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO vmms_staff_account_function_owner;
ALTER FUNCTION public.claim_staff_account_provisioning_request(integer) OWNER TO vmms_staff_account_function_owner;
ALTER FUNCTION public.complete_staff_account_provisioning_request(uuid,uuid,text,text,text,integer,integer) OWNER TO vmms_staff_account_function_owner;
REVOKE CREATE ON SCHEMA public FROM vmms_staff_account_function_owner;
GRANT USAGE ON SCHEMA public TO vmms_staff_account_worker;
GRANT EXECUTE ON FUNCTION public.claim_staff_account_provisioning_request(integer) TO vmms_staff_account_worker;
GRANT EXECUTE ON FUNCTION public.complete_staff_account_provisioning_request(uuid,uuid,text,text,text,integer,integer) TO vmms_staff_account_worker;
