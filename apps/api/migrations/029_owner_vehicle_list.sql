CREATE FUNCTION public.current_vehicle_owner_vehicles(p_session_hash text)
RETURNS TABLE(session_valid boolean, vehicle_id uuid, registration text, make text, model text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  session_row record;
BEGIN
  IF p_session_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  SELECT s.owner_account_id, s.organisation_id, s.site_id
  INTO session_row
  FROM public.owner_sessions s
  JOIN public.vehicle_owner_accounts a
    ON a.organisation_id=s.organisation_id AND a.id=s.owner_account_id
  WHERE s.token_hash=p_session_hash
    AND s.expires_at>transaction_timestamp()
    AND a.active
  FOR SHARE OF s, a;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Relationship commands lock the access scope before changing its revisions.
  -- Taking the same lock prevents a concurrent revocation/transfer from racing
  -- this read and returning data after the change has committed.
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
    SELECT 1
    FROM public.vehicle_owner_relationships relationship
    JOIN public.vehicle_owner_access_scopes scope
      ON scope.organisation_id=relationship.organisation_id
      AND scope.site_id=relationship.site_id
      AND scope.id=relationship.access_scope_id
    JOIN LATERAL (
      SELECT revision.state, revision.effective_from, revision.effective_until
      FROM public.vehicle_owner_revisions revision
      WHERE revision.organisation_id=relationship.organisation_id
        AND revision.site_id=relationship.site_id
        AND revision.relationship_id=relationship.id
      ORDER BY revision.revision DESC
      LIMIT 1
    ) current_revision ON true
    WHERE relationship.organisation_id=session_row.organisation_id
      AND relationship.site_id=session_row.site_id
      AND relationship.owner_account_id=session_row.owner_account_id
      AND current_revision.state='approved'
      AND current_revision.effective_from<=transaction_timestamp()
      AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true, vehicle.id, vehicle.registration, vehicle.make, vehicle.model
  FROM public.vehicle_owner_relationships relationship
  JOIN public.vehicle_owner_access_scopes scope
    ON scope.organisation_id=relationship.organisation_id
    AND scope.site_id=relationship.site_id
    AND scope.id=relationship.access_scope_id
  JOIN public.vehicles vehicle
    ON vehicle.organisation_id=scope.organisation_id
    AND vehicle.id=scope.vehicle_id
  JOIN LATERAL (
    SELECT revision.state, revision.effective_from, revision.effective_until
    FROM public.vehicle_owner_revisions revision
    WHERE revision.organisation_id=relationship.organisation_id
      AND revision.site_id=relationship.site_id
      AND revision.relationship_id=relationship.id
    ORDER BY revision.revision DESC
    LIMIT 1
  ) current_revision ON true
  WHERE relationship.organisation_id=session_row.organisation_id
    AND relationship.site_id=session_row.site_id
    AND relationship.owner_account_id=session_row.owner_account_id
    AND current_revision.state='approved'
    AND current_revision.effective_from<=transaction_timestamp()
    AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
  ORDER BY vehicle.registration, vehicle.id;
END;
$$;

REVOKE ALL ON FUNCTION public.current_vehicle_owner_vehicles(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_vehicle_owner_vehicles(text) TO vmms_runtime;
