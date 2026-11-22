-- Checklist outcomes must evaluate every qualification dimension against the
-- exact, source-approved checklist item and work-order vehicle.
DROP FUNCTION public.lock_work_order_checklist_qualification(text);

CREATE FUNCTION public.lock_work_order_checklist_qualification(
  requested_code text,
  requested_model_scope text,
  requested_system_code text,
  requested_task_class_code text,
  requested_powertrain_class text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected public.staff_qualifications;
BEGIN
  IF requested_code !~ '^[A-Z0-9][A-Z0-9._-]{1,79}$'
    OR requested_model_scope IS NULL
    OR length(btrim(requested_model_scope)) NOT BETWEEN 1 AND 320
    OR requested_system_code !~ '^[A-Z0-9][A-Z0-9._:-]{1,159}$'
    OR requested_task_class_code !~ '^[A-Z0-9][A-Z0-9._:-]{1,159}$'
    OR requested_powertrain_class NOT IN ('EV','HYB','ICE') THEN
    RAISE EXCEPTION 'Unsupported checklist qualification scope';
  END IF;

  SELECT qualification.* INTO selected FROM public.staff_qualifications qualification
  WHERE qualification.organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND qualification.site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND qualification.staff_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND qualification.qualification_code=requested_code AND qualification.state='accepted'
    AND qualification.qualification_revision=(SELECT max(latest.qualification_revision)
      FROM public.staff_qualifications latest
      WHERE latest.organisation_id=qualification.organisation_id AND latest.site_id=qualification.site_id
        AND latest.staff_user_id=qualification.staff_user_id AND latest.qualification_code=qualification.qualification_code
        AND latest.state<>'pending')
    AND qualification.valid_from<=clock_timestamp()
    AND (qualification.valid_until IS NULL OR qualification.valid_until>clock_timestamp())
    AND requested_powertrain_class=ANY(qualification.powertrain_classes)
    AND EXISTS (SELECT 1 FROM unnest(qualification.vehicle_models) model_scope(value)
      WHERE lower(regexp_replace(btrim(model_scope.value),'\s+',' ','g'))
        =lower(regexp_replace(btrim(requested_model_scope),'\s+',' ','g')))
    AND requested_system_code=ANY(qualification.systems)
    AND requested_task_class_code=ANY(qualification.task_classes)
    AND qualification.restrictions='[]'::jsonb
  FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(selected);
END
$$;

REVOKE ALL ON FUNCTION public.lock_work_order_checklist_qualification(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_work_order_checklist_qualification(text,text,text,text,text) TO vmms_runtime;

-- Do not let a caller insert a checklist item that lacks approved classification
-- dimensions, even if it bypasses the API and calls the database directly.
DROP POLICY work_order_checklist_items_prepare_draft ON public.work_order_checklist_items;
CREATE POLICY work_order_checklist_items_prepare_draft ON public.work_order_checklist_items
  FOR INSERT WITH CHECK (
    organisation_id=nullif(current_setting('app.organisation_id',true),'')::uuid
    AND site_id=nullif(current_setting('app.site_id',true),'')::uuid
    AND public.can_read_workshop_checklist_templates(organisation_id,site_id)
    AND EXISTS (
      SELECT 1 FROM public.work_order_checklists checklist
      WHERE checklist.organisation_id=work_order_checklist_items.organisation_id
        AND checklist.site_id=work_order_checklist_items.site_id
        AND checklist.work_order_id=work_order_checklist_items.work_order_id
        AND checklist.id=work_order_checklist_items.checklist_id
        AND checklist.created_by=nullif(current_setting('app.actor_id',true),'')::uuid
        AND checklist.state='draft' AND checklist.kind='routine-maintenance'
        AND EXISTS (
          SELECT 1 FROM public.workshop_checklist_template_revisions template,
            LATERAL jsonb_array_elements(template.items) source_item
          WHERE template.organisation_id=checklist.organisation_id AND template.site_id=checklist.site_id
            AND template.id=checklist.template_revision_id
            AND source_item->>'id'=work_order_checklist_items.item_code
            AND source_item=work_order_checklist_items.definition_snapshot
            AND jsonb_typeof(source_item->'requiredQualifications')='array'
            AND jsonb_array_length(source_item->'requiredQualifications')>0
            AND jsonb_typeof(source_item->'classification')='object'
            AND source_item->'classification' ?& ARRAY['systemCode','taskClassCode']
            AND source_item->'classification'->>'systemCode' ~ '^[A-Z0-9][A-Z0-9._:-]{1,159}$'
            AND source_item->'classification'->>'taskClassCode' ~ '^[A-Z0-9][A-Z0-9._:-]{1,159}$'
        )
    )
  );
