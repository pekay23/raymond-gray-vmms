ALTER TABLE staff_sessions
  ADD COLUMN oidc_issuer text,
  ADD COLUMN oidc_client_id text,
  ADD COLUMN oidc_subject_hash text CHECK (oidc_subject_hash IS NULL OR oidc_subject_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN oidc_session_hash text CHECK (oidc_session_hash IS NULL OR oidc_session_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN oidc_issued_at timestamptz;

ALTER TABLE owner_sessions
  ADD COLUMN oidc_issuer text,
  ADD COLUMN oidc_client_id text,
  ADD COLUMN oidc_subject_hash text CHECK (oidc_subject_hash IS NULL OR oidc_subject_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN oidc_session_hash text CHECK (oidc_session_hash IS NULL OR oidc_session_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN oidc_issued_at timestamptz;

ALTER TABLE staff_sessions ADD CONSTRAINT staff_sessions_oidc_metadata_check CHECK (
  (oidc_issuer IS NULL AND oidc_client_id IS NULL AND oidc_subject_hash IS NULL AND oidc_issued_at IS NULL)
  OR (oidc_issuer IS NOT NULL AND oidc_client_id IS NOT NULL AND oidc_subject_hash IS NOT NULL AND oidc_issued_at IS NOT NULL)
);
ALTER TABLE owner_sessions ADD CONSTRAINT owner_sessions_oidc_metadata_check CHECK (
  (oidc_issuer IS NULL AND oidc_client_id IS NULL AND oidc_subject_hash IS NULL AND oidc_issued_at IS NULL)
  OR (oidc_issuer IS NOT NULL AND oidc_client_id IS NOT NULL AND oidc_subject_hash IS NOT NULL AND oidc_issued_at IS NOT NULL)
);

CREATE TABLE oidc_logout_receipts (
  jti_hash text PRIMARY KEY CHECK (jti_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL
);
CREATE TABLE oidc_revocation_barriers (
  issuer text NOT NULL,
  client_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('subject','session')),
  target_hash text NOT NULL CHECK (target_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (issuer,client_id,target_type,target_hash)
);
CREATE INDEX oidc_revocation_barriers_expiry ON oidc_revocation_barriers(expires_at);

CREATE FUNCTION public.cleanup_oidc_logout_state() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  DELETE FROM public.oidc_logout_receipts WHERE jti_hash IN (
    SELECT jti_hash FROM public.oidc_logout_receipts WHERE expires_at<=transaction_timestamp() ORDER BY expires_at LIMIT 10000
  );
  DELETE FROM public.oidc_revocation_barriers WHERE (issuer,client_id,target_type,target_hash) IN (
    SELECT issuer,client_id,target_type,target_hash FROM public.oidc_revocation_barriers
    WHERE expires_at<=transaction_timestamp() ORDER BY expires_at LIMIT 10000
  );
END $$;
REVOKE ALL ON FUNCTION public.cleanup_oidc_logout_state() FROM PUBLIC;

CREATE FUNCTION public.lock_oidc_logout_targets(
  p_issuer text,p_client_id text,p_subject_hash text,p_session_hash text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  lock_keys bigint[];
  lock_key bigint;
BEGIN
  IF p_subject_hash IS NULL AND p_session_hash IS NULL THEN RAISE EXCEPTION 'logout target required'; END IF;
  SELECT array_agg(key ORDER BY key) INTO lock_keys FROM (
    SELECT hashtextextended('vmms-oidc-sub:'||p_issuer||':'||p_client_id||':'||p_subject_hash,0) AS key WHERE p_subject_hash IS NOT NULL
    UNION ALL
    SELECT hashtextextended('vmms-oidc-sid:'||p_issuer||':'||p_client_id||':'||p_session_hash,0) WHERE p_session_hash IS NOT NULL
  ) targets;
  FOREACH lock_key IN ARRAY lock_keys LOOP PERFORM pg_advisory_xact_lock(lock_key); END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.lock_oidc_logout_targets(text,text,text,text) FROM PUBLIC;

CREATE FUNCTION public.oidc_login_is_revoked(
  p_issuer text,p_client_id text,p_subject_hash text,p_session_hash text,p_id_token_iat timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.lock_oidc_logout_targets(p_issuer,p_client_id,p_subject_hash,p_session_hash);
  RETURN EXISTS (
    SELECT 1 FROM public.oidc_revocation_barriers b
    WHERE b.issuer=p_issuer AND b.client_id=p_client_id AND b.expires_at>transaction_timestamp()
      AND b.issued_at>=p_id_token_iat
      AND ((b.target_type='subject' AND b.target_hash=p_subject_hash)
        OR (b.target_type='session' AND p_session_hash IS NOT NULL AND b.target_hash=p_session_hash))
  );
END $$;
REVOKE ALL ON FUNCTION public.oidc_login_is_revoked(text,text,text,text,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.process_oidc_logout(
  p_issuer text,p_client_id text,p_subject_hash text,p_session_hash text,
  p_id_token_iat timestamptz,p_jti_hash text,p_expires_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE inserted_count integer;
BEGIN
  IF (p_subject_hash IS NULL AND p_session_hash IS NULL) OR p_jti_hash !~ '^[0-9a-f]{64}$'
    OR p_expires_at<=transaction_timestamp() OR p_id_token_iat>transaction_timestamp()+interval '60 seconds' THEN
    RAISE EXCEPTION 'invalid logout event';
  END IF;
  PERFORM public.lock_oidc_logout_targets(p_issuer,p_client_id,p_subject_hash,p_session_hash);
  INSERT INTO public.oidc_logout_receipts(jti_hash,expires_at) VALUES(p_jti_hash,p_expires_at)
    ON CONFLICT(jti_hash) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count=0 THEN RETURN false; END IF;

  IF p_subject_hash IS NOT NULL THEN
    INSERT INTO public.oidc_revocation_barriers(issuer,client_id,target_type,target_hash,issued_at,expires_at)
      VALUES(p_issuer,p_client_id,'subject',p_subject_hash,p_id_token_iat,p_expires_at)
      ON CONFLICT(issuer,client_id,target_type,target_hash) DO UPDATE
        SET issued_at=GREATEST(oidc_revocation_barriers.issued_at,EXCLUDED.issued_at),
            expires_at=GREATEST(oidc_revocation_barriers.expires_at,EXCLUDED.expires_at);
  END IF;
  IF p_session_hash IS NOT NULL THEN
    INSERT INTO public.oidc_revocation_barriers(issuer,client_id,target_type,target_hash,issued_at,expires_at)
      VALUES(p_issuer,p_client_id,'session',p_session_hash,p_id_token_iat,p_expires_at)
      ON CONFLICT(issuer,client_id,target_type,target_hash) DO UPDATE
        SET issued_at=GREATEST(oidc_revocation_barriers.issued_at,EXCLUDED.issued_at),
            expires_at=GREATEST(oidc_revocation_barriers.expires_at,EXCLUDED.expires_at);
  END IF;

  DELETE FROM public.staff_sessions s WHERE s.oidc_issuer=p_issuer AND s.oidc_client_id=p_client_id
    AND (p_subject_hash IS NULL OR (s.oidc_subject_hash=p_subject_hash AND s.oidc_issued_at<=p_id_token_iat))
    AND (p_session_hash IS NULL OR s.oidc_session_hash=p_session_hash);
  DELETE FROM public.owner_sessions s WHERE s.oidc_issuer=p_issuer AND s.oidc_client_id=p_client_id
    AND (p_subject_hash IS NULL OR (s.oidc_subject_hash=p_subject_hash AND s.oidc_issued_at<=p_id_token_iat))
    AND (p_session_hash IS NULL OR s.oidc_session_hash=p_session_hash);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.process_oidc_logout(text,text,text,text,timestamptz,text,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.create_vehicle_owner_session_with_oidc(
  p_issuer text,p_subject text,p_subject_hash text,p_session_hash text,p_provider_session_hash text,p_id_token_iat timestamptz,p_client_id text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_id uuid;
BEGIN
  IF public.oidc_login_is_revoked(p_issuer,p_client_id,p_subject_hash,p_provider_session_hash,p_id_token_iat) THEN RETURN NULL; END IF;
  account_id:=public.create_vehicle_owner_session(p_issuer,p_subject,p_session_hash);
  IF account_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.owner_sessions SET oidc_issuer=p_issuer,oidc_client_id=p_client_id,
    oidc_subject_hash=p_subject_hash,oidc_session_hash=p_provider_session_hash,oidc_issued_at=p_id_token_iat
  WHERE token_hash=p_session_hash;
  RETURN account_id;
END $$;

CREATE FUNCTION public.claim_vehicle_owner_invitation_with_oidc(
  p_claim_hash text,p_issuer text,p_subject text,p_subject_hash text,p_session_hash text,p_provider_session_hash text,p_id_token_iat timestamptz,p_client_id text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_id uuid;
BEGIN
  IF public.oidc_login_is_revoked(p_issuer,p_client_id,p_subject_hash,p_provider_session_hash,p_id_token_iat) THEN RETURN NULL; END IF;
  account_id:=public.claim_vehicle_owner_invitation(p_claim_hash,p_issuer,p_subject,p_session_hash);
  IF account_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.owner_sessions SET oidc_issuer=p_issuer,oidc_client_id=p_client_id,
    oidc_subject_hash=p_subject_hash,oidc_session_hash=p_provider_session_hash,oidc_issued_at=p_id_token_iat
  WHERE token_hash=p_session_hash;
  RETURN account_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_vehicle_owner_session(text,text,text) FROM vmms_runtime;
REVOKE EXECUTE ON FUNCTION public.claim_vehicle_owner_invitation(text,text,text,text) FROM vmms_runtime;
REVOKE ALL ON FUNCTION public.create_vehicle_owner_session_with_oidc(text,text,text,text,text,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_vehicle_owner_invitation_with_oidc(text,text,text,text,text,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.oidc_login_is_revoked(text,text,text,text,timestamptz) TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.process_oidc_logout(text,text,text,text,timestamptz,text,timestamptz) TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.cleanup_oidc_logout_state() TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.create_vehicle_owner_session_with_oidc(text,text,text,text,text,timestamptz,text) TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.claim_vehicle_owner_invitation_with_oidc(text,text,text,text,text,text,timestamptz,text) TO vmms_runtime;
