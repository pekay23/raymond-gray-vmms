ALTER TABLE oidc_login_transactions
  ADD COLUMN login_intent text NOT NULL DEFAULT 'staff' CHECK (login_intent IN ('staff','owner')),
  ADD COLUMN owner_invitation_token_hash text CHECK (
    owner_invitation_token_hash IS NULL OR owner_invitation_token_hash ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT oidc_login_owner_claim_intent_check CHECK (
    login_intent='owner' OR owner_invitation_token_hash IS NULL
  );

CREATE TABLE owner_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id),
  FOREIGN KEY (organisation_id, owner_account_id)
    REFERENCES vehicle_owner_accounts (organisation_id, id)
);
CREATE INDEX owner_sessions_expiry ON owner_sessions(expires_at);

CREATE FUNCTION public.current_vehicle_owner_session(p_session_hash text)
RETURNS TABLE(owner_account_id uuid,organisation_id uuid,site_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT s.owner_account_id,s.organisation_id,s.site_id
  FROM public.owner_sessions s
  JOIN public.vehicle_owner_accounts a
    ON a.organisation_id=s.organisation_id AND a.id=s.owner_account_id
  WHERE s.token_hash=p_session_hash AND s.expires_at>transaction_timestamp()
    AND a.active
    AND EXISTS (
      SELECT 1
      FROM public.vehicle_owner_relationships r
      JOIN public.vehicle_owner_access_scopes scope
        ON scope.organisation_id=r.organisation_id AND scope.site_id=r.site_id AND scope.id=r.access_scope_id
      JOIN LATERAL (
        SELECT state,effective_from,effective_until
        FROM public.vehicle_owner_revisions
        WHERE organisation_id=r.organisation_id AND site_id=r.site_id AND relationship_id=r.id
        ORDER BY revision DESC LIMIT 1
      ) current_revision ON true
      WHERE r.organisation_id=s.organisation_id AND r.site_id=s.site_id AND r.owner_account_id=a.id
        AND current_revision.state='approved'
        AND current_revision.effective_from<=transaction_timestamp()
        AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
    )
$$;
REVOKE ALL ON FUNCTION public.current_vehicle_owner_session(text) FROM PUBLIC;

CREATE FUNCTION public.revoke_vehicle_owner_session(p_session_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  DELETE FROM public.owner_sessions WHERE token_hash=p_session_hash
$$;
REVOKE ALL ON FUNCTION public.revoke_vehicle_owner_session(text) FROM PUBLIC;

CREATE FUNCTION public.claim_vehicle_owner_invitation(
  p_token_hash text,
  p_issuer text,
  p_subject text,
  p_session_hash text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  invitation public.vehicle_owner_invitations%ROWTYPE;
  account public.vehicle_owner_accounts%ROWTYPE;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_session_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO invitation
  FROM public.vehicle_owner_invitations i
  WHERE i.token_hash=p_token_hash
    AND i.claimed_at IS NULL AND i.revoked_at IS NULL
    AND i.expires_at>transaction_timestamp();
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO account
  FROM public.vehicle_owner_accounts a
  WHERE a.organisation_id=invitation.organisation_id
    AND a.id=invitation.owner_account_id
    AND a.issuer=p_issuer AND a.subject=p_subject AND a.active
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM s.id
  FROM public.vehicle_owner_access_scopes s
  JOIN public.vehicle_owner_relationships r
    ON r.organisation_id=s.organisation_id AND r.site_id=s.site_id AND r.access_scope_id=s.id
  WHERE s.organisation_id=invitation.organisation_id
    AND s.site_id=invitation.site_id AND r.owner_account_id=account.id
  FOR SHARE OF s;

  SELECT * INTO invitation
  FROM public.vehicle_owner_invitations i
  WHERE i.id=invitation.id AND i.token_hash=p_token_hash
    AND i.claimed_at IS NULL AND i.revoked_at IS NULL
    AND i.expires_at>transaction_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.vehicle_owner_relationships r
    JOIN public.vehicle_owner_access_scopes s
      ON s.organisation_id=r.organisation_id AND s.site_id=r.site_id AND s.id=r.access_scope_id
    JOIN LATERAL (
      SELECT state,effective_from,effective_until
      FROM public.vehicle_owner_revisions
      WHERE organisation_id=r.organisation_id AND site_id=r.site_id AND relationship_id=r.id
      ORDER BY revision DESC LIMIT 1
    ) current_revision ON true
    WHERE r.organisation_id=invitation.organisation_id
      AND r.site_id=invitation.site_id AND r.owner_account_id=account.id
      AND current_revision.state='approved'
      AND current_revision.effective_from<=transaction_timestamp()
      AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE public.vehicle_owner_invitations
  SET claimed_at=transaction_timestamp()
  WHERE id=invitation.id;
  INSERT INTO public.owner_sessions(token_hash,organisation_id,site_id,owner_account_id,expires_at)
    VALUES(p_session_hash,account.organisation_id,invitation.site_id,account.id,transaction_timestamp()+interval '8 hours');
  RETURN account.id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_vehicle_owner_invitation(text,text,text,text) FROM PUBLIC;

CREATE FUNCTION public.create_vehicle_owner_session(
  p_issuer text,
  p_subject text,
  p_session_hash text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  account public.vehicle_owner_accounts%ROWTYPE;
  account_count integer;
  session_site_id uuid;
BEGIN
  IF p_session_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT count(DISTINCT (i.organisation_id,i.site_id)) INTO account_count
  FROM public.vehicle_owner_accounts a
  JOIN public.vehicle_owner_invitations i
    ON i.organisation_id=a.organisation_id AND i.owner_account_id=a.id AND i.claimed_at IS NOT NULL
  JOIN public.vehicle_owner_relationships r
    ON r.organisation_id=i.organisation_id AND r.site_id=i.site_id AND r.owner_account_id=a.id
  JOIN public.vehicle_owner_access_scopes s
    ON s.organisation_id=r.organisation_id AND s.site_id=r.site_id AND s.id=r.access_scope_id
  JOIN LATERAL (
    SELECT state,effective_from,effective_until FROM public.vehicle_owner_revisions
    WHERE organisation_id=r.organisation_id AND site_id=r.site_id AND relationship_id=r.id
    ORDER BY revision DESC LIMIT 1
  ) current_revision ON true
  WHERE a.issuer=p_issuer AND a.subject=p_subject AND a.active
    AND current_revision.state='approved' AND current_revision.effective_from<=transaction_timestamp()
    AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until);
  IF account_count<>1 THEN RETURN NULL; END IF;

  SELECT a.* INTO account
  FROM public.vehicle_owner_accounts a
  JOIN public.vehicle_owner_invitations i
    ON i.organisation_id=a.organisation_id AND i.owner_account_id=a.id AND i.claimed_at IS NOT NULL
  JOIN public.vehicle_owner_relationships r
    ON r.organisation_id=i.organisation_id AND r.site_id=i.site_id AND r.owner_account_id=a.id
  JOIN LATERAL (
    SELECT state,effective_from,effective_until FROM public.vehicle_owner_revisions
    WHERE organisation_id=r.organisation_id AND site_id=r.site_id AND relationship_id=r.id
    ORDER BY revision DESC LIMIT 1
  ) current_revision ON true
  WHERE a.issuer=p_issuer AND a.subject=p_subject AND a.active
    AND current_revision.state='approved' AND current_revision.effective_from<=transaction_timestamp()
    AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
  ORDER BY i.claimed_at DESC LIMIT 1
  FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT i.site_id INTO session_site_id
  FROM public.vehicle_owner_invitations i
  JOIN public.vehicle_owner_relationships r
    ON r.organisation_id=i.organisation_id AND r.site_id=i.site_id AND r.owner_account_id=i.owner_account_id
  JOIN LATERAL (
    SELECT state,effective_from,effective_until FROM public.vehicle_owner_revisions
    WHERE organisation_id=r.organisation_id AND site_id=r.site_id AND relationship_id=r.id
    ORDER BY revision DESC LIMIT 1
  ) current_revision ON true
  WHERE i.organisation_id=account.organisation_id AND i.owner_account_id=account.id AND i.claimed_at IS NOT NULL
    AND current_revision.state='approved' AND current_revision.effective_from<=transaction_timestamp()
    AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
  ORDER BY i.claimed_at DESC LIMIT 1;

  PERFORM s.id
  FROM public.vehicle_owner_access_scopes s
  JOIN public.vehicle_owner_relationships r
    ON r.organisation_id=s.organisation_id AND r.site_id=s.site_id AND r.access_scope_id=s.id
  WHERE s.organisation_id=account.organisation_id AND s.site_id=session_site_id AND r.owner_account_id=account.id
  FOR SHARE OF s;

  IF NOT EXISTS (
    SELECT 1
    FROM public.vehicle_owner_relationships r
    JOIN public.vehicle_owner_access_scopes s
      ON s.organisation_id=r.organisation_id AND s.site_id=r.site_id AND s.id=r.access_scope_id
    JOIN LATERAL (
      SELECT state,effective_from,effective_until
      FROM public.vehicle_owner_revisions
      WHERE organisation_id=r.organisation_id AND site_id=r.site_id AND relationship_id=r.id
      ORDER BY revision DESC LIMIT 1
    ) current_revision ON true
    WHERE r.organisation_id=account.organisation_id AND r.site_id=session_site_id AND r.owner_account_id=account.id
      AND current_revision.state='approved'
      AND current_revision.effective_from<=transaction_timestamp()
      AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.owner_sessions(token_hash,organisation_id,site_id,owner_account_id,expires_at)
    VALUES(p_session_hash,account.organisation_id,session_site_id,account.id,transaction_timestamp()+interval '8 hours');
  RETURN account.id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_vehicle_owner_session(text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_vehicle_owner_session(text) TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.revoke_vehicle_owner_session(text) TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.claim_vehicle_owner_invitation(text,text,text,text) TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.create_vehicle_owner_session(text,text,text) TO vmms_runtime;
