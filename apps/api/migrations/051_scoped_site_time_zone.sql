CREATE FUNCTION public.current_scoped_site_timezone() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT s.time_zone FROM public.sites s
  JOIN public.memberships m ON m.site_id=s.id AND m.active
  JOIN public.staff_users u ON u.id=m.user_id AND u.active
  WHERE s.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND s.id=nullif(current_setting('app.site_id',true),'')::uuid
    AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
$function$;
REVOKE ALL ON FUNCTION public.current_scoped_site_timezone() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_scoped_site_timezone() TO vmms_runtime;
GRANT vmms_identity_function_owner TO CURRENT_USER;
GRANT CREATE ON SCHEMA public TO vmms_identity_function_owner;
ALTER FUNCTION public.current_scoped_site_timezone() OWNER TO vmms_identity_function_owner;
REVOKE CREATE ON SCHEMA public FROM vmms_identity_function_owner;
REVOKE vmms_identity_function_owner FROM CURRENT_USER;
