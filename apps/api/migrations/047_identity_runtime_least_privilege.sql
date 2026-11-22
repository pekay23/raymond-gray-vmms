DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vmms_identity_function_owner') THEN
    CREATE ROLE vmms_identity_function_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$roles$;
-- Managed PostgreSQL roles are not superusers; membership is required for ALTER OWNER.
GRANT vmms_identity_function_owner TO CURRENT_USER;

ALTER ROLE vmms_identity_function_owner NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
COMMENT ON ROLE vmms_identity_function_owner IS 'NOLOGIN role for narrow SECURITY DEFINER identity/session lookups; never grant membership to vmms_runtime.';
GRANT USAGE ON SCHEMA public TO vmms_identity_function_owner;

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_current_scope ON public.organisations
  USING (id=nullif(current_setting('app.organisation_id',true),'')::uuid)
  WITH CHECK (id=nullif(current_setting('app.organisation_id',true),'')::uuid);

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sites FORCE ROW LEVEL SECURITY;
CREATE POLICY site_current_scope ON public.sites
  USING (
    id=nullif(current_setting('app.site_id',true),'')::uuid
    AND organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
  )
  WITH CHECK (
    id=nullif(current_setting('app.site_id',true),'')::uuid
    AND organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
  );

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_current_scope ON public.memberships
  USING (
    site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id=memberships.site_id
        AND s.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    )
  )
  WITH CHECK (
    site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id=memberships.site_id
        AND s.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    )
  );

ALTER TABLE public.staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_users FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_user_current_site_scope ON public.staff_users
  USING (
    id=nullif(current_setting('app.actor_id',true),'')::uuid
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id=staff_users.id
        AND m.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    )
  )
  WITH CHECK (
    id=nullif(current_setting('app.actor_id',true),'')::uuid
    OR EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id=staff_users.id
        AND m.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    )
  );

CREATE POLICY identity_functions_read_sites ON public.sites
  FOR SELECT TO vmms_identity_function_owner USING (true);
CREATE POLICY identity_functions_read_memberships ON public.memberships
  FOR SELECT TO vmms_identity_function_owner USING (true);
CREATE POLICY identity_functions_read_staff_users ON public.staff_users
  FOR SELECT TO vmms_identity_function_owner USING (true);

REVOKE ALL ON public.organisations FROM PUBLIC,vmms_runtime;
REVOKE ALL ON public.sites FROM PUBLIC,vmms_runtime;
REVOKE ALL ON public.memberships FROM PUBLIC,vmms_runtime;
REVOKE ALL ON public.staff_users FROM PUBLIC,vmms_runtime;
GRANT SELECT (id,organisation_id,code,name) ON public.sites TO vmms_runtime;
GRANT SELECT (user_id,site_id,can_write,active,membership_epoch) ON public.memberships TO vmms_runtime;
GRANT SELECT (id,username,display_name,active) ON public.staff_users TO vmms_runtime;

REVOKE ALL ON public.staff_sessions,public.staff_identities,public.oidc_login_transactions FROM PUBLIC,vmms_runtime;
GRANT SELECT,INSERT,DELETE ON public.staff_sessions TO vmms_identity_function_owner;
GRANT SELECT (id,display_name,active) ON public.staff_users TO vmms_identity_function_owner;
GRANT SELECT ON public.memberships,public.sites,public.staff_identities,public.oidc_login_transactions TO vmms_identity_function_owner;
GRANT INSERT,DELETE ON public.oidc_login_transactions TO vmms_identity_function_owner;

CREATE FUNCTION public.current_staff_session(p_token_hash text)
RETURNS TABLE(staff_user_id uuid,display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT u.id,u.display_name
  FROM public.staff_sessions s
  JOIN public.staff_users u ON u.id=s.user_id
  WHERE p_token_hash ~ '^[0-9a-f]{64}$'
    AND s.token_hash=p_token_hash
    AND s.expires_at>transaction_timestamp()
    AND u.active
$function$;
REVOKE ALL ON FUNCTION public.current_staff_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_session(text) TO vmms_runtime;

CREATE FUNCTION public.current_staff_session_sites(p_token_hash text)
RETURNS TABLE(site_id uuid,organisation_id uuid,site_name text,site_code text,can_write boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT s.id,s.organisation_id,s.name,s.code,m.can_write
  FROM public.staff_sessions session
  JOIN public.staff_users u ON u.id=session.user_id AND u.active
  JOIN public.memberships m ON m.user_id=u.id AND m.active
  JOIN public.sites s ON s.id=m.site_id
  WHERE p_token_hash ~ '^[0-9a-f]{64}$'
    AND session.token_hash=p_token_hash
    AND session.expires_at>transaction_timestamp()
  ORDER BY s.name,s.id
$function$;
REVOKE ALL ON FUNCTION public.current_staff_session_sites(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_session_sites(text) TO vmms_runtime;

CREATE FUNCTION public.current_staff_site_access(p_token_hash text,p_site_id uuid)
RETURNS TABLE(organisation_id uuid,can_write boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT s.organisation_id,m.can_write
  FROM public.staff_sessions session
  JOIN public.staff_users u ON u.id=session.user_id AND u.active
  JOIN public.memberships m ON m.user_id=u.id AND m.active AND m.site_id=p_site_id
  JOIN public.sites s ON s.id=m.site_id
  WHERE p_token_hash ~ '^[0-9a-f]{64}$'
    AND session.token_hash=p_token_hash
    AND session.expires_at>transaction_timestamp()
$function$;
REVOKE ALL ON FUNCTION public.current_staff_site_access(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_site_access(text,uuid) TO vmms_runtime;

CREATE FUNCTION public.active_staff_user(p_staff_user_id uuid)
RETURNS TABLE(staff_user_id uuid,display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT u.id,u.display_name FROM public.staff_users u WHERE u.id=p_staff_user_id AND u.active
$function$;
REVOKE ALL ON FUNCTION public.active_staff_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.active_staff_user(uuid) TO vmms_runtime;

CREATE FUNCTION public.resolve_active_staff_identity(p_issuer text,p_subject text)
RETURNS TABLE(staff_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT u.id
  FROM public.staff_identities identity
  JOIN public.staff_users u ON u.id=identity.staff_user_id AND u.active
  WHERE identity.issuer=p_issuer AND identity.subject=p_subject
$function$;
REVOKE ALL ON FUNCTION public.resolve_active_staff_identity(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_active_staff_identity(text,text) TO vmms_runtime;

CREATE FUNCTION public.create_staff_session(
  p_token_hash text,p_staff_user_id uuid,p_oidc_issuer text,p_oidc_client_id text,
  p_oidc_subject_hash text,p_oidc_session_hash text,p_oidc_issued_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid session token hash' USING ERRCODE='22023'; END IF;
  IF (p_oidc_issuer IS NULL)<>(p_oidc_client_id IS NULL)
    OR (p_oidc_issuer IS NULL)<>(p_oidc_subject_hash IS NULL)
    OR (p_oidc_issuer IS NULL)<>(p_oidc_issued_at IS NULL)
    OR (p_oidc_session_hash IS NOT NULL AND p_oidc_issuer IS NULL)
    OR (p_oidc_subject_hash IS NOT NULL AND p_oidc_subject_hash !~ '^[0-9a-f]{64}$')
    OR (p_oidc_session_hash IS NOT NULL AND p_oidc_session_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid OIDC session metadata' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_users u WHERE u.id=p_staff_user_id AND u.active) THEN
    RAISE EXCEPTION 'staff account is inactive' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.staff_sessions(
    token_hash,user_id,expires_at,oidc_issuer,oidc_client_id,oidc_subject_hash,oidc_session_hash,oidc_issued_at
  ) VALUES (
    p_token_hash,p_staff_user_id,transaction_timestamp()+interval '8 hours',
    p_oidc_issuer,p_oidc_client_id,p_oidc_subject_hash,p_oidc_session_hash,p_oidc_issued_at
  );
END
$function$;
REVOKE ALL ON FUNCTION public.create_staff_session(text,uuid,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_staff_session(text,uuid,text,text,text,text,timestamptz) TO vmms_runtime;

CREATE FUNCTION public.revoke_staff_session(p_token_hash text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  DELETE FROM public.staff_sessions WHERE p_token_hash ~ '^[0-9a-f]{64}$' AND token_hash=p_token_hash
$function$;
REVOKE ALL ON FUNCTION public.revoke_staff_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_staff_session(text) TO vmms_runtime;

CREATE FUNCTION public.create_oidc_login_transaction(
  p_state_hash text,p_binding_hash text,p_nonce text,p_code_verifier text,
  p_login_intent text,p_owner_invitation_token_hash text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
  IF p_state_hash !~ '^[0-9a-f]{64}$' OR p_binding_hash !~ '^[0-9a-f]{64}$'
    OR length(p_nonce) NOT BETWEEN 32 AND 255 OR length(p_code_verifier) NOT BETWEEN 43 AND 128
    OR p_login_intent NOT IN ('staff','owner')
    OR (p_owner_invitation_token_hash IS NOT NULL AND p_owner_invitation_token_hash !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid OIDC transaction' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.oidc_login_transactions(
    state_hash,browser_binding_hash,nonce,code_verifier,expires_at,login_intent,owner_invitation_token_hash
  ) VALUES (
    p_state_hash,p_binding_hash,p_nonce,p_code_verifier,transaction_timestamp()+interval '5 minutes',p_login_intent,p_owner_invitation_token_hash
  );
END
$function$;
REVOKE ALL ON FUNCTION public.create_oidc_login_transaction(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_oidc_login_transaction(text,text,text,text,text,text) TO vmms_runtime;

CREATE FUNCTION public.expire_oidc_login_transactions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $function$
BEGIN
  DELETE FROM public.oidc_login_transactions
  WHERE state_hash IN (
    SELECT state_hash FROM public.oidc_login_transactions
    WHERE expires_at<=transaction_timestamp() ORDER BY expires_at,state_hash LIMIT 10000
  );
END
$function$;
REVOKE ALL ON FUNCTION public.expire_oidc_login_transactions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_oidc_login_transactions() TO vmms_runtime;

CREATE FUNCTION public.cancel_oidc_login_transaction(p_state_hash text,p_binding_hash text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  DELETE FROM public.oidc_login_transactions
  WHERE p_state_hash ~ '^[0-9a-f]{64}$' AND p_binding_hash ~ '^[0-9a-f]{64}$'
    AND state_hash=p_state_hash AND browser_binding_hash=p_binding_hash
$function$;
REVOKE ALL ON FUNCTION public.cancel_oidc_login_transaction(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_oidc_login_transaction(text,text) TO vmms_runtime;

CREATE FUNCTION public.consume_oidc_login_transaction(p_state_hash text,p_binding_hash text)
RETURNS TABLE(nonce text,code_verifier text,login_intent text,owner_invitation_token_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  DELETE FROM public.oidc_login_transactions t
  WHERE p_state_hash ~ '^[0-9a-f]{64}$' AND p_binding_hash ~ '^[0-9a-f]{64}$'
    AND t.state_hash=p_state_hash AND t.browser_binding_hash=p_binding_hash
    AND t.expires_at>transaction_timestamp()
  RETURNING t.nonce,t.code_verifier,t.login_intent,t.owner_invitation_token_hash
$function$;
REVOKE ALL ON FUNCTION public.consume_oidc_login_transaction(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_oidc_login_transaction(text,text) TO vmms_runtime;

GRANT CREATE ON SCHEMA public TO vmms_identity_function_owner;
ALTER FUNCTION public.current_staff_session(text) OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.current_staff_session_sites(text) OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.current_staff_site_access(text,uuid) OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.active_staff_user(uuid) OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.resolve_active_staff_identity(text,text) OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.create_staff_session(text,uuid,text,text,text,text,timestamptz) OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.revoke_staff_session(text) OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.create_oidc_login_transaction(text,text,text,text,text,text) OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.expire_oidc_login_transactions() OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.cancel_oidc_login_transaction(text,text) OWNER TO vmms_identity_function_owner;
ALTER FUNCTION public.consume_oidc_login_transaction(text,text) OWNER TO vmms_identity_function_owner;
REVOKE CREATE ON SCHEMA public FROM vmms_identity_function_owner;
REVOKE vmms_identity_function_owner FROM CURRENT_USER;
