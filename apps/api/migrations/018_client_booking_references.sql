ALTER TABLE parties ADD COLUMN client_code text;
CREATE UNIQUE INDEX parties_client_code_unique
  ON parties(organisation_id,upper(client_code)) WHERE client_code IS NOT NULL;
CREATE SEQUENCE client_code_seq;

ALTER TABLE work_orders
  ADD COLUMN client_code_snapshot text,
  ADD COLUMN client_booking_sequence integer,
  ADD COLUMN powertrain_class text CHECK (powertrain_class IN ('EV','HYB','ICE')),
  ADD COLUMN warranty_status_at_booking text CHECK (warranty_status_at_booking IN ('confirmed','not-confirmed','unknown')),
  ADD COLUMN warranty_confirmation_note text;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_booking_snapshot_complete CHECK (
  (client_party_id IS NULL AND client_code_snapshot IS NULL AND client_booking_sequence IS NULL
    AND powertrain_class IS NULL AND warranty_status_at_booking IS NULL)
  OR
  (client_party_id IS NOT NULL AND client_code_snapshot IS NOT NULL AND client_booking_sequence IS NOT NULL AND client_booking_sequence > 0
    AND powertrain_class IS NOT NULL AND warranty_status_at_booking IS NOT NULL
    AND (warranty_status_at_booking <> 'confirmed' OR length(trim(coalesce(warranty_confirmation_note,''))) > 0))
);
CREATE UNIQUE INDEX work_orders_client_sequence_unique
  ON work_orders(organisation_id,client_party_id,client_booking_sequence)
  WHERE client_party_id IS NOT NULL AND client_booking_sequence IS NOT NULL;

CREATE TABLE client_booking_counters (
  organisation_id uuid NOT NULL,
  client_party_id uuid NOT NULL,
  last_sequence integer NOT NULL CHECK (last_sequence > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id,client_party_id),
  FOREIGN KEY (organisation_id,client_party_id) REFERENCES parties(organisation_id,id)
);
ALTER TABLE client_booking_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_booking_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY organisation_scope ON client_booking_counters
  USING (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.organisation_id',true),'')::uuid);

CREATE FUNCTION public.allocate_client_booking_sequence(p_organisation_id uuid,p_client_party_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $function$
DECLARE allocated integer;
BEGIN
  IF p_organisation_id IS DISTINCT FROM nullif(current_setting('app.organisation_id',true),'')::uuid THEN
    RAISE EXCEPTION 'Client sequence scope does not match transaction scope' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.client_booking_counters(organisation_id,client_party_id,last_sequence)
    VALUES(p_organisation_id,p_client_party_id,1)
    ON CONFLICT(organisation_id,client_party_id)
    DO UPDATE SET last_sequence=public.client_booking_counters.last_sequence+1,updated_at=now()
    RETURNING last_sequence INTO allocated;
  RETURN allocated;
END;
$function$;
REVOKE ALL ON FUNCTION public.allocate_client_booking_sequence(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_client_booking_sequence(uuid,uuid) TO vmms_runtime;

CREATE FUNCTION public.reject_booking_snapshot_rewrite()
RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $function$
BEGIN
  IF ROW(OLD.reference,OLD.client_party_id,OLD.client_code_snapshot,OLD.client_booking_sequence,
      OLD.powertrain_class,OLD.warranty_status_at_booking,OLD.warranty_confirmation_note)
    IS DISTINCT FROM
     ROW(NEW.reference,NEW.client_party_id,NEW.client_code_snapshot,NEW.client_booking_sequence,
      NEW.powertrain_class,NEW.warranty_status_at_booking,NEW.warranty_confirmation_note) THEN
    RAISE EXCEPTION 'Issued booking identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER work_orders_booking_snapshot_immutable
  BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION public.reject_booking_snapshot_rewrite();

GRANT USAGE ON SEQUENCE client_code_seq TO vmms_runtime;
GRANT SELECT ON client_booking_counters TO vmms_runtime;
REVOKE INSERT,UPDATE,DELETE ON client_booking_counters FROM vmms_runtime;
