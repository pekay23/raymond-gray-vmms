-- Record a payer's phone response to one exact proposed scope.
-- This evidence record does not authorize work or satisfy the full G2 gate.

CREATE TABLE public.work_order_scope_payer_responses (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  scope_revision_id uuid NOT NULL,
  payer_party_id uuid NOT NULL,
  scope_digest text NOT NULL CHECK (scope_digest ~ '^[0-9a-f]{64}$'),
  decision text NOT NULL CHECK (decision IN ('approved','declined')),
  respondent_name text NOT NULL CHECK (length(trim(respondent_name)) BETWEEN 1 AND 180),
  respondent_relationship text NOT NULL CHECK (respondent_relationship IN ('payer','authorised-representative')),
  authority_basis text NOT NULL CHECK (length(trim(authority_basis)) BETWEEN 1 AND 1000),
  identity_check_summary text NOT NULL CHECK (length(trim(identity_check_summary)) BETWEEN 1 AND 1000),
  scope_read_back boolean NOT NULL CHECK (scope_read_back),
  response_summary text NOT NULL CHECK (length(trim(response_summary)) BETWEEN 1 AND 1200),
  actor_id uuid NOT NULL REFERENCES public.staff_users(id),
  actor_placement_id uuid NOT NULL,
  authority_snapshot jsonb NOT NULL CHECK (jsonb_typeof(authority_snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,scope_revision_id),
  FOREIGN KEY (organisation_id,site_id,work_order_id,scope_revision_id)
    REFERENCES public.work_order_scope_revisions(organisation_id,site_id,work_order_id,id),
  FOREIGN KEY (organisation_id,payer_party_id)
    REFERENCES public.parties(organisation_id,id),
  FOREIGN KEY (organisation_id,site_id,actor_placement_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id)
);

CREATE INDEX work_order_scope_payer_responses_latest
  ON public.work_order_scope_payer_responses(organisation_id,site_id,work_order_id,created_at DESC);

CREATE FUNCTION public.reject_work_order_scope_payer_response_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'payer scope responses are immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION public.reject_work_order_scope_payer_response_mutation() FROM PUBLIC;
CREATE TRIGGER work_order_scope_payer_responses_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_scope_payer_responses
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_scope_payer_response_mutation();

ALTER TABLE public.work_order_scope_payer_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_scope_payer_responses FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_scope_payer_responses_site_scope ON public.work_order_scope_payer_responses
  FOR SELECT
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);
CREATE POLICY work_order_scope_payer_responses_insert_authorized ON public.work_order_scope_payer_responses
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND authority_snapshot->>'capability'='work-order.record-payer-scope-response'
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants grant_row
      WHERE grant_row.organisation_id=work_order_scope_payer_responses.organisation_id
        AND grant_row.site_id=work_order_scope_payer_responses.site_id
        AND grant_row.staff_user_id=work_order_scope_payer_responses.actor_id
        AND grant_row.id::text=authority_snapshot->>'id'
        AND grant_row.grant_revision::text=authority_snapshot->>'grant_revision'
        AND grant_row.capability='work-order.record-payer-scope-response'
        AND grant_row.revoked_at IS NULL AND grant_row.valid_from<=clock_timestamp()
        AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp())
    )
  );

REVOKE ALL ON public.work_order_scope_payer_responses FROM PUBLIC;
GRANT SELECT,INSERT ON public.work_order_scope_payer_responses TO vmms_runtime;

CREATE OR REPLACE FUNCTION public.lock_work_order_authority_grant(requested_capability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_authority_grants;
BEGIN
  IF requested_capability NOT IN (
    'work-order.assign-lead',
    'work-order.handoff-supervisor',
    'work-order.operations-review',
    'work-order.prepare-work-plan',
    'work-order.prepare-scope-proposal',
    'work-order.checklist.prepare',
    'work-order.record-payer-scope-response'
  ) THEN
    RAISE EXCEPTION 'Unsupported work-order capability';
  END IF;
  SELECT g.* INTO selected FROM public.staff_authority_grants g
  WHERE g.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND g.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND g.capability=requested_capability AND g.revoked_at IS NULL
    AND g.valid_from<=clock_timestamp() AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
  ORDER BY g.grant_revision DESC,g.id LIMIT 1 FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END $$;
REVOKE ALL ON FUNCTION public.lock_work_order_authority_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_work_order_authority_grant(text) TO vmms_runtime;

ALTER TABLE public.sensitive_read_events DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
  'work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared',
  'party-lookup-read-prepared','workforce-organogram-read-prepared','workforce-overview-read-prepared',
  'staff-messages-read-prepared','staff-account-requests-read-prepared','service-request-read-prepared',
  'vehicle-sales-history-read-prepared','work-order-task-activity-read-prepared',
  'work-order-task-work-entries-read-prepared','work-order-task-work-evidence-options-read-prepared',
  'work-order-service-report-read-prepared','work-order-source-reports-read-prepared',
  'vehicle-learning-activity-read-prepared','work-order-checklists-read-prepared',
  'vehicle-learning-review-queue-read-prepared','vehicle-learning-library-read-prepared',
  'finance-configuration-draft-read-prepared','work-order-task-labor-read-prepared',
  'work-order-checklist-outcomes-read-prepared','work-order-scope-proposals-read-prepared',
  'work-order-scope-payer-responses-read-prepared'
));
