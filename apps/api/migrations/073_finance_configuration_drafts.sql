-- Draft proposals collect Finance inputs without making any financial setting
-- operationally effective. No draft approval or effective configuration exists.
CREATE TABLE public.finance_configuration_draft_revisions (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  aggregate_type text NOT NULL DEFAULT 'finance-configuration-draft'
    CHECK (aggregate_type='finance-configuration-draft'),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  previous_revision_number integer,
  content jsonb NOT NULL CHECK (
    jsonb_typeof(content)='object'
    AND content->>'schemaVersion'='1'
    AND length(content::text)<=32768
  ),
  revision_note text NOT NULL CHECK (length(btrim(revision_note)) BETWEEN 1 AND 500),
  author_id uuid NOT NULL REFERENCES public.staff_users(id),
  author_grant_id uuid NOT NULL,
  author_grant_revision integer NOT NULL CHECK (author_grant_revision > 0),
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (revision_number=1 AND previous_revision_number IS NULL)
    OR (revision_number>1 AND previous_revision_number=revision_number-1)
  ),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,draft_id,revision_number),
  FOREIGN KEY (organisation_id,site_id)
    REFERENCES public.sites(organisation_id,id),
  FOREIGN KEY (organisation_id,site_id,draft_id,aggregate_type)
    REFERENCES public.aggregate_roots(organisation_id,site_id,id,aggregate_type),
  FOREIGN KEY (organisation_id,site_id,draft_id,previous_revision_number)
    REFERENCES public.finance_configuration_draft_revisions
      (organisation_id,site_id,draft_id,revision_number)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (organisation_id,site_id,author_grant_id)
    REFERENCES public.staff_authority_grants(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,author_id,command_id)
    REFERENCES public.command_receipts(organisation_id,site_id,actor_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX finance_configuration_draft_revisions_history
  ON public.finance_configuration_draft_revisions
    (organisation_id,site_id,draft_id,revision_number DESC);

ALTER TABLE public.finance_configuration_draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_configuration_draft_revisions FORCE ROW LEVEL SECURITY;

CREATE POLICY finance_configuration_draft_revisions_read
  ON public.finance_configuration_draft_revisions
  FOR SELECT USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.memberships membership
      WHERE membership.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND membership.site_id=finance_configuration_draft_revisions.site_id
        AND membership.active
    )
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants grant_row
      WHERE grant_row.organisation_id=finance_configuration_draft_revisions.organisation_id
        AND grant_row.site_id=finance_configuration_draft_revisions.site_id
        AND grant_row.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND grant_row.capability IN ('finance.configuration-draft.read','finance.configuration-draft.manage')
        AND grant_row.revoked_at IS NULL
        AND grant_row.valid_from<=clock_timestamp()
        AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp())
        AND NOT EXISTS (
          SELECT 1 FROM public.staff_authority_grants newer
          WHERE newer.organisation_id=grant_row.organisation_id
            AND newer.site_id=grant_row.site_id
            AND newer.staff_user_id=grant_row.staff_user_id
            AND newer.capability=grant_row.capability
            AND newer.grant_revision>grant_row.grant_revision
        )
    )
  );

CREATE POLICY finance_configuration_draft_revisions_insert
  ON public.finance_configuration_draft_revisions
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND author_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.memberships membership
      WHERE membership.user_id=finance_configuration_draft_revisions.author_id
        AND membership.site_id=finance_configuration_draft_revisions.site_id
        AND membership.active AND membership.can_write
    )
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants grant_row
      WHERE grant_row.organisation_id=finance_configuration_draft_revisions.organisation_id
        AND grant_row.site_id=finance_configuration_draft_revisions.site_id
        AND grant_row.id=finance_configuration_draft_revisions.author_grant_id
        AND grant_row.grant_revision=finance_configuration_draft_revisions.author_grant_revision
        AND grant_row.staff_user_id=finance_configuration_draft_revisions.author_id
        AND grant_row.capability='finance.configuration-draft.manage'
        AND grant_row.revoked_at IS NULL
        AND grant_row.valid_from<=clock_timestamp()
        AND (grant_row.valid_until IS NULL OR grant_row.valid_until>clock_timestamp())
        AND NOT EXISTS (
          SELECT 1 FROM public.staff_authority_grants newer
          WHERE newer.organisation_id=grant_row.organisation_id
            AND newer.site_id=grant_row.site_id
            AND newer.staff_user_id=grant_row.staff_user_id
            AND newer.capability=grant_row.capability
            AND newer.grant_revision>grant_row.grant_revision
        )
    )
  );

CREATE FUNCTION public.reject_finance_configuration_draft_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'finance configuration draft history is immutable';
END
$$;
REVOKE ALL ON FUNCTION public.reject_finance_configuration_draft_change() FROM PUBLIC;
CREATE TRIGGER finance_configuration_draft_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.finance_configuration_draft_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_finance_configuration_draft_change();

REVOKE ALL ON public.finance_configuration_draft_revisions FROM PUBLIC;
GRANT SELECT,INSERT ON public.finance_configuration_draft_revisions TO vmms_runtime;

-- Keep Finance-grant revocation/rotation ordered with runtime decisions without
-- granting the API role UPDATE privileges on the authority registry.
CREATE FUNCTION public.lock_finance_configuration_grant_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  roots text[] := ARRAY[]::text[];
  target text;
BEGIN
  IF TG_OP<>'INSERT' AND OLD.capability IN ('finance.configuration-draft.read','finance.configuration-draft.manage') THEN
    roots := array_append(roots,'finance-configuration-draft-grant:'||OLD.organisation_id||':'||OLD.site_id||':'||OLD.staff_user_id);
  END IF;
  IF TG_OP<>'DELETE' AND NEW.capability IN ('finance.configuration-draft.read','finance.configuration-draft.manage') THEN
    roots := array_append(roots,'finance-configuration-draft-grant:'||NEW.organisation_id||':'||NEW.site_id||':'||NEW.staff_user_id);
  END IF;
  FOR target IN SELECT DISTINCT root FROM unnest(roots) AS roots_to_lock(root) ORDER BY root LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(target,0));
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.lock_finance_configuration_grant_changes() FROM PUBLIC;
CREATE TRIGGER finance_configuration_grant_change_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.staff_authority_grants
  FOR EACH ROW EXECUTE FUNCTION public.lock_finance_configuration_grant_changes();

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
  'finance-configuration-draft-read-prepared'
));
