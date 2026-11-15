CREATE TABLE public.work_order_policy_package_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  package_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  package_content jsonb NOT NULL CHECK (
    jsonb_typeof(package_content) = 'object'
    AND package_content ->> 'packageId' = package_id::text
    AND package_content ->> 'revision' = revision::text
    AND package_content ->> 'schemaVersion' = schema_version::text
    AND package_content ? 'effectiveTo'
    AND package_content ->> 'effectiveFrom' IS NOT NULL
    AND (package_content ->> 'effectiveFrom')::timestamptz = effective_from
  ),
  package_sha256 text NOT NULL CHECK (package_sha256 ~ '^[0-9a-f]{64}$'),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  created_by uuid NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,package_id,revision),
  UNIQUE (organisation_id,site_id,package_id,revision,package_sha256),
  FOREIGN KEY (organisation_id,site_id)
    REFERENCES public.sites(organisation_id,id),
  CHECK (effective_until IS NULL OR effective_until > effective_from),
  CHECK (
    (effective_until IS NULL AND package_content -> 'effectiveTo' = 'null'::jsonb)
    OR (effective_until IS NOT NULL
      AND (package_content ->> 'effectiveTo') IS NOT NULL
      AND (package_content ->> 'effectiveTo')::timestamptz = effective_until)
  )
);

CREATE INDEX work_order_policy_package_revisions_effectivity
  ON public.work_order_policy_package_revisions
    (organisation_id,site_id,package_id,effective_from,effective_until,revision DESC);

CREATE TABLE public.work_order_policy_package_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  package_id uuid NOT NULL,
  package_revision integer NOT NULL CHECK (package_revision > 0),
  package_sha256 text NOT NULL CHECK (package_sha256 ~ '^[0-9a-f]{64}$'),
  decision_number integer NOT NULL CHECK (decision_number > 0),
  action text NOT NULL CHECK (action IN ('approved','rejected','withdrawn')),
  actor_id uuid NOT NULL REFERENCES public.staff_users(id),
  authority_snapshot jsonb NOT NULL CHECK (jsonb_typeof(authority_snapshot) = 'object'),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,package_id,package_revision,decision_number),
  FOREIGN KEY (organisation_id,site_id,package_id,package_revision,package_sha256)
    REFERENCES public.work_order_policy_package_revisions
      (organisation_id,site_id,package_id,revision,package_sha256),
  FOREIGN KEY (organisation_id,site_id,actor_id,command_id)
    REFERENCES public.command_receipts(organisation_id,site_id,actor_id,command_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organisation_id,site_id)
    REFERENCES public.sites(organisation_id,id)
);

CREATE INDEX work_order_policy_package_decisions_latest
  ON public.work_order_policy_package_decisions
    (organisation_id,site_id,package_id,package_revision,decision_number DESC);

ALTER TABLE public.work_order_policy_package_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_policy_package_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_policy_package_revisions_scope
  ON public.work_order_policy_package_revisions
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

ALTER TABLE public.work_order_policy_package_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_policy_package_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_policy_package_decisions_scope
  ON public.work_order_policy_package_decisions
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

REVOKE ALL ON public.work_order_policy_package_revisions,
  public.work_order_policy_package_decisions FROM PUBLIC,vmms_runtime;
GRANT SELECT ON public.work_order_policy_package_revisions,
  public.work_order_policy_package_decisions TO vmms_runtime;

CREATE FUNCTION public.reject_work_order_policy_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'work-order policy history is immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION public.reject_work_order_policy_ledger_mutation() FROM PUBLIC;
CREATE TRIGGER work_order_policy_package_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_policy_package_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_policy_ledger_mutation();
CREATE TRIGGER work_order_policy_package_decisions_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_policy_package_decisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_policy_ledger_mutation();
