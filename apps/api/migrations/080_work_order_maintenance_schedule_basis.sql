DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.work_order_checklists
    WHERE kind='routine-maintenance' AND schedule_basis='delivery-inspection'
  ) THEN
    RAISE EXCEPTION 'Routine-maintenance checklists contain delivery-inspection schedule basis; review and preserve these records before migrating.';
  END IF;
END
$$;

ALTER TABLE public.work_order_checklists
  ADD CONSTRAINT work_order_checklists_maintenance_schedule_basis
  CHECK (kind<>'routine-maintenance' OR schedule_basis<>'delivery-inspection');
