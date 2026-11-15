ALTER TABLE public.memberships
  ADD COLUMN membership_epoch integer NOT NULL DEFAULT 1 CHECK (membership_epoch > 0);

CREATE FUNCTION public.advance_membership_epoch_on_reactivation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT OLD.active AND NEW.active THEN
    NEW.membership_epoch := OLD.membership_epoch + 1;
  ELSE
    NEW.membership_epoch := OLD.membership_epoch;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.advance_membership_epoch_on_reactivation() FROM PUBLIC;
CREATE TRIGGER memberships_epoch_on_reactivation
  BEFORE UPDATE OF active,membership_epoch ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.advance_membership_epoch_on_reactivation();

CREATE TABLE public.staff_messages (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  sender_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  sender_membership_epoch integer NOT NULL CHECK (sender_membership_epoch > 0),
  work_order_id uuid,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  aggregate_type text NOT NULL DEFAULT 'staff-message' CHECK (aggregate_type='staff-message'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id) REFERENCES public.sites(organisation_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,id,aggregate_type)
    REFERENCES public.aggregate_roots(organisation_id,site_id,id,aggregate_type)
);
CREATE INDEX staff_messages_by_sender ON public.staff_messages(organisation_id,site_id,sender_user_id,created_at DESC,id DESC);

CREATE TABLE public.staff_message_recipients (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  message_id uuid NOT NULL,
  sender_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  sender_membership_epoch integer NOT NULL CHECK (sender_membership_epoch > 0),
  recipient_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  recipient_membership_epoch integer NOT NULL CHECK (recipient_membership_epoch > 0),
  PRIMARY KEY (organisation_id,site_id,message_id,recipient_user_id),
  FOREIGN KEY (organisation_id,site_id,message_id)
    REFERENCES public.staff_messages(organisation_id,site_id,id),
  FOREIGN KEY (recipient_user_id,site_id)
    REFERENCES public.memberships(user_id,site_id),
  CHECK (sender_user_id <> recipient_user_id)
);
CREATE INDEX staff_message_recipients_inbox
  ON public.staff_message_recipients(organisation_id,site_id,recipient_user_id,message_id);

CREATE TABLE public.staff_message_read_receipts (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  message_id uuid NOT NULL,
  sender_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  sender_membership_epoch integer NOT NULL CHECK (sender_membership_epoch > 0),
  reader_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  reader_membership_epoch integer NOT NULL CHECK (reader_membership_epoch > 0),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id,site_id,message_id,reader_user_id),
  FOREIGN KEY (organisation_id,site_id,message_id,reader_user_id)
    REFERENCES public.staff_message_recipients(organisation_id,site_id,message_id,recipient_user_id)
);

CREATE FUNCTION public.staff_message_membership_is_current(requested_user uuid, requested_site uuid, expected_epoch integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  -- This predicate is used by RLS and must never act as a membership oracle.
  -- Only the transaction's authenticated actor may be checked here. Recipient
  -- epochs are captured by lock_staff_message_recipient() in the send command.
  SELECT requested_user=nullif(current_setting('app.actor_id',true),'')::uuid
    AND requested_site=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM public.memberships m
      JOIN public.sites s ON s.id=m.site_id
      WHERE m.user_id=requested_user AND m.site_id=requested_site AND m.active
        AND m.membership_epoch=expected_epoch
        AND s.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid)
$$;
REVOKE ALL ON FUNCTION public.staff_message_membership_is_current(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_message_membership_is_current(uuid,uuid,integer) TO vmms_runtime;

CREATE FUNCTION public.lock_staff_message_recipient(requested_user uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  current_actor uuid;
  current_site uuid;
  current_organisation uuid;
  locked_epoch integer;
BEGIN
  current_actor := nullif(current_setting('app.actor_id',true),'')::uuid;
  current_site := nullif(current_setting('app.site_id',true),'')::uuid;
  current_organisation := nullif(current_setting('app.organisation_id',true),'')::uuid;
  IF current_actor IS NULL OR current_site IS NULL OR current_organisation IS NULL
    OR requested_user IS NULL OR requested_user=current_actor THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_role_placements p
    JOIN public.staff_role_profiles r ON r.code=p.role_code
    JOIN public.memberships own ON own.user_id=p.staff_user_id AND own.site_id=p.site_id
    WHERE p.organisation_id=current_organisation AND p.site_id=current_site
      AND p.staff_user_id=current_actor AND p.state='active' AND r.code='head-service-centre'
      AND r.active AND own.active AND own.can_write
  ) THEN RETURN NULL; END IF;
  SELECT m.membership_epoch INTO locked_epoch
  FROM public.memberships m JOIN public.staff_users u ON u.id=m.user_id
  WHERE m.user_id=requested_user AND m.site_id=current_site AND m.active AND u.active
  FOR SHARE OF m,u;
  RETURN locked_epoch;
END $$;
REVOKE ALL ON FUNCTION public.lock_staff_message_recipient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_staff_message_recipient(uuid) TO vmms_runtime;

CREATE FUNCTION public.lock_staff_message_sender_epoch() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  current_actor uuid;
  current_site uuid;
  current_organisation uuid;
  locked_epoch integer;
BEGIN
  current_actor := nullif(current_setting('app.actor_id',true),'')::uuid;
  current_site := nullif(current_setting('app.site_id',true),'')::uuid;
  current_organisation := nullif(current_setting('app.organisation_id',true),'')::uuid;
  IF current_actor IS NULL OR current_site IS NULL OR current_organisation IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_role_placements p
    JOIN public.staff_role_profiles r ON r.code=p.role_code
    JOIN public.memberships own ON own.user_id=p.staff_user_id AND own.site_id=p.site_id
    WHERE p.organisation_id=current_organisation AND p.site_id=current_site
      AND p.staff_user_id=current_actor AND p.state='active' AND r.code='head-service-centre'
      AND r.active AND own.active AND own.can_write
  ) THEN RETURN NULL; END IF;
  SELECT m.membership_epoch INTO locked_epoch FROM public.memberships m
    WHERE m.user_id=current_actor AND m.site_id=current_site AND m.active AND m.can_write FOR SHARE;
  RETURN locked_epoch;
END $$;
REVOKE ALL ON FUNCTION public.lock_staff_message_sender_epoch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_staff_message_sender_epoch() TO vmms_runtime;

ALTER TABLE public.staff_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_messages_participant_select ON public.staff_messages
  FOR SELECT
  USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (
      SELECT 1 FROM public.staff_message_recipients r
      WHERE r.organisation_id=staff_messages.organisation_id
        AND r.site_id=staff_messages.site_id AND r.message_id=staff_messages.id
    )
  );
CREATE POLICY staff_messages_head_insert ON public.staff_messages
  FOR INSERT
  WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND sender_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND public.lock_staff_message_sender_epoch()=sender_membership_epoch
  );
CREATE POLICY staff_messages_recipient_read_update ON public.staff_messages
  FOR UPDATE
  USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM public.staff_message_recipients r
      WHERE r.organisation_id=staff_messages.organisation_id AND r.site_id=staff_messages.site_id
        AND r.message_id=staff_messages.id AND r.recipient_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND public.staff_message_membership_is_current(r.recipient_user_id,r.site_id,r.recipient_membership_epoch))
  )
  WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM public.staff_message_recipients r
      WHERE r.organisation_id=staff_messages.organisation_id AND r.site_id=staff_messages.site_id
        AND r.message_id=staff_messages.id AND r.recipient_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND public.staff_message_membership_is_current(r.recipient_user_id,r.site_id,r.recipient_membership_epoch))
  );

ALTER TABLE public.staff_message_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_message_recipients FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_message_recipients_participant_scope ON public.staff_message_recipients
  USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND (
      (recipient_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND public.staff_message_membership_is_current(recipient_user_id,site_id,recipient_membership_epoch))
      OR
      (sender_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND public.staff_message_membership_is_current(sender_user_id,site_id,sender_membership_epoch))
    )
  )
  WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND sender_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND public.staff_message_membership_is_current(sender_user_id,site_id,sender_membership_epoch)
    AND public.lock_staff_message_recipient(recipient_user_id)=recipient_membership_epoch
  );

ALTER TABLE public.staff_message_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_message_read_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_message_reads_participant_scope ON public.staff_message_read_receipts
  USING (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND (
      (reader_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND public.staff_message_membership_is_current(reader_user_id,site_id,reader_membership_epoch))
      OR
      (sender_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
        AND public.staff_message_membership_is_current(sender_user_id,site_id,sender_membership_epoch))
    )
  )
  WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND reader_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND public.staff_message_membership_is_current(reader_user_id,site_id,reader_membership_epoch)
  );

REVOKE ALL ON public.staff_messages,public.staff_message_recipients,public.staff_message_read_receipts FROM PUBLIC;
REVOKE UPDATE ON public.staff_messages FROM vmms_runtime;
GRANT SELECT,INSERT ON public.staff_messages TO vmms_runtime;
GRANT UPDATE(version) ON public.staff_messages TO vmms_runtime;
GRANT SELECT,INSERT ON public.staff_message_recipients,public.staff_message_read_receipts TO vmms_runtime;

CREATE FUNCTION public.reject_staff_message_content_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.sender_user_id IS DISTINCT FROM OLD.sender_user_id
    OR NEW.sender_membership_epoch IS DISTINCT FROM OLD.sender_membership_epoch
    OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'staff message content and recipient context are immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.reject_staff_message_content_change() FROM PUBLIC;
CREATE TRIGGER staff_messages_immutable_content
  BEFORE UPDATE OR DELETE ON public.staff_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_staff_message_content_change();

CREATE FUNCTION public.reject_staff_message_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'staff message recipient and read history is immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_staff_message_history_change() FROM PUBLIC;
CREATE TRIGGER staff_message_recipients_immutable
  BEFORE UPDATE OR DELETE ON public.staff_message_recipients
  FOR EACH ROW EXECUTE FUNCTION public.reject_staff_message_history_change();
CREATE TRIGGER staff_message_reads_immutable
  BEFORE UPDATE OR DELETE ON public.staff_message_read_receipts
  FOR EACH ROW EXECUTE FUNCTION public.reject_staff_message_history_change();

ALTER TABLE public.sensitive_read_events
  DROP CONSTRAINT sensitive_read_events_action_check;
ALTER TABLE public.sensitive_read_events
  ADD CONSTRAINT sensitive_read_events_action_check CHECK (action IN (
    'work-order-queue-read-prepared',
    'vehicle-lookup-read-prepared',
    'client-lookup-read-prepared',
    'party-lookup-read-prepared',
    'workforce-organogram-read-prepared',
    'workforce-overview-read-prepared',
    'staff-messages-read-prepared'
  ));
