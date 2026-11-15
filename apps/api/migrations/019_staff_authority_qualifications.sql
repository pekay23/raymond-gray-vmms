-- Empty-by-default operational authority and qualification registries.
-- These tables define evidence storage only; no authority is granted by migration.
CREATE TABLE staff_authority_grants (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  staff_user_id uuid NOT NULL REFERENCES staff_users(id),
  capability text NOT NULL CHECK (capability ~ '^[a-z][a-z0-9.-]{2,80}$'),
  grant_revision integer NOT NULL CHECK (grant_revision > 0),
  granted_by uuid NOT NULL REFERENCES staff_users(id),
  basis_reference text NOT NULL CHECK (length(trim(basis_reference)) BETWEEN 1 AND 500),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES staff_users(id),
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(trim(revocation_reason)) > 0)),
  FOREIGN KEY (organisation_id,site_id) REFERENCES sites(organisation_id,id),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,staff_user_id,capability,grant_revision)
);

CREATE INDEX staff_authority_grants_lookup
  ON staff_authority_grants (organisation_id,site_id,staff_user_id,capability,valid_from)
  WHERE revoked_at IS NULL;

CREATE TABLE staff_qualifications (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  staff_user_id uuid NOT NULL REFERENCES staff_users(id),
  qualification_code text NOT NULL CHECK (qualification_code ~ '^[A-Z0-9][A-Z0-9._-]{1,79}$'),
  qualification_revision integer NOT NULL CHECK (qualification_revision > 0),
  state text NOT NULL CHECK (state IN ('pending','accepted','rejected','revoked','expired')),
  evidence_reference text NOT NULL CHECK (length(trim(evidence_reference)) BETWEEN 1 AND 500),
  assessed_by uuid REFERENCES staff_users(id),
  assessed_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'pending' AND assessed_by IS NULL AND assessed_at IS NULL)
      OR (state <> 'pending' AND assessed_by IS NOT NULL AND assessed_at IS NOT NULL)),
  CHECK (valid_until IS NULL OR valid_from IS NOT NULL AND valid_until > valid_from),
  FOREIGN KEY (organisation_id,site_id) REFERENCES sites(organisation_id,id),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,staff_user_id,qualification_code,qualification_revision)
);

CREATE INDEX staff_qualifications_lookup
  ON staff_qualifications (organisation_id,site_id,staff_user_id,qualification_code,state,valid_from);

ALTER TABLE staff_authority_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_authority_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_authority_grants_scope ON staff_authority_grants
  USING (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id = nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id = nullif(current_setting('app.site_id',true),'')::uuid);
ALTER TABLE staff_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_qualifications FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_qualifications_scope ON staff_qualifications
  USING (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id = nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id = nullif(current_setting('app.site_id',true),'')::uuid);

REVOKE ALL ON staff_authority_grants, staff_qualifications FROM PUBLIC;
GRANT SELECT ON staff_authority_grants, staff_qualifications TO vmms_runtime;
