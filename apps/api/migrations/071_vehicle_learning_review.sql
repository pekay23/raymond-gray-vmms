-- Learning review is a separate, explicitly granted staff capability.
-- No grants are created here; review access remains disabled by default.

CREATE TABLE public.vehicle_learning_reviews (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  author_id uuid NOT NULL REFERENCES public.staff_users(id),
  reviewer_id uuid NOT NULL REFERENCES public.staff_users(id),
  reviewer_grant_id uuid NOT NULL,
  reviewer_grant_revision integer NOT NULL CHECK (reviewer_grant_revision > 0),
  decision text NOT NULL CHECK (decision IN ('changes-requested','reviewed-learning-record')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 3000),
  aggregate_type text NOT NULL DEFAULT 'vehicle-learning-review' CHECK (aggregate_type='vehicle-learning-review'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (author_id <> reviewer_id),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,entry_id,revision_number),
  FOREIGN KEY (organisation_id,site_id,entry_id,revision_number)
    REFERENCES public.vehicle_learning_entry_revisions(organisation_id,site_id,entry_id,revision_number),
  FOREIGN KEY (organisation_id,site_id,entry_id,author_id)
    REFERENCES public.vehicle_learning_entries(organisation_id,site_id,id,author_id),
  FOREIGN KEY (organisation_id,site_id,reviewer_grant_id)
    REFERENCES public.staff_authority_grants(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,id,aggregate_type)
    REFERENCES public.aggregate_roots(organisation_id,site_id,id,aggregate_type)
);

CREATE INDEX vehicle_learning_reviews_by_author
  ON public.vehicle_learning_reviews(organisation_id,site_id,author_id,entry_id,revision_number);

ALTER TABLE public.vehicle_learning_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_learning_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY vehicle_learning_reviews_author_read ON public.vehicle_learning_reviews
  FOR SELECT USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND author_id=nullif(current_setting('app.actor_id',true),'')::uuid
  );
CREATE POLICY vehicle_learning_reviews_reviewer_read ON public.vehicle_learning_reviews
  FOR SELECT USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants g
      WHERE g.organisation_id=vehicle_learning_reviews.organisation_id
        AND g.site_id=vehicle_learning_reviews.site_id
        AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND g.capability='vehicle-learning.review'
        AND g.revoked_at IS NULL
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
CREATE POLICY vehicle_learning_reviews_reviewer_insert ON public.vehicle_learning_reviews
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants g
      WHERE g.organisation_id=vehicle_learning_reviews.organisation_id
        AND g.site_id=vehicle_learning_reviews.site_id
        AND g.id=vehicle_learning_reviews.reviewer_grant_id
        AND g.staff_user_id=vehicle_learning_reviews.reviewer_id
        AND g.capability='vehicle-learning.review'
        AND g.grant_revision=vehicle_learning_reviews.reviewer_grant_revision
        AND g.revoked_at IS NULL
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
CREATE FUNCTION public.reject_vehicle_learning_review_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'vehicle-learning review decisions are immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_vehicle_learning_review_change() FROM PUBLIC;
CREATE TRIGGER vehicle_learning_reviews_immutable
  BEFORE UPDATE OR DELETE ON public.vehicle_learning_reviews
  FOR EACH ROW EXECUTE FUNCTION public.reject_vehicle_learning_review_change();
REVOKE ALL ON public.vehicle_learning_reviews FROM PUBLIC;
GRANT SELECT,INSERT ON public.vehicle_learning_reviews TO vmms_runtime;

-- Serialize reviewer-grant changes with review commands without granting the app write access
-- to the authority registry. New grant revisions are inserted; prior rows stay immutable.
CREATE FUNCTION public.lock_vehicle_learning_review_grant_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  target_organisation uuid;
  target_site uuid;
  target_staff_user uuid;
  target_capability text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.capability='vehicle-learning.review' OR NEW.capability='vehicle-learning.review' THEN
      RAISE EXCEPTION 'vehicle-learning review grants are append-only';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    IF OLD.capability='vehicle-learning.review' THEN
      RAISE EXCEPTION 'vehicle-learning review grants are append-only';
    END IF;
    RETURN OLD;
  END IF;

  target_organisation := NEW.organisation_id;
  target_site := NEW.site_id;
  target_staff_user := NEW.staff_user_id;
  target_capability := NEW.capability;
  IF target_capability='vehicle-learning.review' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'vehicle-learning-review-grant:'||target_organisation::text||':'||target_site::text||':'||target_staff_user::text,0));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lock_vehicle_learning_review_grant_change() FROM PUBLIC;
CREATE TRIGGER lock_vehicle_learning_review_grant_changes
  BEFORE INSERT OR UPDATE OR DELETE ON public.staff_authority_grants
  FOR EACH ROW EXECUTE FUNCTION public.lock_vehicle_learning_review_grant_change();

ALTER TABLE public.sensitive_read_events
  DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events
  ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
    'work-order-queue-read-prepared','vehicle-lookup-read-prepared','client-lookup-read-prepared',
    'party-lookup-read-prepared','workforce-organogram-read-prepared','workforce-overview-read-prepared',
    'staff-messages-read-prepared','staff-account-requests-read-prepared','service-request-read-prepared',
    'vehicle-sales-history-read-prepared','work-order-task-activity-read-prepared',
    'work-order-task-work-entries-read-prepared','work-order-task-work-evidence-options-read-prepared',
    'work-order-service-report-read-prepared','work-order-source-reports-read-prepared',
    'vehicle-learning-activity-read-prepared','work-order-checklists-read-prepared',
    'vehicle-learning-review-queue-read-prepared'
  ));

-- Submitted snapshots become visible to reviewers only while their explicit grant is active.
CREATE POLICY vehicle_learning_entries_reviewer_read ON public.vehicle_learning_entries
  FOR SELECT USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND status='submitted'
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants g
      WHERE g.organisation_id=vehicle_learning_entries.organisation_id
        AND g.site_id=vehicle_learning_entries.site_id
        AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND g.capability='vehicle-learning.review'
        AND g.revoked_at IS NULL
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
CREATE POLICY vehicle_learning_revisions_reviewer_read ON public.vehicle_learning_entry_revisions
  FOR SELECT USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND status='submitted'
    AND EXISTS (
      SELECT 1 FROM public.vehicle_learning_entries e
      WHERE e.organisation_id=vehicle_learning_entry_revisions.organisation_id
        AND e.site_id=vehicle_learning_entry_revisions.site_id
        AND e.id=vehicle_learning_entry_revisions.entry_id
        AND e.author_id=vehicle_learning_entry_revisions.author_id
        AND e.status='submitted'
    )
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants g
      WHERE g.organisation_id=vehicle_learning_entry_revisions.organisation_id
        AND g.site_id=vehicle_learning_entry_revisions.site_id
        AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND g.capability='vehicle-learning.review'
        AND g.revoked_at IS NULL
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

-- A comment may be written by the author or a separately granted reviewer.
DO $$
DECLARE matched_constraint text;
BEGIN
  SELECT conname INTO matched_constraint
  FROM pg_constraint
  WHERE conrelid='public.vehicle_learning_comments'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%entry_author_id = commenter_id%';
  IF matched_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.vehicle_learning_comments DROP CONSTRAINT %I', matched_constraint);
  END IF;
END $$;

DROP POLICY vehicle_learning_comments_author ON public.vehicle_learning_comments;
CREATE POLICY vehicle_learning_comments_author_read ON public.vehicle_learning_comments
  FOR SELECT USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND entry_author_id=nullif(current_setting('app.actor_id',true),'')::uuid
  );
CREATE POLICY vehicle_learning_comments_author_insert ON public.vehicle_learning_comments
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND entry_author_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND commenter_id=nullif(current_setting('app.actor_id',true),'')::uuid
  );
CREATE POLICY vehicle_learning_comments_reviewer_read ON public.vehicle_learning_comments
  FOR SELECT USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.vehicle_learning_entry_revisions r
      JOIN public.vehicle_learning_entries e
        ON e.organisation_id=r.organisation_id AND e.site_id=r.site_id AND e.id=r.entry_id AND e.author_id=r.author_id
      WHERE r.organisation_id=vehicle_learning_comments.organisation_id
        AND r.site_id=vehicle_learning_comments.site_id
        AND r.entry_id=vehicle_learning_comments.entry_id
        AND r.revision_number=vehicle_learning_comments.revision_number
        AND r.status='submitted' AND e.status='submitted'
    )
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants g
      WHERE g.organisation_id=vehicle_learning_comments.organisation_id
        AND g.site_id=vehicle_learning_comments.site_id
        AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND g.capability='vehicle-learning.review'
        AND g.revoked_at IS NULL
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
CREATE POLICY vehicle_learning_comments_reviewer_insert ON public.vehicle_learning_comments
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND commenter_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND entry_author_id<>commenter_id
    AND EXISTS (
      SELECT 1 FROM public.vehicle_learning_entry_revisions r
      JOIN public.vehicle_learning_entries e
        ON e.organisation_id=r.organisation_id AND e.site_id=r.site_id AND e.id=r.entry_id AND e.author_id=r.author_id
      WHERE r.organisation_id=vehicle_learning_comments.organisation_id
        AND r.site_id=vehicle_learning_comments.site_id
        AND r.entry_id=vehicle_learning_comments.entry_id
        AND r.revision_number=vehicle_learning_comments.revision_number
        AND r.status='submitted' AND e.status='submitted' AND e.version=r.revision_number
    )
    AND EXISTS (
      SELECT 1 FROM public.staff_authority_grants g
      WHERE g.organisation_id=vehicle_learning_comments.organisation_id
        AND g.site_id=vehicle_learning_comments.site_id
        AND g.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND g.capability='vehicle-learning.review'
        AND g.revoked_at IS NULL
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

-- Authors may revise a submitted record only after changes were requested for its latest version.
CREATE OR REPLACE FUNCTION public.guard_vehicle_learning_entry_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.organisation_id <> OLD.organisation_id
     OR NEW.site_id <> OLD.site_id OR NEW.author_id <> OLD.author_id OR NEW.created_at <> OLD.created_at
     OR NEW.version <> OLD.version + 1 OR NEW.status NOT IN ('draft','submitted') THEN
    RAISE EXCEPTION 'vehicle-learning identity and revision sequence are immutable';
  END IF;
  IF OLD.status='draft' THEN RETURN NEW; END IF;
  IF OLD.status='submitted' AND EXISTS (
    SELECT 1 FROM public.vehicle_learning_reviews r
    WHERE r.organisation_id=OLD.organisation_id AND r.site_id=OLD.site_id
      AND r.entry_id=OLD.id AND r.revision_number=OLD.version
      AND r.decision='changes-requested'
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'only a draft or a learning note with requested changes may be revised';
END $$;
REVOKE ALL ON FUNCTION public.guard_vehicle_learning_entry_update() FROM PUBLIC;
