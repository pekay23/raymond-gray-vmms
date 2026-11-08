CREATE TABLE evidence_records (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  scan_state text NOT NULL CHECK (scan_state IN ('pending', 'accepted', 'rejected', 'quarantined')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  media_type text NOT NULL CHECK (length(media_type) BETWEEN 1 AND 160),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  created_by uuid NOT NULL REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id)
);

CREATE TABLE vehicle_owner_accounts (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, issuer, subject)
);

CREATE TABLE owner_access_approver_grants (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  staff_user_id uuid NOT NULL REFERENCES staff_users(id),
  capability text NOT NULL CHECK (capability = 'vehicle-owner-access.manage'),
  granted_by uuid NOT NULL REFERENCES staff_users(id),
  evidence_record_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id),
  FOREIGN KEY (organisation_id, site_id, evidence_record_id) REFERENCES evidence_records (organisation_id, site_id, id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (revoked_at IS NULL OR revoked_at >= valid_from)
);

CREATE TABLE vehicle_owner_access_scopes (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  aggregate_type text NOT NULL DEFAULT 'vehicle-owner-access' CHECK (aggregate_type = 'vehicle-owner-access'),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, id),
  UNIQUE (organisation_id, site_id, vehicle_id),
  FOREIGN KEY (organisation_id, site_id, id, aggregate_type)
    REFERENCES aggregate_roots (organisation_id, site_id, id, aggregate_type),
  FOREIGN KEY (organisation_id, site_id) REFERENCES sites (organisation_id, id),
  FOREIGN KEY (organisation_id, vehicle_id) REFERENCES vehicles (organisation_id, id)
);

CREATE TABLE vehicle_owner_relationships (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  access_scope_id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, id),
  UNIQUE (organisation_id, site_id, access_scope_id, owner_account_id),
  FOREIGN KEY (organisation_id, site_id, access_scope_id)
    REFERENCES vehicle_owner_access_scopes (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, owner_account_id)
    REFERENCES vehicle_owner_accounts (organisation_id, id)
);

CREATE TABLE vehicle_owner_revisions (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('approved', 'revoked', 'expired', 'transferred')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  actor_id uuid NOT NULL REFERENCES staff_users(id),
  evidence_record_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, site_id, id),
  UNIQUE (organisation_id, site_id, relationship_id, revision),
  FOREIGN KEY (organisation_id, site_id, relationship_id)
    REFERENCES vehicle_owner_relationships (organisation_id, site_id, id),
  FOREIGN KEY (organisation_id, site_id, evidence_record_id)
    REFERENCES evidence_records (organisation_id, site_id, id),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX vehicle_owner_access_vehicle ON vehicle_owner_access_scopes(organisation_id, site_id, vehicle_id);
CREATE INDEX vehicle_owner_relationship_scope ON vehicle_owner_relationships(organisation_id, site_id, access_scope_id);
CREATE INDEX vehicle_owner_revision_history ON vehicle_owner_revisions(organisation_id, site_id, relationship_id, revision DESC);
CREATE INDEX owner_access_grant_active ON owner_access_approver_grants(organisation_id, site_id, staff_user_id, valid_from, valid_until) WHERE revoked_at IS NULL;

CREATE FUNCTION public.lock_vehicle_owner_access_authority(p_actor_id uuid,p_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_actor_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
    OR p_site_id IS DISTINCT FROM nullif(current_setting('app.site_id',true),'')::uuid THEN
    RETURN false;
  END IF;

  PERFORM g.id
  FROM public.owner_access_approver_grants g
  JOIN public.evidence_records e
    ON e.id=g.evidence_record_id AND e.organisation_id=g.organisation_id AND e.site_id=g.site_id
  WHERE g.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND g.site_id=p_site_id
    AND g.staff_user_id=p_actor_id
    AND g.capability='vehicle-owner-access.manage'
    AND g.revoked_at IS NULL
    AND g.valid_from<=transaction_timestamp()
    AND (g.valid_until IS NULL OR transaction_timestamp()<g.valid_until)
    AND e.scan_state='accepted'
  FOR SHARE OF g,e;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_vehicle_owner_access_authority(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.lock_accepted_owner_evidence(p_evidence_id uuid,p_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_site_id IS DISTINCT FROM nullif(current_setting('app.site_id',true),'')::uuid THEN
    RETURN false;
  END IF;

  PERFORM e.id
  FROM public.evidence_records e
  WHERE e.id=p_evidence_id
    AND e.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND e.site_id=p_site_id
    AND e.scan_state='accepted'
  FOR SHARE OF e;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_accepted_owner_evidence(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.lock_active_vehicle_owner_account(p_owner_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM o.id
  FROM public.vehicle_owner_accounts o
  WHERE o.id=p_owner_id
    AND o.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND o.active
  FOR SHARE OF o;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_active_vehicle_owner_account(uuid) FROM PUBLIC;

ALTER TABLE evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_records FORCE ROW LEVEL SECURITY;
CREATE POLICY site_scope ON evidence_records
  USING (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid);

ALTER TABLE vehicle_owner_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_owner_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_scope ON vehicle_owner_accounts
  USING (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

ALTER TABLE owner_access_approver_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_access_approver_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY site_scope ON owner_access_approver_grants
  USING (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid);

ALTER TABLE vehicle_owner_access_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_owner_access_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY site_scope ON vehicle_owner_access_scopes
  USING (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid);

ALTER TABLE vehicle_owner_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_owner_relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY site_scope ON vehicle_owner_relationships
  USING (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid);

ALTER TABLE vehicle_owner_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_owner_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY site_scope ON vehicle_owner_revisions
  USING (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid AND site_id = nullif(current_setting('app.site_id', true), '')::uuid);

GRANT SELECT ON evidence_records, owner_access_approver_grants TO vmms_runtime;
GRANT SELECT, INSERT ON vehicle_owner_accounts TO vmms_runtime;
GRANT SELECT, INSERT, UPDATE ON vehicle_owner_access_scopes TO vmms_runtime;
GRANT SELECT, INSERT ON vehicle_owner_relationships, vehicle_owner_revisions TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.lock_vehicle_owner_access_authority(uuid,uuid) TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.lock_accepted_owner_evidence(uuid,uuid) TO vmms_runtime;
GRANT EXECUTE ON FUNCTION public.lock_active_vehicle_owner_account(uuid) TO vmms_runtime;

