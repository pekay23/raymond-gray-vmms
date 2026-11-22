INSERT INTO public.aggregate_roots(id,organisation_id,site_id,aggregate_type)
SELECT item.id,item.organisation_id,item.site_id,'work-order-checklist-item'
FROM public.work_order_checklist_items item
ON CONFLICT(id) DO NOTHING;