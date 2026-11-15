CREATE TABLE vehicle_owner_invitations (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  evidence_record_id uuid NOT NULL,
  issued_by uuid NOT NULL REFERENCES staff_users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, id),
  UNIQUE (token_hash),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id),
  FOREIGN KEY (organisation_id, owner_account_id) REFERENCES vehicle_owner_accounts (organisation_id, id),
  FOREIGN KEY (organisation_id, site_id, evidence_record_id) REFERENCES evidence_records (organisation_id, site_id, id),
  CHECK (expires_at > created_at),
  CHECK (claimed_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX vehicle_owner_invitations_owner_history
  ON vehicle_owner_invitations (organisation_id, site_id, owner_account_id, created_at DESC);
CREATE INDEX vehicle_owner_invitations_live_token
  ON vehicle_owner_invitations (token_hash, expires_at)
  WHERE claimed_at IS NULL AND revoked_at IS NULL;

CREATE FUNCTION public.lock_current_vehicle_owner_relationship(p_owner_account_id uuid,p_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_site_id IS DISTINCT FROM nullif(current_setting('app.site_id',true),'')::uuid THEN
    RETURN false;
  END IF;

  PERFORM s.id
  FROM public.vehicle_owner_access_scopes s
  JOIN public.vehicle_owner_relationships r
    ON r.organisation_id=s.organisation_id AND r.site_id=s.site_id AND r.access_scope_id=s.id
  WHERE s.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND s.site_id=p_site_id AND r.owner_account_id=p_owner_account_id
  FOR SHARE OF s;

  PERFORM r.id
  FROM public.vehicle_owner_relationships r
  JOIN public.vehicle_owner_access_scopes s
    ON s.organisation_id=r.organisation_id AND s.site_id=r.site_id AND s.id=r.access_scope_id
  JOIN public.vehicle_owner_accounts a
    ON a.organisation_id=r.organisation_id AND a.id=r.owner_account_id AND a.active
  JOIN LATERAL (
    SELECT state,effective_from,effective_until
    FROM public.vehicle_owner_revisions
    WHERE organisation_id=r.organisation_id AND site_id=r.site_id AND relationship_id=r.id
    ORDER BY revision DESC LIMIT 1
  ) current_revision ON true
  WHERE r.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND r.site_id=p_site_id AND r.owner_account_id=p_owner_account_id
    AND current_revision.state='approved'
    AND current_revision.effective_from<=transaction_timestamp()
    AND (current_revision.effective_until IS NULL OR transaction_timestamp()<current_revision.effective_until)
  LIMIT 1;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_current_vehicle_owner_relationship(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.enforce_vehicle_owner_invitation_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF ROW(NEW.id,NEW.organisation_id,NEW.site_id,NEW.owner_account_id,NEW.token_hash,NEW.evidence_record_id,
      NEW.issued_by,NEW.reason,NEW.expires_at,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id,OLD.organisation_id,OLD.site_id,OLD.owner_account_id,OLD.token_hash,OLD.evidence_record_id,
      OLD.issued_by,OLD.reason,OLD.expires_at,OLD.created_at) THEN
    RAISE EXCEPTION 'vehicle owner invitation evidence is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.claimed_at IS NOT NULL OR OLD.revoked_at IS NOT NULL
     OR (NEW.claimed_at IS NULL AND NEW.revoked_at IS NULL)
     OR (NEW.claimed_at IS NOT NULL AND NEW.revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'vehicle owner invitation can make only one terminal transition' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_vehicle_owner_invitation_transition() FROM PUBLIC;

CREATE TRIGGER vehicle_owner_invitation_transition
  BEFORE UPDATE ON vehicle_owner_invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vehicle_owner_invitation_transition();

ALTER TABLE vehicle_owner_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_owner_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_invitation_site_scope ON vehicle_owner_invitations
  USING (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  )
  WITH CHECK (
    organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
    AND site_id = nullif(current_setting('app.site_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE ON vehicle_owner_invitations TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.lock_current_vehicle_owner_relationship(uuid,uuid) TO vmms_runtime;
