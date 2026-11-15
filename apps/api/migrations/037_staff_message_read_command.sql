-- Only the complete read command may advance a message aggregate. Keeping the
-- version update, read receipt, event, outbox record, and command receipt in a
-- single function prevents an RLS participant from making an unledgered write.
DROP POLICY staff_messages_recipient_read_update ON public.staff_messages;
REVOKE UPDATE ON public.staff_messages FROM vmms_runtime;
REVOKE INSERT ON public.staff_message_read_receipts FROM vmms_runtime;

CREATE FUNCTION public.record_staff_message_read(
  requested_message uuid,
  requested_command uuid,
  requested_fingerprint text,
  requested_event uuid,
  requested_outbox uuid
) RETURNS TABLE(read_at timestamptz, version integer, changed boolean, idempotency_conflict boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor uuid;
  organisation uuid;
  site uuid;
  epoch integer;
  recipient_epoch integer;
  sender uuid;
  sender_epoch integer;
  current_version integer;
  recorded_at timestamptz;
  prior_fingerprint text;
  prior_response jsonb;
  response jsonb;
BEGIN
  actor := nullif(current_setting('app.actor_id',true),'')::uuid;
  organisation := nullif(current_setting('app.organisation_id',true),'')::uuid;
  site := nullif(current_setting('app.site_id',true),'')::uuid;
  IF actor IS NULL OR organisation IS NULL OR site IS NULL
    OR requested_message IS NULL OR requested_command IS NULL
    OR requested_event IS NULL OR requested_outbox IS NULL
    OR requested_fingerprint IS NULL
    OR requested_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  -- Match the regular command runner's retry serialization key.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    organisation::text||':'||site::text||':'||actor::text||':'||requested_command::text,0));

  SELECT m.membership_epoch INTO epoch FROM public.memberships m
  JOIN public.staff_users u ON u.id=m.user_id AND u.active
  WHERE m.user_id=actor AND m.site_id=site AND m.active FOR SHARE OF m,u;
  IF epoch IS NULL THEN RETURN; END IF;

  SELECT m.version INTO current_version FROM public.staff_messages m
  WHERE m.organisation_id=organisation AND m.site_id=site AND m.id=requested_message
  FOR UPDATE;
  IF current_version IS NULL THEN RETURN; END IF;

  -- Authorize before replay: a former recipient must not use an old command
  -- receipt after their site membership is reactivated at a newer epoch.
  SELECT r.sender_user_id,r.sender_membership_epoch,r.recipient_membership_epoch
    INTO sender,sender_epoch,recipient_epoch
  FROM public.staff_message_recipients r
  WHERE r.organisation_id=organisation AND r.site_id=site
    AND r.message_id=requested_message AND r.recipient_user_id=actor;
  IF NOT FOUND OR recipient_epoch<>epoch THEN RETURN; END IF;

  SELECT cr.fingerprint,cr.response INTO prior_fingerprint,prior_response
  FROM public.command_receipts cr
  WHERE cr.organisation_id=organisation AND cr.site_id=site
    AND cr.actor_id=actor AND cr.command_id=requested_command;
  IF FOUND THEN
    IF prior_fingerprint<>requested_fingerprint THEN
      RETURN QUERY SELECT NULL::timestamptz,NULL::integer,false,true;
      RETURN;
    END IF;
    RETURN QUERY SELECT (prior_response->>'readAt')::timestamptz,current_version,false,false;
    RETURN;
  END IF;

  SELECT rr.read_at INTO recorded_at FROM public.staff_message_read_receipts rr
  WHERE rr.organisation_id=organisation AND rr.site_id=site
    AND rr.message_id=requested_message AND rr.reader_user_id=actor;
  IF NOT FOUND THEN
    INSERT INTO public.staff_message_read_receipts AS inserted_read
      (organisation_id,site_id,message_id,sender_user_id,sender_membership_epoch,
       reader_user_id,reader_membership_epoch)
    VALUES(organisation,site,requested_message,sender,sender_epoch,actor,epoch)
    RETURNING inserted_read.read_at INTO recorded_at;

    current_version := current_version+1;
    UPDATE public.staff_messages SET version=current_version
    WHERE organisation_id=organisation AND site_id=site AND id=requested_message;
    response := jsonb_build_object('messageId',requested_message,'readAt',recorded_at);
    INSERT INTO public.domain_events
      (id,organisation_id,site_id,aggregate_id,aggregate_type,aggregate_version,actor_id,
       event_type,reason,previous_state,new_state)
    VALUES(requested_event,organisation,site,requested_message,'staff-message',current_version,actor,
      'workforce.message-read','Recipient recorded an internal staff message as read.',
      jsonb_build_object('version',current_version-1),
      jsonb_build_object('version',current_version,'messageId',requested_message,
        'readerUserId',actor,'readAt',recorded_at));
    INSERT INTO public.outbox(id,organisation_id,site_id,event_id,payload)
    VALUES(requested_outbox,organisation,site,requested_event,
      jsonb_build_object('eventId',requested_event,'aggregateId',requested_message,
        'aggregateType','staff-message','version',current_version,'eventType','workforce.message-read'));
    INSERT INTO public.command_receipts(organisation_id,site_id,actor_id,command_id,fingerprint,response)
    VALUES(organisation,site,actor,requested_command,requested_fingerprint,response);
    RETURN QUERY SELECT recorded_at,current_version,true,false;
    RETURN;
  END IF;

  response := jsonb_build_object('messageId',requested_message,'readAt',recorded_at);
  INSERT INTO public.command_receipts(organisation_id,site_id,actor_id,command_id,fingerprint,response)
  VALUES(organisation,site,actor,requested_command,requested_fingerprint,response);
  RETURN QUERY SELECT recorded_at,current_version,false,false;
END $$;
REVOKE ALL ON FUNCTION public.record_staff_message_read(uuid,uuid,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_staff_message_read(uuid,uuid,text,uuid,uuid) TO vmms_runtime;
