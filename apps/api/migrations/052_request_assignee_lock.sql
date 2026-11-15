-- Bound the target lock to the current site and an active scoped caller. NOWAIT
-- avoids a lock cycle with a target who is concurrently starting a command.
CREATE FUNCTION public.lock_request_assignee(p_target uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT m.can_write FROM public.memberships m
  JOIN public.staff_users u ON u.id=m.user_id AND u.active
  JOIN public.sites s ON s.id=m.site_id
  WHERE m.user_id=p_target AND m.active AND m.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND s.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM public.memberships caller JOIN public.staff_users cu ON cu.id=caller.user_id AND cu.active
      WHERE caller.user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND caller.site_id=m.site_id AND caller.active AND caller.can_write)
  FOR SHARE OF m,u NOWAIT
$function$;
REVOKE ALL ON FUNCTION public.lock_request_assignee(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_request_assignee(uuid) TO vmms_runtime;
