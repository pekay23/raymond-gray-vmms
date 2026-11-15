ALTER TABLE public.vehicle_learning_entries
  ADD CONSTRAINT vehicle_learning_entries_author_key
  UNIQUE (organisation_id,site_id,id,author_id);

CREATE TABLE public.vehicle_learning_entry_revisions (
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES public.staff_users(id),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  make_model text NOT NULL CHECK (length(btrim(make_model)) BETWEEN 1 AND 180),
  powertrain text NOT NULL CHECK (powertrain IN ('BEV','PHEV','HEV','EREV/REEV','ICE','unknown')),
  drivetrain text NOT NULL CHECK (drivetrain IN ('FWD','RWD','AWD/4WD','unknown')),
  systems jsonb NOT NULL CHECK (jsonb_typeof(systems)='array'),
  evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 4000),
  questions text NOT NULL CHECK (length(btrim(questions)) BETWEEN 0 AND 2000),
  status text NOT NULL CHECK (status IN ('draft','submitted')),
  saved_at timestamptz NOT NULL,
  PRIMARY KEY (organisation_id,site_id,entry_id,revision_number),
  FOREIGN KEY (organisation_id,site_id,entry_id)
    REFERENCES public.vehicle_learning_entries(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,entry_id,author_id)
    REFERENCES public.vehicle_learning_entries(organisation_id,site_id,id,author_id)
);

INSERT INTO public.vehicle_learning_entry_revisions (
  organisation_id,site_id,entry_id,author_id,revision_number,title,make_model,
  powertrain,drivetrain,systems,evidence,questions,status,saved_at
)
SELECT organisation_id,site_id,id,author_id,version,title,make_model,
  powertrain,drivetrain,systems,evidence,questions,status,updated_at
FROM public.vehicle_learning_entries;

CREATE TABLE public.vehicle_learning_comments (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  revision_number integer NOT NULL,
  entry_author_id uuid NOT NULL REFERENCES public.staff_users(id),
  commenter_id uuid NOT NULL REFERENCES public.staff_users(id),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 3000),
  aggregate_type text NOT NULL DEFAULT 'vehicle-learning-comment' CHECK (aggregate_type='vehicle-learning-comment'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (entry_author_id=commenter_id),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,id,aggregate_type),
  FOREIGN KEY (organisation_id,site_id,entry_id,revision_number)
    REFERENCES public.vehicle_learning_entry_revisions(organisation_id,site_id,entry_id,revision_number),
  FOREIGN KEY (organisation_id,site_id,entry_id,entry_author_id)
    REFERENCES public.vehicle_learning_entries(organisation_id,site_id,id,author_id),
  FOREIGN KEY (organisation_id,site_id,id,aggregate_type)
    REFERENCES public.aggregate_roots(organisation_id,site_id,id,aggregate_type)
);

CREATE INDEX vehicle_learning_comments_by_entry
  ON public.vehicle_learning_comments(organisation_id,site_id,entry_id,revision_number,created_at,id);

ALTER TABLE public.vehicle_learning_entry_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_learning_entry_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY vehicle_learning_entry_revisions_author ON public.vehicle_learning_entry_revisions
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
     AND author_id=nullif(current_setting('app.actor_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
          AND author_id=nullif(current_setting('app.actor_id',true),'')::uuid);

ALTER TABLE public.vehicle_learning_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_learning_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY vehicle_learning_comments_author ON public.vehicle_learning_comments
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
     AND entry_author_id=nullif(current_setting('app.actor_id',true),'')::uuid
     AND commenter_id=nullif(current_setting('app.actor_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
          AND entry_author_id=nullif(current_setting('app.actor_id',true),'')::uuid
          AND commenter_id=nullif(current_setting('app.actor_id',true),'')::uuid);

CREATE FUNCTION public.reject_vehicle_learning_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'vehicle-learning history is immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_vehicle_learning_history_change() FROM PUBLIC;
CREATE TRIGGER vehicle_learning_entry_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.vehicle_learning_entry_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_vehicle_learning_history_change();
CREATE TRIGGER vehicle_learning_comments_immutable
  BEFORE UPDATE OR DELETE ON public.vehicle_learning_comments
  FOR EACH ROW EXECUTE FUNCTION public.reject_vehicle_learning_history_change();

REVOKE ALL ON public.vehicle_learning_entry_revisions,public.vehicle_learning_comments FROM PUBLIC;
GRANT SELECT,INSERT ON public.vehicle_learning_entry_revisions,public.vehicle_learning_comments TO vmms_runtime;
