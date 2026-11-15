CREATE TABLE public.staff_role_profiles (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9-]{1,63}$'),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
  assignable_by_head boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO public.staff_role_profiles(code,label,description,assignable_by_head) VALUES
  ('head-service-centre','Head of Service Centre / Operations Admin','Oversees the service centre, reviews incoming work and assigns staff to existing work roles.',true),
  ('ev-team-lead','EV Team Lead','Plans and coordinates electric vehicle work.',true),
  ('ice-team-lead','ICE Team Lead','Plans and coordinates combustion vehicle work.',true),
  ('supervisor','Supervisor','Coordinates technicians and engineers on handed-over work.',true),
  ('technician-engineer-trainee','Technician / Engineer / Trainee','Carries out assigned work within current training and approved authority.',true),
  ('service-advisor','Service Advisor','Records visits, prepares invoices and coordinates collection.',true),
  ('quality-inspector','Quality Inspector','Performs assigned independent quality checks.',true),
  ('parts-inventory','Parts & Inventory','Records parts, stock and workshop custody.',true),
  ('warranty-customer-support','Warranty / Customer Support','Coordinates warranty records and customer updates.',true),
  ('finance-billing','Finance / Billing','Records invoices and payments for review.',true),
  ('compliance-records-hr','Compliance / Records / HR','Maintains approved records and staff information.',true),
  ('vmms-operator','VMMS Operator','Manages staff account lifecycle through the shared identity service.',false);

CREATE TABLE public.staff_role_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  staff_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  role_code text NOT NULL REFERENCES public.staff_role_profiles(code),
  reports_to_placement_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','ended')),
  created_by uuid NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.staff_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id) REFERENCES public.sites(organisation_id,id),
  FOREIGN KEY (organisation_id,site_id,reports_to_placement_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id)
);

CREATE UNIQUE INDEX staff_role_placements_current
  ON public.staff_role_placements(organisation_id,site_id,staff_user_id,role_code)
  WHERE state='active';
CREATE INDEX staff_role_placements_site_role
  ON public.staff_role_placements(organisation_id,site_id,role_code,staff_user_id)
  WHERE state='active';

CREATE TABLE public.staff_role_placement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  placement_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  staff_user_id uuid NOT NULL REFERENCES public.staff_users(id),
  role_code text NOT NULL REFERENCES public.staff_role_profiles(code),
  reports_to_placement_id uuid,
  state text NOT NULL CHECK (state IN ('active','ended')),
  changed_by uuid NOT NULL REFERENCES public.staff_users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organisation_id,site_id,placement_id,revision),
  FOREIGN KEY(organisation_id,site_id) REFERENCES public.sites(organisation_id,id),
  FOREIGN KEY(organisation_id,site_id,placement_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id),
  FOREIGN KEY(organisation_id,site_id,reports_to_placement_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id)
);

ALTER TABLE public.staff_role_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_role_placements FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_role_placements_site_scope ON public.staff_role_placements
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

ALTER TABLE public.staff_role_placement_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_role_placement_history FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_role_placement_history_site_scope ON public.staff_role_placement_history
  USING (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
     AND site_id=nullif(current_setting('app.site_id',true),'')::uuid)
  WITH CHECK (organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
          AND site_id=nullif(current_setting('app.site_id',true),'')::uuid);

REVOKE ALL ON public.staff_role_profiles,public.staff_role_placements,public.staff_role_placement_history FROM PUBLIC;
GRANT SELECT ON public.staff_role_profiles TO vmms_runtime;
GRANT SELECT,INSERT,UPDATE ON public.staff_role_placements TO vmms_runtime;
GRANT SELECT,INSERT ON public.staff_role_placement_history TO vmms_runtime;

CREATE FUNCTION public.reject_staff_role_history_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'staff role placement history is immutable'; END $$;
REVOKE ALL ON FUNCTION public.reject_staff_role_history_change() FROM PUBLIC;
CREATE TRIGGER staff_role_history_immutable
  BEFORE UPDATE OR DELETE ON public.staff_role_placement_history
  FOR EACH ROW EXECUTE FUNCTION public.reject_staff_role_history_change();
