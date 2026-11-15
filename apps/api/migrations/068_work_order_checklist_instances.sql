CREATE TABLE public.work_order_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  template_revision_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pdi','routine-maintenance')),
  state text NOT NULL CHECK (state IN ('draft','in-progress','submitted','returned','approved','closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  schedule_basis text NOT NULL CHECK (schedule_basis IN ('verified-history','customer-request','delivery-inspection','unknown')),
  odometer_at_start_km integer CHECK (odometer_at_start_km>=0),
  vehicle_snapshot jsonb NOT NULL CHECK (jsonb_typeof(vehicle_snapshot)='object'),
  created_by uuid NOT NULL REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,id),
  FOREIGN KEY (organisation_id,site_id,work_order_id)
    REFERENCES public.work_orders(organisation_id,site_id,id),
  FOREIGN KEY (organisation_id,site_id,template_revision_id)
    REFERENCES public.workshop_checklist_template_revisions(organisation_id,site_id,id)
);
CREATE INDEX work_order_checklists_by_work_order
  ON public.work_order_checklists(organisation_id,site_id,work_order_id,created_at DESC,id);

CREATE TABLE public.work_order_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  checklist_id uuid NOT NULL,
  item_code text NOT NULL CHECK (length(trim(item_code)) BETWEEN 1 AND 100),
  ordinal integer NOT NULL CHECK (ordinal>0),
  definition_snapshot jsonb NOT NULL CHECK (jsonb_typeof(definition_snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id,site_id,id),
  UNIQUE (organisation_id,site_id,checklist_id,id),
  UNIQUE (organisation_id,site_id,work_order_id,checklist_id,id),
  UNIQUE (organisation_id,site_id,checklist_id,item_code),
  UNIQUE (organisation_id,site_id,checklist_id,ordinal),
  FOREIGN KEY (organisation_id,site_id,work_order_id,checklist_id)
    REFERENCES public.work_order_checklists(organisation_id,site_id,work_order_id,id)
);
CREATE INDEX work_order_checklist_items_ordered
  ON public.work_order_checklist_items(organisation_id,site_id,checklist_id,ordinal,id);

CREATE TABLE public.work_order_checklist_item_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  site_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  checklist_id uuid NOT NULL,
  checklist_item_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision>0),
  result text NOT NULL CHECK (result IN ('completed','failed','not-checked','not-completed','blocked','not-applicable')),
  reason text CHECK (reason IS NULL OR length(trim(reason)) BETWEEN 1 AND 1200),
  comments text CHECK (comments IS NULL OR length(trim(comments)) BETWEEN 1 AND 2400),
  measurement jsonb CHECK (measurement IS NULL OR jsonb_typeof(measurement)='object'),
  actor_id uuid NOT NULL REFERENCES public.staff_users(id),
  actor_placement_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organisation_id,site_id,checklist_item_id,revision),
  FOREIGN KEY (organisation_id,site_id,work_order_id,checklist_id,checklist_item_id)
    REFERENCES public.work_order_checklist_items(organisation_id,site_id,work_order_id,checklist_id,id),
  FOREIGN KEY (organisation_id,site_id,actor_placement_id)
    REFERENCES public.staff_role_placements(organisation_id,site_id,id),
  CHECK (result IN ('completed','not-applicable') OR reason IS NOT NULL),
  CHECK (result<>'not-applicable' OR reason IS NOT NULL)
);
CREATE INDEX work_order_checklist_item_history
  ON public.work_order_checklist_item_revisions(organisation_id,site_id,checklist_item_id,revision DESC);

CREATE FUNCTION public.reject_work_order_checklist_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'checklist item snapshots and outcome history are immutable' USING ERRCODE='55000';
END
$$;
REVOKE ALL ON FUNCTION public.reject_work_order_checklist_snapshot_mutation() FROM PUBLIC;
CREATE TRIGGER work_order_checklist_item_snapshot_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_checklist_snapshot_mutation();
CREATE TRIGGER work_order_checklist_item_revision_immutable
  BEFORE UPDATE OR DELETE ON public.work_order_checklist_item_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_work_order_checklist_snapshot_mutation();

ALTER TABLE public.work_order_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_checklists FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_checklists_staff_read ON public.work_order_checklists
  FOR SELECT USING (public.can_read_workshop_checklist_templates(organisation_id,site_id));
ALTER TABLE public.work_order_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_checklist_items_staff_read ON public.work_order_checklist_items
  FOR SELECT USING (public.can_read_workshop_checklist_templates(organisation_id,site_id));
ALTER TABLE public.work_order_checklist_item_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_checklist_item_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_checklist_item_revisions_staff_read ON public.work_order_checklist_item_revisions
  FOR SELECT USING (public.can_read_workshop_checklist_templates(organisation_id,site_id));
REVOKE ALL ON public.work_order_checklists,public.work_order_checklist_items,public.work_order_checklist_item_revisions FROM PUBLIC,vmms_runtime;
GRANT SELECT ON public.work_order_checklists,public.work_order_checklist_items,public.work_order_checklist_item_revisions TO vmms_runtime;
