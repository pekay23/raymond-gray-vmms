-- Only explicitly shared, reviewer-marked learning revisions appear in the
-- staff library. This is a curated training snapshot, not technical approval.
ALTER TABLE public.vehicle_learning_reviews
  ADD COLUMN share_with_after_sales boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT vehicle_learning_review_share_decision
    CHECK (decision='reviewed-learning-record' OR NOT share_with_after_sales);

CREATE TABLE public.vehicle_learning_library_entries (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  review_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  make_model text NOT NULL CHECK (length(btrim(make_model)) BETWEEN 1 AND 180),
  powertrain text NOT NULL CHECK (powertrain IN ('BEV','PHEV','HEV','EREV/REEV','ICE','unknown')),
  drivetrain text NOT NULL CHECK (drivetrain IN ('FWD','RWD','AWD/4WD','unknown')),
  systems jsonb NOT NULL CHECK (jsonb_typeof(systems)='array'),
  evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 4000),
  questions text NOT NULL CHECK (length(btrim(questions)) BETWEEN 0 AND 2000),
  assessment jsonb,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organisation_id,site_id,entry_id,revision_number),
  UNIQUE (organisation_id,site_id,review_id),
  FOREIGN KEY (organisation_id,site_id,entry_id,revision_number)
    REFERENCES public.vehicle_learning_entry_revisions(organisation_id,site_id,entry_id,revision_number),
  FOREIGN KEY (organisation_id,site_id,review_id)
    REFERENCES public.vehicle_learning_reviews(organisation_id,site_id,id),
  CHECK (assessment IS NULL OR (jsonb_typeof(assessment)='object' AND assessment->>'schemaVersion'='1'))
);

CREATE INDEX vehicle_learning_library_search
  ON public.vehicle_learning_library_entries(organisation_id,site_id,lower(make_model),lower(title));

-- Preserve the immutable shared snapshot while allowing a reviewer to withdraw
-- its visibility if private information is discovered later.
CREATE TABLE public.vehicle_learning_library_revocations (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revoker_id uuid NOT NULL REFERENCES public.staff_users(id),
  revoker_grant_id uuid NOT NULL,
  revoker_grant_revision integer NOT NULL CHECK (revoker_grant_revision > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  aggregate_type text NOT NULL DEFAULT 'vehicle-learning-library-revocation'
    CHECK (aggregate_type='vehicle-learning-library-revocation'),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,entry_id,revision_number),
  FOREIGN KEY (organisation_id,site_id,entry_id,revision_number)
    REFERENCES public.vehicle_learning_library_entries(organisation_id,site_id,entry_id,revision_number),
  FOREIGN KEY (organisation_id,site_id,revoker_grant_id)
    REFERENCES public.staff_authority_grants(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,id,aggregate_type)
    REFERENCES public.aggregate_roots(organisation_id,site_id,id,aggregate_type)
);

ALTER TABLE public.vehicle_learning_library_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_learning_library_revocations FORCE ROW LEVEL SECURITY;
CREATE POLICY vehicle_learning_library_revocations_staff_read ON public.vehicle_learning_library_revocations
  FOR SELECT USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.staff_role_placements p
      JOIN public.staff_role_profiles rp ON rp.code=p.role_code AND rp.active
      JOIN public.staff_users u ON u.id=p.staff_user_id AND u.active
      JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id AND m.active
      WHERE p.organisation_id=vehicle_learning_library_revocations.organisation_id
        AND p.site_id=vehicle_learning_library_revocations.site_id
        AND p.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND p.state='active'
        AND p.role_code IN (
          'head-service-centre','ev-team-lead','ice-team-lead','supervisor',
          'technician-engineer-trainee','service-advisor','quality-inspector',
          'parts-inventory','warranty-customer-support','finance-billing','compliance-records-hr'
        )
    )
  );
CREATE POLICY vehicle_learning_library_revocations_reviewer_insert ON public.vehicle_learning_library_revocations
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.staff_role_placements p
      JOIN public.staff_role_profiles rp ON rp.code=p.role_code AND rp.active
      JOIN public.staff_users u ON u.id=p.staff_user_id AND u.active
      JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id AND m.active
      WHERE p.organisation_id=vehicle_learning_library_revocations.organisation_id
        AND p.site_id=vehicle_learning_library_revocations.site_id
        AND p.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND p.state='active'
        AND p.role_code IN (
          'head-service-centre','ev-team-lead','ice-team-lead','supervisor',
          'technician-engineer-trainee','service-advisor','quality-inspector',
          'parts-inventory','warranty-customer-support','finance-billing','compliance-records-hr'
        )
    )
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants g
      WHERE g.organisation_id=vehicle_learning_library_revocations.organisation_id
        AND g.site_id=vehicle_learning_library_revocations.site_id
        AND g.id=vehicle_learning_library_revocations.revoker_grant_id
        AND g.grant_revision=vehicle_learning_library_revocations.revoker_grant_revision
        AND g.staff_user_id=vehicle_learning_library_revocations.revoker_id
        AND vehicle_learning_library_revocations.revoker_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND g.capability='vehicle-learning.review' AND g.revoked_at IS NULL
        AND g.valid_from<=clock_timestamp()
        AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
        AND NOT EXISTS (
          SELECT 1 FROM public.staff_authority_grants newer
          WHERE newer.organisation_id=g.organisation_id AND newer.site_id=g.site_id
            AND newer.staff_user_id=g.staff_user_id AND newer.capability=g.capability
            AND newer.grant_revision>g.grant_revision
        )
    )
  );
CREATE FUNCTION public.reject_vehicle_learning_library_revocation_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'vehicle-learning library revocations are immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_vehicle_learning_library_revocation_change() FROM PUBLIC;
CREATE TRIGGER vehicle_learning_library_revocations_immutable
  BEFORE UPDATE OR DELETE ON public.vehicle_learning_library_revocations
  FOR EACH ROW EXECUTE FUNCTION public.reject_vehicle_learning_library_revocation_change();

ALTER TABLE public.vehicle_learning_library_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_learning_library_entries FORCE ROW LEVEL SECURITY;

-- All current after-sales roles may read the exact same-site staff projection.
CREATE POLICY vehicle_learning_library_staff_read ON public.vehicle_learning_library_entries
  FOR SELECT USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1
      FROM public.staff_role_placements p
      JOIN public.staff_role_profiles rp ON rp.code=p.role_code AND rp.active
      JOIN public.staff_users u ON u.id=p.staff_user_id AND u.active
      JOIN public.memberships m ON m.user_id=p.staff_user_id AND m.site_id=p.site_id AND m.active
      WHERE p.organisation_id=vehicle_learning_library_entries.organisation_id
        AND p.site_id=vehicle_learning_library_entries.site_id
        AND p.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND p.state='active'
        AND p.role_code IN (
          'head-service-centre','ev-team-lead','ice-team-lead','supervisor',
          'technician-engineer-trainee','service-advisor','quality-inspector',
          'parts-inventory','warranty-customer-support','finance-billing','compliance-records-hr'
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.vehicle_learning_library_revocations x
      WHERE x.organisation_id=vehicle_learning_library_entries.organisation_id
        AND x.site_id=vehicle_learning_library_entries.site_id
        AND x.entry_id=vehicle_learning_library_entries.entry_id
        AND x.revision_number=vehicle_learning_library_entries.revision_number
    )
  );

-- Runtime can project only the exact revision covered by an active reviewer grant.
CREATE POLICY vehicle_learning_library_reviewer_insert ON public.vehicle_learning_library_entries
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1
      FROM public.vehicle_learning_reviews r
      JOIN public.vehicle_learning_entry_revisions v
        ON v.organisation_id=r.organisation_id AND v.site_id=r.site_id
        AND v.entry_id=r.entry_id AND v.revision_number=r.revision_number
      JOIN public.staff_authority_grants g
        ON g.organisation_id=r.organisation_id AND g.site_id=r.site_id
        AND g.id=r.reviewer_grant_id AND g.staff_user_id=r.reviewer_id
      WHERE r.organisation_id=vehicle_learning_library_entries.organisation_id
        AND r.site_id=vehicle_learning_library_entries.site_id
        AND r.entry_id=vehicle_learning_library_entries.entry_id
        AND r.revision_number=vehicle_learning_library_entries.revision_number
        AND r.id=vehicle_learning_library_entries.review_id
        AND r.reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND r.decision='reviewed-learning-record' AND r.share_with_after_sales
        AND r.reviewer_grant_id=g.id AND r.reviewer_grant_revision=g.grant_revision
        AND g.capability='vehicle-learning.review' AND g.revoked_at IS NULL
        AND g.valid_from<=clock_timestamp()
        AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
        AND NOT EXISTS (
          SELECT 1 FROM public.staff_authority_grants newer
          WHERE newer.organisation_id=g.organisation_id AND newer.site_id=g.site_id
            AND newer.staff_user_id=g.staff_user_id AND newer.capability=g.capability
            AND newer.grant_revision>g.grant_revision
        )
        AND vehicle_learning_library_entries.title=v.title
        AND vehicle_learning_library_entries.make_model=v.make_model
        AND vehicle_learning_library_entries.powertrain=v.powertrain
        AND vehicle_learning_library_entries.drivetrain=v.drivetrain
        AND vehicle_learning_library_entries.systems=v.systems
        AND vehicle_learning_library_entries.evidence=v.evidence
        AND vehicle_learning_library_entries.questions=v.questions
        AND vehicle_learning_library_entries.assessment IS NOT DISTINCT FROM v.assessment
    )
  );

CREATE FUNCTION public.reject_vehicle_learning_library_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'vehicle-learning library snapshots are immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_vehicle_learning_library_change() FROM PUBLIC;
CREATE TRIGGER vehicle_learning_library_immutable
  BEFORE UPDATE OR DELETE ON public.vehicle_learning_library_entries
  FOR EACH ROW EXECUTE FUNCTION public.reject_vehicle_learning_library_change();

REVOKE ALL ON public.vehicle_learning_library_entries FROM PUBLIC;
GRANT SELECT,INSERT ON public.vehicle_learning_library_entries TO vmms_runtime;
REVOKE ALL ON public.vehicle_learning_library_revocations FROM PUBLIC;
GRANT SELECT,INSERT ON public.vehicle_learning_library_revocations TO vmms_runtime;

ALTER TABLE public.sensitive_read_events DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
  'work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared',
  'party-lookup-read-prepared','workforce-organogram-read-prepared','workforce-overview-read-prepared',
  'staff-messages-read-prepared','staff-account-requests-read-prepared','service-request-read-prepared',
  'vehicle-sales-history-read-prepared','work-order-task-activity-read-prepared',
  'work-order-task-work-entries-read-prepared','work-order-task-work-evidence-options-read-prepared',
  'work-order-service-report-read-prepared','work-order-source-reports-read-prepared',
  'vehicle-learning-activity-read-prepared','work-order-checklists-read-prepared',
  'vehicle-learning-review-queue-read-prepared','vehicle-learning-library-read-prepared'
));
