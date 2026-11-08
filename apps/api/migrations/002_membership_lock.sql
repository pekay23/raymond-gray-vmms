CREATE FUNCTION lock_membership(actor uuid, requested_site uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT m.can_write
  FROM public.memberships m JOIN public.sites s ON s.id=m.site_id
  WHERE m.user_id=actor AND m.site_id=requested_site AND m.active
    AND actor=nullif(current_setting('app.actor_id',true),'')::uuid
    AND requested_site=nullif(current_setting('app.site_id',true),'')::uuid
    AND s.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
  FOR SHARE OF m
$function$;
REVOKE ALL ON FUNCTION lock_membership(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_membership(uuid,uuid) TO vmms_runtime;
