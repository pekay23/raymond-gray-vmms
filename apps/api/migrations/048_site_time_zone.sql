ALTER TABLE public.sites
  ADD COLUMN time_zone text NOT NULL DEFAULT 'Africa/Accra'
  CHECK (length(btrim(time_zone)) BETWEEN 1 AND 64);

GRANT SELECT (time_zone) ON public.sites TO vmms_identity_function_owner;

GRANT vmms_identity_function_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO vmms_identity_function_owner;
DROP FUNCTION public.current_staff_session_sites(text);

CREATE FUNCTION public.current_staff_session_sites(p_token_hash text)
RETURNS TABLE(site_id uuid,organisation_id uuid,site_name text,site_code text,site_time_zone text,can_write boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT s.id,s.organisation_id,s.name,s.code,s.time_zone,m.can_write
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
ALTER FUNCTION public.current_staff_session_sites(text) OWNER TO vmms_identity_function_owner;
REVOKE CREATE ON SCHEMA public FROM vmms_identity_function_owner;
REVOKE vmms_identity_function_owner FROM CURRENT_USER;
