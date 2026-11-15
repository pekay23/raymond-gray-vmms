CREATE TABLE public.vehicle_learning_entries (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES public.staff_users(id),
  aggregate_type text NOT NULL DEFAULT 'vehicle-learning-entry' CHECK (aggregate_type='vehicle-learning-entry'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  make_model text NOT NULL CHECK (length(btrim(make_model)) BETWEEN 1 AND 180),
  powertrain text NOT NULL CHECK (powertrain IN ('BEV','PHEV','HEV','EREV/REEV','ICE','unknown')),
  drivetrain text NOT NULL CHECK (drivetrain IN ('FWD','RWD','AWD/4WD','unknown')),
  systems jsonb NOT NULL CHECK (jsonb_typeof(systems)='array'),
  evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 4000),
  questions text NOT NULL CHECK (length(btrim(questions)) BETWEEN 0 AND 2000),
  status text NOT NULL CHECK (status IN ('draft','submitted')),
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,id,aggregate_type),
  FOREIGN KEY (organisation_id,site_id,id,aggregate_type) REFERENCES public.aggregate_roots(organisation_id,site_id,id,aggregate_type)
);
CREATE INDEX vehicle_learning_entries_author ON public.vehicle_learning_entries(organisation_id,site_id,author_id,updated_at DESC);
ALTER TABLE public.vehicle_learning_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_learning_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY vehicle_learning_entries_scope ON public.vehicle_learning_entries
 USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND site_id=nullif(current_setting('app.site_id',true),'')::uuid AND author_id=nullif(current_setting('app.actor_id',true),'')::uuid)
 WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid AND site_id=nullif(current_setting('app.site_id',true),'')::uuid AND author_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE FUNCTION public.guard_vehicle_learning_entry_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.status <> 'draft' OR NEW.id <> OLD.id OR NEW.organisation_id <> OLD.organisation_id
     OR NEW.site_id <> OLD.site_id OR NEW.author_id <> OLD.author_id OR NEW.created_at <> OLD.created_at
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'only the author may revise a learning draft';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_vehicle_learning_entry_update() FROM PUBLIC;
CREATE TRIGGER vehicle_learning_entry_update_guard BEFORE UPDATE ON public.vehicle_learning_entries
FOR EACH ROW EXECUTE FUNCTION public.guard_vehicle_learning_entry_update();
REVOKE ALL ON public.vehicle_learning_entries FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.vehicle_learning_entries TO vmms_runtime;
