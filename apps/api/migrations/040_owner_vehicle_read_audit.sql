DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vmms_owner_read_audit_function_owner') THEN
    CREATE ROLE vmms_owner_read_audit_function_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$roles$;
COMMENT ON ROLE vmms_owner_read_audit_function_owner IS 'NOLOGIN, non-superuser owner of the narrowly scoped, RLS-bound owner vehicle projection and audit function.';

CREATE TABLE public.owner_vehicle_read_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  action text NOT NULL CHECK (action='owner-vehicle-list-read-prepared'),
  projection_revision integer NOT NULL CHECK (projection_revision=1),
  result_count integer NOT NULL CHECK (result_count>=0),
  request_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organisation_id,site_id) REFERENCES public.sites(organisation_id,id),
  FOREIGN KEY (organisation_id,owner_account_id) REFERENCES public.vehicle_owner_accounts(organisation_id,id)
);
ALTER TABLE public.owner_vehicle_read_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_vehicle_read_events FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_vehicle_read_event_scope ON public.owner_vehicle_read_events
  WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND owner_account_id=nullif(current_setting('app.owner_account_id',true),'')::uuid
  );
REVOKE ALL ON public.owner_vehicle_read_events FROM PUBLIC,vmms_runtime;
GRANT INSERT (organisation_id,site_id,owner_account_id,action,projection_revision,result_count,request_id)
  ON public.owner_vehicle_read_events TO vmms_owner_read_audit_function_owner;

CREATE FUNCTION public.reject_owner_vehicle_read_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'owner vehicle read events are immutable' USING ERRCODE='55000';
END
$$;
CREATE TRIGGER owner_vehicle_read_events_immutable
  BEFORE UPDATE OR DELETE ON public.owner_vehicle_read_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_owner_vehicle_read_event_mutation();

GRANT USAGE ON SCHEMA public TO vmms_owner_read_audit_function_owner;
GRANT SELECT ON public.owner_sessions,public.vehicle_owner_accounts,public.vehicle_owner_access_scopes,
  public.vehicle_owner_relationships,public.vehicle_owner_revisions,public.vehicles
  TO vmms_owner_read_audit_function_owner;
GRANT UPDATE (token_hash) ON public.owner_sessions TO vmms_owner_read_audit_function_owner;
GRANT UPDATE (id) ON public.vehicle_owner_accounts,public.vehicle_owner_access_scopes TO vmms_owner_read_audit_function_owner;

DROP FUNCTION public.current_vehicle_owner_vehicles(text);
CREATE FUNCTION public.current_vehicle_owner_vehicles(p_session_hash text,p_request_id uuid)
RETURNS TABLE(session_valid boolean,vehicle_id uuid,registration text,make text,model text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  session_row record;
  result_count integer;
BEGIN
  IF p_session_hash !~ '^[0-9a-f]{64}$' OR p_request_id IS NULL THEN
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,NULL::text,NULL::text;
    RETURN;
  END IF;

  SELECT s.owner_account_id,s.organisation_id,s.site_id
  INTO session_row
  FROM public.owner_sessions s
  WHERE s.token_hash=p_session_hash AND s.expires_at>transaction_timestamp()
  FOR SHARE OF s;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,NULL::text,NULL::text;
    RETURN;
  END IF;

  PERFORM set_config('app.organisation_id',session_row.organisation_id::text,true);
  PERFORM set_config('app.site_id',session_row.site_id::text,true);
  PERFORM set_config('app.owner_account_id',session_row.owner_account_id::text,true);

  PERFORM a.id FROM public.vehicle_owner_accounts a
    WHERE a.organisation_id=session_row.organisation_id AND a.id=session_row.owner_account_id AND a.active
    FOR SHARE OF a;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,NULL::text,NULL::text;
    RETURN;
  END IF;

  PERFORM scope.id
  FROM public.vehicle_owner_access_scopes scope
  JOIN public.vehicle_owner_relationships relationship
    ON relationship.organisation_id=scope.organisation_id
    AND relationship.site_id=scope.site_id
    AND relationship.access_scope_id=scope.id
  WHERE scope.organisation_id=session_row.organisation_id
    AND scope.site_id=session_row.site_id
    AND relationship.owner_account_id=session_row.owner_account_id
  ORDER BY scope.id
  FOR SHARE OF scope;

  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_owner_relationships relationship
    JOIN public.vehicle_owner_access_scopes scope
      ON scope.organisation_id=relationship.organisation_id AND scope.site_id=relationship.site_id AND scope.id=relationship.access_scope_id
    JOIN LATERAL (
      SELECT revision.state,revision.effective_from,revision.effective_until
      FROM public.vehicle_owner_revisions revision
      WHERE revision.organisation_id=relationship.organisation_id AND revision.site_id=relationship.site_id AND revision.relationship_id=relationship.id
      ORDER BY revision.revision DESC LIMIT 1
    ) current_revision ON true
    WHERE relationship.organisation_id=session_row.organisation_id AND relationship.site_id=session_row.site_id
      AND relationship.owner_account_id=session_row.owner_account_id AND current_revision.state='approved'
      AND current_revision.effective_from<=transaction_timestamp()
      AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
  ) THEN
    RETURN QUERY SELECT false,NULL::uuid,NULL::text,NULL::text,NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true,vehicle.id,vehicle.registration,vehicle.make,vehicle.model
  FROM public.vehicle_owner_relationships relationship
  JOIN public.vehicle_owner_access_scopes scope
    ON scope.organisation_id=relationship.organisation_id AND scope.site_id=relationship.site_id AND scope.id=relationship.access_scope_id
  JOIN public.vehicles vehicle ON vehicle.organisation_id=scope.organisation_id AND vehicle.id=scope.vehicle_id
  JOIN LATERAL (
    SELECT revision.state,revision.effective_from,revision.effective_until
    FROM public.vehicle_owner_revisions revision
    WHERE revision.organisation_id=relationship.organisation_id AND revision.site_id=relationship.site_id AND revision.relationship_id=relationship.id
    ORDER BY revision.revision DESC LIMIT 1
  ) current_revision ON true
  WHERE relationship.organisation_id=session_row.organisation_id AND relationship.site_id=session_row.site_id
    AND relationship.owner_account_id=session_row.owner_account_id AND current_revision.state='approved'
    AND current_revision.effective_from<=transaction_timestamp()
    AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
  ORDER BY vehicle.registration,vehicle.id;

  GET DIAGNOSTICS result_count=ROW_COUNT;
  INSERT INTO public.owner_vehicle_read_events
    (organisation_id,site_id,owner_account_id,action,projection_revision,result_count,request_id)
  VALUES (session_row.organisation_id,session_row.site_id,session_row.owner_account_id,
    'owner-vehicle-list-read-prepared',1,result_count,p_request_id);
END
$$;
REVOKE ALL ON FUNCTION public.current_vehicle_owner_vehicles(text,uuid) FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO vmms_owner_read_audit_function_owner;
ALTER FUNCTION public.current_vehicle_owner_vehicles(text,uuid) OWNER TO vmms_owner_read_audit_function_owner;
REVOKE CREATE ON SCHEMA public FROM vmms_owner_read_audit_function_owner;
GRANT EXECUTE ON FUNCTION public.current_vehicle_owner_vehicles(text,uuid) TO vmms_runtime;
